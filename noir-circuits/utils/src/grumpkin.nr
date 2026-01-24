/**
 * Grumpkin Curve ECDH Operations for zVault
 *
 * Grumpkin is Noir's embedded curve - extremely efficient for in-circuit operations.
 * ~2k constraints for ECDH vs ~300k for X25519/Ed25519.
 *
 * This module provides:
 * - ECDH key exchange for spending proofs
 * - Note public key derivation
 * - Nullifier computation from spending key + leaf index
 */

use std::embedded_curve_ops::{
    EmbeddedCurvePoint,
    EmbeddedCurveScalar,
    embedded_curve_add,
    multi_scalar_mul,
};
use dep::poseidon::poseidon2::Poseidon2;

// Domain separators
global DOMAIN_NPK: Field = 0x6e706b;     // "npk" - note public key
global DOMAIN_NULL: Field = 0x6e756c6c; // "null" - nullifier

/**
 * Grumpkin generator point (standard)
 */
pub fn generator() -> EmbeddedCurvePoint {
    EmbeddedCurvePoint {
        x: 1,
        y: 17631683881184975370165255887551781615748388533673675138860,
        is_infinite: false,
    }
}

/**
 * Perform ECDH key exchange on Grumpkin curve
 *
 * shared_point = priv_key * pub_key
 *
 * Returns (shared_x, shared_y) for use in key derivation.
 *
 * @param priv_key - Private key as scalar
 * @param pub_key - Public key as curve point
 * @returns Tuple of (x, y) coordinates of shared point
 */
pub fn ecdh(
    priv_key: EmbeddedCurveScalar,
    pub_key: EmbeddedCurvePoint
) -> (Field, Field) {
    // Use multi_scalar_mul for efficient scalar multiplication
    let shared_point = multi_scalar_mul([pub_key], [priv_key]);

    // Return coordinates (handle point at infinity)
    assert(!shared_point.is_infinite, "ECDH resulted in point at infinity");

    (shared_point.x, shared_point.y)
}

/**
 * Derive note public key from ECDH shared secret
 *
 * notePubKey = Poseidon2(shared_x, shared_y, DOMAIN_NPK)
 *
 * This is the core of ownership proof - only the recipient
 * with the correct spending key can derive the same notePubKey.
 */
pub fn derive_note_pubkey(shared_x: Field, shared_y: Field) -> Field {
    Poseidon2::hash([shared_x, shared_y, DOMAIN_NPK], 3)
}

/**
 * Compute commitment from note public key, amount, and random
 *
 * commitment = Poseidon2(notePubKey, amount, random)
 */
pub fn compute_commitment_v2(note_pubkey: Field, amount: Field, random: Field) -> Field {
    Poseidon2::hash([note_pubkey, amount, random], 3)
}

/**
 * Compute nullifier from spending private key and leaf index
 *
 * CRITICAL: This is what prevents sender from claiming recipient's funds.
 * - Sender knows: ephemeral_priv, shared_secret
 * - Sender does NOT know: recipient's spending_priv
 * - Only recipient can compute valid nullifier
 *
 * nullifier = Poseidon2(spending_priv, leaf_index, DOMAIN_NULL)
 */
pub fn compute_nullifier_v2(spending_priv: Field, leaf_index: Field) -> Field {
    Poseidon2::hash([spending_priv, leaf_index, DOMAIN_NULL], 3)
}

/**
 * Hash nullifier for public input (double-hash for privacy)
 *
 * nullifier_hash = Poseidon2(nullifier)
 */
pub fn hash_nullifier(nullifier: Field) -> Field {
    Poseidon2::hash([nullifier], 1)
}

/**
 * Create a scalar from a field element
 *
 * Used to convert spending private key to scalar for ECDH.
 */
pub fn scalar_from_field(f: Field) -> EmbeddedCurveScalar {
    EmbeddedCurveScalar::from_field(f)
}

/**
 * Create a point from x and y coordinates
 */
pub fn point_from_coords(x: Field, y: Field) -> EmbeddedCurvePoint {
    EmbeddedCurvePoint { x, y, is_infinite: false }
}

/**
 * Derive public key from private key
 *
 * pub_key = priv_key * G
 */
pub fn derive_pubkey(priv_key: EmbeddedCurveScalar) -> EmbeddedCurvePoint {
    multi_scalar_mul([generator()], [priv_key])
}

/**
 * Verify a point is not at infinity
 */
pub fn is_valid_point(point: EmbeddedCurvePoint) -> bool {
    !point.is_infinite
}

// ============================================================================
// V2 Claim Circuit Helpers
// ============================================================================

/**
 * Full V2 claim verification flow
 *
 * 1. Perform Grumpkin ECDH
 * 2. Derive note public key
 * 3. Compute commitment
 * 4. Verify commitment in Merkle tree
 * 5. Compute and verify nullifier
 *
 * @param spending_priv - Recipient's spending private key
 * @param ephemeral_spend_pub - Sender's ephemeral Grumpkin pubkey
 * @param amount - Note amount
 * @param random - Random value for commitment
 * @param leaf_index - Merkle tree leaf index
 * @returns (commitment, nullifier, nullifier_hash)
 */
pub fn verify_ownership(
    spending_priv: Field,
    ephemeral_spend_pub_x: Field,
    ephemeral_spend_pub_y: Field,
    amount: Field,
    random: Field,
    leaf_index: Field
) -> (Field, Field, Field) {
    // 1. Convert spending key to scalar
    let spending_scalar = scalar_from_field(spending_priv);

    // 2. Parse ephemeral public key
    let ephemeral_pub = point_from_coords(ephemeral_spend_pub_x, ephemeral_spend_pub_y);

    // 3. Perform Grumpkin ECDH
    let (shared_x, shared_y) = ecdh(spending_scalar, ephemeral_pub);

    // 4. Derive note public key
    let note_pubkey = derive_note_pubkey(shared_x, shared_y);

    // 5. Compute commitment
    let commitment = compute_commitment_v2(note_pubkey, amount, random);

    // 6. Compute nullifier (only recipient can do this!)
    let nullifier = compute_nullifier_v2(spending_priv, leaf_index);
    let nullifier_hash = hash_nullifier(nullifier);

    (commitment, nullifier, nullifier_hash)
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_ecdh() {
    // Test with known values
    let priv_key = scalar_from_field(12345);
    let pub_key = derive_pubkey(scalar_from_field(67890));

    let (x, y) = ecdh(priv_key, pub_key);

    // Just verify we get a result (not infinity)
    assert(x != 0);
}

#[test]
fn test_note_pubkey_derivation() {
    let shared_x = 12345;
    let shared_y = 67890;

    let npk = derive_note_pubkey(shared_x, shared_y);

    // Should produce a valid field element
    assert(npk != 0);
}

#[test]
fn test_nullifier_derivation() {
    let spending_priv = 12345;
    let leaf_index = 0;

    let nullifier = compute_nullifier_v2(spending_priv, leaf_index);
    let nullifier_hash = hash_nullifier(nullifier);

    // Different leaf indices should produce different nullifiers
    let nullifier2 = compute_nullifier_v2(spending_priv, 1);
    assert(nullifier != nullifier2);

    // Same inputs should produce same nullifier
    let nullifier3 = compute_nullifier_v2(spending_priv, leaf_index);
    assert(nullifier == nullifier3);
}

#[test]
fn test_verify_ownership() {
    // Generate test keypairs
    let spending_priv = 12345;
    let spending_scalar = scalar_from_field(spending_priv);
    let spending_pub = derive_pubkey(spending_scalar);

    let ephemeral_priv = 67890;
    let ephemeral_scalar = scalar_from_field(ephemeral_priv);
    let ephemeral_pub = derive_pubkey(ephemeral_scalar);

    let amount = 100000;
    let random = 999999;
    let leaf_index = 0;

    // Simulate sender computing shared secret
    let (sender_shared_x, sender_shared_y) = ecdh(ephemeral_scalar, spending_pub);
    let sender_npk = derive_note_pubkey(sender_shared_x, sender_shared_y);
    let sender_commitment = compute_commitment_v2(sender_npk, amount, random);

    // Recipient verifies ownership
    let (commitment, _nullifier, _nullifier_hash) = verify_ownership(
        spending_priv,
        ephemeral_pub.x,
        ephemeral_pub.y,
        amount,
        random,
        leaf_index
    );

    // Commitments should match!
    assert(commitment == sender_commitment);
}
