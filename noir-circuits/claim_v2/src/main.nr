// Claim V2 Circuit - Ownership Proof with Grumpkin ECDH (SHIELDED-ONLY)
//
// This is the core ownership proof circuit for the dual-key ECDH system.
// It proves that the claimer knows the spending private key that corresponds
// to the stealth deposit.
//
// SHIELDED-ONLY ARCHITECTURE:
// - Amount is PRIVATE (not a public input)
// - Amount is only revealed at withdrawal time (unavoidable for BTC)
// - This provides maximum privacy for transfers/splits
//
// Key Security Properties:
// - Sender knows: ephemeral_priv, shared_secret, commitment
// - Sender does NOT know: recipient's spending_priv
// - Nullifier = H(spending_priv, leaf_index, DOMAIN_NULL)
// - Only recipient can compute valid nullifier!
//
// SECURITY IMPROVEMENTS (V2 Simplified):
// - Removed random field: ephemeral key uniqueness is sufficient
// - Removed double nullifier hashing: saves ~1.5k constraints
// - Commitment: Poseidon2(notePubKey, amount) instead of (notePubKey, amount, random)
// - Public input: nullifier directly (not hash of nullifier)
// - Amount is private witness only (shielded-only architecture)
//
// If sender tries with wrong key:
//   wrong_shared = ECDH(sender_priv, ephemeral_pub)
//   wrong_note_pk = H(wrong_shared)
//   wrong_commitment = H(wrong_note_pk, amount)
//   NOT IN MERKLE TREE -> Proof fails
//
// Constraint Cost: ~8.5k total (saved ~1.5k from removing double hash)
// - Grumpkin ECDH: ~2k
// - Poseidon2 hashes: ~500 (reduced from ~1.5k)
// - Merkle proof (20 levels): ~6k

use dep::zvault_utils::grumpkin;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    // PRIVATE INPUTS (never revealed)
    // Grumpkin spending private key (scalar field element)
    spending_priv: Field,
    // Sender's ephemeral Grumpkin public key (x-coordinate)
    ephemeral_spend_pub_x: Field,
    // Sender's ephemeral Grumpkin public key (y-coordinate)
    ephemeral_spend_pub_y: Field,
    // Note amount in satoshis (PRIVATE - shielded-only architecture)
    // Amount is never revealed except at withdrawal time
    amount: Field,
    // Merkle tree leaf index
    leaf_index: Field,
    // Merkle path elements (siblings)
    merkle_path: [Field; 20],
    // Merkle path indices (0 = left, 1 = right)
    merkle_indices: [u1; 20],
    // PUBLIC INPUTS (verified on-chain)
    // Current Merkle root
    merkle_root: pub Field,
    // Nullifier (for double-spend prevention) - SIMPLIFIED: no hash wrapper
    nullifier_pub: pub Field,
    // NOTE: amount_pub removed in shielded-only architecture
    // Amount is only revealed at withdrawal time (unavoidable for BTC)
) {
    // 1. GRUMPKIN ECDH (Efficient! ~2k constraints)
    // Convert spending key to scalar
    let spending_scalar = grumpkin::scalar_from_field(spending_priv);

    // Parse ephemeral public key
    let ephemeral_pub = grumpkin::point_from_coords(
        ephemeral_spend_pub_x,
        ephemeral_spend_pub_y
    );

    // Perform ECDH to get shared secret
    let (shared_x, shared_y) = grumpkin::ecdh(spending_scalar, ephemeral_pub);

    // 2. DERIVE NOTE PUBLIC KEY
    // notePubKey = Poseidon2(shared_x, shared_y, DOMAIN_NPK)
    let note_pub_key = grumpkin::derive_note_pubkey(shared_x, shared_y);

    // 3. COMPUTE AND VERIFY COMMITMENT (SIMPLIFIED: no random)
    // commitment = Poseidon2(notePubKey, amount)
    // Note: Pass 0 for random to use simplified V2 formula
    let commitment = grumpkin::compute_commitment_v2(note_pub_key, amount, 0);

    // 4. VERIFY COMMITMENT EXISTS IN MERKLE TREE
    let computed_root = compute_merkle_root_20(
        commitment,
        leaf_index,
        merkle_path,
        merkle_indices
    );
    assert(merkle_root == computed_root, "Commitment not in Merkle tree");

    // 5. COMPUTE AND VERIFY NULLIFIER (OWNERSHIP PROOF!)
    // CRITICAL: Nullifier is derived from SPENDING PRIVATE KEY + leaf index
    // Only the legitimate recipient can compute this!
    // Sender knows shared secret but NOT spending_priv
    //
    // SIMPLIFIED: Single hash, no double-hashing (saves ~1.5k constraints)
    // nullifier = Poseidon2(spending_priv, leaf_index, DOMAIN_NULL)
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);

    // Direct comparison (no hash wrapper)
    assert(nullifier_pub == nullifier, "Invalid nullifier");

    // NOTE: Amount verification removed in shielded-only architecture
    // Amount stays private - only verified via commitment in Merkle tree
    // Amount is revealed only at withdrawal time (unavoidable for BTC)
}

// Compute Merkle root from leaf and path (20-level tree)
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

// Tests

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
    let leaf_index = 0;

    // Sender computes commitment (SIMPLIFIED: no random)
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, 0);

    // Compute nullifier (recipient would do this)
    // SIMPLIFIED: nullifier is used directly, no hash wrapper
    let nullifier = grumpkin::compute_nullifier_v2(spending_priv, leaf_index);

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

    // Run the circuit (shielded-only: no amount_pub)
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        nullifier
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
    let leaf_index = 0;

    // Sender computes commitment (correctly, no random in V2)
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, 0);

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

    // This should FAIL because attacker's ECDH produces wrong commitment
    main(
        attacker_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        attacker_nullifier
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
    let leaf_index = 0;

    // Compute correct commitment (no random in V2)
    let (sender_shared_x, sender_shared_y) = grumpkin::ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = grumpkin::derive_note_pubkey(sender_shared_x, sender_shared_y);
    let commitment = grumpkin::compute_commitment_v2(sender_npk, amount, 0);

    // Build Merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // Use wrong nullifier (not the correct one for this spending_priv + leaf_index)
    let wrong_nullifier = 123456789;

    // This should FAIL because nullifier doesn't match
    main(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        wrong_nullifier
    );
}
