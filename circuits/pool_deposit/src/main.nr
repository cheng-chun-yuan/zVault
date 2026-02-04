// Pool Deposit Circuit (Unified Model)
//
// Proves valid deposit of zkBTC into yield pool using unified commitment format.
// Spends an existing unified commitment and creates a pool position commitment.
//
// Input:  Unified Commitment = Poseidon2(pub_key_x, amount)
// Output: Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)
//
// Unified Model:
//   Commitment = Poseidon2(pub_key_x, amount)
//   Nullifier  = Poseidon2(priv_key, leaf_index)
//   Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)

use dep::zvault_utils;

fn main(
    // Private inputs - unified commitment being deposited
    priv_key: Field,               // Spending private key
    pub_key_x: Field,              // Corresponding public key x-coordinate
    amount: u64,                   // Amount in the commitment
    leaf_index: Field,             // Position in Merkle tree
    input_merkle_path: [Field; 20],
    input_path_indices: [u1; 20],

    // Private inputs - pool position output (can be different key for privacy)
    pool_pub_key_x: Field,         // Public key for pool position

    // Public inputs
    input_merkle_root: pub Field,      // Main zkBTC tree root
    input_nullifier_hash: pub Field,   // Hash of input nullifier
    pool_commitment: pub Field,        // New pool position commitment
    deposit_epoch: pub Field,          // Current epoch at deposit time
) {
    // 1. Verify input unified commitment exists in main merkle tree
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    assert(
        zvault_utils::verify_merkle_proof_20(input_commitment, input_merkle_root, input_merkle_path, input_path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Compute and verify nullifier hash
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    assert(
        input_nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid input nullifier hash"
    );

    // 3. Verify principal equals input amount (full deposit, no partial)
    let principal = amount as Field;

    // 4. Compute and verify pool position commitment
    // Pool commitment = Poseidon2(pool_pub_key_x, principal, deposit_epoch)
    let expected_pool_commitment = zvault_utils::compute_pool_commitment(
        pool_pub_key_x,
        principal,
        deposit_epoch
    );
    assert(
        pool_commitment == expected_pool_commitment,
        "Pool commitment mismatch"
    );

    // 5. Security checks
    assert(priv_key != 0, "Private key cannot be zero");
    assert(pool_pub_key_x != 0, "Pool public key cannot be zero");
    assert(amount > 0, "Amount must be greater than zero");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_pool_deposit_unified_circuit() {
    // Input unified commitment
    let priv_key = 12345;
    let pub_key_x = 67890; // In practice: pub_key = priv_key * G
    let amount: u64 = 100000000; // 1 BTC in sats
    let leaf_index = 0;

    // Pool position uses different key for privacy
    let pool_pub_key_x = 0xfedcba9876543210;

    // Deposit epoch
    let deposit_epoch = 10;

    // Compute input commitment using unified format
    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Compute pool commitment
    let pool_commitment = zvault_utils::compute_pool_commitment(
        pool_pub_key_x,
        amount as Field,
        deposit_epoch
    );

    // Build simple merkle tree (leaf at index 0)
    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    // Compute root
    let mut current = input_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon::bn254::hash_2([current, zero]);
    }
    let input_merkle_root = current;

    // Run circuit
    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        input_merkle_path,
        input_path_indices,
        pool_pub_key_x,
        input_merkle_root,
        input_nullifier_hash,
        pool_commitment,
        deposit_epoch
    );
}

#[test(should_fail_with = "Pool public key cannot be zero")]
fn test_pool_deposit_zero_pool_key() {
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    // INVALID: zero pool key
    let pool_pub_key_x = 0;
    let deposit_epoch = 10;

    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let pool_commitment = zvault_utils::compute_pool_commitment(
        pool_pub_key_x,
        amount as Field,
        deposit_epoch
    );

    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon::bn254::hash_2([current, zero]);
    }
    let input_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        input_merkle_path,
        input_path_indices,
        pool_pub_key_x,
        input_merkle_root,
        input_nullifier_hash,
        pool_commitment,
        deposit_epoch
    );
}

#[test(should_fail_with = "Amount must be greater than zero")]
fn test_pool_deposit_zero_amount() {
    let priv_key = 12345;
    let pub_key_x = 67890;
    let amount: u64 = 0; // INVALID: zero amount
    let leaf_index = 0;

    let pool_pub_key_x = 0xfedcba9876543210;
    let deposit_epoch = 10;

    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let pool_commitment = zvault_utils::compute_pool_commitment(
        pool_pub_key_x,
        amount as Field,
        deposit_epoch
    );

    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon::bn254::hash_2([current, zero]);
    }
    let input_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        input_merkle_path,
        input_path_indices,
        pool_pub_key_x,
        input_merkle_root,
        input_nullifier_hash,
        pool_commitment,
        deposit_epoch
    );
}

#[test(should_fail_with = "Private key cannot be zero")]
fn test_pool_deposit_zero_priv_key() {
    let priv_key = 0; // INVALID: zero private key
    let pub_key_x = 67890;
    let amount: u64 = 100000000;
    let leaf_index = 0;

    let pool_pub_key_x = 0xfedcba9876543210;
    let deposit_epoch = 10;

    let input_commitment = zvault_utils::compute_commitment(pub_key_x, amount as Field);
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let pool_commitment = zvault_utils::compute_pool_commitment(
        pool_pub_key_x,
        amount as Field,
        deposit_epoch
    );

    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon::bn254::hash_2([current, zero]);
    }
    let input_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        amount,
        leaf_index,
        input_merkle_path,
        input_path_indices,
        pool_pub_key_x,
        input_merkle_root,
        input_nullifier_hash,
        pool_commitment,
        deposit_epoch
    );
}
