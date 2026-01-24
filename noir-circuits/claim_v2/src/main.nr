/**
 * Claim V2 Circuit - Ownership Proof with Grumpkin ECDH
 *
 * This is the core ownership proof circuit for the dual-key ECDH system.
 * It proves that the claimer knows the spending private key that corresponds
 * to the stealth deposit.
 *
 * Key Security Properties:
 * - Sender knows: ephemeral_priv, shared_secret, commitment
 * - Sender does NOT know: recipient's spending_priv
 * - Nullifier = H(spending_priv, leaf_index)
 * - Only recipient can compute valid nullifier!
 *
 * If sender tries with wrong key:
 *   wrong_shared = ECDH(sender_priv, ephemeral_pub)
 *   wrong_note_pk = H(wrong_shared)
 *   wrong_commitment = H(wrong_note_pk, amount, random)
 *   → NOT IN MERKLE TREE → Proof fails
 *
 * Constraint Cost: ~10k total
 * - Grumpkin ECDH: ~2k
 * - Poseidon2 hashes: ~1.5k
 * - Merkle proof (20 levels): ~6k
 */

use dep::zvault_utils;
use dep::zvault_utils::grumpkin;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (supports ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    // ============================================================
    // PRIVATE INPUTS (never revealed)
    // ============================================================

    /// Grumpkin spending private key (scalar field element)
    spending_priv: Field,

    /// Sender's ephemeral Grumpkin public key (x-coordinate)
    ephemeral_spend_pub_x: Field,

    /// Sender's ephemeral Grumpkin public key (y-coordinate)
    ephemeral_spend_pub_y: Field,

    /// Note amount in satoshis
    amount: Field,

    /// Random value for commitment
    random: Field,

    /// Merkle tree leaf index
    leaf_index: Field,

    /// Merkle path elements (siblings)
    merkle_path: [Field; 20],

    /// Merkle path indices (0 = left, 1 = right)
    merkle_indices: [u1; 20],

    // ============================================================
    // PUBLIC INPUTS (verified on-chain)
    // ============================================================

    /// Current Merkle root
    merkle_root: pub Field,

    /// Hash of the nullifier (for double-spend prevention)
    nullifier_hash: pub Field,

    /// Amount being claimed (must match private amount)
    amount_pub: pub Field,
) {
    // ============================================================
    // 1. GRUMPKIN ECDH (Efficient! ~2k constraints)
    // ============================================================

    // Convert spending key to scalar
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);

    // Parse ephemeral public key
    let ephemeral_pub = grumpkin::point_from_coords(
        ephemeral_spend_pub_x,
        ephemeral_spend_pub_y
    );

    // Perform ECDH to get shared secret
    let (shared_x, shared_y) = grumpkin::ecdh(spending_scalar, ephemeral_pub);

    // ============================================================
    // 2. DERIVE NOTE PUBLIC KEY
    // ============================================================

    // notePubKey = Poseidon2(shared_x, shared_y, DOMAIN_NPK)
    let note_pub_key = grumpkin::derive_note_pubkey(shared_x, shared_y);

    // ============================================================
    // 3. COMPUTE AND VERIFY COMMITMENT
    // ============================================================

    // commitment = Poseidon2(notePubKey, amount, random)
    let commitment = grumpkin::compute_commitment_v2(note_pub_key, amount, random);

    // ============================================================
    // 4. VERIFY COMMITMENT EXISTS IN MERKLE TREE
    // ============================================================

    let computed_root = compute_merkle_root_20(
        commitment,
        leaf_index,
        merkle_path,
        merkle_indices
    );
    assert(merkle_root == computed_root, "Commitment not in Merkle tree");

    // ============================================================
    // 5. COMPUTE AND VERIFY NULLIFIER (OWNERSHIP PROOF!)
    // ============================================================

    // CRITICAL: Nullifier is derived from SPENDING PRIVATE KEY + leaf index
    // Only the legitimate recipient can compute this!
    // Sender knows shared secret but NOT spending_priv
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);
    let computed_nullifier_hash = grumpkin::hash_nullifier(nullifier);

    assert(nullifier_hash == computed_nullifier_hash, "Invalid nullifier");

    // ============================================================
    // 6. VERIFY AMOUNT MATCHES
    // ============================================================

    assert(amount == amount_pub, "Amount mismatch");
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
fn test_claim_v2_basic() {
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

    // Sender computes commitment
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, random);

    // Compute nullifier (recipient would do this)
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);
    let nullifier_hash = grumpkin::hash_nullifier(nullifier);

    // Build Merkle tree with single leaf
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    // Compute root (all siblings are zero)
    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // Run the circuit
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        nullifier_hash,
        amount
    );
}

#[test(should_fail_with = "Commitment not in Merkle tree")]
fn test_claim_v2_wrong_spending_key() {
    // This test proves that sender CANNOT claim recipient's funds

    // Recipient's keys
    let spending_priv = 12345;
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let spending_pub = grumpkin::derive_pubkey(spending_scalar);

    // Sender's ephemeral keys
    let ephemeral_priv = 67890;
    let ephemeral_scalar = grumpkin::scalar_from_field(ephemeral_priv);
    let ephemeral_pub = grumpkin::derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Sender computes commitment (correctly)
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, random);

    // Sender builds Merkle tree with correct commitment
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // Sender tries to claim with their own key (wrong!)
    let attacker_priv = 11111; // Different from spending_priv

    // Attacker computes their own (wrong) nullifier
    let attacker_nullifier = grumpkin::compute_nullifier_v2(attacker_priv, leaf_index);
    let attacker_nullifier_hash = grumpkin::hash_nullifier(attacker_nullifier);

    // This should FAIL because attacker's ECDH produces wrong commitment
    main(
        attacker_priv, // WRONG KEY!
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        attacker_nullifier_hash,
        amount
    );
}

#[test(should_fail_with = "Invalid nullifier")]
fn test_claim_v2_wrong_nullifier() {
    // Recipient tries to use wrong nullifier
    let spending_priv = 12345;
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);
    let spending_pub = grumpkin::derive_pubkey(spending_scalar);

    let ephemeral_priv = 67890;
    let ephemeral_scalar = grumpkin::scalar_from_field(ephemeral_priv);
    let ephemeral_pub = grumpkin::derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Compute correct commitment
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, random);

    // Build Merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // Use wrong nullifier hash
    let wrong_nullifier_hash = 123456789;

    // This should FAIL because nullifier doesn't match
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        wrong_nullifier_hash,
        amount
    );
}
