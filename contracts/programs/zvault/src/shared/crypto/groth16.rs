//! Groth16 Zero-Knowledge Proof Parsing
//!
//! Parses Sunspot/Noir Groth16 proofs for CPI verification via deployed
//! Sunspot verifier programs. Verification takes ~200k compute units.
//!
//! # Proof Format (388 bytes for Sunspot)
//!
//! The Sunspot/Noir Groth16 proof format:
//! - a: G1 point (64 bytes) - 2 x 32-byte field elements
//! - b: G2 point (128 bytes) - 4 x 32-byte field elements
//! - c: G1 point (64 bytes) - 2 x 32-byte field elements
//! - public_inputs_count: u32 LE (4 bytes)
//! - public_inputs: N x 32 bytes
//!
//! Note: Sunspot proofs include public inputs in the proof data.
//! Verification is done via CPI to the Sunspot-generated verifier program.

use pinocchio::program_error::ProgramError;

use crate::error::ZVaultError;

/// Expected Groth16 proof size (a + b + c = 64 + 128 + 64 = 256 bytes)
pub const GROTH16_PROOF_CORE_SIZE: usize = 256;

/// Sunspot proof header: proof_core(256) + pi_count(4) = 260 bytes minimum
pub const SUNSPOT_PROOF_MIN_SIZE: usize = 260;

/// Maximum public inputs we support
pub const MAX_PUBLIC_INPUTS: usize = 10;

/// Parse Sunspot proof data into components
///
/// Returns (proof_a, proof_b, proof_c, public_inputs)
pub fn parse_sunspot_proof(data: &[u8]) -> Result<([u8; 64], [u8; 128], [u8; 64], Vec<[u8; 32]>), ProgramError> {
    if data.len() < SUNSPOT_PROOF_MIN_SIZE {
        return Err(ZVaultError::InvalidProofSize.into());
    }

    // Parse proof components (all big-endian)
    let mut proof_a = [0u8; 64];
    proof_a.copy_from_slice(&data[0..64]);

    let mut proof_b = [0u8; 128];
    proof_b.copy_from_slice(&data[64..192]);

    let mut proof_c = [0u8; 64];
    proof_c.copy_from_slice(&data[192..256]);

    // Parse public inputs count (little-endian u32)
    let pi_count = u32::from_le_bytes([data[256], data[257], data[258], data[259]]) as usize;

    if pi_count > MAX_PUBLIC_INPUTS {
        return Err(ZVaultError::TooManyPublicInputs.into());
    }

    let expected_size = SUNSPOT_PROOF_MIN_SIZE + pi_count * 32;
    if data.len() < expected_size {
        return Err(ZVaultError::InvalidProofSize.into());
    }

    // Parse public inputs
    let mut public_inputs = Vec::with_capacity(pi_count);
    for i in 0..pi_count {
        let start = 260 + i * 32;
        let mut pi = [0u8; 32];
        pi.copy_from_slice(&data[start..start + 32]);
        public_inputs.push(pi);
    }

    Ok((proof_a, proof_b, proof_c, public_inputs))
}

