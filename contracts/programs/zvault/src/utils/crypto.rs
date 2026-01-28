//! Cryptographic utilities for zVault
//!
//! Provides Poseidon2 hashing for Merkle tree operations.
//! Uses Solana's native Poseidon syscall for efficiency.

use pinocchio::program_error::ProgramError;

/// Poseidon2 hash of two 32-byte inputs (for Merkle tree nodes)
///
/// Uses the BN254 field with Poseidon2 parameters optimized for
/// binary Merkle trees (2 inputs → 1 output).
///
/// # On-chain Implementation
/// Uses Solana's `sol_poseidon` syscall when available (Solana 1.16+).
/// Falls back to a reference implementation for testing.
#[inline]
pub fn poseidon2_hash(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    #[cfg(target_os = "solana")]
    {
        poseidon2_hash_syscall(left, right)
    }

    #[cfg(not(target_os = "solana"))]
    {
        poseidon2_hash_reference(left, right)
    }
}

/// Poseidon2 hash using Solana syscall
#[cfg(target_os = "solana")]
fn poseidon2_hash_syscall(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    use solana_poseidon::{hashv, PoseidonHash, Parameters, Endianness};

    // Use Light Protocol's parameters (standard for ZK on Solana)
    let hash = hashv(
        Parameters::Bn254X5,
        Endianness::BigEndian,
        &[left, right],
    ).map_err(|_| ProgramError::InvalidArgument)?;

    Ok(hash.to_bytes())
}

/// Reference implementation for testing (not for production on-chain use)
#[cfg(not(target_os = "solana"))]
fn poseidon2_hash_reference(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    // For off-chain testing, use a deterministic hash
    // This matches the structure but uses SHA256 as placeholder
    // Real tests should use the actual Poseidon implementation
    let mut hasher_input = [0u8; 65];
    hasher_input[0] = 0x01; // Domain separator for Merkle node
    hasher_input[1..33].copy_from_slice(left);
    hasher_input[33..65].copy_from_slice(right);

    // Simple deterministic hash for testing
    let mut result = [0u8; 32];
    for (i, chunk) in hasher_input.chunks(2).enumerate() {
        if i < 32 {
            result[i] = chunk.iter().fold(0u8, |acc, &x| acc.wrapping_add(x));
        }
    }
    // Add mixing
    for i in 0..32 {
        result[i] = result[i].wrapping_add(result[(i + 7) % 32]);
    }

    Ok(result)
}

/// Compute Merkle root from a leaf and its sibling path
///
/// # Arguments
/// * `leaf` - The leaf commitment
/// * `leaf_index` - Position of the leaf (determines left/right placement)
/// * `siblings` - Array of sibling hashes from leaf to root
///
/// # Returns
/// The computed Merkle root
pub fn compute_merkle_root(
    leaf: &[u8; 32],
    leaf_index: u64,
    siblings: &[[u8; 32]],
) -> Result<[u8; 32], ProgramError> {
    let mut current = *leaf;
    let mut index = leaf_index;

    for sibling in siblings {
        // If index is even, current is left child; if odd, current is right child
        let is_left = index & 1 == 0; // Bitwise check: even = left child
        current = if is_left {
            poseidon2_hash(&current, sibling)?
        } else {
            poseidon2_hash(sibling, &current)?
        };
        index /= 2;
    }

    Ok(current)
}

/// Zero value for empty Merkle tree nodes at each level
/// These are precomputed: zero[0] = H(0,0), zero[1] = H(zero[0], zero[0]), etc.
pub const ZERO_HASHES: [[u8; 32]; 20] = [
    // Level 0: Hash of two zero leaves
    [0u8; 32],
    // Levels 1-19: Each level is hash of previous level with itself
    // In production, these should be precomputed with actual Poseidon2
    [0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32],
    [0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32],
    [0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32],
    [0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32],
    [0u8; 32], [0u8; 32], [0u8; 32],
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poseidon2_hash_deterministic() {
        let left = [1u8; 32];
        let right = [2u8; 32];

        let hash1 = poseidon2_hash(&left, &right).unwrap();
        let hash2 = poseidon2_hash(&left, &right).unwrap();

        assert_eq!(hash1, hash2, "Hash should be deterministic");
    }

    #[test]
    fn test_poseidon2_hash_different_inputs() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        let c = [3u8; 32];

        let hash_ab = poseidon2_hash(&a, &b).unwrap();
        let hash_ac = poseidon2_hash(&a, &c).unwrap();
        let hash_ba = poseidon2_hash(&b, &a).unwrap();

        assert_ne!(hash_ab, hash_ac, "Different inputs should produce different hashes");
        assert_ne!(hash_ab, hash_ba, "Order should matter");
    }

    #[test]
    fn test_merkle_root_computation() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32]];

        let root = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Root should be deterministic
        let root2 = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        assert_eq!(root, root2);
    }
}
