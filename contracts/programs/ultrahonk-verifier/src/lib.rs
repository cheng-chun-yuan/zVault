//! UltraHonk ZK-SNARK Verifier for Solana
//!
//! Enables browser-based proof generation via bb.js with on-chain verification.
//! Compatible with Noir circuits compiled with UltraHonk backend.
//!
//! # Architecture
//!
//! ```text
//! Browser (bb.js WASM)          Solana
//! ┌─────────────────┐          ┌────────────────────┐
//! │ Noir Circuit    │          │ UltraHonk Verifier │
//! │     ↓           │   tx     │                    │
//! │ UltraHonk Proof │ ───────→ │ verify_proof()     │
//! │ (~8-16KB)       │          │     ↓              │
//! └─────────────────┘          │ sol_alt_bn128      │
//!                              │ syscalls           │
//!                              └────────────────────┘
//! ```
//!
//! # Proof Format
//!
//! UltraHonk proofs from bb.js contain:
//! - Circuit size log (1 byte)
//! - Public inputs count (4 bytes)
//! - Public inputs (N × 32 bytes)
//! - Commitments (multiple G1 points)
//! - Evaluations (field elements)
//! - Opening proof (KZG)

use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod bn254;
pub mod constants;
pub mod error;
pub mod transcript;
pub mod types;
pub mod verifier;

pub use error::UltraHonkError;
pub use types::*;
pub use verifier::verify_ultrahonk_proof;

/// Program ID placeholder (update after deployment)
pub const ID: Pubkey = [
    0x55, 0x48, 0x6f, 0x6e, 0x6b, 0x56, 0x65, 0x72,  // "UHonkVer"
    0x69, 0x66, 0x69, 0x65, 0x72, 0x53, 0x6f, 0x6c,  // "ifierSol"
    0x61, 0x6e, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00,  // "ana"
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
];

/// Instruction discriminators
pub mod instruction {
    /// Verify an UltraHonk proof with VK account
    /// Accounts: [vk_account]
    /// Data: [proof_len (4)] || [proof_bytes...] || [public_inputs_count (4)] || [public_inputs (N × 32)] || [vk_hash (32)]
    pub const VERIFY: u8 = 0;

    /// Verify proof with verification key from account (legacy, same as VERIFY)
    /// Accounts: [vk_account]
    /// Data: [proof_len (4)] || [proof_bytes...] || [public_inputs_count (4)] || [public_inputs (N × 32)]
    pub const VERIFY_WITH_VK_ACCOUNT: u8 = 1;

    /// Initialize verification key account
    pub const INIT_VK: u8 = 2;

    /// Verify proof from buffer with VK account (for large proofs > 10KB)
    /// Accounts: [proof_buffer, vk_account]
    /// Data: [public_inputs_count (4)] || [public_inputs (N × 32)] || [vk_hash (32)]
    pub const VERIFY_FROM_BUFFER: u8 = 3;
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

/// Main entrypoint - routes to instruction handlers
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        instruction::VERIFY => process_verify(program_id, accounts, data),
        instruction::VERIFY_WITH_VK_ACCOUNT => process_verify_with_vk(program_id, accounts, data),
        instruction::INIT_VK => process_init_vk(program_id, accounts, data),
        instruction::VERIFY_FROM_BUFFER => process_verify_from_buffer(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Process VERIFY instruction
///
/// Accounts: [vk_account]
/// Instruction data format:
/// - proof_len (4 bytes, little-endian)
/// - proof_bytes (proof_len bytes)
/// - public_inputs_count (4 bytes, little-endian)
/// - public_inputs (count × 32 bytes)
/// - vk_hash (32 bytes) - hash of verification key for integrity check
fn process_verify(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Require VK account
    if accounts.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let vk_account = &accounts[0];

    // Verify VK account ownership
    if vk_account.owner() != program_id {
        pinocchio::msg!("VK account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Parse proof length
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if data.len() < 4 + proof_len + 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let proof_bytes = &data[4..4 + proof_len];

    // Parse public inputs count
    let pi_offset = 4 + proof_len;
    let pi_count = u32::from_le_bytes([
        data[pi_offset],
        data[pi_offset + 1],
        data[pi_offset + 2],
        data[pi_offset + 3],
    ]) as usize;

    let pi_start = pi_offset + 4;
    let pi_end = pi_start + pi_count * 32;

    if data.len() < pi_end + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let public_inputs_bytes = &data[pi_start..pi_end];
    let vk_hash = &data[pi_end..pi_end + 32];

    // Load VK from account
    let vk_data = vk_account.try_borrow_data()?;
    let vk = VerificationKey::from_bytes_boxed(&vk_data)
        .map_err(|_| {
            pinocchio::msg!("Failed to parse VK from account");
            ProgramError::InvalidAccountData
        })?;

    // Verify VK hash integrity
    let computed_hash = compute_vk_hash(&vk_data);
    if computed_hash != vk_hash {
        pinocchio::msg!("VK hash mismatch");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    // Parse proof (use Box to avoid stack overflow)
    let proof = Box::new(
        UltraHonkProof::from_bytes(proof_bytes)
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );

    // Parse public inputs
    let public_inputs: Vec<[u8; 32]> = public_inputs_bytes
        .chunks_exact(32)
        .map(|chunk| {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(chunk);
            arr
        })
        .collect();

    // Verify proof
    let valid = verify_ultrahonk_proof(&vk, &proof, &public_inputs)
        .map_err(|e| {
            pinocchio::msg!("Verification error");
            ProgramError::from(e)
        })?;

    if !valid {
        pinocchio::msg!("UltraHonk proof verification failed");
        return Err(ProgramError::InvalidArgument);
    }

    pinocchio::msg!("UltraHonk proof verified successfully");
    Ok(())
}

/// Process VERIFY_WITH_VK_ACCOUNT instruction
fn process_verify_with_vk(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let vk_account = &accounts[0];

    // Verify VK account ownership
    if vk_account.owner() != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Load VK from account (uses boxed factory to avoid stack overflow)
    let vk_data = vk_account.try_borrow_data()?;
    let vk = VerificationKey::from_bytes_boxed(&vk_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    // Parse proof and public inputs (same format as VERIFY but without vk_hash)
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if data.len() < 4 + proof_len + 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let proof_bytes = &data[4..4 + proof_len];

    let pi_offset = 4 + proof_len;
    let pi_count = u32::from_le_bytes([
        data[pi_offset],
        data[pi_offset + 1],
        data[pi_offset + 2],
        data[pi_offset + 3],
    ]) as usize;

    let pi_start = pi_offset + 4;
    let pi_end = pi_start + pi_count * 32;

    if data.len() < pi_end {
        return Err(ProgramError::InvalidInstructionData);
    }

    let public_inputs_bytes = &data[pi_start..pi_end];

    // Parse proof (use Box to avoid stack overflow)
    let proof = Box::new(
        UltraHonkProof::from_bytes(proof_bytes)
            .map_err(|_| ProgramError::InvalidInstructionData)?
    );

    // Parse public inputs
    let public_inputs: Vec<[u8; 32]> = public_inputs_bytes
        .chunks_exact(32)
        .map(|chunk| {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(chunk);
            arr
        })
        .collect();

    // Verify proof
    let valid = verify_ultrahonk_proof(&vk, &proof, &public_inputs)
        .map_err(|_| {
            pinocchio::msg!("Verification error");
            ProgramError::InvalidArgument
        })?;

    if !valid {
        pinocchio::msg!("UltraHonk proof verification failed");
        return Err(ProgramError::InvalidArgument);
    }

    pinocchio::msg!("UltraHonk proof verified successfully");
    Ok(())
}

/// ChadBuffer authority offset (first 32 bytes are authority)
const CHADBUFFER_DATA_OFFSET: usize = 32;

/// Compute VK hash using keccak256
fn compute_vk_hash(vk_data: &[u8]) -> [u8; 32] {
    use solana_nostd_keccak::hashv;
    // Hash the minimum VK size to avoid length extension issues
    let hash_len = core::cmp::min(vk_data.len(), VerificationKey::MIN_SIZE);
    hashv(&[&vk_data[..hash_len]])
}

/// Process VERIFY_FROM_BUFFER instruction
///
/// Reads proof from a ChadBuffer account, avoiding CPI data size limits.
/// Data format: [public_inputs_count (4)] || [public_inputs (N × 32)] || [vk_hash (32)]
/// Accounts: [proof_buffer, vk_account]
fn process_verify_from_buffer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let vk_account = &accounts[1];

    // Verify VK account ownership
    if vk_account.owner() != program_id {
        pinocchio::msg!("VK account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Parse public inputs count
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pi_count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    let pi_end = 4 + pi_count * 32;
    if data.len() < pi_end + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let public_inputs_bytes = &data[4..pi_end];
    let vk_hash = &data[pi_end..pi_end + 32];

    // Load VK from account
    let vk_data = vk_account.try_borrow_data()?;
    let vk = VerificationKey::from_bytes_boxed(&vk_data)
        .map_err(|_| {
            pinocchio::msg!("Failed to parse VK from account");
            ProgramError::InvalidAccountData
        })?;

    // Verify VK hash integrity
    let computed_hash = compute_vk_hash(&vk_data);
    if computed_hash != vk_hash {
        pinocchio::msg!("VK hash mismatch");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    // Read proof from buffer (skip 32-byte ChadBuffer authority)
    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        pinocchio::msg!("Buffer too small");
        return Err(ProgramError::InvalidAccountData);
    }

    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    // Parse proof (use Box to avoid stack overflow)
    let proof = Box::new(
        UltraHonkProof::from_bytes(proof_bytes)
            .map_err(|_| {
                pinocchio::msg!("Failed to parse proof from buffer");
                ProgramError::InvalidInstructionData
            })?
    );

    // Parse public inputs
    let public_inputs: Vec<[u8; 32]> = public_inputs_bytes
        .chunks_exact(32)
        .map(|chunk| {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(chunk);
            arr
        })
        .collect();

    // Verify proof
    let valid = verify_ultrahonk_proof(&vk, &proof, &public_inputs)
        .map_err(|e| {
            pinocchio::msg!("Verification error");
            ProgramError::from(e)
        })?;

    if !valid {
        pinocchio::msg!("UltraHonk proof verification failed");
        return Err(ProgramError::InvalidArgument);
    }

    pinocchio::msg!("UltraHonk proof verified (from buffer)");
    Ok(())
}

/// Process INIT_VK instruction
fn process_init_vk(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let vk_account = &accounts[0];
    let authority = &accounts[1];
    let _system_program = &accounts[2];

    // Authority must sign
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // VK account must be owned by this program or system program (uninitialized)
    let owner = vk_account.owner();
    let system_program: Pubkey = [0u8; 32]; // System program ID is all zeros
    if owner != program_id && owner != &system_program {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Write VK data
    let mut vk_data = vk_account.try_borrow_mut_data()?;
    if vk_data.len() < data.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }

    vk_data[..data.len()].copy_from_slice(data);

    pinocchio::msg!("Verification key initialized");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instruction_discriminators() {
        assert_eq!(instruction::VERIFY, 0);
        assert_eq!(instruction::VERIFY_WITH_VK_ACCOUNT, 1);
        assert_eq!(instruction::INIT_VK, 2);
    }
}
