//! Instruction Introspection Utilities
//!
//! Security utilities for verifying that specific instructions were executed
//! earlier in the same transaction.
//!
//! # Security Model
//!
//! Solana transactions are atomic - all instructions succeed or all fail.
//! By checking that a verifier instruction exists earlier in the transaction,
//! we can safely skip redundant verification in a later instruction.
//!
//! The Instructions sysvar is transaction-scoped, so this check cannot be
//! bypassed across transactions.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::instructions::Instructions,
};

/// UltraHonk verifier instruction discriminators
pub mod verifier_instruction {
    pub const VERIFY: u8 = 0;
    pub const VERIFY_WITH_VK_ACCOUNT: u8 = 1;
    pub const INIT_VK: u8 = 2;
    pub const VERIFY_FROM_BUFFER: u8 = 3;
}

/// Verify that a VERIFY_FROM_BUFFER instruction was executed earlier in this transaction.
///
/// This function checks that:
/// 1. An earlier instruction in this TX called the verifier program
/// 2. That instruction used the VERIFY_FROM_BUFFER discriminator (3)
/// 3. The buffer account used matches the expected buffer
///
/// # Arguments
/// * `instructions_sysvar` - The Instructions sysvar account
/// * `verifier_program_id` - Expected verifier program ID
/// * `expected_buffer` - The buffer account that should have been verified
///
/// # Returns
/// * `Ok(())` if verification instruction was found
/// * `Err(ProgramError)` if not found or invalid
///
/// # Security
/// - Only checks instructions BEFORE the current one (prevents order manipulation)
/// - Verifies exact program ID match (prevents fake verifier)
/// - Verifies buffer account match (prevents buffer substitution)
pub fn verify_prior_buffer_verification(
    instructions_sysvar: &AccountInfo,
    verifier_program_id: &Pubkey,
    expected_buffer: &Pubkey,
) -> Result<(), ProgramError> {
    // Create Instructions wrapper from sysvar account
    let instructions = Instructions::try_from(instructions_sysvar)?;

    // Get current instruction index
    let current_index = instructions.load_current_index() as usize;

    // Check all instructions BEFORE the current one
    for i in 0..current_index {
        let ix = instructions.load_instruction_at(i)?;

        // Check if this instruction is from the verifier program
        if ix.get_program_id() != verifier_program_id {
            continue;
        }

        // Get instruction data and check discriminator
        let ix_data = ix.get_instruction_data();
        if ix_data.is_empty() || ix_data[0] != verifier_instruction::VERIFY_FROM_BUFFER {
            continue;
        }

        // Check that the buffer account matches
        // VERIFY_FROM_BUFFER accounts: [proof_buffer]
        let buffer_meta = ix.get_account_meta_at(0);
        if buffer_meta.is_err() {
            continue;
        }

        let buffer_meta = buffer_meta.unwrap();
        if &buffer_meta.key == expected_buffer {
            pinocchio::msg!("Found valid prior VERIFY_FROM_BUFFER instruction");
            return Ok(());
        }
    }

    pinocchio::msg!("No prior VERIFY_FROM_BUFFER instruction found for this buffer");
    Err(ProgramError::InvalidInstructionData)
}

/// Verify that ANY verification instruction was executed earlier in this transaction.
///
/// Less strict version that accepts VERIFY or VERIFY_FROM_BUFFER.
/// Use this when you don't need to match a specific buffer.
///
/// # Arguments
/// * `instructions_sysvar` - The Instructions sysvar account
/// * `verifier_program_id` - Expected verifier program ID
///
/// # Returns
/// * `Ok(())` if any verification instruction was found
/// * `Err(ProgramError)` if not found
pub fn verify_prior_verification_any(
    instructions_sysvar: &AccountInfo,
    verifier_program_id: &Pubkey,
) -> Result<(), ProgramError> {
    let instructions = Instructions::try_from(instructions_sysvar)?;
    let current_index = instructions.load_current_index() as usize;

    for i in 0..current_index {
        let ix = instructions.load_instruction_at(i)?;

        if ix.get_program_id() != verifier_program_id {
            continue;
        }

        // Accept VERIFY or VERIFY_FROM_BUFFER
        let ix_data = ix.get_instruction_data();
        if !ix_data.is_empty() {
            let disc = ix_data[0];
            if disc == verifier_instruction::VERIFY || disc == verifier_instruction::VERIFY_FROM_BUFFER {
                pinocchio::msg!("Found valid prior verification instruction");
                return Ok(());
            }
        }
    }

    pinocchio::msg!("No prior verification instruction found");
    Err(ProgramError::InvalidInstructionData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminators() {
        assert_eq!(verifier_instruction::VERIFY, 0);
        assert_eq!(verifier_instruction::VERIFY_FROM_BUFFER, 3);
    }
}
