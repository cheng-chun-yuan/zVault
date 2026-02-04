//! Prior instruction verification utilities
//!
//! Provides functions to verify that specific instructions were executed
//! earlier in the same transaction, enabling optimizations like skipping
//! redundant proof verification.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::instructions::Instructions,
};

/// UltraHonk verifier instruction discriminators
pub mod verifier_instruction {
    /// Standard verification
    pub const VERIFY: u8 = 0;
    /// Verification with VK account
    pub const VERIFY_WITH_VK_ACCOUNT: u8 = 1;
    /// Initialize VK
    pub const INIT_VK: u8 = 2;
    /// Verification from buffer
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

/// Verify that a specific instruction discriminator was called on a program
///
/// Generic version that can check for any instruction type.
///
/// # Arguments
/// * `instructions_sysvar` - The Instructions sysvar account
/// * `program_id` - Expected program ID
/// * `expected_discriminator` - The instruction discriminator to look for
///
/// # Returns
/// * `Ok(())` if matching instruction was found
/// * `Err(ProgramError)` if not found
pub fn verify_prior_instruction(
    instructions_sysvar: &AccountInfo,
    program_id: &Pubkey,
    expected_discriminator: u8,
) -> Result<(), ProgramError> {
    let instructions = Instructions::try_from(instructions_sysvar)?;
    let current_index = instructions.load_current_index() as usize;

    for i in 0..current_index {
        let ix = instructions.load_instruction_at(i)?;

        if ix.get_program_id() != program_id {
            continue;
        }

        let ix_data = ix.get_instruction_data();
        if !ix_data.is_empty() && ix_data[0] == expected_discriminator {
            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData)
}

/// Count how many times a specific instruction was called before the current one
///
/// Useful for enforcing limits or tracking state.
///
/// # Arguments
/// * `instructions_sysvar` - The Instructions sysvar account
/// * `program_id` - Expected program ID
/// * `discriminator` - The instruction discriminator to count
///
/// # Returns
/// The count of matching instructions
pub fn count_prior_instructions(
    instructions_sysvar: &AccountInfo,
    program_id: &Pubkey,
    discriminator: u8,
) -> Result<usize, ProgramError> {
    let instructions = Instructions::try_from(instructions_sysvar)?;
    let current_index = instructions.load_current_index() as usize;

    let mut count = 0;
    for i in 0..current_index {
        let ix = instructions.load_instruction_at(i)?;

        if ix.get_program_id() != program_id {
            continue;
        }

        let ix_data = ix.get_instruction_data();
        if !ix_data.is_empty() && ix_data[0] == discriminator {
            count += 1;
        }
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminators() {
        assert_eq!(verifier_instruction::VERIFY, 0);
        assert_eq!(verifier_instruction::VERIFY_WITH_VK_ACCOUNT, 1);
        assert_eq!(verifier_instruction::INIT_VK, 2);
        assert_eq!(verifier_instruction::VERIFY_FROM_BUFFER, 3);
    }
}
