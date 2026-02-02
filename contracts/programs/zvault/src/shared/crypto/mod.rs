//! Cryptographic utilities module
//!
//! Provides cryptographic primitives used throughout the zVault program:
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `poseidon` | Poseidon hash for Merkle tree operations (BN254 field) |
//! | `merkle` | Merkle tree computation and verification |
//! | `sha256` | SHA256 hashing for Bitcoin operations |

pub mod merkle;
pub mod poseidon;
pub mod sha256;

// Re-export commonly used items
pub use merkle::{compute_merkle_root, ZERO_HASHES};
pub use poseidon::poseidon2_hash;
pub use sha256::{double_sha256, double_sha256_pair, sha256};
