//! Cryptographic utilities module
//!
//! Provides cryptographic primitives used throughout the zVault program:
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `poseidon` | Poseidon hash for Merkle tree operations (BN254 field) |
//! | `merkle` | Merkle tree computation and verification |
//! | `sha256` | SHA256 hashing for Bitcoin operations |
//! | `groth16` | Groth16 proof parsing (verification via Sunspot CPI) |

pub mod groth16;
pub mod merkle;
pub mod poseidon;
pub mod sha256;

// Re-export commonly used items
pub use groth16::{parse_sunspot_proof, GROTH16_PROOF_CORE_SIZE, SUNSPOT_PROOF_MIN_SIZE};
pub use merkle::{compute_merkle_root, TREE_DEPTH, ZERO_HASHES};
pub use poseidon::poseidon2_hash;
pub use sha256::{double_sha256, double_sha256_pair, sha256};
