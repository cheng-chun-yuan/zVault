//! Harvest yield instruction - Backend service harvests yield from external DeFi vault

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

/// Harvest yield instruction data
pub struct HarvestYieldData {
    /// Amount harvested from external DeFi vault
    pub harvested_amount: u64,
}

impl HarvestYieldData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 8 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let harvested_amount = u64::from_le_bytes([
            data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
        ]);

        Ok(Self { harvested_amount })
    }
}

/// Harvest yield accounts
pub struct HarvestYieldAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub defi_vault: &'a AccountInfo,
    pub harvester: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> HarvestYieldAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 4 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let defi_vault = &accounts[1];
        let harvester = &accounts[2];
        let system_program = &accounts[3];

        // Validate harvester is signer
        if !harvester.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            defi_vault,
            harvester,
            system_program,
        })
    }
}

/// Process harvest yield instruction
pub fn process_harvest_yield(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = HarvestYieldAccounts::from_accounts(accounts)?;
    let ix_data = HarvestYieldData::from_bytes(data)?;

    // SECURITY: Validate account owner
    validate_program_owner(accounts.yield_pool, program_id)?;

    // Validate harvested amount > 0
    if ix_data.harvested_amount == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // Verify harvester is authority (only authority can harvest)
    // Also verify defi_vault matches
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if accounts.harvester.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }

        if accounts.defi_vault.key().as_ref() != pool.defi_vault {
            return Err(ProgramError::InvalidAccountData);
        }
    }

    let clock = Clock::get()?;

    // Update yield reserve with harvested amount
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.add_yield_reserve(ix_data.harvested_amount)?;
        pool.set_last_harvest(clock.unix_timestamp);
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
