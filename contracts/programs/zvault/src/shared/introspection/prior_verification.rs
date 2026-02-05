//! Prior instruction verification utilities
//!
//! Provides functions to verify that specific instructions were executed
//! earlier in the same transaction, enabling optimizations like skipping
//! redundant proof verification.
//!
//! Updated for Sunspot Groth16 verification (inline proofs).

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::instructions::Instructions,
};

/// Sunspot verifier program ID (devnet deployment)
///
/// This is used for instruction introspection to verify that a Groth16 proof
/// was verified earlier in the same transaction via Sunspot CPI.
///
/// Note: On localnet, the verifier is redeployed each time with a new address,
/// so we skip the hardcoded check in localnet builds (controlled by `localnet` feature).
#[cfg(not(feature = "localnet"))]
pub const SUNSPOT_VERIFIER_PROGRAM_ID: Pubkey = [
    // Sunspot verifier program ID - update with actual deployment
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// Groth16 verifier instruction discriminators (Sunspot)
pub mod verifier_instruction {
    /// Standard Groth16 verification
    pub const VERIFY: u8 = 0;
    /// Verification with VK account
    pub const VERIFY_WITH_VK_ACCOUNT: u8 = 1;
    /// Initialize VK
    pub const INIT_VK: u8 = 2;
}

/// Verify that a Groth16 VERIFY instruction was executed earlier in this transaction.
///
/// This function checks that:
/// 1. An earlier instruction in this TX called the Sunspot verifier program
/// 2. That instruction used a valid verification discriminator
///
/// # Arguments
/// * `instructions_sysvar` - The Instructions sysvar account
/// * `verifier_program_id` - Expected verifier program ID
///
/// # Returns
/// * `Ok(())` if verification instruction was found
/// * `Err(ProgramError)` if not found or invalid
pub fn verify_prior_groth16_verification(
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

        // Accept VERIFY or VERIFY_WITH_VK_ACCOUNT
        let ix_data = ix.get_instruction_data();
        if !ix_data.is_empty() {
            let disc = ix_data[0];
            if disc == verifier_instruction::VERIFY || disc == verifier_instruction::VERIFY_WITH_VK_ACCOUNT {
                pinocchio::msg!("Found valid prior Groth16 verification instruction");
                return Ok(());
            }
        }
    }

    pinocchio::msg!("No prior Groth16 verification instruction found");
    Err(ProgramError::InvalidInstructionData)
}

/// Require prior Groth16 verification - convenience wrapper
///
/// This is a high-level helper that:
/// 1. SECURITY: Validates verifier_program_id matches expected SUNSPOT_VERIFIER_PROGRAM_ID (devnet only)
/// 2. Logs the verification attempt
/// 3. Calls verify_prior_groth16_verification
/// 4. Logs success/failure
/// 5. Returns ZVaultError::ZkVerificationFailed on error
///
/// # Security
/// This function prevents arbitrary CPI attacks by validating the verifier
/// program ID before checking introspection. An attacker cannot substitute
/// a fake verifier program.
///
/// # Localnet Mode
/// On localnet (with `localnet` feature enabled), the entire introspection check
/// is skipped because:
/// 1. Localnet is only for testing - devnet/mainnet uses full verification
/// 2. The Groth16 proof is verified inline in the instruction
///
/// SECURITY WARNING: The localnet feature should NEVER be enabled in production.
pub fn require_prior_groth16_verification(
    instructions_sysvar: &AccountInfo,
    verifier_program_id: &Pubkey,
) -> Result<(), ProgramError> {
    // On localnet, skip the introspection check entirely
    // Proofs are verified inline
    #[cfg(feature = "localnet")]
    {
        pinocchio::msg!("Localnet mode: skipping Groth16 introspection check");
        pinocchio::msg!("WARNING: This is only safe for testing. Production uses on-chain verification.");
        let _ = instructions_sysvar;
        let _ = verifier_program_id;
        return Ok(());
    }

    // SECURITY: Validate the verifier program ID matches expected value
    #[cfg(not(feature = "localnet"))]
    if verifier_program_id != &SUNSPOT_VERIFIER_PROGRAM_ID {
        pinocchio::msg!("Invalid verifier program ID");
        return Err(crate::error::ZVaultError::InvalidVerifierProgram.into());
    }

    #[cfg(not(feature = "localnet"))]
    {
        pinocchio::msg!("Verifying prior Groth16 verification instruction...");

        verify_prior_groth16_verification(
            instructions_sysvar,
            verifier_program_id,
        ).map_err(|_| {
            pinocchio::msg!("No valid prior Groth16 verification instruction found");
            crate::error::ZVaultError::ZkVerificationFailed
        })?;

        pinocchio::msg!("Prior Groth16 verification confirmed");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminators() {
        assert_eq!(verifier_instruction::VERIFY, 0);
        assert_eq!(verifier_instruction::VERIFY_WITH_VK_ACCOUNT, 1);
        assert_eq!(verifier_instruction::INIT_VK, 2);
    }
}
