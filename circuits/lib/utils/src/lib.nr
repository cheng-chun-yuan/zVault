// zVault Unified Cryptographic Utilities
//
// UNIFIED MODEL: All commitments and nullifiers use the same format
//
// Commitment = Poseidon(pub_key_x, amount)
// Nullifier  = Poseidon(priv_key, leaf_index)
// Nullifier Hash = Poseidon(nullifier)
//
// This applies to:
// - User balances (stealth addresses)
// - Claim links (self-addressed with seed-derived keys)
// - Pool positions (stealth-based)
//
// NOTE: Using Circom-compatible Poseidon (NOT Poseidon2) for compatibility with
// Solana's sol_poseidon syscall and circomlibjs in SDK.

use dep::poseidon::poseidon::bn254::hash_1;
use dep::poseidon::poseidon::bn254::hash_2;
use dep::poseidon::poseidon::bn254::hash_3;

// Grumpkin ECDH module for key derivation
pub mod grumpkin;

// ============================================================================
// Unified Commitment System
// ============================================================================

/// Compute commitment from public key x-coordinate and amount
/// commitment = Poseidon(pub_key_x, amount)
pub fn compute_commitment(pub_key_x: Field, amount: Field) -> Field {
    hash_2([pub_key_x, amount])
}

/// Compute nullifier from private key and leaf index
/// nullifier = Poseidon(priv_key, leaf_index)
pub fn compute_nullifier(priv_key: Field, leaf_index: Field) -> Field {
    hash_2([priv_key, leaf_index])
}

/// Compute nullifier hash for double-spend prevention
/// nullifier_hash = Poseidon(nullifier)
pub fn compute_nullifier_hash(nullifier: Field) -> Field {
    hash_1([nullifier])
}

// ============================================================================
// Pool Position Commitment
// ============================================================================

/// Compute pool position commitment
/// pool_commitment = Poseidon(pub_key_x, principal, deposit_epoch)
pub fn compute_pool_commitment(pub_key_x: Field, principal: Field, deposit_epoch: Field) -> Field {
    hash_3([pub_key_x, principal, deposit_epoch])
}

// ============================================================================
// Merkle Tree Verification (20-level standard)
// ============================================================================

/// Verify Merkle proof (20-level tree, ~1M leaves)
pub fn verify_merkle_proof_20(
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

        current = hash_2([left, right]);
    }

    current == root
}

// ============================================================================
// Legacy Compatibility (to be removed)
// ============================================================================

/// Legacy: Compute note from nullifier and secret (OLD FORMAT - deprecated)
pub fn compute_note(nullifier: Field, secret: Field) -> Field {
    hash_2([nullifier, secret])
}

/// Legacy: Compute commitment from secrets (OLD FORMAT - deprecated)
pub fn compute_commitment_from_secrets(nullifier: Field, secret: Field, amount: Field) -> Field {
    let note = compute_note(nullifier, secret);
    hash_2([note, amount])
}

/// Legacy stealth commitment (same as unified - kept for compatibility)
pub fn compute_stealth_commitment(pub_key_x: Field, amount: Field) -> Field {
    compute_commitment(pub_key_x, amount)
}

/// Legacy stealth nullifier (same as unified - kept for compatibility)
pub fn compute_stealth_nullifier(priv_key: Field, leaf_index: Field) -> Field {
    compute_nullifier(priv_key, leaf_index)
}

/// Legacy stealth nullifier hash (same as unified - kept for compatibility)
pub fn compute_stealth_nullifier_hash(nullifier: Field) -> Field {
    compute_nullifier_hash(nullifier)
}
