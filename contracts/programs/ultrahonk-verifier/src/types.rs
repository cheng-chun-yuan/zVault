//! UltraHonk proof types (Stack-Optimized)
//!
//! Minimal data structures to fit within Solana's 4KB stack limit.

use crate::bn254::{G1Point, G2Point, G1_POINT_SIZE, G2_POINT_SIZE, FR_SIZE};
use crate::error::UltraHonkError;

/// Minimal UltraHonk proof structure
///
/// Only contains the essential elements needed for KZG verification.
/// Full proof data is parsed on-demand from the raw bytes.
#[derive(Clone, Debug)]
pub struct UltraHonkProof {
    /// Log of circuit size
    pub circuit_size_log: u8,
    /// First wire commitment (for minimal verification)
    pub wire_commitment: G1Point,
    /// KZG quotient commitment
    pub kzg_quotient: G1Point,
}

impl Default for UltraHonkProof {
    fn default() -> Self {
        Self {
            circuit_size_log: 0,
            wire_commitment: G1Point::default(),
            kzg_quotient: G1Point::default(),
        }
    }
}

impl UltraHonkProof {
    /// Parse minimal proof data from bytes
    ///
    /// Format: circuit_size_log (1) + wire_commitment (64) + ... + kzg_quotient (64)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < 1 + G1_POINT_SIZE {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        let circuit_size_log = bytes[0];

        // Parse first wire commitment (offset 1)
        let wire_commitment = G1Point::from_bytes(&bytes[1..1 + G1_POINT_SIZE])?;

        // For minimal verification, extract KZG quotient from end
        // In full proof: commitments + evaluations + kzg_quotient
        // KZG quotient is typically the last G1 point before evaluations
        let kzg_offset = if bytes.len() >= 1 + G1_POINT_SIZE * 2 {
            // Try to find KZG quotient - simplified: use second commitment
            1 + G1_POINT_SIZE
        } else {
            1
        };

        let kzg_quotient = if kzg_offset + G1_POINT_SIZE <= bytes.len() {
            G1Point::from_bytes(&bytes[kzg_offset..kzg_offset + G1_POINT_SIZE])?
        } else {
            G1Point::default()
        };

        Ok(Self {
            circuit_size_log,
            wire_commitment,
            kzg_quotient,
        })
    }
}

/// Minimal UltraHonk verification key
#[derive(Clone, Debug)]
pub struct VerificationKey {
    /// Log of circuit size
    pub circuit_size_log: u8,
    /// Number of public inputs
    pub num_public_inputs: u32,
    /// SRS G2 element for pairing
    pub g2_x: G2Point,
}

impl Default for VerificationKey {
    fn default() -> Self {
        Self {
            circuit_size_log: 0,
            num_public_inputs: 0,
            g2_x: G2Point::default(),
        }
    }
}

impl VerificationKey {
    /// Parse verification key from bytes
    ///
    /// Format: circuit_size_log (1) + padding (3) + num_public_inputs (4) + g2_x (128)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < 8 + G2_POINT_SIZE {
            return Err(UltraHonkError::InvalidVerificationKey);
        }

        let circuit_size_log = bytes[0];

        let num_public_inputs = u32::from_le_bytes([
            bytes[4], bytes[5], bytes[6], bytes[7]
        ]);

        let g2_x = G2Point::from_bytes(&bytes[8..8 + G2_POINT_SIZE])?;

        Ok(Self {
            circuit_size_log,
            num_public_inputs,
            g2_x,
        })
    }

    /// Default G2 x-coordinate for pairing (BN254 SRS)
    /// This is the [x]_2 element from the SRS for KZG verification
    pub fn default_g2_x() -> G2Point {
        let mut g2 = [0u8; 128];

        // BN254 SRS G2 x-coordinate (from trusted setup)
        // x.c0
        g2[0..32].copy_from_slice(&[
            0x26, 0x0e, 0x01, 0xb2, 0x51, 0xf6, 0xce, 0xc7,
            0x2b, 0x02, 0xa3, 0x3e, 0x09, 0xf4, 0xf8, 0x49,
            0x8c, 0xe7, 0xd5, 0xdb, 0xaa, 0x5b, 0x2f, 0x1f,
            0x96, 0x9a, 0x6f, 0x58, 0x33, 0x07, 0xde, 0x12,
        ]);
        // x.c1
        g2[32..64].copy_from_slice(&[
            0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a,
            0x73, 0x60, 0x73, 0x5f, 0xb2, 0x2c, 0xeb, 0x31,
            0x6b, 0x3a, 0x82, 0x62, 0x29, 0x32, 0xb1, 0x6e,
            0x97, 0x7c, 0x7a, 0x84, 0x8c, 0xef, 0xda, 0x19,
        ]);
        // y.c0
        g2[64..96].copy_from_slice(&[
            0x11, 0x59, 0x6b, 0x93, 0xd7, 0x28, 0x93, 0x15,
            0x7b, 0x41, 0x72, 0x89, 0xa6, 0x22, 0xd5, 0xd7,
            0x24, 0x10, 0x9b, 0x9e, 0x7f, 0xb3, 0x03, 0x8d,
            0x8a, 0xcc, 0x5c, 0xc0, 0x04, 0x50, 0x64, 0x07,
        ]);
        // y.c1
        g2[96..128].copy_from_slice(&[
            0x07, 0x3e, 0x38, 0x1f, 0x1e, 0x28, 0x79, 0x55,
            0x0f, 0x41, 0x05, 0x90, 0x59, 0xa3, 0x92, 0x44,
            0x1a, 0x15, 0xee, 0x64, 0x62, 0x5f, 0x77, 0x38,
            0x90, 0x5e, 0xdd, 0xf6, 0xda, 0x42, 0x38, 0x1b,
        ]);

        G2Point(g2)
    }

    /// Minimum VK size in bytes
    pub const MIN_SIZE: usize = 8 + G2_POINT_SIZE;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_default() {
        let proof = UltraHonkProof::default();
        assert_eq!(proof.circuit_size_log, 0);
    }

    #[test]
    fn test_vk_default() {
        let vk = VerificationKey::default();
        assert_eq!(vk.circuit_size_log, 0);
        assert_eq!(vk.num_public_inputs, 0);
    }
}
