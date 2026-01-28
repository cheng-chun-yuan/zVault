//! Update yield rate instruction - Governance-controlled rate update

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::YieldPool;
use crate::utils::validate_program_owner;

/// Update yield rate instruction data
pub struct UpdateYieldRateData {
    /// New yield rate in basis points (e.g., 500 = 5%)
    pub new_rate_bps: u16,
}

impl UpdateYieldRateData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 2 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let new_rate_bps = u16::from_le_bytes([data[0], data[1]]);

        Ok(Self { new_rate_bps })
    }
}

/// Update yield rate accounts
pub struct UpdateYieldRateAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub authority: &'a AccountInfo,
}

impl<'a> UpdateYieldRateAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 2 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let authority = &accounts[1];

        // Validate authority is signer
        if !authority.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            authority,
        })
    }
}

/// Process update yield rate instruction
pub fn process_update_yield_rate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = UpdateYieldRateAccounts::from_accounts(accounts)?;
    let ix_data = UpdateYieldRateData::from_bytes(data)?;

    // SECURITY: Validate account owner
    validate_program_owner(accounts.yield_pool, program_id)?;

    // Validate yield rate (0-10000 bps = 0-100%)
    if ix_data.new_rate_bps > 10000 {
        return Err(ZVaultError::InvalidYieldRate.into());
    }

    // Verify authority
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if accounts.authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
    }

    let clock = Clock::get()?;

    // Update yield rate
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.set_yield_rate_bps(ix_data.new_rate_bps);
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
