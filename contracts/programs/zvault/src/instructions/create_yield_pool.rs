//! Create yield pool instruction - Initialize a new privacy-preserving yield pool

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    PoolCommitmentTree, YieldPool, POOL_COMMITMENT_TREE_DISCRIMINATOR, YIELD_POOL_DISCRIMINATOR,
};

/// Create yield pool instruction data
pub struct CreateYieldPoolData {
    /// Unique pool identifier
    pub pool_id: [u8; 8],
    /// Initial yield rate in basis points (e.g., 500 = 5%)
    pub yield_rate_bps: u16,
    /// Epoch duration in seconds (e.g., 86400 for daily epochs)
    pub epoch_duration: i64,
    /// External DeFi vault address (for yield generation)
    pub defi_vault: [u8; 32],
}

impl CreateYieldPoolData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // pool_id (8) + yield_rate_bps (2) + epoch_duration (8) + defi_vault (32) = 50 bytes
        if data.len() < 50 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut pool_id = [0u8; 8];
        pool_id.copy_from_slice(&data[0..8]);

        let yield_rate_bps = u16::from_le_bytes([data[8], data[9]]);

        let epoch_duration = i64::from_le_bytes([
            data[10], data[11], data[12], data[13], data[14], data[15], data[16], data[17],
        ]);

        let mut defi_vault = [0u8; 32];
        defi_vault.copy_from_slice(&data[18..50]);

        Ok(Self {
            pool_id,
            yield_rate_bps,
            epoch_duration,
            defi_vault,
        })
    }
}

/// Create yield pool accounts
pub struct CreateYieldPoolAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub authority: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> CreateYieldPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 4 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let authority = &accounts[2];
        let system_program = &accounts[3];

        // Validate authority is signer
        if !authority.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            pool_commitment_tree,
            authority,
            system_program,
        })
    }
}

/// Process create yield pool instruction
pub fn process_create_yield_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = CreateYieldPoolAccounts::from_accounts(accounts)?;
    let ix_data = CreateYieldPoolData::from_bytes(data)?;

    // Validate yield rate (0-10000 bps = 0-100%)
    if ix_data.yield_rate_bps > 10000 {
        return Err(ZVaultError::InvalidYieldRate.into());
    }

    // Validate epoch duration (minimum 1 hour)
    if ix_data.epoch_duration < 3600 {
        return Err(ZVaultError::InvalidEpochDuration.into());
    }

    // Verify yield pool PDA
    let pool_seeds: &[&[u8]] = &[YieldPool::SEED, &ix_data.pool_id];
    let (expected_pool_pda, pool_bump) = find_program_address(pool_seeds, program_id);
    if accounts.yield_pool.key() != &expected_pool_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Verify pool commitment tree PDA
    let tree_seeds: &[&[u8]] = &[PoolCommitmentTree::SEED, &ix_data.pool_id];
    let (expected_tree_pda, tree_bump) = find_program_address(tree_seeds, program_id);
    if accounts.pool_commitment_tree.key() != &expected_tree_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if pool already exists
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        if !pool_data.is_empty() && pool_data[0] == YIELD_POOL_DISCRIMINATOR {
            return Err(ZVaultError::AlreadyInitialized.into());
        }
    }

    // Check if tree already exists
    {
        let tree_data = accounts.pool_commitment_tree.try_borrow_data()?;
        if !tree_data.is_empty() && tree_data[0] == POOL_COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ZVaultError::AlreadyInitialized.into());
        }
    }

    let clock = Clock::get()?;

    // Initialize yield pool
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::init(&mut pool_data)?;

        pool.bump = pool_bump;
        pool.pool_id.copy_from_slice(&ix_data.pool_id);
        pool.set_yield_rate_bps(ix_data.yield_rate_bps);
        pool.set_epoch_duration(ix_data.epoch_duration);
        pool.defi_vault.copy_from_slice(&ix_data.defi_vault);
        pool.commitment_tree
            .copy_from_slice(accounts.pool_commitment_tree.key().as_ref());
        pool.authority
            .copy_from_slice(accounts.authority.key().as_ref());
        pool.set_current_epoch(0);
        pool.set_created_at(clock.unix_timestamp);
        pool.set_last_update(clock.unix_timestamp);
    }

    // Initialize pool commitment tree
    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::init(&mut tree_data)?;

        tree.bump = tree_bump;
        tree.pool_id.copy_from_slice(&ix_data.pool_id);
    }

    Ok(())
}
