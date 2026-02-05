//! Sunspot Groth16 Verifier CPI
//!
//! Provides utilities for calling the Sunspot-generated verifier program
//! to verify Groth16 proofs on-chain.
//!
//! The verifier program expects: proof_bytes || public_witness_bytes
//! and returns success if the proof is valid.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
};

/// Call the Sunspot verifier program to verify a Groth16 proof
///
/// # Arguments
/// * `verifier_program` - The Sunspot verifier program account
/// * `proof` - The Groth16 proof bytes (256 bytes: a(64) + b(128) + c(64))
/// * `public_witness` - The public witness bytes (public inputs, each 32 bytes)
///
/// # Returns
/// * `Ok(())` if the proof is valid
/// * `Err(ProgramError)` if the proof is invalid or verification fails
pub fn verify_groth16_proof_cpi(
    verifier_program: &AccountInfo,
    proof: &[u8],
    public_witness: &[u8],
) -> Result<(), ProgramError> {
    // Sunspot verifier expects: proof || public_witness
    let mut instruction_data = Vec::with_capacity(proof.len() + public_witness.len());
    instruction_data.extend_from_slice(proof);
    instruction_data.extend_from_slice(public_witness);

    // No accounts needed for basic verification
    let accounts: [AccountMeta; 0] = [];

    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: &accounts,
        data: &instruction_data,
    };

    // Invoke the verifier - it will fail if proof is invalid
    invoke(&instruction, &[])?;

    Ok(())
}

/// Verify a Groth16 proof with parsed components (legacy — 256-byte proof core only)
///
/// NOTE: This sends only the 256-byte proof core without gnark commitments.
/// Use `verify_groth16_proof_full` for circuits that require commitment verification.
pub fn verify_groth16_proof_components<const N: usize>(
    verifier_program: &AccountInfo,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; N],
) -> Result<(), ProgramError> {
    // Build proof bytes (256 bytes total)
    let mut proof = [0u8; 256];
    proof[0..64].copy_from_slice(proof_a);
    proof[64..192].copy_from_slice(proof_b);
    proof[192..256].copy_from_slice(proof_c);

    // Build public witness (N * 32 bytes)
    let mut public_witness = vec![0u8; N * 32];
    for (i, input) in public_inputs.iter().enumerate() {
        public_witness[i * 32..(i + 1) * 32].copy_from_slice(input);
    }

    verify_groth16_proof_cpi(verifier_program, &proof, &public_witness)
}

/// Verify a Groth16 proof using the full gnark proof format (with commitments).
///
/// The Sunspot verifier expects: proof_raw || gnark_public_witness
///
/// Where:
/// - proof_raw: Full gnark proof (A(64) + B(128) + C(64) + nb_commitments(4,BE)
///              + commitments(N×64) + commitment_pok(64))
/// - gnark_public_witness: 12-byte header + NR_INPUTS × 32-byte field elements
///
/// The 12-byte header is: nbPublic(u32 BE) + nbSecret(u32 BE, always 0) + vecLen(u32 BE)
pub fn verify_groth16_proof_full<const N: usize>(
    verifier_program: &AccountInfo,
    proof_raw: &[u8],
    public_inputs: &[[u8; 32]; N],
) -> Result<(), ProgramError> {
    // Build gnark public witness with 12-byte header
    let nr_inputs = N as u32;
    let nr_be = nr_inputs.to_be_bytes();
    let witness_len = 12 + N * 32;
    let mut public_witness = vec![0u8; witness_len];

    // Header: nbPublic(4, BE) + nbSecret(4, BE=0) + vectorLen(4, BE)
    public_witness[0..4].copy_from_slice(&nr_be);
    // bytes 4..8 = 0 (nbSecret) - already zero
    public_witness[8..12].copy_from_slice(&nr_be);

    // Field elements (32 bytes each, big-endian)
    for (i, input) in public_inputs.iter().enumerate() {
        let start = 12 + i * 32;
        public_witness[start..start + 32].copy_from_slice(input);
    }

    verify_groth16_proof_cpi(verifier_program, proof_raw, &public_witness)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_proof_size() {
        // Groth16 proof: a(64) + b(128) + c(64) = 256 bytes
        assert_eq!(64 + 128 + 64, 256);
    }
}
