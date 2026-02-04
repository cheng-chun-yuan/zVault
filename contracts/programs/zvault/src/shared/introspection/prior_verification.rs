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

/// UltraHonk verifier program ID (devnet deployment: 5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd)
///
/// This is used for instruction introspection to verify that a ZK proof
/// was verified earlier in the same transaction.
///
/// Note: On localnet, the verifier is redeployed each time with a new address,
/// so we skip the hardcoded check in localnet builds (controlled by `localnet` feature).
#[cfg(not(feature = "localnet"))]
pub const ULTRAHONK_VERIFIER_PROGRAM_ID: Pubkey = [
    0x48, 0xcc, 0x08, 0x1f, 0x39, 0x5e, 0x5c, 0x8f,
    0xfc, 0x94, 0x7c, 0x8e, 0x79, 0x69, 0x2d, 0x11,
    0x06, 0xed, 0x76, 0x6e, 0x30, 0x3d, 0xf7, 0xad,
    0x11, 0xc8, 0xae, 0x14, 0x0b, 0x61, 0x8e, 0x80,
];

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

/// Verify prior buffer verification with logging - convenience wrapper
///
/// This is a high-level helper that:
/// 1. SECURITY: Validates verifier_program_id matches expected ULTRAHONK_VERIFIER_PROGRAM_ID (devnet only)
/// 2. Logs the verification attempt
/// 3. Calls verify_prior_buffer_verification
/// 4. Logs success/failure
/// 5. Returns ZVaultError::ZkVerificationFailed on error
///
/// Use this in instruction handlers for consistent behavior.
///
/// # Security
/// This function prevents arbitrary CPI attacks by validating the verifier
/// program ID before checking introspection. An attacker cannot substitute
/// a fake verifier program.
///
/// # Localnet Mode
/// On localnet (with `localnet` feature enabled), the entire introspection check
/// is skipped because:
/// 1. VK accounts are expensive (~850KB, 6+ SOL for rent) and complex to manage
/// 2. The proof is already verified locally (client-side) before submission
/// 3. Localnet is only for testing - devnet/mainnet uses full verification
///
/// SECURITY WARNING: The localnet feature should NEVER be enabled in production.
pub fn require_prior_zk_verification(
    instructions_sysvar: &AccountInfo,
    verifier_program_id: &Pubkey,
    expected_buffer: &Pubkey,
) -> Result<(), ProgramError> {
    // On localnet, skip the introspection check entirely
    // The proof is verified locally before submission
    #[cfg(feature = "localnet")]
    {
        pinocchio::msg!("Localnet mode: skipping ZK proof verification introspection");
        pinocchio::msg!("WARNING: This is only safe for testing. Production uses on-chain verification.");
        // Suppress unused variable warnings
        let _ = instructions_sysvar;
        let _ = verifier_program_id;
        let _ = expected_buffer;
        return Ok(());
    }

    // SECURITY: Validate the verifier program ID matches expected value
    // This prevents arbitrary CPI attacks where an attacker substitutes a fake verifier
    #[cfg(not(feature = "localnet"))]
    if verifier_program_id != &ULTRAHONK_VERIFIER_PROGRAM_ID {
        pinocchio::msg!("Invalid verifier program ID");
        return Err(crate::error::ZVaultError::InvalidVerifierProgram.into());
    }

    #[cfg(not(feature = "localnet"))]
    {
        pinocchio::msg!("Verifying prior verification instruction...");

        verify_prior_buffer_verification(
            instructions_sysvar,
            verifier_program_id,
            expected_buffer,
        ).map_err(|_| {
            pinocchio::msg!("No valid prior verification instruction found");
            crate::error::ZVaultError::ZkVerificationFailed
        })?;

        pinocchio::msg!("Prior verification confirmed");
    }
    Ok(())
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
