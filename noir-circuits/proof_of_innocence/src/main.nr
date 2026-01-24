/**
 * Proof of Innocence Circuit
 *
 * Proves that a note originated from a verified BTC deposit without
 * revealing which specific deposit it came from.
 *
 * Use Cases:
 * - Compliance: Prove funds are from verified deposits (not mixing services)
 * - Exchange Integration: Demonstrate clean source of funds
 * - Regulatory: Voluntary disclosure without full de-anonymization
 *
 * Architecture:
 * ```
 * BTC Deposit → SPV Verify → Add to InnocenceTree
 *                                    ↓
 * User generates PoI proof proving:
 *   "My note came from a verified BTC deposit"
 *   Without revealing WHICH specific deposit
 * ```
 *
 * The InnocenceTree is a separate Merkle tree containing only commitments
 * from verified BTC deposits (not from private transfers/splits).
 */

use dep::zvault_utils;
use dep::zvault_utils::grumpkin;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth for innocence tree
global TREE_DEPTH: u32 = 20;

fn main(
    // ============================================================
    // PRIVATE INPUTS (never revealed)
    // ============================================================

    /// Grumpkin spending private key
    spending_priv: Field,

    /// Sender's ephemeral Grumpkin public key (x-coordinate)
    ephemeral_spend_pub_x: Field,

    /// Sender's ephemeral Grumpkin public key (y-coordinate)
    ephemeral_spend_pub_y: Field,

    /// Note amount in satoshis
    amount: Field,

    /// Random value for commitment
    random: Field,

    /// Merkle tree leaf index in innocence tree
    leaf_index: Field,

    /// Merkle path elements in innocence tree
    innocence_merkle_path: [Field; 20],

    /// Merkle path indices
    innocence_path_indices: [u1; 20],

    // ============================================================
    // PUBLIC INPUTS
    // ============================================================

    /// Root of the innocence tree (verified BTC deposits only)
    innocence_tree_root: pub Field,

    /// Nullifier hash (links to the actual spending)
    nullifier_hash: pub Field,
) {
    // ============================================================
    // 1. DERIVE COMMITMENT (Same as claim_v2)
    // ============================================================

    // Grumpkin ECDH
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let ephemeral_pub = grumpkin::point_from_coords(
        ephemeral_spend_pub_x,
        ephemeral_spend_pub_y
    );
    let (shared_x, shared_y) = grumpkin::ecdh(spending_scalar, ephemeral_pub);

    // Derive note public key
    let note_pub_key = grumpkin::derive_note_pubkey(shared_x, shared_y);

    // Compute commitment
    let commitment = grumpkin::compute_commitment_v2(note_pub_key, amount, random);

    // ============================================================
    // 2. VERIFY COMMITMENT IN INNOCENCE TREE
    // ============================================================

    // The innocence tree ONLY contains verified BTC deposit commitments
    // If our commitment is in this tree, we prove our funds came from
    // a verified BTC deposit without revealing which one

    let computed_root = compute_merkle_root_20(
        commitment,
        leaf_index,
        innocence_merkle_path,
        innocence_path_indices
    );

    assert(
        innocence_tree_root == computed_root,
        "Commitment not found in innocence tree - funds may not be from verified deposit"
    );

    // ============================================================
    // 3. VERIFY NULLIFIER MATCHES
    // ============================================================

    // This links the PoI proof to the actual spending
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);
    let computed_nullifier_hash = grumpkin::hash_nullifier(nullifier);

    assert(
        nullifier_hash == computed_nullifier_hash,
        "Nullifier hash mismatch"
    );

    // ============================================================
    // SUCCESS: Proven that funds came from verified BTC deposit
    // without revealing which specific deposit
    // ============================================================
}

/**
 * Compute Merkle root from leaf and path (20-level tree)
 */
fn compute_merkle_root_20(
    leaf: Field,
    leaf_index: Field,
    path_elements: [Field; 20],
    path_indices: [u1; 20]
) -> Field {
    let mut current = leaf;

    // Verify leaf index matches path indices
    let mut computed_index: Field = 0;
    let mut multiplier: Field = 1;
    for i in 0..20 {
        if path_indices[i] == 1 {
            computed_index += multiplier;
        }
        multiplier *= 2;
    }
    assert(leaf_index == computed_index, "Leaf index mismatch");

    // Compute root
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

    current
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_proof_of_innocence_valid() {
    // Generate test keypairs
    let spending_priv = 12345;
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let spending_pub = grumpkin::derive_pubkey(spending_scalar);

    let ephemeral_priv = 67890;
    let ephemeral_scalar = grumpkin::scalar_from_field(ephemeral_priv);
    let ephemeral_pub = grumpkin::derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Compute commitment
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, random);

    // Compute nullifier
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);
    let nullifier_hash = grumpkin::hash_nullifier(nullifier);

    // Build innocence tree with this commitment
    let zero: Field = 0;
    let innocence_merkle_path: [Field; 20] = [zero; 20];
    let innocence_path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let innocence_tree_root = current;

    // Run the circuit
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        innocence_merkle_path,
        innocence_path_indices,
        innocence_tree_root,
        nullifier_hash
    );
}

#[test(should_fail_with = "Commitment not found in innocence tree")]
fn test_proof_of_innocence_not_in_tree() {
    // This test proves that you cannot fake a PoI proof
    // if your commitment isn't in the innocence tree

    let spending_priv = 12345;
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let spending_pub = grumpkin::derive_pubkey(spending_scalar);

    let ephemeral_priv = 67890;
    let ephemeral_scalar = grumpkin::scalar_from_field(ephemeral_priv);
    let ephemeral_pub = grumpkin::derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Compute nullifier
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);
    let nullifier_hash = grumpkin::hash_nullifier(nullifier);

    // Build innocence tree with DIFFERENT commitment (simulating funds
    // that came from a private transfer, not a verified BTC deposit)
    let zero: Field = 0;
    let innocence_merkle_path: [Field; 20] = [zero; 20];
    let innocence_path_indices: [u1; 20] = [0; 20];

    // Use a different commitment in the tree
    let fake_commitment = 123456789;
    let mut current = fake_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let innocence_tree_root = current;

    // This should FAIL because our real commitment isn't in the innocence tree
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        innocence_merkle_path,
        innocence_path_indices,
        innocence_tree_root,
        nullifier_hash
    );
}

#[test(should_fail_with = "Nullifier hash mismatch")]
fn test_proof_of_innocence_wrong_nullifier() {
    // Generate valid commitment in innocence tree
    let spending_priv = 12345;
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let spending_pub = grumpkin::derive_pubkey(spending_scalar);

    let ephemeral_priv = 67890;
    let ephemeral_scalar = grumpkin::scalar_from_field(ephemeral_priv);
    let ephemeral_pub = grumpkin::derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Compute commitment
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, random);

    // Build innocence tree
    let zero: Field = 0;
    let innocence_merkle_path: [Field; 20] = [zero; 20];
    let innocence_path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let innocence_tree_root = current;

    // Use wrong nullifier hash
    let wrong_nullifier_hash = 111222333;

    // This should FAIL because nullifier doesn't match
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        innocence_merkle_path,
        innocence_path_indices,
        innocence_tree_root,
        wrong_nullifier_hash
    );
}
