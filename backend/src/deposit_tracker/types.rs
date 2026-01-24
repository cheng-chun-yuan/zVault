//! Deposit Tracker Types
//!
//! Types for tracking Bitcoin deposits through their lifecycle:
//! pending → detected → confirming → confirmed → sweeping → sweep_confirming → verifying → ready → claimed

use serde::{Deserialize, Serialize};

/// Status of a deposit through its lifecycle
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DepositStatus {
    /// Waiting for BTC deposit to appear
    Pending,
    /// BTC transaction seen in mempool
    Detected,
    /// 0 confirmations on deposit tx
    Confirming,
    /// 1+ confirmations, ready to sweep
    Confirmed,
    /// Creating and broadcasting sweep tx to pool wallet
    Sweeping,
    /// Waiting for 2 confirmations on sweep tx
    SweepConfirming,
    /// Submitting sweep tx for SPV verification on Solana
    Verifying,
    /// Verified on Solana, can claim sbBTC
    Ready,
    /// sbBTC minted
    Claimed,
    /// Error occurred
    Failed,
}

impl Default for DepositStatus {
    fn default() -> Self {
        Self::Pending
    }
}

impl std::fmt::Display for DepositStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Detected => write!(f, "detected"),
            Self::Confirming => write!(f, "confirming"),
            Self::Confirmed => write!(f, "confirmed"),
            Self::Sweeping => write!(f, "sweeping"),
            Self::SweepConfirming => write!(f, "sweep_confirming"),
            Self::Verifying => write!(f, "verifying"),
            Self::Ready => write!(f, "ready"),
            Self::Claimed => write!(f, "claimed"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

/// A deposit record tracking a single Bitcoin deposit through its lifecycle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositRecord {
    /// Unique deposit ID
    pub id: String,
    /// Taproot address for this deposit
    pub taproot_address: String,
    /// The SHA256(nullifier || secret) commitment (hex, 32 bytes)
    pub commitment: String,
    /// Amount in satoshis
    pub amount_sats: u64,
    /// Current status
    pub status: DepositStatus,
    /// Number of confirmations on deposit tx
    pub confirmations: u32,

    // Original deposit transaction
    /// Bitcoin transaction ID of user's deposit
    pub deposit_txid: Option<String>,
    /// Output index in the deposit transaction
    pub deposit_vout: Option<u32>,
    /// Block height of deposit confirmation
    pub deposit_block_height: Option<u64>,

    // Sweep transaction (spends to pool wallet)
    /// Transaction ID of the sweep tx (this is used for SPV)
    pub sweep_txid: Option<String>,
    /// Confirmations on the sweep tx
    pub sweep_confirmations: u32,
    /// Block height of sweep confirmation
    pub sweep_block_height: Option<u64>,
    /// Pool wallet address that received the sweep
    pub pool_address: Option<String>,

    // Solana verification (uses sweep_txid)
    /// Solana transaction signature for SPV verification
    pub solana_tx: Option<String>,
    /// Leaf index in the commitment tree
    pub leaf_index: Option<u64>,

    /// Timestamp when deposit was registered
    pub created_at: u64,
    /// Timestamp of last status update
    pub updated_at: u64,
    /// Error message if failed
    pub error: Option<String>,
}

impl DepositRecord {
    /// Create a new deposit record
    pub fn new(taproot_address: String, commitment: String, amount_sats: u64) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let id = format!("dep_{}_{:08x}", now, rand::random::<u32>());

        Self {
            id,
            taproot_address,
            commitment,
            amount_sats,
            status: DepositStatus::Pending,
            confirmations: 0,
            deposit_txid: None,
            deposit_vout: None,
            deposit_block_height: None,
            sweep_txid: None,
            sweep_confirmations: 0,
            sweep_block_height: None,
            pool_address: None,
            solana_tx: None,
            leaf_index: None,
            created_at: now,
            updated_at: now,
            error: None,
        }
    }

    /// Update status and touch timestamp
    pub fn set_status(&mut self, status: DepositStatus) {
        self.status = status;
        self.touch();
    }

    /// Mark as detected (tx seen in mempool)
    pub fn mark_detected(&mut self, txid: String, vout: u32) {
        self.deposit_txid = Some(txid);
        self.deposit_vout = Some(vout);
        self.status = DepositStatus::Detected;
        self.touch();
    }

    /// Update confirmation count
    pub fn update_confirmations(&mut self, confirmations: u32, block_height: Option<u64>) {
        self.confirmations = confirmations;
        if let Some(height) = block_height {
            self.deposit_block_height = Some(height);
        }

        // Update status based on confirmations
        if confirmations == 0 {
            self.status = DepositStatus::Detected;
        } else if confirmations < 1 {
            self.status = DepositStatus::Confirming;
        } else {
            self.status = DepositStatus::Confirmed;
        }
        self.touch();
    }

    /// Mark as sweeping
    pub fn mark_sweeping(&mut self) {
        self.status = DepositStatus::Sweeping;
        self.touch();
    }

    /// Mark sweep tx broadcast
    pub fn mark_sweep_broadcast(&mut self, sweep_txid: String, pool_address: String) {
        self.sweep_txid = Some(sweep_txid);
        self.pool_address = Some(pool_address);
        self.status = DepositStatus::SweepConfirming;
        self.touch();
    }

    /// Update sweep confirmation count
    pub fn update_sweep_confirmations(&mut self, confirmations: u32, block_height: Option<u64>) {
        self.sweep_confirmations = confirmations;
        if let Some(height) = block_height {
            self.sweep_block_height = Some(height);
        }
        self.touch();
    }

    /// Mark as verifying (SPV proof being submitted)
    pub fn mark_verifying(&mut self) {
        self.status = DepositStatus::Verifying;
        self.touch();
    }

    /// Mark as ready (verified on Solana)
    pub fn mark_ready(&mut self, solana_tx: String, leaf_index: u64) {
        self.solana_tx = Some(solana_tx);
        self.leaf_index = Some(leaf_index);
        self.status = DepositStatus::Ready;
        self.touch();
    }

    /// Mark as claimed
    pub fn mark_claimed(&mut self) {
        self.status = DepositStatus::Claimed;
        self.touch();
    }

    /// Mark as failed
    pub fn mark_failed(&mut self, error: String) {
        self.error = Some(error);
        self.status = DepositStatus::Failed;
        self.touch();
    }

    /// Update timestamp
    fn touch(&mut self) {
        self.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
    }

    /// Check if deposit can proceed to sweeping
    pub fn can_sweep(&self) -> bool {
        self.status == DepositStatus::Confirmed && self.confirmations >= 1
    }

    /// Check if sweep is ready for SPV verification
    pub fn can_verify(&self) -> bool {
        self.status == DepositStatus::SweepConfirming && self.sweep_confirmations >= 2
    }

    /// Check if user can claim sbBTC
    pub fn can_claim(&self) -> bool {
        self.status == DepositStatus::Ready
    }
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/// POST /api/deposits - Register a new deposit to track
#[derive(Debug, Deserialize)]
pub struct RegisterDepositRequest {
    /// Taproot deposit address (bc1p... or tb1p...)
    pub taproot_address: String,
    /// The commitment SHA256(nullifier || secret) as hex (64 chars)
    pub commitment: String,
    /// Expected amount in satoshis
    pub amount_sats: u64,
    /// Optional claim link for reference
    pub claim_link: Option<String>,
}

/// Response to POST /api/deposits
#[derive(Debug, Serialize)]
pub struct RegisterDepositResponse {
    pub success: bool,
    pub deposit_id: Option<String>,
    pub message: Option<String>,
}

/// GET /api/deposits/:id - Deposit status response
#[derive(Debug, Serialize)]
pub struct DepositStatusResponse {
    pub id: String,
    pub status: String,
    pub confirmations: u32,
    pub can_claim: bool,
    pub btc_txid: Option<String>,
    pub sweep_txid: Option<String>,
    pub sweep_confirmations: u32,
    pub solana_tx: Option<String>,
    pub leaf_index: Option<u64>,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl From<&DepositRecord> for DepositStatusResponse {
    fn from(record: &DepositRecord) -> Self {
        Self {
            id: record.id.clone(),
            status: record.status.to_string(),
            confirmations: record.confirmations,
            can_claim: record.can_claim(),
            btc_txid: record.deposit_txid.clone(),
            sweep_txid: record.sweep_txid.clone(),
            sweep_confirmations: record.sweep_confirmations,
            solana_tx: record.solana_tx.clone(),
            leaf_index: record.leaf_index,
            error: record.error.clone(),
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

/// WebSocket message sent to clients
#[derive(Debug, Clone, Serialize)]
pub struct DepositStatusUpdate {
    pub deposit_id: String,
    pub status: String,
    pub confirmations: u32,
    pub sweep_confirmations: u32,
    pub can_claim: bool,
    pub error: Option<String>,
}

impl From<&DepositRecord> for DepositStatusUpdate {
    fn from(record: &DepositRecord) -> Self {
        Self {
            deposit_id: record.id.clone(),
            status: record.status.to_string(),
            confirmations: record.confirmations,
            sweep_confirmations: record.sweep_confirmations,
            can_claim: record.can_claim(),
            error: record.error.clone(),
        }
    }
}

/// Tracker service configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerConfig {
    /// Polling interval in seconds
    pub poll_interval_secs: u64,
    /// Required confirmations for deposit
    pub required_confirmations: u32,
    /// Required confirmations for sweep before SPV
    pub required_sweep_confirmations: u32,
    /// Esplora API URL
    pub esplora_url: String,
    /// Solana RPC URL
    pub solana_rpc: String,
    /// Pool receive address for swept funds
    pub pool_receive_address: String,
}

impl Default for TrackerConfig {
    fn default() -> Self {
        Self {
            poll_interval_secs: 10,
            required_confirmations: 1, // Reduced to 1 for demo/testing
            required_sweep_confirmations: 2,
            esplora_url: "https://blockstream.info/testnet/api".to_string(),
            solana_rpc: "https://api.devnet.solana.com".to_string(),
            pool_receive_address: String::new(), // Must be set via env
        }
    }
}

/// Tracker statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TrackerStats {
    pub total_deposits: u64,
    pub pending: u64,
    pub confirming: u64,
    pub ready: u64,
    pub claimed: u64,
    pub failed: u64,
    pub total_sats_received: u64,
}

impl std::fmt::Display for TrackerStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Deposits: {} total | {} pending | {} confirming | {} ready | {} claimed | {} failed",
            self.total_deposits,
            self.pending,
            self.confirming,
            self.ready,
            self.claimed,
            self.failed
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deposit_record_lifecycle() {
        let mut record = DepositRecord::new(
            "tb1p123...".to_string(),
            "abcd".repeat(16),
            100_000,
        );

        assert_eq!(record.status, DepositStatus::Pending);
        assert!(!record.can_claim());

        // Detect
        record.mark_detected("txid123".to_string(), 0);
        assert_eq!(record.status, DepositStatus::Detected);

        // Confirm (1 confirmation is enough for demo/testing)
        record.update_confirmations(1, Some(1000));
        assert_eq!(record.status, DepositStatus::Confirmed);
        assert!(record.can_sweep());

        // Sweep
        record.mark_sweeping();
        record.mark_sweep_broadcast("sweep_txid".to_string(), "pool_addr".to_string());
        assert_eq!(record.status, DepositStatus::SweepConfirming);

        // Sweep confirms
        record.update_sweep_confirmations(2, Some(1002));
        assert!(record.can_verify());

        // Verify
        record.mark_verifying();
        record.mark_ready("sol_tx".to_string(), 42);
        assert_eq!(record.status, DepositStatus::Ready);
        assert!(record.can_claim());
    }

    #[test]
    fn test_status_display() {
        assert_eq!(DepositStatus::Pending.to_string(), "pending");
        assert_eq!(DepositStatus::Confirming.to_string(), "confirming");
        assert_eq!(DepositStatus::Ready.to_string(), "ready");
    }
}
