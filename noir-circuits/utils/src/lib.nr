use dep::poseidon::poseidon2::Poseidon2;

// Grumpkin ECDH module for stealth circuits
pub mod grumpkin;

// Tree depth constants
// STANDARDIZED: All circuits now use 20-level trees (~1M leaves)
global TREE_DEPTH_LEGACY: u32 = 10; // Legacy: ~1k leaves
global TREE_DEPTH: u32 = 20; // Standard: ~1M leaves

/**
 * Verify Merkle proof (10-level tree) - LEGACY
 *
 * @deprecated Use verify_merkle_proof_20 for new circuits
 */
pub fn verify_merkle_proof(
    leaf: Field,
    root: Field,
    path_elements: [Field; 10],
    path_indices: [u1; 10],
) -> bool {
    let mut current = leaf;

    for i in 0..10 {
        let sibling = path_elements[i];
        let is_right = (path_indices[i] == 1) as bool;

        let (left, right) = if is_right {
            (sibling, current)
        } else {
            (current, sibling)
        };

        current = Poseidon2::hash([left, right], 2);
    }

    current == root
}

/**
 * Verify Merkle proof (20-level tree) - STANDARD
 *
 * All new circuits should use this function.
 * Supports ~1M leaves in the Merkle tree.
 */
pub fn verify_merkle_proof_20(
    leaf: Field,
    root: Field,
    path_elements: [Field; 20],
    path_indices: [u1; 20],
) -> bool {
    let mut current = leaf;

    for i in 0..20 {
        let sibling = path_elements[i];
        let is_right = (path_indices[i] == 1) as bool;

        let (left, right) = if is_right {
            (sibling, current)
        } else {
            (current, sibling)
        };

        current = Poseidon2::hash([left, right], 2);
    }

    current == root
}

pub fn compute_note(nullifier: Field, secret: Field) -> Field {
    Poseidon2::hash([nullifier, secret], 2)
}

pub fn compute_commitment(note: Field, amount: Field) -> Field {
    Poseidon2::hash([note, amount], 2)
}

pub fn compute_nullifier_hash(nullifier: Field) -> Field {
    Poseidon2::hash([nullifier], 1)
}

pub fn compute_commitment_from_secrets(nullifier: Field, secret: Field, amount: Field) -> Field {
    let note = compute_note(nullifier, secret);
    compute_commitment(note, amount)
}
