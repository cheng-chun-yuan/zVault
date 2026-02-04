//! Compound yield instruction - Reinvest yield into principal (UltraHonk)
//!
//! The UltraHonk verifier must be called in an earlier instruction of the same transaction.
//! This instruction uses instruction introspection to verify the verifier was called.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{create_pda_account, validate_program_owner, validate_account_writable};

/// Compound yield instruction data (UltraHonk proof via buffer)
///
/// Layout:
/// - old_nullifier_hash: [u8; 32]
/// - new_pool_commitment: [u8; 32]
/// - pool_merkle_root: [u8; 32]
/// - old_principal: u64
/// - deposit_epoch: u64
/// - vk_hash: [u8; 32]
///
/// Proof is in ChadBuffer account, verified by earlier verifier instruction in same TX.
pub struct CompoundYieldData {
    pub old_nullifier_hash: [u8; 32],
    pub new_pool_commitment: [u8; 32],
    pub pool_merkle_root: [u8; 32],
    pub old_principal: u64,
    pub deposit_epoch: u64,
    pub vk_hash: [u8; 32],
}

impl CompoundYieldData {
    /// Data size: nullifier(32) + new_commit(32) + root(32) + principal(8) + epoch(8) + vk_hash(32) = 144 bytes
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 8 + 32;

    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 0;

        let mut old_nullifier_hash = [0u8; 32];
        old_nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut new_pool_commitment = [0u8; 32];
        new_pool_commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut pool_merkle_root = [0u8; 32];
        pool_merkle_root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let old_principal = u64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        offset += 8;

        let deposit_epoch = u64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidInstructionData)?,
        );
        offset += 8;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            old_nullifier_hash,
            new_pool_commitment,
            pool_merkle_root,
            old_principal,
            deposit_epoch,
            vk_hash,
        })
    }
}

/// Compound yield accounts (8 accounts)
///
/// 0. yield_pool (writable)
/// 1. pool_commitment_tree (writable)
/// 2. pool_nullifier_record (writable)
/// 3. compounder (signer)
/// 4. system_program
/// 5. ultrahonk_verifier - UltraHonk verifier program (for introspection check)
/// 6. proof_buffer (readonly) - ChadBuffer account containing proof data
/// 7. instructions_sysvar (readonly) - For verifying prior verification instruction
pub struct CompoundYieldAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub pool_nullifier_record: &'a AccountInfo,
    pub compounder: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
    pub proof_buffer: &'a AccountInfo,
    pub instructions_sysvar: &'a AccountInfo,
}

impl<'a> CompoundYieldAccounts<'a> {
    pub const ACCOUNT_COUNT: usize = 8;

    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < Self::ACCOUNT_COUNT {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        if !accounts[3].is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool: &accounts[0],
            pool_commitment_tree: &accounts[1],
            pool_nullifier_record: &accounts[2],
            compounder: &accounts[3],
            system_program: &accounts[4],
            ultrahonk_verifier: &accounts[5],
            proof_buffer: &accounts[6],
            instructions_sysvar: &accounts[7],
        })
    }
}

/// Process compound yield instruction (UltraHonk proof via introspection)
pub fn process_compound_yield(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = CompoundYieldAccounts::from_accounts(accounts)?;
    let ix_data = CompoundYieldData::from_bytes(data)?;

    if ix_data.old_principal == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;

    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.pool_commitment_tree)?;
    validate_account_writable(accounts.pool_nullifier_record)?;

    let pool_id: [u8; 8];
    let current_epoch: u64;
    let yield_amount: u64;
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::YieldPoolPaused.into());
        }

        pool_id = pool.pool_id;
        current_epoch = pool.current_epoch();

        let epochs_staked = current_epoch.saturating_sub(ix_data.deposit_epoch);
        yield_amount = pool.calculate_yield_checked(ix_data.old_principal, epochs_staked)?;

        if yield_amount > pool.yield_reserve() {
            return Err(ZVaultError::InsufficientYieldReserve.into());
        }

        if yield_amount == 0 {
            return Err(ZVaultError::ZeroAmount.into());
        }

        ix_data.old_principal
            .checked_add(yield_amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    {
        let tree_data = accounts.pool_commitment_tree.try_borrow_data()?;
        let tree = PoolCommitmentTree::from_bytes(&tree_data)?;

        if tree.pool_id != pool_id {
            return Err(ZVaultError::InvalidPoolId.into());
        }

        if !tree.is_valid_root(&ix_data.pool_merkle_root) {
            return Err(ZVaultError::InvalidPoolRoot.into());
        }

        if !tree.has_capacity() {
            return Err(ZVaultError::PoolTreeFull.into());
        }
    }

    let nullifier_seeds: &[&[u8]] = &[
        PoolNullifierRecord::SEED,
        &pool_id,
        &ix_data.old_nullifier_hash,
    ];
    let (expected_nullifier_pda, nullifier_bump) = find_program_address(nullifier_seeds, program_id);
    if accounts.pool_nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::get()?;
    let rent = Rent::get()?;

    {
        let nullifier_data_len = accounts.pool_nullifier_record.data_len();
        if nullifier_data_len > 0 {
            let nullifier_data = accounts.pool_nullifier_record.try_borrow_data()?;
            if !nullifier_data.is_empty() && nullifier_data[0] == POOL_NULLIFIER_RECORD_DISCRIMINATOR {
                return Err(ZVaultError::PoolNullifierAlreadyUsed.into());
            }
        } else {
            let lamports = rent.minimum_balance(PoolNullifierRecord::LEN);
            let bump_bytes = [nullifier_bump];
            let signer_seeds: &[&[u8]] = &[
                PoolNullifierRecord::SEED,
                &pool_id,
                &ix_data.old_nullifier_hash,
                &bump_bytes,
            ];

            create_pda_account(
                accounts.compounder,
                accounts.pool_nullifier_record,
                program_id,
                lamports,
                PoolNullifierRecord::LEN as u64,
                signer_seeds,
            )?;
        }
    }

    // Verify that UltraHonk verifier was called in an earlier instruction
    // SECURITY: require_prior_zk_verification validates the verifier program ID
    crate::utils::require_prior_zk_verification(
        accounts.instructions_sysvar,
        accounts.ultrahonk_verifier.key(),
        accounts.proof_buffer.key(),
    )?;

    {
        let mut nullifier_data = accounts.pool_nullifier_record.try_borrow_mut_data()?;
        let nullifier = PoolNullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.old_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.pool_id.copy_from_slice(&pool_id);
        nullifier.set_epoch_at_operation(current_epoch);
        nullifier.spent_by.copy_from_slice(accounts.compounder.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::Compound);
    }

    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;
        tree.insert_leaf(&ix_data.new_pool_commitment)?;
    }

    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.add_principal(yield_amount)?;
        pool.sub_yield_reserve(yield_amount)?;
        pool.add_yield_distributed(yield_amount)?;
        pool.set_last_update(clock.unix_timestamp);
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    pinocchio::msg!("Pool compound completed (UltraHonk)");
    Ok(())
}
