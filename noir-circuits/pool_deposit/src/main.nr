// Pool Deposit Circuit (Stealth Mode)
//
// Proves valid deposit of zkBTC into yield pool using stealth addresses.
// Spends an existing zkBTC note and creates a pool position commitment.
//
// Stealth Pool Position Commitment Structure:
//   pool_commitment = Poseidon2(stealth_pub_x, principal, deposit_epoch)
//
// Where stealth_pub is derived off-chain via ECDH:
//   sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
//   stealthPub = spendingPub + hash(sharedSecret) * G

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    // Private inputs - zkBTC note being deposited
    input_nullifier: Field,
    input_secret: Field,
    input_amount: u64,
    input_merkle_path: [Field; 20],
    input_path_indices: [u1; 20],

    // Public inputs
    input_merkle_root: pub Field,      // Main zkBTC tree root
    input_nullifier_hash: pub Field,   // Hash of input nullifier (for on-chain recording)
    stealth_pub_x: pub Field,          // Stealth public key x-coordinate (from ECDH)
    pool_commitment: pub Field,        // New pool position commitment
    deposit_epoch: pub Field,          // Current epoch at deposit time
) {
    // 1. Verify input zkBTC commitment exists in main merkle tree
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount as Field
    );
    assert(
        verify_merkle_proof_20(input_commitment, input_merkle_root, input_merkle_path, input_path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Verify input nullifier hash matches
    assert(
        input_nullifier_hash == zvault_utils::compute_nullifier_hash(input_nullifier),
        "Invalid input nullifier hash"
    );

    // 3. Verify principal equals input amount (full deposit, no partial)
    let principal = input_amount as Field;

    // 4. Compute and verify pool position commitment
    // Pool commitment = Poseidon2(stealth_pub_x, principal, deposit_epoch)
    // stealth_pub_x is derived off-chain via ECDH and provided as public input
    let expected_pool_commitment = Poseidon2::hash([stealth_pub_x, principal, deposit_epoch], 3);
    assert(
        pool_commitment == expected_pool_commitment,
        "Pool commitment mismatch"
    );

    // 5. Ensure stealth_pub_x is valid (non-zero)
    assert(stealth_pub_x != 0, "Stealth public key cannot be zero");

    // 6. Ensure principal > 0
    assert(input_amount > 0, "Principal must be greater than zero");
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
fn test_pool_deposit_stealth_circuit() {
    // Input zkBTC note
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount: u64 = 100000000; // 1 BTC in sats

    // Stealth public key x-coordinate (derived off-chain via ECDH)
    // In production, this is: stealthPub = spendingPub + hash(ECDH(ephemeral, viewingPub)) * G
    let stealth_pub_x = 0xfedcba9876543210;

    // Deposit epoch
    let deposit_epoch = 10;

    // Compute input commitment
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount as Field
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    // Compute pool commitment: Poseidon2(stealth_pub_x, principal, deposit_epoch)
    let pool_commitment = Poseidon2::hash([stealth_pub_x, input_amount as Field, deposit_epoch], 3);

    // Build simple merkle tree (leaf at index 0)
    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    // Compute root
    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let input_merkle_root = current;

    // Run circuit
    main(
        input_nullifier,
        input_secret,
        input_amount,
        input_merkle_path,
        input_path_indices,
        input_merkle_root,
        input_nullifier_hash,
        stealth_pub_x,
        pool_commitment,
        deposit_epoch
    );
}

#[test(should_fail_with = "Stealth public key cannot be zero")]
fn test_pool_deposit_zero_stealth_key() {
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount: u64 = 100000000;

    // INVALID: zero stealth key
    let stealth_pub_x = 0;

    let deposit_epoch = 10;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount as Field
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    let pool_commitment = Poseidon2::hash([stealth_pub_x, input_amount as Field, deposit_epoch], 3);

    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let input_merkle_root = current;

    main(
        input_nullifier,
        input_secret,
        input_amount,
        input_merkle_path,
        input_path_indices,
        input_merkle_root,
        input_nullifier_hash,
        stealth_pub_x,
        pool_commitment,
        deposit_epoch
    );
}

#[test(should_fail_with = "Principal must be greater than zero")]
fn test_pool_deposit_zero_principal() {
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount: u64 = 0; // INVALID: zero amount

    let stealth_pub_x = 0xfedcba9876543210;
    let deposit_epoch = 10;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount as Field
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    let pool_commitment = Poseidon2::hash([stealth_pub_x, input_amount as Field, deposit_epoch], 3);

    let zero: Field = 0;
    let input_merkle_path: [Field; 20] = [zero; 20];
    let input_path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let input_merkle_root = current;

    main(
        input_nullifier,
        input_secret,
        input_amount,
        input_merkle_path,
        input_path_indices,
        input_merkle_root,
        input_nullifier_hash,
        stealth_pub_x,
        pool_commitment,
        deposit_epoch
    );
}
