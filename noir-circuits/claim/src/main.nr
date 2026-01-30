// Claim Circuit (Unified Model)
//
// Claims zkBTC from a commitment to a public Solana wallet.
// Input: Unified commitment (pub_key_x, amount)
// Output: Public transfer to recipient's ATA
//
// Commitment = Poseidon(pub_key_x, amount)
// Nullifier = Poseidon(priv_key, leaf_index)
//
// NOTE: Using Circom-compatible Poseidon (NOT Poseidon2) for compatibility with
// Solana's sol_poseidon syscall and circomlibjs in SDK.
//
// This circuit works for both:
// - Claim links (seed-derived keys encoded in URL)
// - Stealth balances (ECDH-derived keys)

use dep::zvault_utils;
use std::hash::poseidon::bn254::hash_2;

fn main(
    // Private inputs
    priv_key: Field,           // Spending private key
    pub_key_x: Field,          // Corresponding public key x-coordinate
    amount: u64,
    leaf_index: Field,         // Position in Merkle tree
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    // Public inputs
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    amount_pub: pub u64,       // Amount revealed for public claim
) {
    // 1. Verify commitment exists in Merkle tree
    let commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    assert(
        zvault_utils::verify_merkle_proof_20(commitment, merkle_root, merkle_path, path_indices),
        "Commitment not in Merkle tree"
    );

    // 2. Verify nullifier hash
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    assert(
        nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid nullifier hash"
    );

    // 3. Verify public amount matches private amount
    assert(amount == amount_pub, "Amount mismatch");

    // 4. Security: Verify non-zero values
    assert(priv_key != 0, "Private key cannot be zero");
    assert(amount > 0, "Amount must be positive");
}

#[test]
fn test_claim_circuit() {
    let priv_key = 12345;
    let pub_key_x = 67890; // In practice: pub_key = priv_key * G
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Build merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        nullifier_hash,
        amount
    );
}

#[test(should_fail_with = "Amount mismatch")]
fn test_claim_wrong_amount() {
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // Wrong public amount
    let wrong_amount: u64 = 50000000;

    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        merkle_root,
        nullifier_hash,
        wrong_amount // Mismatch!
    );
}
