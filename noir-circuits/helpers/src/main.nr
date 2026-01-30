// Helper circuit to compute public inputs for testing
//
// This circuit computes and returns the values needed for claim, transfer, split circuits.
// Use noir_js to execute this and get the computed values.

use dep::zvault_utils;
use std::hash::poseidon::bn254::hash_2;

// Compute Merkle root from leaf with zero siblings (all-left path)
fn compute_merkle_root(leaf: Field) -> Field {
    let zero: Field = 0;
    let mut current = leaf;
    for _i in 0..10 {
        current = hash_2([current, zero]);
    }
    current
}

// Main function returns computed public inputs for the claim circuit
fn main(
    nullifier: Field,
    secret: Field,
    amount: Field,
) -> pub (Field, Field, Field) {
    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let merkle_root = compute_merkle_root(commitment);

    (merkle_root, nullifier_hash, commitment)
}

#[test]
fn test_compute_claim_inputs() {
    let nullifier: Field = 12345;
    let secret: Field = 67890;
    let amount: Field = 1000000;

    let (merkle_root, nullifier_hash, commitment) = main(nullifier, secret, amount);

    // Print computed values for use in Prover.toml
    std::println(f"merkle_root: {merkle_root}");
    std::println(f"nullifier_hash: {nullifier_hash}");
    std::println(f"commitment: {commitment}");
}

#[test]
fn test_compute_transfer_inputs() {
    let nullifier: Field = 12345;
    let secret: Field = 67890;
    let amount: Field = 1000000;
    let output_nullifier: Field = 11111;
    let output_secret: Field = 22222;

    // Input values
    let (merkle_root, nullifier_hash, _) = main(nullifier, secret, amount);

    // Output commitment
    let output_commitment = zvault_utils::compute_commitment_from_secrets(output_nullifier, output_secret, amount);

    std::println(f"merkle_root: {merkle_root}");
    std::println(f"nullifier_hash: {nullifier_hash}");
    std::println(f"output_commitment: {output_commitment}");
}

#[test]
fn test_compute_split_inputs() {
    let input_nullifier: Field = 12345;
    let input_secret: Field = 67890;
    let input_amount: Field = 100000000;

    let output1_nullifier: Field = 11111;
    let output1_secret: Field = 22222;
    let output1_amount: Field = 60000000;

    let output2_nullifier: Field = 33333;
    let output2_secret: Field = 44444;
    let output2_amount: Field = 40000000;

    let (merkle_root, input_nullifier_hash, _) = main(input_nullifier, input_secret, input_amount);
    let output_commitment1 = zvault_utils::compute_commitment_from_secrets(output1_nullifier, output1_secret, output1_amount);
    let output_commitment2 = zvault_utils::compute_commitment_from_secrets(output2_nullifier, output2_secret, output2_amount);

    std::println(f"merkle_root: {merkle_root}");
    std::println(f"input_nullifier_hash: {input_nullifier_hash}");
    std::println(f"output_commitment1: {output_commitment1}");
    std::println(f"output_commitment2: {output_commitment2}");
}

#[test]
fn test_compute_partial_withdraw_inputs() {
    let nullifier: Field = 12345;
    let secret: Field = 67890;
    let amount: Field = 100000000;

    let change_nullifier: Field = 11111;
    let change_secret: Field = 22222;
    let change_amount: Field = 70000000;

    let (merkle_root, nullifier_hash, _) = main(nullifier, secret, amount);
    let change_commitment = zvault_utils::compute_commitment_from_secrets(change_nullifier, change_secret, change_amount);

    std::println(f"merkle_root: {merkle_root}");
    std::println(f"nullifier_hash: {nullifier_hash}");
    std::println(f"change_commitment: {change_commitment}");
}
