//! Merkle tree operations
//!
//! Provides Merkle tree computation and verification utilities
//! using Poseidon2 hash for node computation.

use pinocchio::program_error::ProgramError;

use super::poseidon::poseidon2_hash;

/// Maximum tree depth (supports 2^20 = ~1M commitments)
pub const TREE_DEPTH: usize = 20;

/// Pre-computed zero hashes for each level of the tree
/// ZERO[0] = 0 (empty leaf)
/// ZERO[i] = Poseidon(ZERO[i-1], ZERO[i-1])
///
/// These values must match the SDK's ZERO_HASHES exactly!
/// Pre-computed using Circom-compatible Poseidon with BN254 scalar field.
/// (matches Solana's sol_poseidon syscall and Noir's std::hash::poseidon::bn254)
pub const ZERO_HASHES: [[u8; 32]; TREE_DEPTH + 1] = [
    [0u8; 32], // Level 0: Empty leaf
    hex_literal::hex!("2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"), // Level 1
    hex_literal::hex!("1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1"), // Level 2
    hex_literal::hex!("18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238"), // Level 3
    hex_literal::hex!("07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a"), // Level 4
    hex_literal::hex!("2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55"), // Level 5
    hex_literal::hex!("2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78"), // Level 6
    hex_literal::hex!("078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d"), // Level 7
    hex_literal::hex!("2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61"), // Level 8
    hex_literal::hex!("0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747"), // Level 9
    hex_literal::hex!("1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2"), // Level 10
    hex_literal::hex!("1f8d8822725e36385200c0b201249819a6e6e1e4650808b5bebc6bface7d7636"), // Level 11
    hex_literal::hex!("2c5d82f66c914bafb9701589ba8cfcfb6162b0a12acf88a8d0879a0471b5f85a"), // Level 12
    hex_literal::hex!("14c54148a0940bb820957f5adf3fa1134ef5c4aaa113f4646458f270e0bfbfd0"), // Level 13
    hex_literal::hex!("190d33b12f986f961e10c0ee44d8b9af11be25588cad89d416118e4bf4ebe80c"), // Level 14
    hex_literal::hex!("22f98aa9ce704152ac17354914ad73ed1167ae6596af510aa5b3649325e06c92"), // Level 15
    hex_literal::hex!("2a7c7c9b6ce5880b9f6f228d72bf6a575a526f29c66ecceef8b753d38bba7323"), // Level 16
    hex_literal::hex!("2e8186e558698ec1c67af9c14d463ffc470043c9c2988b954d75dd643f36b992"), // Level 17
    hex_literal::hex!("0f57c5571e9a4eab49e2c8cf050dae948aef6ead647392273546249d1c1ff10f"), // Level 18
    hex_literal::hex!("1830ee67b5fb554ad5f63d4388800e1cfe78e310697d46e43c9ce36134f72cca"), // Level 19
    hex_literal::hex!("2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e"), // Level 20
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
        for level in 0..=TREE_DEPTH {
            let zero = get_zero_hash(level);
            assert_eq!(zero.len(), 32);
        }

        // Out of bounds should return last zero hash
        let last = get_zero_hash(100);
        assert_eq!(last, &ZERO_HASHES[TREE_DEPTH]);
    }

    // =========================================================================
    // Property Tests
    // =========================================================================

    #[test]
    fn test_different_leaves_produce_different_roots() {
        let leaf_a = [1u8; 32];
        let leaf_b = [2u8; 32];
        let siblings = [[0u8; 32]; 3];

        let root_a = compute_merkle_root(&leaf_a, 0, &siblings).unwrap();
        let root_b = compute_merkle_root(&leaf_b, 0, &siblings).unwrap();

        assert_ne!(root_a, root_b, "Different leaves must produce different roots");
    }

    #[test]
    fn test_same_leaf_different_positions_different_roots() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32], [4u8; 32]];

        let root_pos_0 = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        let root_pos_1 = compute_merkle_root(&leaf, 1, &siblings).unwrap();
        let root_pos_2 = compute_merkle_root(&leaf, 2, &siblings).unwrap();
        let root_pos_3 = compute_merkle_root(&leaf, 3, &siblings).unwrap();

        // All positions should yield different roots
        assert_ne!(root_pos_0, root_pos_1);
        assert_ne!(root_pos_0, root_pos_2);
        assert_ne!(root_pos_0, root_pos_3);
        assert_ne!(root_pos_1, root_pos_2);
        assert_ne!(root_pos_1, root_pos_3);
        assert_ne!(root_pos_2, root_pos_3);
    }

    #[test]
    fn test_root_computation_is_deterministic() {
        let leaf = [42u8; 32];
        let siblings: Vec<[u8; 32]> = (0..20).map(|i| [i as u8; 32]).collect();

        let root1 = compute_merkle_root(&leaf, 12345, &siblings).unwrap();
        let root2 = compute_merkle_root(&leaf, 12345, &siblings).unwrap();
        let root3 = compute_merkle_root(&leaf, 12345, &siblings).unwrap();

        assert_eq!(root1, root2);
        assert_eq!(root2, root3);
    }

    // =========================================================================
    // Boundary Tests
    // =========================================================================

    #[test]
    fn test_max_depth_proof() {
        let leaf = [1u8; 32];
        let siblings: Vec<[u8; 32]> = (0..20).map(|i| [(i + 1) as u8; 32]).collect();

        let root = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        assert!(verify_merkle_proof(&leaf, 0, &siblings, &root).unwrap());
    }

    #[test]
    fn test_max_leaf_index() {
        let leaf = [1u8; 32];
        let siblings: Vec<[u8; 32]> = (0..20).map(|_| [0u8; 32]).collect();
        let max_index = (1u64 << 20) - 1; // 2^20 - 1 = 1048575

        let root = compute_merkle_root(&leaf, max_index, &siblings).unwrap();
        assert!(verify_merkle_proof(&leaf, max_index, &siblings, &root).unwrap());
    }

    #[test]
    fn test_empty_siblings_returns_leaf() {
        let leaf = [99u8; 32];
        let siblings: &[[u8; 32]] = &[];

        let root = compute_merkle_root(&leaf, 0, siblings).unwrap();
        assert_eq!(root, leaf, "Empty siblings should return leaf as root");
    }

    #[test]
    fn test_single_sibling() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32]];

        // At index 0 (even), leaf is left child: H(leaf, sibling)
        let root_left = compute_merkle_root(&leaf, 0, &siblings).unwrap();
        // At index 1 (odd), leaf is right child: H(sibling, leaf)
        let root_right = compute_merkle_root(&leaf, 1, &siblings).unwrap();

        assert_ne!(root_left, root_right, "Position affects root");
    }

    // =========================================================================
    // Adversarial Tests
    // =========================================================================

    #[test]
    fn test_tampered_sibling_fails_verification() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32], [4u8; 32]];

        let valid_root = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Tamper with one sibling
        let mut tampered_siblings = siblings;
        tampered_siblings[1][0] ^= 0xFF; // Flip bits in sibling

        assert!(
            !verify_merkle_proof(&leaf, 0, &tampered_siblings, &valid_root).unwrap(),
            "Tampered sibling must fail verification"
        );
    }

    #[test]
    fn test_wrong_leaf_index_fails_verification() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32], [4u8; 32]];

        let root_at_0 = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Try to verify with wrong index
        assert!(
            !verify_merkle_proof(&leaf, 1, &siblings, &root_at_0).unwrap(),
            "Wrong leaf index must fail verification"
        );
        assert!(
            !verify_merkle_proof(&leaf, 2, &siblings, &root_at_0).unwrap(),
            "Wrong leaf index must fail verification"
        );
    }

    #[test]
    fn test_truncated_proof_produces_different_root() {
        let leaf = [1u8; 32];
        let full_siblings = [[2u8; 32], [3u8; 32], [4u8; 32]];
        let truncated_siblings = [[2u8; 32], [3u8; 32]];

        let full_root = compute_merkle_root(&leaf, 0, &full_siblings).unwrap();
        let truncated_root = compute_merkle_root(&leaf, 0, &truncated_siblings).unwrap();

        assert_ne!(full_root, truncated_root, "Different depth = different root");
    }

    #[test]
    fn test_swapped_siblings_fails_verification() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32], [4u8; 32]];

        let valid_root = compute_merkle_root(&leaf, 0, &siblings).unwrap();

        // Swap first two siblings
        let swapped_siblings = [[3u8; 32], [2u8; 32], [4u8; 32]];

        assert!(
            !verify_merkle_proof(&leaf, 0, &swapped_siblings, &valid_root).unwrap(),
            "Swapped siblings must fail verification"
        );
    }

    #[test]
    fn test_wrong_root_fails_verification() {
        let leaf = [1u8; 32];
        let siblings = [[2u8; 32], [3u8; 32]];

        let wrong_root = [0xFFu8; 32];

        assert!(
            !verify_merkle_proof(&leaf, 0, &siblings, &wrong_root).unwrap(),
            "Wrong root must fail verification"
        );
    }

    #[test]
    fn test_all_zeros_is_valid_but_distinct() {
        let zero_leaf = [0u8; 32];
        let zero_siblings = [[0u8; 32], [0u8; 32]];

        let zero_root = compute_merkle_root(&zero_leaf, 0, &zero_siblings).unwrap();

        // Should produce a valid (non-error) result
        assert!(verify_merkle_proof(&zero_leaf, 0, &zero_siblings, &zero_root).unwrap());

        // But different from a non-zero leaf
        let nonzero_leaf = [1u8; 32];
        let nonzero_root = compute_merkle_root(&nonzero_leaf, 0, &zero_siblings).unwrap();
        assert_ne!(zero_root, nonzero_root);
    }
}
