//! sbBTC Backend - Minimal Server-Side Services
//!
//! This backend only contains the server-side components that cannot run
//! on the client. All other functionality is handled by the SDK.
//!
//! ## Server-Side Services
//!
//! 1. **Header Relay (TypeScript)** - Submits Bitcoin headers to Solana light client
//! 2. **Redemption Processor** - Signs and broadcasts BTC withdrawals
//!
//! ## Client-Side (SDK)
//!
//! All deposit, claim, and verification logic is handled by the SDK:
//! - Note generation (nullifier + secret)
//! - Taproot address derivation
//! - Noir ZK proof generation
//! - Merkle tree operations
//! - Transaction building and signing

// Core modules (kept)
pub mod api;
pub mod btc_client;
pub mod btc_spv;
pub mod deposit_tracker;
pub mod esplora;
pub mod redemption;
pub mod sol_client;
pub mod taproot;

// Re-exports: Bitcoin signer
pub use btc_client::{FrostConfig, Signer, SignerError, SingleKeySigner};

// Re-exports: Solana client
pub use sol_client::{
    generate_keypair as generate_sol_keypair, load_keypair_from_file, SolClient, SolConfig,
    SolError, DEVNET_RPC,
};

// Re-exports: Esplora client
pub use esplora::{EsploraClient, EsploraError, EsploraTxStatus};

// Re-exports: Redemption service
pub use redemption::{
    PoolUtxo, RedemptionConfig, RedemptionService, RedemptionStats, WithdrawalRequest,
    WithdrawalStatus,
};

// Re-exports: Bitcoin SPV
pub use btc_spv::{BlockHeader, SpvError, SpvProof, SpvProofGenerator, TxDetails, TxMerkleProof};

// Re-exports: Taproot
pub use taproot::{
    generate_deposit_address, get_unlock_criteria, PoolKeys, TaprootDeposit, TaprootError,
    UnlockCriteria,
};

// Re-exports: Deposit Tracker
pub use deposit_tracker::{
    create_tracker_service, create_ws_state, DepositRecord, DepositStatus, DepositStatusResponse,
    DepositTrackerService, RegisterDepositRequest, RegisterDepositResponse, SharedTrackerService,
    TrackerConfig, TrackerError, TrackerStats,
};

/// Satoshi conversion helpers
pub mod units {
    pub const SATS_PER_BTC: u64 = 100_000_000;

    /// Convert BTC to satoshis with proper rounding
    pub fn btc_to_sats(btc: f64) -> u64 {
        (btc * SATS_PER_BTC as f64).round() as u64
    }

    pub fn sats_to_btc(sats: u64) -> f64 {
        sats as f64 / SATS_PER_BTC as f64
    }

    pub fn format_sats(sats: u64) -> String {
        let btc = sats_to_btc(sats);
        format!("{} sats ({:.8} BTC)", sats, btc)
    }
}
