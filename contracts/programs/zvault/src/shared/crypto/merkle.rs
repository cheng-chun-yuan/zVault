//! Merkle tree operations
//!
//! Provides Merkle tree computation and verification utilities
//! using Poseidon2 hash for node computation.

use pinocchio::program_error::ProgramError;

use super::poseidon::poseidon2_hash;

/// Zero value for empty Merkle tree nodes at each level
/// These are precomputed: zero[0] = H(0,0), zero[1] = H(zero[0], zero[0]), etc.
///
/// Note: In production, these should be precomputed with actual Poseidon2.
/// Currently initialized as zeros for compatibility.
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

/// Compute Merkle root from a leaf and its sibling path
///
/// # Arguments
/// * `leaf` - The leaf commitment
/// * `leaf_index` - Position of the leaf (determines left/right placement)
/// * `siblings` - Array of sibling hashes from leaf to root
///
/// # Returns
/// The computed Merkle root
///
/// # Algorithm
/// Starting from the leaf, we hash up the tree:
/// - If index is even, current node is left child: H(current, sibling)
/// - If index is odd, current node is right child: H(sibling, current)
/// - Divide index by 2 and move to next level
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

/// Verify that a leaf exists in a Merkle tree
///
/// # Arguments
/// * `leaf` - The leaf commitment to verify
/// * `leaf_index` - Position of the leaf
/// * `siblings` - Sibling path from leaf to root
/// * `expected_root` - The expected Merkle root
///
/// # Returns
/// `true` if the computed root matches the expected root
pub fn verify_merkle_proof(
    leaf: &[u8; 32],
    leaf_index: u64,
    siblings: &[[u8; 32]],
    expected_root: &[u8; 32],
) -> Result<bool, ProgramError> {
    let computed_root = compute_merkle_root(leaf, leaf_index, siblings)?;
    Ok(&computed_root == expected_root)
}

/// Compute the hash of two Merkle tree nodes
///
/// This is a convenience wrapper around poseidon2_hash for Merkle tree operations.
#[inline]
pub fn hash_nodes(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    poseidon2_hash(left, right)
}

/// Get the zero hash for a given tree level
///
/// # Arguments
/// * `level` - The tree level (0 = leaf level)
///
/// # Returns
/// The precomputed zero hash for that level
#[inline]
pub fn get_zero_hash(level: usize) -> &'static [u8; 32] {
    if level < ZERO_HASHES.len() {
        &ZERO_HASHES[level]
    } else {
        &ZERO_HASHES[ZERO_HASHES.len() - 1]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_root_computation() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32]];

        let root = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Root should be deterministic
        let root2 = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        assert_eq!(root, root2);
    }

    #[test]
    fn test_verify_merkle_proof() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32]];

        // Compute the expected root
        let expected_root = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Verification should succeed
        assert!(verify_merkle_proof(&leaf, 0, &siblings, &expected_root).unwrap());

        // Verification with wrong root should fail
        let wrong_root = [0u8; 32];
        assert!(!verify_merkle_proof(&leaf, 0, &siblings, &wrong_root).unwrap());
    }

    #[test]
    fn test_different_positions_different_roots() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32]];

        let root_at_0 = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        let root_at_1 = compute_merkle_root(&leaf, 1, &siblings).unwrap();

        assert_ne!(root_at_0, root_at_1, "Different positions should produce different roots");
    }

    #[test]
    fn test_get_zero_hash() {
        for level in 0..20 {
            let zero = get_zero_hash(level);
            assert_eq!(zero.len(), 32);
        }

        // Out of bounds should return last zero hash
        let last = get_zero_hash(100);
        assert_eq!(last, &ZERO_HASHES[19]);
    }
}
