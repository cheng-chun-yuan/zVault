// Partial Withdraw Circuit (SECURITY IMPROVED)
//
// Withdraw any amount with change.
// Amount conservation: input_amount == withdraw_amount + change_amount
//
// SECURITY IMPROVEMENTS:
// - Standardized to 20-level tree (was 10)
// - Added change nullifier uniqueness constraint

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (standardized to 20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    nullifier: Field,
    secret: Field,
    amount: u64,
    merkle_path: [Field; 20],
    path_indices: [u1; 20],
    change_nullifier: Field,
    change_secret: Field,
    change_amount: u64,

    merkle_root: pub Field,
    nullifier_hash: pub Field,
    withdraw_amount: pub u64,
    change_commitment: pub Field,
    recipient: pub Field,
) {
    // 1. Verify input commitment in Merkle tree
    let commitment = zvault_utils::compute_commitment_from_secrets(nullifier, secret, amount as Field);
    assert(
        zvault_utils::verify_merkle_proof_20(commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Verify nullifier hash
    assert(
        nullifier_hash == zvault_utils::compute_nullifier_hash(nullifier),
        "Invalid nullifier hash"
    );

    // 3. Verify amount conservation
    assert(withdraw_amount <= amount, "Withdraw amount exceeds balance");
    assert(amount == withdraw_amount + change_amount, "Amount conservation failed");

    // 4. Verify change commitment
    assert(
        change_commitment == zvault_utils::compute_commitment_from_secrets(
            change_nullifier,
            change_secret,
            change_amount as Field
        ),
        "Change commitment mismatch"
    );

    // 5. SECURITY: Change nullifier must differ from input (if there is change)
    if change_amount > 0 {
        assert(change_nullifier != nullifier, "Change nullifier must differ from input");
    }

    // Recipient is used for binding the withdraw to a specific address
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

    // 20-level tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
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

    // 20-level tree
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = commitment;
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
