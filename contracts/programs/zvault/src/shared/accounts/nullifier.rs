//! Nullifier account creation and validation helpers
//!
//! Consolidates the repeated nullifier creation pattern used across
//! spend instructions (claim, spend_split, withdraw_from_pool, etc.)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{rent::Rent, Sysvar},
};

use crate::error::ZVaultError;
use crate::state::{NullifierOperationType, NullifierRecord, NULLIFIER_RECORD_DISCRIMINATOR};

use super::pda::create_pda_account;

/// Verify that a nullifier PDA is correctly derived and has not been spent.
///
/// # Arguments
/// * `nullifier_account` - The nullifier PDA account
/// * `nullifier_hash` - The nullifier hash used to derive the PDA
/// * `program_id` - The program ID for PDA derivation
///
/// # Returns
/// * `Ok(bump)` - The bump seed if valid and not yet spent
/// * `Err(InvalidSeeds)` - If PDA derivation doesn't match
/// * `Err(NullifierAlreadyUsed)` - If nullifier was already spent
pub fn verify_nullifier_pda(
    nullifier_account: &AccountInfo,
    nullifier_hash: &[u8; 32],
    program_id: &Pubkey,
) -> Result<u8, ProgramError> {
    // Verify PDA derivation
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, nullifier_hash];
    let (expected_pda, bump) = find_program_address(nullifier_seeds, program_id);

    if nullifier_account.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if already spent
    let data_len = nullifier_account.data_len();
    if data_len > 0 {
        let data = nullifier_account.try_borrow_data()?;
        if !data.is_empty() && data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    Ok(bump)
}

/// Create and initialize a nullifier record PDA.
///
/// This is a high-level helper that:
/// 1. Creates the PDA account (if not already created)
/// 2. Initializes the nullifier record with provided data
///
/// # Arguments
/// * `nullifier_account` - The nullifier PDA account to create
/// * `payer` - Account paying for rent
/// * `program_id` - The program ID (owner of the new account)
/// * `nullifier_hash` - The nullifier hash
/// * `bump` - The PDA bump seed (from verify_nullifier_pda)
/// * `operation_type` - Type of operation creating this nullifier
/// * `spent_at` - Timestamp when nullifier was spent
/// * `spent_by` - Public key of the user who spent
///
/// # Note
/// Call `verify_nullifier_pda` first to get the bump and check for double-spend.
pub fn create_nullifier_record(
    nullifier_account: &AccountInfo,
    payer: &AccountInfo,
    program_id: &Pubkey,
    nullifier_hash: &[u8; 32],
    bump: u8,
    operation_type: NullifierOperationType,
    spent_at: i64,
    spent_by: &[u8; 32],
) -> Result<(), ProgramError> {
    // Only create if account doesn't exist
    if nullifier_account.data_len() == 0 {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(NullifierRecord::LEN);
        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[NullifierRecord::SEED, nullifier_hash, &bump_bytes];

        create_pda_account(
            payer,
            nullifier_account,
            program_id,
            lamports,
            NullifierRecord::LEN as u64,
            signer_seeds,
        )?;
    }

    // Initialize the nullifier record
    {
        let mut data = nullifier_account.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut data)?;

        nullifier.nullifier_hash.copy_from_slice(nullifier_hash);
        nullifier.set_spent_at(spent_at);
        nullifier.spent_by.copy_from_slice(spent_by);
        nullifier.set_operation_type(operation_type);
    }

    Ok(())
}

/// Combined helper: verify PDA and create nullifier record in one call.
///
/// This is the primary helper for instruction handlers that need to:
/// 1. Verify the nullifier PDA is correctly derived
/// 2. Check for double-spend
/// 3. Create and initialize the nullifier record
///
/// # Arguments
/// * `nullifier_account` - The nullifier PDA account
/// * `payer` - Account paying for rent
/// * `program_id` - The program ID
/// * `nullifier_hash` - The nullifier hash
/// * `operation_type` - Type of operation
/// * `spent_at` - Timestamp
/// * `spent_by` - User who spent
///
/// # Returns
/// * `Ok(())` - Nullifier created successfully
/// * `Err(InvalidSeeds)` - PDA derivation mismatch
/// * `Err(NullifierAlreadyUsed)` - Double-spend attempt
pub fn verify_and_create_nullifier(
    nullifier_account: &AccountInfo,
    payer: &AccountInfo,
    program_id: &Pubkey,
    nullifier_hash: &[u8; 32],
    operation_type: NullifierOperationType,
    spent_at: i64,
    spent_by: &[u8; 32],
) -> Result<(), ProgramError> {
    let bump = verify_nullifier_pda(nullifier_account, nullifier_hash, program_id)?;

    create_nullifier_record(
        nullifier_account,
        payer,
        program_id,
        nullifier_hash,
        bump,
        operation_type,
        spent_at,
        spent_by,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nullifier_record_size() {
        // Verify the size constant matches the actual struct size
        assert_eq!(NullifierRecord::LEN, 104);
    }
}
