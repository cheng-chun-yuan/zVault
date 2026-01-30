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
