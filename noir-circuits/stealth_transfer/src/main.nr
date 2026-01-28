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
    amount: Field, // Private - never revealed
    merkle_path: [Field; 20],
    path_indices: [u1; 20],

    // Private inputs for output (derived by sender for recipient)
    output_stealth_pub_x: Field, // x-coordinate of recipient's stealth public key

    // Public inputs
    merkle_root: pub Field,
    input_nullifier_hash: pub Field,
    output_commitment: pub Field,
    // Amount is NOT public - ZK proof guarantees conservation
) {
    // 1. Verify input commitment exists in Merkle tree
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        input_nullifier,
        input_secret,
        amount
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
    // Output commitment = Poseidon2(stealth_pub_x, amount)
    // Amount conservation is guaranteed: same 'amount' used in input and output
    let expected_output_commitment = Poseidon2::hash([output_stealth_pub_x, amount], 2);
    assert(
        output_commitment == expected_output_commitment,
        "Output commitment does not match stealth derivation"
    );
    // No need to publicly reveal amount - the proof guarantees the same amount
    // is used in both input commitment verification and output commitment creation
}

#[test]
fn test_stealth_transfer_circuit() {
    // Input note
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000; // 1,000,000 sats

    // Compute input commitment
    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        nullifier,
        secret,
        amount
    );
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Output stealth derivation
    // In practice: stealth_pub_x = ECDH(ephemeralPriv, recipientViewingPub).x
    let output_stealth_pub_x = 999999; // Simulated stealth public key x-coordinate

    // Compute output commitment (same amount, but now private)
    let output_commitment = Poseidon2::hash([output_stealth_pub_x, amount], 2);

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

    // Execute circuit - amount is private, only commitment is public
    main(
        nullifier,
        secret,
        amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        merkle_root,
        nullifier_hash,
        output_commitment
    );
}

#[test(should_fail_with = "Output commitment does not match stealth derivation")]
fn test_stealth_transfer_amount_mismatch() {
    // Input note
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        nullifier,
        secret,
        amount
    );
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Output with DIFFERENT amount in commitment (should fail)
    let output_stealth_pub_x = 999999;
    let wrong_amount = 500000; // Wrong! Should be 1000000

    // Commitment made with wrong amount
    let output_commitment = Poseidon2::hash([output_stealth_pub_x, wrong_amount], 2);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    let mut current = input_commitment;
    for _i in 0..20 {
        current = Poseidon2::hash([current, zero], 2);
    }
    let merkle_root = current;

    // This should fail - circuit uses correct amount but commitment has wrong amount
    main(
        nullifier,
        secret,
        amount, // Correct amount
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        merkle_root,
        nullifier_hash,
        output_commitment // But commitment has wrong_amount baked in
    );
}

#[test(should_fail_with = "Output commitment does not match stealth derivation")]
fn test_stealth_transfer_commitment_mismatch() {
    // Input note
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    let input_commitment = zvault_utils::compute_commitment_from_secrets(
        nullifier,
        secret,
        amount
    );
    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    // Output with wrong stealth pub
    let output_stealth_pub_x = 999999;
    let wrong_stealth_pub_x = 888888; // Different from what's in commitment

    // Commitment computed with wrong_stealth_pub_x
    let output_commitment = Poseidon2::hash([wrong_stealth_pub_x, amount], 2);

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
        nullifier,
        secret,
        amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x, // Passing the correct stealth pub
        merkle_root,
        nullifier_hash,
        output_commitment // But commitment was made with wrong one
    );
}

#[test(should_fail_with = "Input commitment not in Merkle tree")]
fn test_stealth_transfer_invalid_merkle_proof() {
    // Input note
    let nullifier = 12345;
    let secret = 67890;
    let amount = 1000000;

    let nullifier_hash = zvault_utils::compute_nullifier_hash(nullifier);

    let output_stealth_pub_x = 999999;
    let output_commitment = Poseidon2::hash([output_stealth_pub_x, amount], 2);

    let zero: Field = 0;
    let merkle_path: [Field; 20] = [zero; 20];
    let path_indices: [u1; 20] = [0; 20];

    // Use wrong merkle root
    let wrong_merkle_root = 123456789;

    // This should fail due to invalid merkle proof
    main(
        nullifier,
        secret,
        amount,
        merkle_path,
        path_indices,
        output_stealth_pub_x,
        wrong_merkle_root,
        nullifier_hash,
        output_commitment
    );
}
