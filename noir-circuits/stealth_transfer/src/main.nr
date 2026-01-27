// Stealth Transfer Circuit
//
// Enables private transfer of existing zkBTC commitment to a recipient's stealth address.
// The sender proves knowledge of the input note and creates a new commitment for the recipient.
//
// Flow:
// 1. Verify sender owns input commitment (in merkle tree)
// 2. Verify input nullifier hash is correct
// 3. Verify output commitment matches recipient's stealth derivation
// 4. Amount conservation (input == output for full transfer)
//
// Stealth Address Model (EIP-5564/DKSAP):
// - Sender generates ephemeral keypair
// - Sender computes: sharedSecret = ECDH(ephemeralPriv, recipientViewingPub)
// - Sender derives: stealthPubKey = recipientSpendingPub + hash(sharedSecret) * G
// - Commitment = Poseidon2(stealthPubKey.x, amount)
// - Recipient scans with viewing key, claims with spending key

use dep::zvault_utils;
use dep::poseidon::poseidon2::Poseidon2;

// Merkle tree depth (standardized to 20 levels, ~1M leaves)
global TREE_DEPTH: u32 = 20;

fn main(
    // Private inputs (sender knows)
    input_nullifier: Field,
    input_secret: Field,
    input_amount: Field,
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    // Private inputs for output (derived by sender for recipient)
    // The output commitment is computed from the stealth derivation
    // output_commitment = Poseidon2(stealth_pub_x, amount)
    // where stealth_pub_x is derived from ECDH between ephemeral key and recipient's viewing key
    output_stealth_pub_x: Field, // x-coordinate of recipient's stealth public key

    // Public inputs
    merkle_root: pub Field,
    input_nullifier_hash: pub Field,
    output_commitment: pub Field,
    amount_pub: pub Field, // Amount must be public for on-chain verification
) {
    // 1. Verify input commitment exists in Merkle tree
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount
    );
    assert(
        zvault_utils::verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices),
        "Input commitment not in Merkle tree"
    );

    // 2. Verify input nullifier hash
    assert(
        input_nullifier_hash == zvault_utils::compute_nullifier_hash(input_nullifier),
        "Invalid input nullifier hash"
    );

    // 3. Verify output commitment matches stealth derivation
    // The output commitment is: Poseidon2(stealth_pub_x, amount)
    // This ensures the recipient (who can derive stealth_priv from ECDH) can claim
    let expected_output_commitment = Poseidon2::hash([output_stealth_pub_x, amount_pub], 2);
    assert(
        output_commitment == expected_output_commitment,
        "Output commitment does not match stealth derivation"
    );

    // 4. Verify amount conservation (full transfer - input equals output)
    assert(
        input_amount == amount_pub,
        "Amount mismatch: input must equal output for full transfer"
    );
}

#[test]
fn test_stealth_transfer_circuit() {
    // Input note
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount = 1000000; // 1,000,000 sats

    // Compute input commitment
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    // Output stealth derivation
    // In practice: stealth_pub_x = ECDH(ephemeralPriv, recipientViewingPub).x
    let output_stealth_pub_x = 999999; // Simulated stealth public key x-coordinate
    let output_amount = input_amount; // Full transfer

    // Compute output commitment
    let output_commitment = Poseidon2::hash([output_stealth_pub_x, output_amount], 2);

    // Build merkle tree (20-level, single leaf for test)
    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    // Compute merkle root (leaf at position 0)
    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // Execute circuit
    main(
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        merkle_root,
        input_nullifier_hash,
        output_commitment,
        output_amount
    );
}

#[test(should_fail_with = "Amount mismatch")]
fn test_stealth_transfer_amount_mismatch() {
    // Input note
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount = 1000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    // Output with DIFFERENT amount (should fail)
    let output_stealth_pub_x = 999999;
    let output_amount = 500000; // Wrong! Should be 1000000

    let output_commitment = Poseidon2::hash([output_stealth_pub_x, output_amount], 2);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // This should fail due to amount mismatch
    main(
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        merkle_root,
        input_nullifier_hash,
        output_commitment,
        output_amount
    );
}

#[test(should_fail_with = "Output commitment does not match stealth derivation")]
fn test_stealth_transfer_commitment_mismatch() {
    // Input note
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount = 1000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    // Output with wrong stealth pub
    let output_stealth_pub_x = 999999;
    let wrong_stealth_pub_x = 888888; // Different from what's in commitment
    let output_amount = input_amount;

    // Commitment computed with wrong_stealth_pub_x
    let output_commitment = Poseidon2::hash([wrong_stealth_pub_x, output_amount], 2);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // This should fail due to commitment mismatch
    main(
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x, // Passing the correct stealth pub
        merkle_root,
        input_nullifier_hash,
        output_commitment, // But commitment was made with wrong one
        output_amount
    );
}

#[test(should_fail_with = "Input commitment not in Merkle tree")]
fn test_stealth_transfer_invalid_merkle_proof() {
    // Input note
    let input_nullifier = 12345;
    let input_secret = 67890;
    let input_amount = 1000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        input_amount
    );
    let input_nullifier_hash = zvault_utils::compute_nullifier_hash(input_nullifier);

    let output_stealth_pub_x = 999999;
    let output_amount = input_amount;
    let output_commitment = Poseidon2::hash([output_stealth_pub_x, output_amount], 2);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    // Use wrong merkle root
    let wrong_merkle_root = 123456789;

    // This should fail due to invalid merkle proof
    main(
        input_nullifier,
        input_secret,
        input_amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        wrong_merkle_root,
        input_nullifier_hash,
        output_commitment,
        output_amount
    );
}
