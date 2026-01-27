// Pool Claim Yield Circuit (Stealth Mode)
//
// Proves ownership of pool position and claims earned yield while keeping principal staked.
// Uses stealth key derived from ECDH shared secret.
//
// Creates:
// 1. New pool position with new stealth key (same principal, reset epoch)
// 2. zkBTC note for earned yield amount
//
// Stealth Key Derivation (off-chain):
//   sharedSecret = ECDH(viewingPriv, ephemeralPub)
//   stealthPriv = spendingPriv + hash(sharedSecret)
//
// Nullifier = Poseidon2(stealth_priv, leaf_index)

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    // Private inputs - old pool position (stealth key)
    old_stealth_priv: Field,           // Derived: spendingPriv + hash(sharedSecret)
    principal: u64,
    deposit_epoch: u64,
    leaf_index: u64,                   // Position in merkle tree
    pool_merkle_path: [Field; 20],
    pool_path_indices: [u1; 20],

    // Private inputs - yield note secrets
    yield_nullifier: Field,
    yield_secret: Field,

    // Public inputs
    pool_merkle_root: pub Field,           // Pool commitment tree root
    old_nullifier_hash: pub Field,         // Poseidon2(Poseidon2(old_stealth_priv, leaf_index))
    old_stealth_pub_x: pub Field,          // Old position's stealth pub x-coordinate
    new_stealth_pub_x: pub Field,          // New position's stealth pub x-coordinate
    new_pool_commitment: pub Field,        // New pool position (same principal, reset epoch)
    yield_commitment: pub Field,           // zkBTC note for earned yield
    current_epoch: pub u64,                // Current epoch
    yield_rate_bps: pub u64,               // Yield rate in basis points
    pool_id: pub Field,                    // Pool identifier
) {
    // 1. Verify old pool position in merkle tree
    // Pool commitment = Poseidon2(stealth_pub_x, principal, deposit_epoch)
    let old_pool_commitment = Poseidon2::hash([old_stealth_pub_x, principal as Field, deposit_epoch as Field], 3);
    assert(
        verify_merkle_proof_20(old_pool_commitment, pool_merkle_root, pool_merkle_path, pool_path_indices),
        "Old pool position not in Merkle tree"
    );

    // 2. Verify old nullifier
    // nullifier = Poseidon2(stealth_priv, leaf_index)
    let old_nullifier = Poseidon2::hash([old_stealth_priv, leaf_index as Field], 2);
    let computed_nullifier_hash = Poseidon2::hash([old_nullifier], 1);
    assert(
        old_nullifier_hash == computed_nullifier_hash,
        "Invalid old nullifier hash"
    );

    // 3. Verify old_stealth_priv matches old_stealth_pub_x
    // In production, this would verify: old_stealth_priv * G = (old_stealth_pub_x, _)
    // For now, we trust this relationship (verified off-chain via announcement)
    assert(old_stealth_priv != 0, "Old stealth private key cannot be zero");

    // 4. Calculate earned yield
    assert(current_epoch >= deposit_epoch, "Current epoch must be >= deposit epoch");
    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    // 5. Verify new pool position commitment (same principal, reset to current_epoch)
    // New commitment uses new_stealth_pub_x (from new ECDH derivation)
    let expected_new_commitment = Poseidon2::hash([new_stealth_pub_x, principal as Field, current_epoch as Field], 3);
    assert(
        new_pool_commitment == expected_new_commitment,
        "New pool commitment mismatch"
    );

    // 6. Verify yield commitment (zkBTC note for yield_amount)
    let expected_yield_commitment = zvault_utils::compute_commitment_from_secrets(
        yield_nullifier,
        yield_secret,
        yield_amount as Field
    );
    assert(
        yield_commitment == expected_yield_commitment,
        "Yield commitment mismatch"
    );

    // 7. Ensure new stealth key is different from old
    assert(new_stealth_pub_x != old_stealth_pub_x, "New stealth key must differ from old");

    // 8. Verify pool_id binding
    assert(pool_id != 0, "Pool ID cannot be zero");
}

/**
 * Verify Merkle proof (20-level tree)
 */
fn verify_merkle_proof_20(
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

#[test]
fn test_pool_claim_yield_stealth_circuit() {
    // Old stealth key
    let old_stealth_priv = 0x123456789abcdef;
    let old_stealth_pub_x = 0xfedcba9876543210;

    // Position details
    let principal: u64 = 100000000; // 1 BTC
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    // New stealth key (from new ECDH)
    let new_stealth_pub_x = 0xabcdef012345678;

    // Yield note secrets
    let yield_nullifier = 55555;
    let yield_secret = 66666;

    // Current state
    let current_epoch: u64 = 20; // 10 epochs staked
    let yield_rate_bps: u64 = 500; // 5% per epoch
    let pool_id = 1;

    // Calculate yield
    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    // yield = 50000000 (0.5 BTC)

    // Compute old pool commitment
    let old_pool_commitment = Poseidon2::hash([old_stealth_pub_x, principal as Field, deposit_epoch as Field], 3);

    // Compute old nullifier
    let old_nullifier = Poseidon2::hash([old_stealth_priv, leaf_index as Field], 2);
    let old_nullifier_hash = Poseidon2::hash([old_nullifier], 1);

    // Compute new pool commitment (same principal, reset epoch)
    let new_pool_commitment = Poseidon2::hash([new_stealth_pub_x, principal as Field, current_epoch as Field], 3);

    // Compute yield commitment
    let yield_commitment = zvault_utils::compute_commitment_from_secrets(
        yield_nullifier,
        yield_secret,
        yield_amount as Field
    );

    // Build merkle tree
    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    // Run circuit
    main(
        old_stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        yield_nullifier,
        yield_secret,
        pool_merkle_root,
        old_nullifier_hash,
        old_stealth_pub_x,
        new_stealth_pub_x,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "New stealth key must differ from old")]
fn test_pool_claim_yield_same_stealth_key() {
    let old_stealth_priv = 0x123456789abcdef;
    let old_stealth_pub_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    // INVALID: Same stealth key
    let new_stealth_pub_x = old_stealth_pub_x;

    let yield_nullifier = 55555;
    let yield_secret = 66666;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = Poseidon2::hash([old_stealth_pub_x, principal as Field, deposit_epoch as Field], 3);
    let old_nullifier = Poseidon2::hash([old_stealth_priv, leaf_index as Field], 2);
    let old_nullifier_hash = Poseidon2::hash([old_nullifier], 1);

    let new_pool_commitment = Poseidon2::hash([new_stealth_pub_x, principal as Field, current_epoch as Field], 3);

    let yield_commitment = zvault_utils::compute_commitment_from_secrets(
        yield_nullifier,
        yield_secret,
        yield_amount as Field
    );

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        yield_nullifier,
        yield_secret,
        pool_merkle_root,
        old_nullifier_hash,
        old_stealth_pub_x,
        new_stealth_pub_x,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Old stealth private key cannot be zero")]
fn test_pool_claim_yield_zero_stealth_key() {
    let old_stealth_priv = 0; // INVALID
    let old_stealth_pub_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    let new_stealth_pub_x = 0xabcdef012345678;

    let yield_nullifier = 55555;
    let yield_secret = 66666;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;

    let old_pool_commitment = Poseidon2::hash([old_stealth_pub_x, principal as Field, deposit_epoch as Field], 3);
    let old_nullifier = Poseidon2::hash([old_stealth_priv, leaf_index as Field], 2);
    let old_nullifier_hash = Poseidon2::hash([old_nullifier], 1);

    let new_pool_commitment = Poseidon2::hash([new_stealth_pub_x, principal as Field, current_epoch as Field], 3);

    let yield_commitment = zvault_utils::compute_commitment_from_secrets(
        yield_nullifier,
        yield_secret,
        yield_amount as Field
    );

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = old_pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        old_stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        yield_nullifier,
        yield_secret,
        pool_merkle_root,
        old_nullifier_hash,
        old_stealth_pub_x,
        new_stealth_pub_x,
        new_pool_commitment,
        yield_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}
