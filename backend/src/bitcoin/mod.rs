//! Bitcoin Infrastructure Module
//!
//! This module provides all Bitcoin-related functionality for the zVault backend:
//! - Esplora API client for blockchain interaction
//! - Transaction signing (single-key and future FROST)
//! - Taproot address generation with embedded commitments
//! - SPV proof generation for deposit verification

pub mod client;
pub mod signer;
pub mod spv;
pub mod taproot;

// Re-exports for convenience
pub use client::{
    BlockHeaderInfo, EsploraClient, EsploraError, EsploraTxStatus, MerkleProofInfo, UtxoInfo,
    MAINNET_URL, TESTNET_URL,
};
pub use signer::{FrostConfig, Signer, SignerError, SingleKeySigner};
pub use spv::{
    txid_to_bytes, BlockHeader, SpvError, SpvProof, SpvProofGenerator, TxDetails, TxMerkleProof,
};
pub use taproot::{
    build_timelock_script, generate_deposit_address, generate_deposit_address_dual_path,
    get_unlock_criteria, parse_x_only_pubkey, PoolKeys, SpendingProof, TaprootDeposit,
    TaprootDepositDualPath, TaprootDepositDualPathRaw, TaprootError, UnlockCriteria, UnlockStep,
    ADMIN_SWEEP_CONFIRMATIONS, REFUND_TIMELOCK_BLOCKS, REFUND_TIMELOCK_BLOCKS_TESTNET,
    SPV_REQUIRED_CONFIRMATIONS,
};
