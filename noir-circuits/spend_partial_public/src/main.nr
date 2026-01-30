// Spend Partial Public Circuit (Unified Model)
//
// Performs a partial public claim: Commitment -> Public Amount + Change Commitment
//
// Input: One commitment (priv_key, pub_key_x, amount, leaf_index)
// Output: Public amount (revealed) + Change commitment (change_pub_key_x, change_amount)
//
// Amount conservation: input_amount == public_amount + change_amount
//
// Unified Model:
// - Commitment = Poseidon2(pub_key_x, amount)
// - Nullifier = Poseidon2(priv_key, leaf_index)
//
// This circuit enables partial withdrawals while keeping change private.

use dep::zvault_utils;
use dep::poseidon::poseidon::bn254::hash_2;

fn main(
    // Private inputs - Input commitment
    priv_key: Field,           // Spending private key
    pub_key_x: Field,          // Corresponding public key x-coordinate
    amount: u64,               // Input amount
    leaf_index: Field,         // Position in Merkle tree
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    // Private inputs - Change commitment
    change_pub_key_x: Field,   // Public key for change (can be same or different)
    change_amount: u64,        // Amount to keep as change

    // Public inputs
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    public_amount: pub u64,           // Amount being publicly claimed
    change_commitment: pub Field,     // Commitment for the change
    recipient: pub Field,             // Solana wallet address (32 bytes as Field)
) {
    // 1. Verify input commitment exists in Merkle tree
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    assert(
        zvault_utils::verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Verify nullifier hash
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    assert(
        nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid nullifier hash"
    );

    // 3. Verify amount conservation: input = public + change
    assert(amount == public_amount + change_amount, "Amount conservation violated");

    // 4. Verify change commitment matches provided values
    let computed_change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);
    assert(change_commitment == computed_change_commitment, "Invalid change commitment");

    // 5. Security validations
    assert(priv_key != 0, "Private key cannot be zero");
    assert(amount > 0, "Input amount must be positive");
    assert(public_amount > 0, "Public amount must be positive");
    // change_amount can be 0 for full claims

    // 6. Verify recipient is non-zero (valid Solana address)
    assert(recipient != 0, "Recipient cannot be zero");

    // 7. If change_amount > 0, change_pub_key_x must be non-zero
    if change_amount > 0 {
        assert(change_pub_key_x != 0, "Change public key cannot be zero when change > 0");
    }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_partial_claim_with_change() {
    // Setup: 1 BTC input, claim 0.6 BTC public, 0.4 BTC change
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000; // 1 BTC in satoshis
    let leaf_index = 0;

    let public_amount: u64 = 60000000; // 0.6 BTC
    let change_amount: u64 = 40000000; // 0.4 BTC

    let change_pub_key_x = 11111; // New key for change
    let recipient = 999999; // Mock Solana wallet

    // Compute values
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);

    // Build Merkle tree (input commitment at index 0)
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
        change_pub_key_x,
        change_amount,
        merkle_root,
        nullifier_hash,
        public_amount,
        change_commitment,
        recipient
    );
}

#[test]
fn test_full_claim_no_change() {
    // Setup: Full claim with no change (change_amount = 0)
    let priv_key = 54321;
    let pub_key_x = 98765;
    let amount: u64 = 50000000; // 0.5 BTC
    let leaf_index = 5;

    let public_amount: u64 = 50000000; // Full amount
    let change_amount: u64 = 0; // No change

    // When change is 0, change_pub_key_x can be 0 (it's not used)
    let change_pub_key_x = 0;
    let recipient = 888888;

    // Compute values
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);

    // Build Merkle tree
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
        change_pub_key_x,
        change_amount,
        merkle_root,
        nullifier_hash,
        public_amount,
        change_commitment,
        recipient
    );
}

#[test(should_fail_with = "Amount conservation violated")]
fn test_amount_mismatch_should_fail() {
    // Setup: Try to claim more than input amount
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000; // 1 BTC
    let leaf_index = 0;

    // Wrong amounts: 0.7 + 0.4 = 1.1 BTC > 1 BTC
    let public_amount: u64 = 70000000;
    let change_amount: u64 = 40000000;

    let change_pub_key_x = 11111;
    let recipient = 999999;

    // Compute values
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);

    // Build Merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should fail due to amount mismatch
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        change_pub_key_x,
        change_amount,
        merkle_root,
        nullifier_hash,
        public_amount,
        change_commitment,
        recipient
    );
}

#[test(should_fail_with = "Invalid change commitment")]
fn test_wrong_change_commitment_should_fail() {
    // Setup: Correct amounts but wrong change commitment
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let public_amount: u64 = 60000000;
    let change_amount: u64 = 40000000;

    let change_pub_key_x = 11111;
    let recipient = 999999;

    // Compute values
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Wrong change commitment (using wrong amount)
    let wrong_change_commitment = zvault_utils::compute_commitment(change_pub_key_x, 50000000);

    // Build Merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should fail due to wrong change commitment
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        change_pub_key_x,
        change_amount,
        merkle_root,
        nullifier_hash,
        public_amount,
        wrong_change_commitment,
        recipient
    );
}

#[test(should_fail_with = "Invalid nullifier hash")]
fn test_wrong_nullifier_should_fail() {
    // Setup: Wrong private key for nullifier
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let public_amount: u64 = 60000000;
    let change_amount: u64 = 40000000;

    let change_pub_key_x = 11111;
    let recipient = 999999;

    // Compute values
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);

    // Use wrong private key for nullifier
    let wrong_priv_key = 99999;
    let wrong_nullifier = zvault_utils::compute_nullifier(wrong_priv_key, leaf_index);
    let wrong_nullifier_hash = zvault_utils::compute_nullifier_hash(wrong_nullifier);

    let change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);

    // Build Merkle tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = hash_2([current, zero]);
    }
    let merkle_root = current;

    // This should fail due to nullifier mismatch
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        change_pub_key_x,
        change_amount,
        merkle_root,
        wrong_nullifier_hash, // Wrong nullifier hash!
        public_amount,
        change_commitment,
        recipient
    );
}

#[test(should_fail_with = "Input commitment not in Merkle tree")]
fn test_wrong_merkle_root_should_fail() {
    // Setup: Wrong Merkle root
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let public_amount: u64 = 60000000;
    let change_amount: u64 = 40000000;

    let change_pub_key_x = 11111;
    let recipient = 999999;

    // Compute values
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment(change_pub_key_x, change_amount as Field);

    // Build Merkle tree with empty path
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    // Wrong Merkle root
    let wrong_merkle_root = 123456789;

    // This should fail due to Merkle proof failure
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        merkle_path,
        path_indices,
        change_pub_key_x,
        change_amount,
        wrong_merkle_root,
        nullifier_hash,
        public_amount,
        change_commitment,
        recipient
    );
}
