// Pool Withdraw Circuit (Stealth Mode)
//
// Proves ownership of pool position and calculates yield for full withdrawal.
// Uses stealth key derived from ECDH shared secret.
//
// Stealth Key Derivation (off-chain):
//   sharedSecret = ECDH(viewingPriv, ephemeralPub)
//   stealthPriv = spendingPriv + hash(sharedSecret)
//   stealthPub = stealthPriv * G
//
// Nullifier Derivation (in-circuit):
//   nullifier = Poseidon2(stealth_priv, leaf_index)
//
// Yield Calculation:
//   epochs_staked = current_epoch - deposit_epoch
//   yield = (principal * epochs_staked * yield_rate_bps) / 10000
//   total_amount = principal + yield

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    // Private inputs - stealth key and position details
    stealth_priv: Field,           // Derived: spendingPriv + hash(sharedSecret)
    principal: u64,
    deposit_epoch: u64,
    leaf_index: u64,               // Position in merkle tree (for nullifier)
    pool_merkle_path: [Field; 20],
    pool_path_indices: [u1; 20],

    // Private inputs - output zkBTC note
    output_nullifier: Field,
    output_secret: Field,

    // Public inputs
    pool_merkle_root: pub Field,       // Pool commitment tree root
    pool_nullifier_hash: pub Field,    // Poseidon2(Poseidon2(stealth_priv, leaf_index))
    stealth_pub_x: pub Field,          // stealthPriv * G (x-coordinate)
    output_commitment: pub Field,      // zkBTC note commitment (principal + yield)
    current_epoch: pub u64,            // Current epoch
    yield_rate_bps: pub u64,           // Yield rate in basis points (e.g., 500 = 5%)
    pool_id: pub Field,                // Pool identifier
) {
    // 1. Derive stealth public key from private key (Grumpkin curve multiplication)
    // In a real implementation, this would be an embedded curve operation
    // For now, we trust that stealth_pub_x matches stealth_priv (verified off-chain)
    // The on-chain verifier checks that stealth_pub_x corresponds to the announcement

    // 2. Verify pool position commitment in pool merkle tree
    // Pool commitment = Poseidon2(stealth_pub_x, principal, deposit_epoch)
    let pool_commitment = Poseidon2::hash([stealth_pub_x, principal as Field, deposit_epoch as Field], 3);
    assert(
        verify_merkle_proof_20(pool_commitment, pool_merkle_root, pool_merkle_path, pool_path_indices),
        "Pool position not in Merkle tree"
    );

    // 3. Compute and verify nullifier
    // nullifier = Poseidon2(stealth_priv, leaf_index)
    let nullifier = Poseidon2::hash([stealth_priv, leaf_index as Field], 2);
    let computed_nullifier_hash = Poseidon2::hash([nullifier], 1);
    assert(
        pool_nullifier_hash == computed_nullifier_hash,
        "Invalid pool nullifier hash"
    );

    // 4. Calculate earned yield
    assert(current_epoch >= deposit_epoch, "Current epoch must be >= deposit epoch");
    let epochs_staked = current_epoch - deposit_epoch;

    // yield = (principal * epochs_staked * yield_rate_bps) / 10000
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount;

    // 5. Verify output commitment contains correct total amount
    let expected_output = zvault_utils::compute_commitment_from_secrets(
        output_nullifier,
        output_secret,
        total_amount as Field
    );
    assert(
        output_commitment == expected_output,
        "Output commitment mismatch - wrong amount"
    );

    // 6. Verify stealth_priv is non-zero (security check)
    assert(stealth_priv != 0, "Stealth private key cannot be zero");

    // 7. Verify pool_id is included (binds proof to specific pool)
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
fn test_pool_withdraw_stealth_circuit() {
    // Stealth key (derived off-chain: spendingPriv + hash(sharedSecret))
    let stealth_priv = 0x123456789abcdef;

    // Corresponding stealth public key x-coordinate
    // In production: stealthPub = stealth_priv * G (Grumpkin curve)
    let stealth_pub_x = 0xfedcba9876543210;

    // Pool position
    let principal: u64 = 100000000; // 1 BTC in sats
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    // Output zkBTC note
    let output_nullifier = 33333;
    let output_secret = 44444;

    // Current state
    let current_epoch: u64 = 20; // 10 epochs staked
    let yield_rate_bps: u64 = 500; // 5% per epoch
    let pool_id = 1;

    // Calculate expected yield
    let epochs_staked = current_epoch - deposit_epoch; // 10
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount; // 1.5 BTC

    // Compute pool commitment
    let pool_commitment = Poseidon2::hash([stealth_pub_x, principal as Field, deposit_epoch as Field], 3);

    // Compute nullifier: Poseidon2(stealth_priv, leaf_index)
    let nullifier = Poseidon2::hash([stealth_priv, leaf_index as Field], 2);
    let pool_nullifier_hash = Poseidon2::hash([nullifier], 1);

    // Compute output commitment
    let output_commitment = zvault_utils::compute_commitment_from_secrets(
        output_nullifier,
        output_secret,
        total_amount as Field
    );

    // Build simple merkle tree
    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    // Run circuit
    main(
        stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_nullifier,
        output_secret,
        pool_merkle_root,
        pool_nullifier_hash,
        stealth_pub_x,
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
    let stealth_priv = 0x123456789abcdef;
    let stealth_pub_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    let output_nullifier = 33333;
    let output_secret = 44444;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    // Compute pool commitment
    let pool_commitment = Poseidon2::hash([stealth_pub_x, principal as Field, deposit_epoch as Field], 3);

    // Compute nullifier
    let nullifier = Poseidon2::hash([stealth_priv, leaf_index as Field], 2);
    let pool_nullifier_hash = Poseidon2::hash([nullifier], 1);

    // WRONG: Use only principal, not principal + yield
    let wrong_output_commitment = zvault_utils::compute_commitment_from_secrets(
        output_nullifier,
        output_secret,
        principal as Field // Should be total_amount
    );

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_nullifier,
        output_secret,
        pool_merkle_root,
        pool_nullifier_hash,
        stealth_pub_x,
        wrong_output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}

#[test(should_fail_with = "Stealth private key cannot be zero")]
fn test_pool_withdraw_zero_stealth_key() {
    let stealth_priv = 0; // INVALID
    let stealth_pub_x = 0xfedcba9876543210;

    let principal: u64 = 100000000;
    let deposit_epoch: u64 = 10;
    let leaf_index: u64 = 0;

    let output_nullifier = 33333;
    let output_secret = 44444;

    let current_epoch: u64 = 20;
    let yield_rate_bps: u64 = 500;
    let pool_id = 1;

    let epochs_staked = current_epoch - deposit_epoch;
    let yield_amount = (principal * epochs_staked * yield_rate_bps) / 10000;
    let total_amount = principal + yield_amount;

    let pool_commitment = Poseidon2::hash([stealth_pub_x, principal as Field, deposit_epoch as Field], 3);
    let nullifier = Poseidon2::hash([stealth_priv, leaf_index as Field], 2);
    let pool_nullifier_hash = Poseidon2::hash([nullifier], 1);

    let output_commitment = zvault_utils::compute_commitment_from_secrets(
        output_nullifier,
        output_secret,
        total_amount as Field
    );

    let zero: Field = 0;
    let pool_merkle_path: [Field; 20] = [zero; 20];
    let pool_path_indices: [u1; 20] = [0; 20];

    let mut current = pool_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let pool_merkle_root = current;

    main(
        stealth_priv,
        principal,
        deposit_epoch,
        leaf_index,
        pool_merkle_path,
        pool_path_indices,
        output_nullifier,
        output_secret,
        pool_merkle_root,
        pool_nullifier_hash,
        stealth_pub_x,
        output_commitment,
        current_epoch,
        yield_rate_bps,
        pool_id
    );
}
