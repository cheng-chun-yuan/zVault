//! Account validation utilities for security checks
//!
//! CRITICAL: These functions must be called BEFORE deserializing any account data.
//! Without owner validation, attackers can pass fake accounts with crafted data.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::constants::TOKEN_2022_PROGRAM_ID;
use crate::error::ZVaultError;

/// Validate that an account is owned by the program
///
/// # Security
/// This MUST be called before deserializing any program-owned account (PoolState,
/// CommitmentTree, NullifierRecord, DepositRecord, RedemptionRequest, etc.)
///
/// Without this check, an attacker can:
/// 1. Create a fake account with crafted data matching expected discriminator
/// 2. Pass it to an instruction
/// 3. Have the program trust the fake data
#[inline(always)]
pub fn validate_program_owner(
    account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<(), ProgramError> {
    let owner = account.owner();
    if owner != program_id {
        return Err(ZVaultError::InvalidAccountOwner.into());
    }
    Ok(())
}

/// Validate that an account is owned by Token-2022 program
#[inline(always)]
pub fn validate_token_2022_owner(account: &AccountInfo) -> Result<(), ProgramError> {
    let token_2022_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);
    let owner = account.owner();
    if owner != &token_2022_id {
        return Err(ProgramError::InvalidAccountOwner);
    }
    Ok(())
}

/// Validate that an account key matches the Token-2022 program ID
#[inline(always)]
pub fn validate_token_program_key(account: &AccountInfo) -> Result<(), ProgramError> {
    let token_2022_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);
    if account.key() != &token_2022_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Validate that an account is the System Program
#[inline(always)]
pub fn validate_system_program(account: &AccountInfo) -> Result<(), ProgramError> {
    // System program ID: 11111111111111111111111111111111
    const SYSTEM_PROGRAM_ID: [u8; 32] = [0; 32];
    let system_id = Pubkey::from(SYSTEM_PROGRAM_ID);
    if account.key() != &system_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Validate multiple program-owned accounts at once
///
/// # Arguments
/// * `accounts` - Slice of accounts to validate
/// * `program_id` - The program ID that should own these accounts
#[inline(always)]
pub fn validate_program_owners(
    accounts: &[&AccountInfo],
    program_id: &Pubkey,
) -> Result<(), ProgramError> {
    for account in accounts {
        validate_program_owner(account, program_id)?;
    }
    Ok(())
}

/// Validate that an account is writable
///
/// # Security
/// This MUST be called before any `try_borrow_mut_data()` operation.
/// Without this check, silent state corruption can occur if a read-only
/// account is passed where a writable one is expected.
#[inline(always)]
pub fn validate_account_writable(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(ZVaultError::AccountNotWritable.into());
    }
    Ok(())
}

/// Validate that a token account belongs to the expected mint
///
/// # Security
/// This prevents token account spoofing attacks where an attacker
/// passes a token account for a different mint.
///
/// # Token Account Layout (Token-2022)
/// - Bytes 0-32: mint pubkey
/// - Bytes 32-64: owner pubkey
/// - Bytes 64-72: amount (u64)
#[inline(always)]
pub fn validate_token_mint(
    token_account: &AccountInfo,
    expected_mint: &Pubkey,
) -> Result<(), ProgramError> {
    let data = token_account.try_borrow_data()?;
    if data.len() < 32 {
        return Err(ZVaultError::InvalidAccountData.into());
    }

    let mint_bytes: [u8; 32] = data[0..32]
        .try_into()
        .map_err(|_| ZVaultError::InvalidAccountData)?;

    if &mint_bytes != expected_mint.as_ref() {
        return Err(ZVaultError::InvalidMint.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    // Tests would go here with mock AccountInfo
}
