// Pool Claim Yield Circuit (Unified Model)
//
// Proves ownership of pool position and claims earned yield while keeping principal staked.
// Input:  Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)
// Output: 1. New Pool Position = Poseidon2(new_pub_key_x, principal, current_epoch)
//         2. Yield as Unified Commitment = Poseidon2(yield_pub_key_x, yield_amount)
//
// Unified Model:
//   Commitment = Poseidon2(pub_key_x, amount)
//   Nullifier  = Poseidon2(priv_key, leaf_index)
//   Pool Position = Poseidon2(pub_key_x, principal, deposit_epoch)

use dep::zvault_utils;

fn main(
    // Private inputs - old pool position
    old_priv_key: Field,               // Private key for old pool position
    old_pub_key_x: Field,              // Public key x-coordinate for old position
    principal: u64,
    deposit_epoch: u64,
    leaf_index: Field,                 // Position in merkle tree
    pool_merkle_path: [Field; 20],
    pool_path_indices: [u1; 20],

    // Private inputs - new pool position key
    new_pub_key_x: Field,              // Public key for new pool position

    // Private inputs - yield output key
    yield_pub_key_x: Field,            // Public key for yield commitment

    // Public inputs
    pool_merkle_root: pub Field,           // Pool commitment tree root
    old_nullifier_hash: pub Field,         // Poseidon2(Poseidon2(old_priv_key, leaf_index))
    new_pool_commitment: pub Field,        // New pool position (same principal, reset epoch)
    yield_commitment: pub Field,           // Unified commitment for earned yield
    current_epoch: pub u64,                // Current epoch
    yield_rate_bps: pub u64,               // Yield rate in basis points
    pool_id: pub Field,                    // Pool identifier
) {
    // 1. Verify old pool position in merkle tree
    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    assert(
        zvault_utils::verify_merkle_proof_20(old_pool_commitment, pool_merkle_root, pool_merkle_path, pool_path_indices),
        "Old pool position not in Merkle tree"
    );

    // 2. Verify old nullifier
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    assert(
        old_nullifier_hash == zvault_utils::compute_nullifier_hash(old_nullifier),
        "Invalid old nullifier hash"
    );

    // 3. Security check on old private key
    assert(old_priv_key != 0, "Old private key cannot be zero");

    // 4. Calculate earned yield
    assert(current_epoch >= deposit_epoch, "Current epoch must be >= deposit epoch");
    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    // 5. Verify new pool position commitment (same principal, reset to current_epoch)
    let expected_new_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );
    assert(
        new_pool_commitment == expected_new_commitment,
        "New pool commitment mismatch"
    );

    // 6. Verify yield commitment (unified format)
    let expected_yield_commitment = zvault_utils::compute_commitment(
        yield_pub_key_x,
        yield_amount as Field
    );
    assert(
        yield_commitment == expected_yield_commitment,
        "Yield commitment mismatch"
    );

    // 7. Ensure new pool key is different from old (for unlinkability)
    assert(new_pub_key_x != old_pub_key_x, "New pool key must differ from old");

    // 8. Security checks
    assert(new_pub_key_x != 0, "New pool public key cannot be zero");
    assert(yield_pub_key_x != 0, "Yield public key cannot be zero");
    assert(pool_id != 0, "Pool ID cannot be zero");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_pool_claim_yield_unified_circuit() {
    // Old pool position keys
    let old_priv_key = 0x123456789abcdef;
    let old_pub_key_x = 0xfedcba9876543210;

    // Position details
    let principal: u64 = 100000000; // 1 BTC
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    // New pool position key
    let new_pub_key_x = 0xabcdef012345678;

    // Yield output key
    let yield_pub_key_x = 0x9876543210abcdef;

    // Current state
    let current_epoch: u64 = 20; // 10 epochs staked
    let yield_rate_bps: u64 = 500; // 5% per epoch
    let pool_id = 1;

    // Calculate yield
    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    // yield = 50000000 (0.5 BTC)

    // Compute old pool commitment
    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );

    // Compute old nullifier
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    let old_nullifier_hash = zvault_utils::compute_nullifier_hash(old_nullifier);

    // Compute new pool commitment (same principal, reset epoch)
    let new_pool_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );

    // Compute yield commitment (unified format)
    let yield_commitment = zvault_utils::compute_commitment(yield_pub_key_x, yield_amount as Field);

    // Build merkle tree
    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon2::Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    // Run circuit
    main(
        old_priv_key,
        old_pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        new_pub_key_x,
        yield_pub_key_x,
        pool_merkle_root,
        old_nullifier_hash,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "New pool key must differ from old")]
fn test_pool_claim_yield_same_pool_key() {
    let old_priv_key = 0x123456789abcdef;
    let old_pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    // INVALID: Same pool key
    let new_pub_key_x = old_pub_key_x;

    let yield_pub_key_x = 0x9876543210abcdef;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    let old_nullifier_hash = zvault_utils::compute_nullifier_hash(old_nullifier);

    let new_pool_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );

    let yield_commitment = zvault_utils::compute_commitment(yield_pub_key_x, yield_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon2::Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_priv_key,
        old_pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        new_pub_key_x,
        yield_pub_key_x,
        pool_merkle_root,
        old_nullifier_hash,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Old private key cannot be zero")]
fn test_pool_claim_yield_zero_priv_key() {
    let old_priv_key = 0; // INVALID
    let old_pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let new_pub_key_x = 0xabcdef012345678;
    let yield_pub_key_x = 0x9876543210abcdef;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    let old_nullifier_hash = zvault_utils::compute_nullifier_hash(old_nullifier);

    let new_pool_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );

    let yield_commitment = zvault_utils::compute_commitment(yield_pub_key_x, yield_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon2::Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_priv_key,
        old_pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        new_pub_key_x,
        yield_pub_key_x,
        pool_merkle_root,
        old_nullifier_hash,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "New pool public key cannot be zero")]
fn test_pool_claim_yield_zero_new_key() {
    let old_priv_key = 0x123456789abcdef;
    let old_pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let new_pub_key_x = 0; // INVALID
    let yield_pub_key_x = 0x9876543210abcdef;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    let old_nullifier_hash = zvault_utils::compute_nullifier_hash(old_nullifier);

    let new_pool_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );

    let yield_commitment = zvault_utils::compute_commitment(yield_pub_key_x, yield_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon2::Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_priv_key,
        old_pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        new_pub_key_x,
        yield_pub_key_x,
        pool_merkle_root,
        old_nullifier_hash,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Yield public key cannot be zero")]
fn test_pool_claim_yield_zero_yield_key() {
    let old_priv_key = 0x123456789abcdef;
    let old_pub_key_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index = 0;

    let new_pub_key_x = 0xabcdef012345678;
    let yield_pub_key_x = 0; // INVALID

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = zvault_utils::compute_pool_commitment(
        old_pub_key_x,
        principal as Field,
        deposit_epoch as Field
    );
    let old_nullifier = zvault_utils::compute_nullifier(old_priv_key, leaf_index);
    let old_nullifier_hash = zvault_utils::compute_nullifier_hash(old_nullifier);

    let new_pool_commitment = zvault_utils::compute_pool_commitment(
        new_pub_key_x,
        principal as Field,
        current_epoch as Field
    );

    let yield_commitment = zvault_utils::compute_commitment(yield_pub_key_x, yield_amount as Field);

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = dep::poseidon::poseidon2::Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_priv_key,
        old_pub_key_x,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        new_pub_key_x,
        yield_pub_key_x,
        pool_merkle_root,
        old_nullifier_hash,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}
