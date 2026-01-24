//! Deposit Tracker Service
//!
//! Main service that tracks Bitcoin deposits through their lifecycle:
//! pending → detected → confirming → confirmed → sweeping → sweep_confirming → verifying → ready
//!
//! # Flow:
//! 1. User registers deposit (taproot address + commitment)
//! 2. Service polls Esplora for incoming transactions
//! 3. Once confirmed (6 blocks), sweeps UTXO to pool wallet
//! 4. After sweep confirms (2 blocks), submits SPV proof to Solana
//! 5. User can claim sbBTC once status is "ready"

use solana_sdk::signature::Keypair;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

use super::sweeper::{SweeperError, UtxoSweeper};
use super::types::{DepositRecord, DepositStatus, TrackerConfig, TrackerStats};
use super::verifier::{SpvVerifier, VerifierError};
use super::watcher::{AddressWatcher, WatcherError};
use super::websocket::{DepositUpdatePublisher, SharedWebSocketState};

/// Deposit tracker service errors
#[derive(Debug, thiserror::Error)]
pub enum TrackerError {
    #[error("Deposit not found: {0}")]
    NotFound(String),

    #[error("Invalid commitment: {0}")]
    InvalidCommitment(String),

    #[error("Invalid address: {0}")]
    InvalidAddress(String),

    #[error("Watcher error: {0}")]
    Watcher(#[from] WatcherError),

    #[error("Sweeper error: {0}")]
    Sweeper(#[from] SweeperError),

    #[error("Verifier error: {0}")]
    Verifier(#[from] VerifierError),

    #[error("Duplicate deposit: {0}")]
    Duplicate(String),
}

/// Main deposit tracker service
pub struct DepositTrackerService {
    /// Configuration
    config: TrackerConfig,
    /// In-memory deposit storage (address -> record)
    deposits: HashMap<String, DepositRecord>,
    /// Lookup by ID
    deposits_by_id: HashMap<String, String>,
    /// Address watcher
    watcher: AddressWatcher,
    /// UTXO sweeper
    sweeper: Option<UtxoSweeper>,
    /// SPV verifier
    verifier: Option<SpvVerifier>,
    /// WebSocket publisher
    publisher: Option<DepositUpdatePublisher>,
    /// Statistics
    stats: TrackerStats,
}

impl DepositTrackerService {
    /// Create a new tracker service for testnet
    pub fn new_testnet(config: TrackerConfig) -> Self {
        let watcher = AddressWatcher::testnet();

        Self {
            config,
            deposits: HashMap::new(),
            deposits_by_id: HashMap::new(),
            watcher,
            sweeper: None,
            verifier: None,
            publisher: None,
            stats: TrackerStats::default(),
        }
    }

    /// Create with custom configuration
    pub fn new(config: TrackerConfig) -> Self {
        let watcher = AddressWatcher::new(&config.esplora_url);

        Self {
            config,
            deposits: HashMap::new(),
            deposits_by_id: HashMap::new(),
            watcher,
            sweeper: None,
            verifier: None,
            publisher: None,
            stats: TrackerStats::default(),
        }
    }

    /// Set up sweeper with pool private key
    pub fn with_sweeper(mut self, pool_signing_key: &str) -> Result<Self, TrackerError> {
        let sweeper = UtxoSweeper::from_private_key(
            pool_signing_key,
            self.config.pool_receive_address.clone(),
            bitcoin::Network::Testnet,
        )
        .map_err(|e| TrackerError::InvalidAddress(e.to_string()))?;

        self.sweeper = Some(sweeper);
        Ok(self)
    }

    /// Set up verifier with Solana keypair
    pub fn with_verifier(mut self, keypair: Keypair) -> Self {
        let mut verifier = SpvVerifier::new_testnet(&self.config.solana_rpc);
        verifier.set_payer(keypair);
        self.verifier = Some(verifier);
        self
    }

    /// Set up WebSocket publisher
    pub fn with_websocket(mut self, ws_state: SharedWebSocketState) -> Self {
        self.publisher = Some(DepositUpdatePublisher::new(ws_state));
        self
    }

    /// Register a new deposit to track
    pub fn register_deposit(
        &mut self,
        taproot_address: String,
        commitment: String,
        amount_sats: u64,
    ) -> Result<String, TrackerError> {
        // Validate commitment format
        if commitment.len() != 64 {
            return Err(TrackerError::InvalidCommitment(format!(
                "wrong length: {} != 64",
                commitment.len()
            )));
        }

        // Check for duplicate
        if self.deposits.contains_key(&taproot_address) {
            return Err(TrackerError::Duplicate(taproot_address));
        }

        // Create new record
        let record = DepositRecord::new(taproot_address.clone(), commitment, amount_sats);
        let id = record.id.clone();

        // Store
        self.deposits_by_id.insert(id.clone(), taproot_address.clone());
        self.deposits.insert(taproot_address, record);

        // Update stats
        self.stats.total_deposits += 1;
        self.stats.pending += 1;

        Ok(id)
    }

    /// Get deposit by ID
    pub fn get_deposit(&self, id: &str) -> Option<&DepositRecord> {
        self.deposits_by_id
            .get(id)
            .and_then(|addr| self.deposits.get(addr))
    }

    /// Get deposit by ID (mutable)
    fn get_deposit_mut(&mut self, id: &str) -> Option<&mut DepositRecord> {
        let addr = self.deposits_by_id.get(id)?.clone();
        self.deposits.get_mut(&addr)
    }

    /// Get deposit by address
    pub fn get_deposit_by_address(&self, address: &str) -> Option<&DepositRecord> {
        self.deposits.get(address)
    }

    /// Get all deposits
    pub fn get_all_deposits(&self) -> Vec<&DepositRecord> {
        self.deposits.values().collect()
    }

    /// Get statistics
    pub fn stats(&self) -> &TrackerStats {
        &self.stats
    }

    /// Run the tracker service (blocking)
    pub async fn run(&mut self) -> Result<(), TrackerError> {
        println!("=== Deposit Tracker Service ===");
        println!("Poll interval: {} seconds", self.config.poll_interval_secs);
        println!("Required confirmations: {}", self.config.required_confirmations);
        println!(
            "Required sweep confirmations: {}",
            self.config.required_sweep_confirmations
        );
        println!();

        let mut poll_interval = interval(Duration::from_secs(self.config.poll_interval_secs));

        loop {
            poll_interval.tick().await;
            if let Err(e) = self.process_cycle().await {
                eprintln!("Process cycle error: {}", e);
            }
        }
    }

    /// Run a single processing cycle
    pub async fn process_cycle(&mut self) -> Result<(), TrackerError> {
        // Collect addresses to check (clone to avoid borrow issues)
        let addresses: Vec<String> = self.deposits.keys().cloned().collect();

        for address in addresses {
            if let Err(e) = self.process_deposit(&address).await {
                eprintln!("Error processing deposit {}: {}", address, e);
                // Mark as failed if there's a serious error
                let should_publish = if let Some(record) = self.deposits.get_mut(&address) {
                    if !matches!(
                        record.status,
                        DepositStatus::Claimed | DepositStatus::Failed
                    ) {
                        // Only mark failed for certain errors
                        match &e {
                            TrackerError::Sweeper(_) | TrackerError::Verifier(_) => {
                                record.mark_failed(e.to_string());
                                true
                            }
                            _ => false,
                        }
                    } else {
                        false
                    }
                } else {
                    false
                };

                if should_publish {
                    if let Some(record) = self.deposits.get(&address) {
                        self.publish_update(record).await;
                    }
                }
            }
        }

        Ok(())
    }

    /// Process a single deposit
    async fn process_deposit(&mut self, address: &str) -> Result<(), TrackerError> {
        let record = self.deposits.get(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        // Clone needed data to avoid borrow issues
        let status = record.status;
        let commitment = record.commitment.clone();

        match status {
            DepositStatus::Pending | DepositStatus::Detected | DepositStatus::Confirming => {
                // Check for deposits and update confirmations
                self.check_and_update_confirmations(address).await?;
            }
            DepositStatus::Confirmed => {
                // Ready to sweep
                self.sweep_deposit(address, &commitment).await?;
            }
            DepositStatus::Sweeping => {
                // Waiting for sweep tx broadcast - handled in sweep_deposit
            }
            DepositStatus::SweepConfirming => {
                // Check sweep confirmations
                self.check_sweep_confirmations(address).await?;
            }
            DepositStatus::Verifying => {
                // SPV verification in progress - check if done
                self.check_verification_status(address).await?;
            }
            DepositStatus::Ready => {
                // Waiting for user to claim - nothing to do
            }
            DepositStatus::Claimed | DepositStatus::Failed => {
                // Terminal states - nothing to do
            }
        }

        // Publish update after processing
        if let Some(record) = self.deposits.get(address) {
            self.publish_update(record).await;
        }

        Ok(())
    }

    /// Check address for deposits and update confirmation count
    async fn check_and_update_confirmations(&mut self, address: &str) -> Result<(), TrackerError> {
        let addr_status = self.watcher.check_address(address).await?;

        if addr_status.utxos.is_empty() {
            // No deposit yet
            return Ok(());
        }

        // Find the first UTXO (assuming single deposit per address)
        let utxo = addr_status.utxos[0].clone();

        let record = self.deposits.get_mut(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        // Update record if we found a deposit
        if record.deposit_txid.is_none() {
            record.mark_detected(utxo.txid.clone(), utxo.vout);
            println!(
                "[{}] Deposit detected: {} ({} sats)",
                record.id, utxo.txid, utxo.value
            );

            // Update amount if different
            if record.amount_sats != utxo.value {
                record.amount_sats = utxo.value;
            }
        }

        // Update confirmations
        let old_status = record.status;
        record.update_confirmations(utxo.confirmations, utxo.block_height);
        let new_status = record.status;
        let record_id = record.id.clone();

        // Drop the mutable borrow before updating stats
        if new_status != old_status {
            println!(
                "[{}] Status: {:?} → {:?} ({} confirmations)",
                record_id, old_status, new_status, utxo.confirmations
            );

            // Update stats
            self.update_stats_for_status_change(old_status, new_status);
        }

        Ok(())
    }

    /// Sweep deposit UTXO to pool wallet
    async fn sweep_deposit(&mut self, address: &str, commitment: &str) -> Result<(), TrackerError> {
        let sweeper = match &self.sweeper {
            Some(s) => s,
            None => {
                eprintln!("Sweeper not configured, skipping sweep");
                return Ok(());
            }
        };

        let record = self.deposits.get_mut(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        // Mark as sweeping
        record.mark_sweeping();
        println!("[{}] Sweeping UTXO to pool wallet...", record.id);

        // Attempt sweep
        let result = sweeper
            .sweep_utxo(address, commitment, self.config.required_confirmations)
            .await?;

        // Update record with sweep tx
        record.mark_sweep_broadcast(result.txid.clone(), result.pool_address);
        println!(
            "[{}] Sweep broadcast: {} (fee: {} sats)",
            record.id, result.txid, result.fee_sats
        );

        Ok(())
    }

    /// Check sweep transaction confirmations
    async fn check_sweep_confirmations(&mut self, address: &str) -> Result<(), TrackerError> {
        let record = self.deposits.get(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        let sweep_txid = match &record.sweep_txid {
            Some(txid) => txid.clone(),
            None => return Ok(()),
        };

        let record_id = record.id.clone();
        let commitment = record.commitment.clone();

        // Get sweep tx confirmations
        let tx_status = self.watcher.get_tx_confirmations(&sweep_txid).await?;

        let record = self.deposits.get_mut(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        record.update_sweep_confirmations(tx_status.confirmations, tx_status.block_height);

        println!(
            "[{}] Sweep confirmations: {}",
            record_id, tx_status.confirmations
        );

        // If enough confirmations, proceed to verification
        if record.can_verify() {
            self.verify_deposit(address, &sweep_txid, &commitment).await?;
        }

        Ok(())
    }

    /// Submit deposit for SPV verification
    async fn verify_deposit(
        &mut self,
        address: &str,
        sweep_txid: &str,
        commitment: &str,
    ) -> Result<(), TrackerError> {
        let verifier = match &self.verifier {
            Some(v) => v,
            None => {
                eprintln!("Verifier not configured, skipping verification");
                return Ok(());
            }
        };

        let record = self.deposits.get_mut(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        let amount_sats = record.amount_sats;
        let record_id = record.id.clone();

        // Check if already verified
        if verifier.is_already_verified(sweep_txid).await? {
            println!("[{}] Already verified on Solana", record_id);
            record.mark_ready("already_verified".to_string(), 0);
            return Ok(());
        }

        // Mark as verifying
        record.mark_verifying();
        println!("[{}] Submitting SPV verification...", record_id);

        // Submit verification
        let result = verifier
            .verify_deposit(sweep_txid, 0, commitment, amount_sats)
            .await?;

        // Update record
        let record = self.deposits.get_mut(address).ok_or_else(|| {
            TrackerError::NotFound(address.to_string())
        })?;

        record.mark_ready(result.solana_tx.clone(), result.leaf_index);
        println!(
            "[{}] Verified! Solana TX: {}, Leaf index: {}",
            record_id, result.solana_tx, result.leaf_index
        );

        // Update stats
        self.stats.ready += 1;
        self.stats.total_sats_received += amount_sats;

        Ok(())
    }

    /// Check verification status (for deposits in Verifying state)
    async fn check_verification_status(&mut self, _address: &str) -> Result<(), TrackerError> {
        // Verification is synchronous in verify_deposit
        // This is a placeholder for async verification flows
        Ok(())
    }

    /// Publish status update via WebSocket
    async fn publish_update(&self, record: &DepositRecord) {
        if let Some(publisher) = &self.publisher {
            publisher.publish_deposit_status(record).await;
        }
    }

    /// Update stats for status change
    fn update_stats_for_status_change(&mut self, old: DepositStatus, new: DepositStatus) {
        // Decrement old status
        match old {
            DepositStatus::Pending => self.stats.pending = self.stats.pending.saturating_sub(1),
            DepositStatus::Confirming | DepositStatus::Detected => {
                self.stats.confirming = self.stats.confirming.saturating_sub(1)
            }
            DepositStatus::Ready => self.stats.ready = self.stats.ready.saturating_sub(1),
            _ => {}
        }

        // Increment new status
        match new {
            DepositStatus::Pending => self.stats.pending += 1,
            DepositStatus::Confirming | DepositStatus::Detected => self.stats.confirming += 1,
            DepositStatus::Ready => self.stats.ready += 1,
            DepositStatus::Claimed => self.stats.claimed += 1,
            DepositStatus::Failed => self.stats.failed += 1,
            _ => {}
        }
    }

    /// Mark deposit as claimed (called by claim handler)
    pub fn mark_claimed(&mut self, id: &str) -> Result<(), TrackerError> {
        let (old_status, new_status) = {
            let record = self.get_deposit_mut(id).ok_or_else(|| {
                TrackerError::NotFound(id.to_string())
            })?;

            if record.status != DepositStatus::Ready {
                return Err(TrackerError::InvalidCommitment(format!(
                    "cannot claim deposit in status {:?}",
                    record.status
                )));
            }

            let old_status = record.status;
            record.mark_claimed();
            (old_status, record.status)
        };

        self.update_stats_for_status_change(old_status, new_status);

        Ok(())
    }
}

/// Shared service type for API handlers
pub type SharedTrackerService = Arc<RwLock<DepositTrackerService>>;

/// Create shared tracker service
pub fn create_tracker_service(config: TrackerConfig) -> SharedTrackerService {
    Arc::new(RwLock::new(DepositTrackerService::new_testnet(config)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_deposit() {
        let config = TrackerConfig::default();
        let mut service = DepositTrackerService::new_testnet(config);

        let id = service
            .register_deposit(
                "tb1p123abc".to_string(),
                "a".repeat(64),
                100_000,
            )
            .unwrap();

        assert!(id.starts_with("dep_"));

        let record = service.get_deposit(&id).unwrap();
        assert_eq!(record.status, DepositStatus::Pending);
        assert_eq!(record.amount_sats, 100_000);
    }

    #[test]
    fn test_duplicate_registration() {
        let config = TrackerConfig::default();
        let mut service = DepositTrackerService::new_testnet(config);

        service
            .register_deposit("tb1p123".to_string(), "b".repeat(64), 50_000)
            .unwrap();

        // Duplicate should fail
        let result = service.register_deposit("tb1p123".to_string(), "c".repeat(64), 60_000);
        assert!(matches!(result, Err(TrackerError::Duplicate(_))));
    }

    #[test]
    fn test_invalid_commitment() {
        let config = TrackerConfig::default();
        let mut service = DepositTrackerService::new_testnet(config);

        // Too short
        let result = service.register_deposit("tb1p456".to_string(), "abc".to_string(), 10_000);
        assert!(matches!(result, Err(TrackerError::InvalidCommitment(_))));
    }
}
