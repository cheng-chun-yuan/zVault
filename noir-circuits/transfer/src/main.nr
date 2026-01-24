// Transfer Circuit
//
// 1-in-1-out transfer: Proves knowledge of input commitment and creates new output commitment.
// Amount is preserved (input amount == output amount).

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    nullifier: Field,
    secret: Field,
    amount: Field,
    merkle_path: [Field; 10],
    path_indices: [u1; 10],
    output_nullifier: Field,
    output_secret: Field,
    
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    output_commitment: pub Field,
) {
    let input_commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    assert(zvault_utils::verify_merkle_proof(input_commitment, merkle_root, merkle_path, path_indices));

    assert(nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier));
    assert(output_commitment == zvault_utils::compute_commitment_from_secrets(output_nullifier, output_secret, amount));
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

    let zero: Field = 0;
    let merkle_path: [Field; 10] = [zero; 10];
    let path_indices: [u1; 10] = [0; 10];

    let mut current = input_commitment;
    for _i in 0..10 {
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
