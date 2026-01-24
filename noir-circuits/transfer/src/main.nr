// Transfer Circuit (SECURITY IMPROVED)
//
// 1-in-1-out transfer: Proves knowledge of input commitment and creates new output commitment.
// Amount is preserved (input amount == output amount).
//
// SECURITY IMPROVEMENTS:
// - Standardized to 20-level tree (was 10)
// - Added output nullifier uniqueness constraint

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (standardized to 20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    nullifier: Field,
    secret: Field,
    amount: Field,
    merkle_path: [Field; 20],
    path_indices: [u1; 20],
    output_nullifier: Field,
    output_secret: Field,

    merkle_root: pub Field,
    nullifier_hash: pub Field,
    output_commitment: pub Field,
) {
    // 1. Verify input commitment in Merkle tree
    let input_commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    assert(
        zvault_utils::verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Verify nullifier hash
    assert(
        nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid nullifier hash"
    );

    // 3. Verify output commitment
    assert(
        output_commitment == zvault_utils::compute_commitment_from_secrets(output_nullifier, output_secret, amount),
        "Output commitment mismatch"
    );

    // 4. SECURITY: Output nullifier must differ from input
    assert(output_nullifier != nullifier, "Output nullifier must differ from input");
}

#[test]
fn test_transfer_circuit() {
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    let output_nullifier = 11111;
    let output_secret = 22222;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment = zvault_utils::compute_commitment_from_secrets(output_nullifier, output_secret, amount);

    // 20-level tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    main(
        nullifier,
        secret,
        amount,
        merkle_path,
        path_indices,
        output_nullifier,
        output_secret,
        merkle_root,
        nullifier_hash,
        output_commitment
    );
}

#[test(should_fail_with = "Output nullifier must differ from input")]
fn test_transfer_same_nullifier() {
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    // INVALID: Using same nullifier for output
    let output_nullifier = 12345; // Same as input!
    let output_secret = 22222;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let output_commitment = zvault_utils::compute_commitment_from_secrets(output_nullifier, output_secret, amount);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // This should FAIL
    main(
        nullifier,
        secret,
        amount,
        merkle_path,
        path_indices,
        output_nullifier,
        output_secret,
        merkle_root,
        nullifier_hash,
        output_commitment
    );
}
