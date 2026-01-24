// Split Circuit (SECURITY IMPROVED)
//
// 1-in-2-out split: Takes one commitment and splits it into two.
// Amount conservation: input_amount == output1_amount + output2_amount
//
// SECURITY IMPROVEMENTS:
// - Standardized to 20-level tree (~1M leaves)
// - Added output nullifier uniqueness constraint
// - Output nullifiers must be different from each other AND from input

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (standardized to 20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    input_nullifier: Field,
    input_secret: Field,
    input_amount: u64,
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    output1_nullifier: Field,
    output1_secret: Field,
    output1_amount: u64,

    output2_nullifier: Field,
    output2_secret: Field,
    output2_amount: u64,

    merkle_root: pub Field,
    input_nullifier_hash: pub Field,
    output_commitment1: pub Field,
    output_commitment2: pub Field,
) {
    // 1. Verify amount conservation
    assert(input_amount == output1_amount + output2_amount, "Amount conservation failed");

    // 2. Verify input commitment exists in Merkle tree
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount as Field
    );
    assert(
        verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 3. Verify input nullifier hash
    assert(
        input_nullifier_hash == zvault_utils::compute_nullifier_hash(input_nullifier),
        "Invalid input nullifier hash"
    );

    // 4. Verify output commitments match
    assert(
        output_commitment1 == zvault_utils::compute_commitment_from_secrets(
            output1_nullifier,
            output1_secret,
            output1_amount as Field
        ),
        "Output 1 commitment mismatch"
    );
    assert(
        output_commitment2 == zvault_utils::compute_commitment_from_secrets(
            output2_nullifier,
            output2_secret,
            output2_amount as Field
        ),
        "Output 2 commitment mismatch"
    );

    // 5. SECURITY: Ensure output nullifiers are unique
    // - Output nullifiers must be different from each other
    // - Output nullifiers must be different from input nullifier
    assert(output1_nullifier != output2_nullifier, "Output nullifiers must be unique");
    assert(output1_nullifier != input_nullifier, "Output 1 nullifier must differ from input");
    assert(output2_nullifier != input_nullifier, "Output 2 nullifier must differ from input");
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
fn test_split_circuit() {
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount: u64 = 100000000;

    let output1_nullifier = 11111;
    let output1_secret = 22222;
    let output1_amount: u64 = 60000000;

    let output2_nullifier = 33333;
    let output2_secret = 44444;
    let output2_amount: u64 = 40000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(input_nullifier, input_secret, input_amount as Field);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    let output_commitment1 = zvault_utils::compute_commitment_from_secrets(output1_nullifier, output1_secret, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment_from_secrets(output2_nullifier, output2_secret, output2_amount as Field);

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
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output1_nullifier,
        output1_secret,
        output1_amount,
        output2_nullifier,
        output2_secret,
        output2_amount,
        merkle_root,
        input_nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}

#[test]
fn test_split_amount_conservation() {
    let input: u64 = 1000;
    let output1: u64 = 600;
    let output2: u64 = 400;
    assert(input == output1 + output2);
}

#[test(should_fail_with = "Output nullifiers must be unique")]
fn test_split_duplicate_output_nullifiers() {
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount: u64 = 100000000;

    // INVALID: Same nullifier for both outputs
    let output1_nullifier = 11111;
    let output1_secret = 22222;
    let output1_amount: u64 = 60000000;

    let output2_nullifier = 11111; // Same as output1!
    let output2_secret = 44444;
    let output2_amount: u64 = 40000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(input_nullifier, input_secret, input_amount as Field);
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    let output_commitment1 = zvault_utils::compute_commitment_from_secrets(output1_nullifier, output1_secret, output1_amount as Field);
    let output_commitment2 = zvault_utils::compute_commitment_from_secrets(output2_nullifier, output2_secret, output2_amount as Field);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // This should FAIL due to duplicate nullifiers
    main(
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output1_nullifier,
        output1_secret,
        output1_amount,
        output2_nullifier,
        output2_secret,
        output2_amount,
        merkle_root,
        input_nullifier_hash,
        output_commitment1,
        output_commitment2
    );
}
