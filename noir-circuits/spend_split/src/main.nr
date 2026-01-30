// Spend Split Circuit (Unified Model)
//
// Splits one commitment into two commitments (send to two recipients).
// Input: One commitment (priv_key, pub_key_x, amount, leaf_index)
// Output: Two commitments (output1_pub_key_x, output1_amount) + (output2_pub_key_x, output2_amount)
//
// Commitment = Poseidon2(pub_key_x, amount)
// Nullifier = Poseidon2(priv_key, leaf_index)
//
// Amount conservation: input_amount == output1_amount + output2_amount
//
// Security constraints:
// - Input commitment must exist in Merkle tree
// - Nullifier hash prevents double-spend
// - Output public keys must be unique (different recipients)

use dep::zvault_utils;
use std::hash::poseidon::bn254::hash_2;

fn main(
    // Private inputs - Input commitment
    priv_key: Field,           // Spending private key
    pub_key_x: Field,          // Corresponding public key x-coordinate
    amount: u64,               // Input amount
    leaf_index: Field,         // Position in Merkle tree
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    // Private inputs - Output 1
    output1_pub_key_x: Field,  // Recipient 1's public key x-coordinate
    output1_amount: u64,       // Amount for recipient 1

    // Private inputs - Output 2
    output2_pub_key_x: Field,  // Recipient 2's public key x-coordinate
    output2_amount: u64,       // Amount for recipient 2

    // Public inputs
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    output_commitment1: pub Field,
    output_commitment2: pub Field,
) {
    // 1. Verify amount conservation
    assert(amount == output1_amount + output2_amount, "Amount conservation failed");

    // 2. Verify input commitment exists in Merkle tree
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    assert(
        zvault_utils::verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 3. Verify nullifier hash for double-spend prevention
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    assert(
        nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid nullifier hash"
    );

    // 4. Verify output commitments match
    let computed_output1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    assert(
        output_commitment1 == computed_output1,
        "Output 1 commitment mismatch"
    );

    let computed_output2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);
    assert(
        output_commitment2 == computed_output2,
        "Output 2 commitment mismatch"
    );

    // 5. Security: Ensure output public keys are unique (different recipients)
    assert(output1_pub_key_x != output2_pub_key_x, "Output public keys must be unique");

    // 6. Security: Verify non-zero values
    assert(priv_key != 0, "Private key cannot be zero");
    assert(amount > 0, "Amount must be positive");
    assert(output1_amount > 0, "Output 1 amount must be positive");
    assert(output2_amount > 0, "Output 2 amount must be positive");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_spend_split_basic() {
    // Input commitment
    let priv_key = 12345;
    let pub_key_x = 67890; // In practice: pub_key = priv_key * G
    let amount: u64 = 100000000; // 1 BTC in satoshis
    let leaf_index = 0;

    // Output 1: Recipient 1 gets 60%
    let output1_pub_key_x = 11111;
    let output1_amount: u64 = 60000000;

    // Output 2: Recipient 2 gets 40%
    let output2_pub_key_x = 22222;
    let output2_amount: u64 = 40000000;

    // Compute commitments
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);

    // Build merkle tree (single leaf at index 0)
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // Execute circuit
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        output1_pub_key_x,
        output1_amount,
        output2_pub_key_x,
        output2_amount,
        merkle_root,
        nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}

#[test(should_fail_with = "Amount conservation failed")]
fn test_spend_split_amount_mismatch() {
    // Input commitment
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    // INVALID: Output amounts don't sum to input
    let output1_pub_key_x = 11111;
    let output1_amount: u64 = 60000000;

    let output2_pub_key_x = 22222;
    let output2_amount: u64 = 50000000; // 60M + 50M = 110M != 100M

    // Compute commitments
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);

    // Build merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should FAIL due to amount mismatch
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        output1_pub_key_x,
        output1_amount,
        output2_pub_key_x,
        output2_amount,
        merkle_root,
        nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}

#[test(should_fail_with = "Output public keys must be unique")]
fn test_spend_split_duplicate_output_keys() {
    // Input commitment
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    // INVALID: Same public key for both outputs (same recipient)
    let output1_pub_key_x = 11111;
    let output1_amount: u64 = 60000000;

    let output2_pub_key_x = 11111; // Same as output1!
    let output2_amount: u64 = 40000000;

    // Compute commitments
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);

    // Build merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should FAIL due to duplicate output public keys
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        output1_pub_key_x,
        output1_amount,
        output2_pub_key_x,
        output2_amount,
        merkle_root,
        nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}

#[test]
fn test_spend_split_unequal_amounts() {
    // Test with very unequal split (99% / 1%)
    let priv_key = 99999;
    let pub_key_x = 88888;
    let amount: u64 = 100000000;
    let leaf_index = 5;

    // 99% to recipient 1, 1% to recipient 2
    let output1_pub_key_x = 77777;
    let output1_amount: u64 = 99000000;

    let output2_pub_key_x = 66666;
    let output2_amount: u64 = 1000000;

    // Compute commitments
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);

    // Build merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
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
        output1_pub_key_x,
        output1_amount,
        output2_pub_key_x,
        output2_amount,
        merkle_root,
        nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}

#[test(should_fail_with = "Output 1 amount must be positive")]
fn test_spend_split_zero_amount() {
    // Test that zero amounts are rejected
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    // INVALID: Output 1 has zero amount
    let output1_pub_key_x = 11111;
    let output1_amount: u64 = 0;

    let output2_pub_key_x = 22222;
    let output2_amount: u64 = 100000000;

    // Compute commitments
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment1 = zvault_utils::compute_commitment(output1_pub_key_x, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment(output2_pub_key_x, output2_amount as Field);

    // Build merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should FAIL due to zero amount
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        output1_pub_key_x,
        output1_amount,
        output2_pub_key_x,
        output2_amount,
        merkle_root,
        nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}
