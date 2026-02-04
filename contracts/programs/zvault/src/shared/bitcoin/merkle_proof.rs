//! Bitcoin merkle proof verification
//!
//! Provides utilities for verifying Bitcoin merkle proofs using
//! double SHA256 hashing as per Bitcoin protocol.

use pinocchio::program_error::ProgramError;

use crate::shared::crypto::sha256::double_sha256_pair;

/// Verify a Bitcoin merkle proof
///
/// Bitcoin uses double SHA256 for merkle tree computation.
/// The proof nodes are provided from leaf to root.
///
/// # Arguments
/// * `tx_hash` - The transaction hash (little-endian, as in block)
/// * `tx_index` - The index of the transaction in the block
/// * `merkle_proof` - Array of proof nodes from leaf to root
/// * `merkle_root` - The expected merkle root from the block header
///
/// # Returns
/// * `Ok(true)` if the proof is valid
/// * `Ok(false)` if the proof is invalid
/// * `Err` on invalid input
pub fn verify_bitcoin_merkle_proof(
    tx_hash: &[u8; 32],
    tx_index: u32,
    merkle_proof: &[[u8; 32]],
    merkle_root: &[u8; 32],
) -> Result<bool, ProgramError> {
    let computed_root = compute_bitcoin_merkle_root(tx_hash, tx_index, merkle_proof)?;
    Ok(&computed_root == merkle_root)
}

/// Compute the merkle root from a leaf and proof
///
/// # Arguments
/// * `tx_hash` - The transaction hash (little-endian, as in block)
/// * `tx_index` - The index of the transaction in the block
/// * `merkle_proof` - Array of proof nodes from leaf to root
///
/// # Returns
/// The computed merkle root
pub fn compute_bitcoin_merkle_root(
    tx_hash: &[u8; 32],
    tx_index: u32,
    merkle_proof: &[[u8; 32]],
) -> Result<[u8; 32], ProgramError> {
    let mut current = *tx_hash;
    let mut index = tx_index;

    for sibling in merkle_proof {
        // In Bitcoin merkle trees:
        // - Even index: hash(current || sibling)
        // - Odd index: hash(sibling || current)
        current = if index & 1 == 0 {
            double_sha256_pair(&current, sibling)
        } else {
            double_sha256_pair(sibling, &current)
        };
        index >>= 1;
    }

    Ok(current)
}

/// Compute merkle root for a list of transaction hashes
///
/// This builds a full merkle tree bottom-up. If there's an odd number
/// of elements at any level, the last element is duplicated (Bitcoin rule).
///
/// # Arguments
/// * `tx_hashes` - List of transaction hashes
///
/// # Returns
/// The merkle root
pub fn compute_merkle_root_from_txs(tx_hashes: &[[u8; 32]]) -> Result<[u8; 32], ProgramError> {
    if tx_hashes.is_empty() {
        return Err(ProgramError::InvalidArgument);
    }

    if tx_hashes.len() == 1 {
        return Ok(tx_hashes[0]);
    }

    // Work with a mutable copy
    let mut level: Vec<[u8; 32]> = tx_hashes.to_vec();

    while level.len() > 1 {
        // If odd number, duplicate last element
        if level.len() % 2 == 1 {
            level.push(*level.last().unwrap());
        }

        // Compute next level
        let mut next_level = Vec::with_capacity(level.len() / 2);
        for i in (0..level.len()).step_by(2) {
            let hash = double_sha256_pair(&level[i], &level[i + 1]);
            next_level.push(hash);
        }
        level = next_level;
    }

    Ok(level[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_tx_merkle_root() {
        let tx_hash = [1u8; 32];
        let root = compute_merkle_root_from_txs(&[tx_hash]).unwrap();
        assert_eq!(root, tx_hash); // Single tx is its own root
    }

    #[test]
    fn test_two_tx_merkle_root() {
        let tx1 = [1u8; 32];
        let tx2 = [2u8; 32];
        let root = compute_merkle_root_from_txs(&[tx1, tx2]).unwrap();

        // Should be hash of tx1 || tx2
        let expected = double_sha256_pair(&tx1, &tx2);
        assert_eq!(root, expected);
    }

    #[test]
    fn test_merkle_proof_verification() {
        // Build a simple 4-tx tree
        let tx1 = [1u8; 32];
        let tx2 = [2u8; 32];
        let tx3 = [3u8; 32];
        let tx4 = [4u8; 32];

        let root = compute_merkle_root_from_txs(&[tx1, tx2, tx3, tx4]).unwrap();

        // Build proof for tx1 (index 0)
        // Level 0: [tx1, tx2, tx3, tx4]
        // Level 1: [h12, h34] where h12 = hash(tx1, tx2), h34 = hash(tx3, tx4)
        // Proof for tx1: [tx2, h34]
        let h34 = double_sha256_pair(&tx3, &tx4);
        let proof = [tx2, h34];

        assert!(verify_bitcoin_merkle_proof(&tx1, 0, &proof, &root).unwrap());

        // Wrong tx should fail
        let wrong_tx = [99u8; 32];
        assert!(!verify_bitcoin_merkle_proof(&wrong_tx, 0, &proof, &root).unwrap());
    }

    #[test]
    fn test_empty_tx_list() {
        assert!(compute_merkle_root_from_txs(&[]).is_err());
    }
}
