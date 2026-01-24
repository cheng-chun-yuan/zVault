// Partial Withdraw Circuit
//
// Withdraw any amount with change.
// Amount conservation: input_amount == withdraw_amount + change_amount

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    nullifier: Field,
    secret: Field,
    amount: u64,
    merkle_path: [Field; 10],
    path_indices: [u1; 10],
    change_nullifier: Field,
    change_secret: Field,
    change_amount: u64,
    
    merkle_root: pub Field,
    nullifier_hash: pub Field,
    withdraw_amount: pub u64,
    change_commitment: pub Field,
    recipient: pub Field,
) {
    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount as Field);
    assert(zvault_utils::verify_merkle_proof(commitment, merkle_root, merkle_path, path_indices));

    assert(nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier));

    assert(withdraw_amount <= amount);
    assert(amount == withdraw_amount + change_amount);

    assert(change_commitment == zvault_utils::compute_commitment_from_secrets(change_nullifier, change_secret, change_amount as Field));

    let _ = recipient;
}

#[test]
fn test_partial_withdraw_circuit() {
    let nullifier = 12345;
    let secret = 67890;
    let amount: u64 = 100000000;

    let withdraw_amount: u64 = 30000000;
    let change_nullifier = 11111;
    let change_secret = 22222;
    let change_amount: u64 = 70000000;

    let recipient = 99999;

    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount as Field);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment_from_secrets(change_nullifier, change_secret, change_amount as Field);

    let zero: Field = 0;
    let merkle_path: [Field; 10] = [zero; 10];
    let path_indices: [u1; 10] = [0; 10];

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
        change_nullifier,
        change_secret,
        change_amount,
        merkle_root,
        nullifier_hash,
        withdraw_amount,
        change_commitment,
        recipient
    );
}

#[test]
fn test_full_withdraw_no_change() {
    let nullifier = 12345;
    let secret = 67890;
    let amount: u64 = 100000000;

    let withdraw_amount: u64 = 100000000;
    let change_nullifier = 0;
    let change_secret = 0;
    let change_amount: u64 = 0;

    let recipient = 99999;

    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount as Field);
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);
    let change_commitment = zvault_utils::compute_commitment_from_secrets(change_nullifier, change_secret, change_amount as Field);

    let zero: Field = 0;
    let merkle_path: [Field; 10] = [zero; 10];
    let path_indices: [u1; 10] = [0; 10];

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
        change_nullifier,
        change_secret,
        change_amount,
        merkle_root,
        nullifier_hash,
        withdraw_amount,
        change_commitment,
        recipient
    );
}
