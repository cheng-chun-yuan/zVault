//! Withdraw from pool instruction - Exit pool with principal + yield (UltraHonk)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{create_pda_account, verify_ultrahonk_pool_withdraw_proof, validate_program_owner, validate_account_writable, MAX_ULTRAHONK_PROOF_SIZE};

/// Withdraw from pool instruction data (UltraHonk proof)
pub struct WithdrawFromPoolData<'a> {
    pub proof: &'a [u8],
    pub pool_nullifier_hash: [u8; 32],
    pub output_commitment: [u8; 32],
    pub pool_merkle_root: [u8; 32],
    pub principal: u64,
    pub deposit_epoch: u64,
    pub vk_hash: [u8; 32],
}

impl<'a> WithdrawFromPoolData<'a> {
    pub const MIN_SIZE: usize = 4 + 32 + 32 + 32 + 8 + 8 + 32; // 148 bytes + proof

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 4 + proof_len + 32 + 32 + 32 + 8 + 8 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[4..4 + proof_len];
        let mut offset = 4 + proof_len;

        let mut pool_nullifier_hash = [0u8; 32];
        pool_nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment = [0u8; 32];
        output_commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut pool_merkle_root = [0u8; 32];
        pool_merkle_root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let principal = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let deposit_epoch = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof,
            pool_nullifier_hash,
            output_commitment,
            pool_merkle_root,
            principal,
            deposit_epoch,
            vk_hash,
        })
    }
}

/// Withdraw from pool accounts
pub struct WithdrawFromPoolAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub main_commitment_tree: &'a AccountInfo,
    pub pool_nullifier_record: &'a AccountInfo,
    pub withdrawer: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
}

impl<'a> WithdrawFromPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 7 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        Ok(Self {
            yield_pool: &accounts[0],
            pool_commitment_tree: &accounts[1],
            main_commitment_tree: &accounts[2],
            pool_nullifier_record: &accounts[3],
            withdrawer: &accounts[4],
            system_program: &accounts[5],
            ultrahonk_verifier: &accounts[6],
        })
    }
}

/// Process withdraw from pool instruction (UltraHonk proof)
pub fn process_withdraw_from_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = WithdrawFromPoolAccounts::from_accounts(accounts)?;
    let ix_data = WithdrawFromPoolData::from_bytes(data)?;

    if !accounts.withdrawer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if ix_data.principal == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;
    validate_program_owner(accounts.main_commitment_tree, program_id)?;

    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.main_commitment_tree)?;
    validate_account_writable(accounts.pool_nullifier_record)?;

    let pool_id: [u8; 8];
    let current_epoch: u64;
    let yield_rate_bps: u16;
    let yield_amount: u64;
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::YieldPoolPaused.into());
        }

        pool_id = pool.pool_id;
        current_epoch = pool.current_epoch();
        yield_rate_bps = pool.yield_rate_bps();

        let epochs_staked = current_epoch.saturating_sub(ix_data.deposit_epoch);
        yield_amount = pool.calculate_yield_checked(ix_data.principal, epochs_staked)?;

        if yield_amount > pool.yield_reserve() {
            return Err(ZVaultError::InsufficientYieldReserve.into());
        }
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
    }

    let nullifier_seeds: &[&[u8]] = &[
        PoolNullifierRecord::SEED,
        &pool_id,
        &ix_data.pool_nullifier_hash,
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
                &ix_data.pool_nullifier_hash,
                &bump_bytes,
            ];

            create_pda_account(
                accounts.withdrawer,
                accounts.pool_nullifier_record,
                program_id,
                lamports,
                PoolNullifierRecord::LEN as u64,
                signer_seeds,
            )?;
        }
    }

    // Verify UltraHonk proof via CPI
    pinocchio::msg!("Verifying UltraHonk pool withdraw proof...");
    verify_ultrahonk_pool_withdraw_proof(
        accounts.ultrahonk_verifier,
        ix_data.proof,
        &ix_data.pool_merkle_root,
        &ix_data.pool_nullifier_hash,
        &ix_data.output_commitment,
        current_epoch,
        yield_rate_bps,
        &ix_data.vk_hash,
    ).map_err(|_| {
        pinocchio::msg!("UltraHonk proof verification failed");
        ZVaultError::ZkVerificationFailed
    })?;

    {
        let mut nullifier_data = accounts.pool_nullifier_record.try_borrow_mut_data()?;
        let nullifier = PoolNullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.pool_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.pool_id.copy_from_slice(&pool_id);
        nullifier.set_epoch_at_operation(current_epoch);
        nullifier.spent_by.copy_from_slice(accounts.withdrawer.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::Withdraw);
    }

    {
        let mut tree_data = accounts.main_commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.output_commitment)?;
    }

    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.increment_total_withdrawals()?;
        pool.sub_principal(ix_data.principal)?;
        pool.sub_yield_reserve(yield_amount)?;
        pool.add_yield_distributed(yield_amount)?;
        pool.set_last_update(clock.unix_timestamp);
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    pinocchio::msg!("Pool withdraw completed (UltraHonk)");
    Ok(())
}
