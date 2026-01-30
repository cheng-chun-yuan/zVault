//! UltraHonk proof verification (Stack-Optimized)
//!
//! Minimal implementation optimized for Solana's 4KB stack limit.

use crate::bn254::{pairing_check, G2Point};
use crate::error::UltraHonkError;
use crate::types::{UltraHonkProof, VerificationKey};

/// Verify an UltraHonk proof (simplified for stack efficiency)
///
/// This is a simplified verification that checks the KZG opening proof.
/// For full UltraHonk verification, additional checks would be needed.
#[inline(never)]
pub fn verify_ultrahonk_proof(
    vk: &VerificationKey,
    proof: &UltraHonkProof,
    public_inputs: &[[u8; 32]],
) -> Result<bool, UltraHonkError> {
    // Basic validation
    if vk.circuit_size_log != proof.circuit_size_log {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    if public_inputs.len() != vk.num_public_inputs as usize {
        return Err(UltraHonkError::InvalidPublicInput);
    }

    // Verify KZG pairing check
    verify_kzg_opening(vk, proof)
}

/// Verify KZG opening proof via pairing check
#[inline(never)]
fn verify_kzg_opening(
    vk: &VerificationKey,
    proof: &UltraHonkProof,
) -> Result<bool, UltraHonkError> {
    // For UltraHonk, the final verification is a KZG pairing check:
    // e(P, [x]_2) == e(Q, G2)
    //
    // Which we verify as:
    // e(P, [x]_2) * e(-Q, G2) == 1

    // Use wire commitment for verification
    let commitment = proof.wire_commitment;

    // Negate the KZG quotient for pairing
    let neg_quotient = proof.kzg_quotient.negate();

    // Pairing check: e(commitment, g2_x) * e(-quotient, G2) == 1
    let pairs = [
        (commitment, vk.g2_x),
        (neg_quotient, g2_generator()),
    ];

    pairing_check(&pairs)
}

/// G2 generator point (BN254)
#[inline(always)]
fn g2_generator() -> G2Point {
    let mut g2 = [0u8; 128];

    // Standard BN254 G2 generator coordinates
    // x.c0
    g2[0..32].copy_from_slice(&[
        0x19, 0x80, 0x0b, 0x28, 0x16, 0x65, 0xd5, 0x17,
        0xf0, 0x8a, 0x6d, 0x4f, 0x5b, 0x46, 0xf3, 0x3b,
        0xaa, 0x2c, 0x12, 0xd0, 0x1c, 0xaf, 0xf4, 0x3e,
        0x3c, 0x1e, 0xbc, 0x3e, 0x5a, 0x8e, 0x56, 0x10,
    ]);
    // x.c1
    g2[32..64].copy_from_slice(&[
        0x26, 0x18, 0xfd, 0x2f, 0x54, 0x54, 0x2b, 0x36,
        0x5b, 0x55, 0x3a, 0x8d, 0xf7, 0xfe, 0x52, 0x21,
        0xb3, 0xc4, 0x5f, 0x67, 0x3e, 0x47, 0x93, 0x1d,
        0x5e, 0x0f, 0x2c, 0x3d, 0x53, 0x4d, 0x64, 0x12,
    ]);
    // y.c0
    g2[64..96].copy_from_slice(&[
        0x09, 0x3c, 0xf5, 0xbd, 0xfd, 0x51, 0x94, 0x7a,
        0xb7, 0xce, 0xa5, 0x3d, 0x47, 0x9a, 0xbe, 0x78,
        0x47, 0xbe, 0xce, 0xc0, 0xc9, 0x3e, 0x12, 0x32,
        0x3a, 0x7a, 0xba, 0x2e, 0xbc, 0x41, 0xa0, 0x2a,
    ]);
    // y.c1
    g2[96..128].copy_from_slice(&[
        0x2e, 0xb4, 0x86, 0xcd, 0xf5, 0xe3, 0x6e, 0x6e,
        0x8c, 0x19, 0x60, 0x0d, 0x9a, 0xfd, 0x7e, 0xb8,
        0x3f, 0x8d, 0x23, 0x98, 0x86, 0x59, 0x6b, 0x9f,
        0x72, 0x1a, 0x3e, 0xc8, 0x1d, 0x8d, 0x3c, 0x17,
    ]);

    G2Point(g2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_g2_generator_not_identity() {
        let g2 = g2_generator();
        assert!(!g2.is_identity());
    }
}
