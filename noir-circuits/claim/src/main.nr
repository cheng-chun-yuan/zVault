// Claim Circuit (claim_direct)
//
// Proves:
// 1. User knows (nullifier, secret) for a commitment
// 2. The commitment exists in the Merkle tree
// 3. Outputs nullifier_hash for double-spend prevention

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    // Private inputs (witness)
    nullifier: Field,
    secret: Field,
    amount: Field,
    merkle_path: [Field; 10],
    path_indices: [u1; 10],
    
    // Public inputs
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    amount_pub: pub Field,
) {
    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    assert(zvault_utils::verify_merkle_proof(commitment, merkle_root, merkle_path, path_indices));
    assert(nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier));
    assert(amount == amount_pub);
}

#[test]
fn test_claim_circuit() {
    // Test values
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Tree setup
    let zero: Field = 0;
    let merkle_path: [Field; 10] = [zero; 10];
    let path_indices: [u1; 10] = [0; 10];

    // Compute root
    let mut current = commitment;
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
        merkle_root,
        nullifier_hash,
        amount
    );
}
