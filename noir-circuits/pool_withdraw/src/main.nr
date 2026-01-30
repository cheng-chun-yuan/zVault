// Pool Withdraw Circuit (Unified Model)
//
// Proves ownership of pool position and calculates yield for full withdrawal.
// Input:  Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)
// Output: Unified Commitment = Poseidon2(output_pub_key_x, principal + yield)
//
// Unified Model:
//   Commitment = Poseidon2(pub_key_x, amount)
//   Nullifier  = Poseidon2(priv_key, leaf_index)
//   Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)
//
// Yield Calculation:
//   epochs_staked = current_epoch - deposit_epoch
//   yield = (principal * epochs_staked * yield_rate_bps) / 10000
//   total_amount = principal + yield

use dep::zvault_utils;

fn main(
    // Private inputs - pool position details
    priv_key: Field,               // Private key for pool position
    pub_key_x: Field,              // Public key x-coordinate for pool position
    principal: u64,
    deposit_epoch: u64,
    leaf_index: Field,             // Position in merkle tree (for nullifier)
    pool_merkle_path: [Field; 20],
    pool_path_indices: [u1; 20],

    // Private inputs - output unified commitment
    output_pub_key_x: Field,       // Public key for output commitment

    // Public inputs
    pool_merkle_root: pub Field,       // Pool commitment tree root
    pool_nullifier_hash: pub Field,    // Poseidon2(Poseidon2(priv_key, leaf_index))
    output_commitment: pub Field,      // Unified commitment (principal + yield)
    current_epoch: pub u64,            // Current epoch
    yield_rate_bps: pub u64,           // Yield rate in basis points (e.g., 500 = 5%)
    pool_id: pub Field,                // Pool identifier
) {
    // 1. Verify pool position commitment in pool merkle tree
    let pool_commitment = zvault_utils::compute_pool_commitment(
        pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    assert(
        zvault_utils::verify_merkle_proof_20(pool_commitment, pool_merkle_root, pool_merkle_path, pool_path_indices),
        "Pool position not in Merkle tree"
    );

    // 2. Compute and verify nullifier
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    assert(
        pool_nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid pool nullifier hash"
    );

    // 3. Calculate earned yield
    assert(current_epoch >= deposit_epoch, "Current epoch must be >= deposit epoch");
    let epochs_staked = current_epoch - deposit_epoch;

    // yield = (principal * epochs_staked * yield_rate_bps) / 10000
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount;

    // 4. Verify output commitment contains correct total amount (unified format)
    let expected_output = zvault_utils::compute_commitment(output_pub_key_x, total_amount as Field);
    assert(
        output_commitment == expected_output,
        "Output commitment mismatch - wrong amount"
    );

    // 5. Security checks
    assert(priv_key != 0, "Private key cannot be zero");
    assert(output_pub_key_x != 0, "Output public key cannot be zero");
    assert(pool_id != 0, "Pool ID cannot be zero");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_pool_withdraw_unified_circuit() {
    // Pool position keys
    let priv_key = 0x123456789abcdef;
    let pub_key_x = 0xfedcba9876543210; // In practice: pub_key = priv_key * G

    // Pool position
    let principal: u64 = 100000000; // 1 BTC in sats
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    // Output unified commitment
    let output_pub_key_x = 0xabcdef012345678;

    // Current state
    let current_epoch: u64 = 20; // 10 epochs staked
    let yield_rate_bps: u64 = 500; // 5% per epoch
    let pool_id = 1;

    // Calculate expected yield
    let epochs_staked = current_epoch - deposit_epoch; // 10
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount; // 1.5 BTC

    // Compute pool commitment
    let pool_commitment = zvault_utils::compute_pool_commitment(
        pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );

    // Compute nullifier
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let pool_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Compute output unified commitment
    let output_commitment = zvault_utils::compute_commitment(output_pub_key_x, total_amount as Field);

    // Build simple merkle tree
    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = std::hash::poseidon::bn254::hash_2([current, zero]);
    }
    let pool_merkle_root = current;

    // Run circuit
    main(
        priv_key,
        pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_pub_key_x,
        pool_merkle_root,
        pool_nullifier_hash,
        output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test]
fn test_yield_calculation() {
    let principal: u64 = 100000000; // 1 BTC
    let epochs_staked: u64 = 10;
    let yield_rate_bps: u64 = 500; // 5%

    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    // (100000000 * 10 * 500) / 10000 = 50000000
    assert(yield_amount == 50000000);

    let total = principal + yield_amount;
    assert(total == 150000000);
}

#[test(should_fail_with = "Output commitment mismatch - wrong amount")]
fn test_pool_withdraw_wrong_amount() {
    let priv_key = 0x123456789abcdef;
    let pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let output_pub_key_x = 0xabcdef012345678;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    // Compute pool commitment
    let pool_commitment = zvault_utils::compute_pool_commitment(
        pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );

    // Compute nullifier
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let pool_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // WRONG: Use only principal, not principal + yield
    let wrong_output_commitment = zvault_utils::compute_commitment(output_pub_key_x, principal as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = std::hash::poseidon::bn254::hash_2([current, zero]);
    }
    let pool_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_pub_key_x,
        pool_merkle_root,
        pool_nullifier_hash,
        wrong_output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Private key cannot be zero")]
fn test_pool_withdraw_zero_priv_key() {
    let priv_key = 0; // INVALID
    let pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let output_pub_key_x = 0xabcdef012345678;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount;

    let pool_commitment = zvault_utils::compute_pool_commitment(
        pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let pool_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let output_commitment = zvault_utils::compute_commitment(output_pub_key_x, total_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = std::hash::poseidon::bn254::hash_2([current, zero]);
    }
    let pool_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_pub_key_x,
        pool_merkle_root,
        pool_nullifier_hash,
        output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Output public key cannot be zero")]
fn test_pool_withdraw_zero_output_key() {
    let priv_key = 0x123456789abcdef;
    let pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let output_pub_key_x = 0; // INVALID

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount;

    let pool_commitment = zvault_utils::compute_pool_commitment(
        pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let nullifier = zvault_utils::compute_nullifier(priv_key, leaf_index);
    let pool_nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let output_commitment = zvault_utils::compute_commitment(output_pub_key_x, total_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = std::hash::poseidon::bn254::hash_2([current, zero]);
    }
    let pool_merkle_root = current;

    main(
        priv_key,
        pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_pub_key_x,
        pool_merkle_root,
        pool_nullifier_hash,
        output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}
