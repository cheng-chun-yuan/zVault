//! Withdraw from pool instruction - Exit pool with principal + yield (UltraHonk)
//!
//! ## Proof Sources
//! - **Inline (proof_source=0)**: Proof data included directly in instruction data
//! - **Buffer (proof_source=1)**: Proof read from ChadBuffer account (for large proofs)

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

const CHADBUFFER_AUTHORITY_SIZE: usize = 32;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PoolWithdrawProofSource {
    Inline = 0,
    Buffer = 1,
}

impl PoolWithdrawProofSource {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Inline),
            1 => Some(Self::Buffer),
            _ => None,
        }
    }
}

/// Withdraw from pool instruction data (UltraHonk proof)
pub struct WithdrawFromPoolData<'a> {
    pub proof_source: PoolWithdrawProofSource,
    pub proof: Option<&'a [u8]>,
    pub pool_nullifier_hash: &'a [u8; 32],
    pub output_commitment: &'a [u8; 32],
    pub pool_merkle_root: &'a [u8; 32],
    pub principal: u64,
    pub deposit_epoch: u64,
    pub vk_hash: &'a [u8; 32],
}

impl<'a> WithdrawFromPoolData<'a> {
    pub const MIN_SIZE_INLINE: usize = 1 + 4 + 32 + 32 + 32 + 8 + 8 + 32;
    pub const MIN_SIZE_BUFFER: usize = 1 + 32 + 32 + 32 + 8 + 8 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_source = PoolWithdrawProofSource::from_u8(data[0]).ok_or(ProgramError::InvalidInstructionData)?;

        match proof_source {
            PoolWithdrawProofSource::Inline => Self::parse_inline(data),
            PoolWithdrawProofSource::Buffer => Self::parse_buffer(data),
        }
    }

    fn parse_inline(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_INLINE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_len = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;
        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 1 + 4 + proof_len + 32 + 32 + 32 + 8 + 8 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[5..5 + proof_len];
        let mut offset = 5 + proof_len;

        let pool_nullifier_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let output_commitment: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let pool_merkle_root: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let principal = u64::from_le_bytes(
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

        let vk_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        Ok(Self {
            proof_source: PoolWithdrawProofSource::Inline,
            proof: Some(proof),
            pool_nullifier_hash,
            output_commitment,
            pool_merkle_root,
            principal,
            deposit_epoch,
            vk_hash,
        })
    }

    fn parse_buffer(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_BUFFER {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 1;

        let pool_nullifier_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let output_commitment: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let pool_merkle_root: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let principal = u64::from_le_bytes(
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

        let vk_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        Ok(Self {
            proof_source: PoolWithdrawProofSource::Buffer,
            proof: None,
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
    pub vk_account: &'a AccountInfo,
    pub proof_buffer: Option<&'a AccountInfo>,
}

impl<'a> WithdrawFromPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo], use_buffer: bool) -> Result<Self, ProgramError> {
        let min_accounts = if use_buffer { 9 } else { 8 };
        if accounts.len() < min_accounts {
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
            vk_account: &accounts[7],
            proof_buffer: if use_buffer { Some(&accounts[8]) } else { None },
        })
    }
}

/// Process withdraw from pool instruction (UltraHonk proof)
pub fn process_withdraw_from_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let use_buffer = data[0] == PoolWithdrawProofSource::Buffer as u8;

    let accounts = WithdrawFromPoolAccounts::from_accounts(accounts, use_buffer)?;
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

        if !tree.is_valid_root(ix_data.pool_merkle_root) {
            return Err(ZVaultError::InvalidPoolRoot.into());
        }
    }

    let nullifier_seeds: &[&[u8]] = &[
        PoolNullifierRecord::SEED,
        &pool_id,
        ix_data.pool_nullifier_hash,
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
                ix_data.pool_nullifier_hash,
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
    match ix_data.proof_source {
        PoolWithdrawProofSource::Inline => {
            let proof = ix_data.proof.ok_or(ProgramError::InvalidInstructionData)?;
            pinocchio::msg!("Verifying UltraHonk pool withdraw proof (inline)...");
            verify_ultrahonk_pool_withdraw_proof(
                accounts.ultrahonk_verifier,
                accounts.vk_account,
                proof,
                ix_data.pool_merkle_root,
                ix_data.pool_nullifier_hash,
                ix_data.output_commitment,
                current_epoch,
                yield_rate_bps,
                ix_data.vk_hash,
            ).map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
        PoolWithdrawProofSource::Buffer => {
            let proof_buffer_account = accounts.proof_buffer.ok_or(ProgramError::NotEnoughAccountKeys)?;
            let buffer_data = proof_buffer_account.try_borrow_data()?;
            if buffer_data.len() <= CHADBUFFER_AUTHORITY_SIZE {
                return Err(ProgramError::InvalidAccountData);
            }
            let proof = &buffer_data[CHADBUFFER_AUTHORITY_SIZE..];
            if proof.len() > MAX_ULTRAHONK_PROOF_SIZE {
                return Err(ZVaultError::InvalidProofLength.into());
            }
            pinocchio::msg!("Verifying UltraHonk pool withdraw proof (buffer)...");
            verify_ultrahonk_pool_withdraw_proof(
                accounts.ultrahonk_verifier,
                accounts.vk_account,
                proof,
                ix_data.pool_merkle_root,
                ix_data.pool_nullifier_hash,
                ix_data.output_commitment,
                current_epoch,
                yield_rate_bps,
                ix_data.vk_hash,
            ).map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
    }

    {
        let mut nullifier_data = accounts.pool_nullifier_record.try_borrow_mut_data()?;
        let nullifier = PoolNullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(ix_data.pool_nullifier_hash);
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

        tree.insert_leaf(ix_data.output_commitment)?;
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
