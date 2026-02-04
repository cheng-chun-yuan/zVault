//! Bitcoin utilities module
//!
//! Provides Bitcoin-specific utilities for transaction parsing,
//! hash computation, and merkle proof verification.
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `tx_hash` | Transaction hash computation (double SHA256) |
//! | `merkle_proof` | Bitcoin merkle proof verification |
//! | `address` | Bitcoin address parsing and validation |

pub mod address;
pub mod merkle_proof;
pub mod tx_hash;

// Re-export commonly used items
pub use merkle_proof::{verify_bitcoin_merkle_proof, compute_bitcoin_merkle_root};
pub use tx_hash::{
    compute_tx_hash, compute_txid, ParsedTransaction, OutputIterator, TxOutput,
    StealthOpReturnData, COMMITMENT_SIZE, OP_RETURN, STEALTH_OP_RETURN_MAGIC,
    STEALTH_OP_RETURN_SIZE, STEALTH_OP_RETURN_VERSION,
};

// Re-export SHA256 functions from crypto module for convenience
pub use crate::shared::crypto::sha256::{
    double_sha256, double_sha256_pair, sha256, hash_meets_target,
    calculate_chainwork, add_chainwork,
};
