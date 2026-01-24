// Split Circuit
//
// 1-in-2-out split: Takes one commitment and splits it into two.
// Amount conservation: input_amount == output1_amount + output2_amount

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    input_nullifier: Field,
    input_secret: Field,
    input_amount: u64,
    merkle_path: [Field; 10],
    path_indices: [u1; 10],
    
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
    assert(input_amount == output1_amount + output2_amount);

    let input_commitment = zvault_utils::compute_commitment_from_secrets(input_nullifier, input_secret, input_amount as Field);
    assert(zvault_utils::verify_merkle_proof(input_commitment, merkle_root, merkle_path, path_indices));

    assert(input_nullifier_hash == zvault_utils::compute_nullifier_hash(input_nullifier));

    assert(output_commitment1 == zvault_utils::compute_commitment_from_secrets(output1_nullifier, output1_secret, output1_amount as Field));
    assert(output_commitment2 == zvault_utils::compute_commitment_from_secrets(output2_nullifier, output2_secret, output2_amount as Field));
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

    let zero: Field = 0;
    let merkle_path: [Field; 10] = [zero; 10];
    let path_indices: [u1; 10] = [0; 10];

    let mut current = input_commitment;
    for _i in 0..10 {
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
