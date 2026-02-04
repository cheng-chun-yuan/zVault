//! Compound yield instruction - Reinvest yield into principal (UltraHonk)
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
    PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{create_pda_account, verify_ultrahonk_pool_compound_proof, validate_program_owner, validate_account_writable, MAX_ULTRAHONK_PROOF_SIZE};

const CHADBUFFER_AUTHORITY_SIZE: usize = 32;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CompoundProofSource {
    Inline = 0,
    Buffer = 1,
}

impl CompoundProofSource {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Inline),
            1 => Some(Self::Buffer),
            _ => None,
        }
    }
}

/// Compound yield instruction data (UltraHonk proof)
pub struct CompoundYieldData<'a> {
    pub proof_source: CompoundProofSource,
    pub proof: Option<&'a [u8]>,
    pub old_nullifier_hash: &'a [u8; 32],
    pub new_pool_commitment: &'a [u8; 32],
    pub pool_merkle_root: &'a [u8; 32],
    pub old_principal: u64,
    pub deposit_epoch: u64,
    pub vk_hash: &'a [u8; 32],
}

impl<'a> CompoundYieldData<'a> {
    pub const MIN_SIZE_INLINE: usize = 1 + 4 + 32 + 32 + 32 + 8 + 8 + 32;
    pub const MIN_SIZE_BUFFER: usize = 1 + 32 + 32 + 32 + 8 + 8 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_source = CompoundProofSource::from_u8(data[0]).ok_or(ProgramError::InvalidInstructionData)?;

        match proof_source {
            CompoundProofSource::Inline => Self::parse_inline(data),
            CompoundProofSource::Buffer => Self::parse_buffer(data),
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

        let old_nullifier_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let new_pool_commitment: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let pool_merkle_root: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
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

        let vk_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        Ok(Self {
            proof_source: CompoundProofSource::Inline,
            proof: Some(proof),
            old_nullifier_hash,
            new_pool_commitment,
            pool_merkle_root,
            old_principal,
            deposit_epoch,
            vk_hash,
        })
    }

    fn parse_buffer(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_BUFFER {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 1;

        let old_nullifier_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let new_pool_commitment: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        offset += 32;

        let pool_merkle_root: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
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

        let vk_hash: &[u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        Ok(Self {
            proof_source: CompoundProofSource::Buffer,
            proof: None,
            old_nullifier_hash,
            new_pool_commitment,
            pool_merkle_root,
            old_principal,
            deposit_epoch,
            vk_hash,
        })
    }
}

/// Compound yield accounts
pub struct CompoundYieldAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub pool_nullifier_record: &'a AccountInfo,
    pub compounder: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
    pub vk_account: &'a AccountInfo,
    pub proof_buffer: Option<&'a AccountInfo>,
}

impl<'a> CompoundYieldAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo], use_buffer: bool) -> Result<Self, ProgramError> {
        let min_accounts = if use_buffer { 8 } else { 7 };
        if accounts.len() < min_accounts {
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
            vk_account: &accounts[6],
            proof_buffer: if use_buffer { Some(&accounts[7]) } else { None },
        })
    }
}

/// Process compound yield instruction (UltraHonk proof)
pub fn process_compound_yield(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let use_buffer = data[0] == CompoundProofSource::Buffer as u8;

    let accounts = CompoundYieldAccounts::from_accounts(accounts, use_buffer)?;
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

        if !tree.is_valid_root(ix_data.pool_merkle_root) {
            return Err(ZVaultError::InvalidPoolRoot.into());
        }

        if !tree.has_capacity() {
            return Err(ZVaultError::PoolTreeFull.into());
        }
    }

    let nullifier_seeds: &[&[u8]] = &[
        PoolNullifierRecord::SEED,
        &pool_id,
        ix_data.old_nullifier_hash,
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
                ix_data.old_nullifier_hash,
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

    // Verify UltraHonk proof via CPI
    match ix_data.proof_source {
        CompoundProofSource::Inline => {
            let proof = ix_data.proof.ok_or(ProgramError::InvalidInstructionData)?;
            pinocchio::msg!("Verifying UltraHonk compound proof (inline)...");
            verify_ultrahonk_pool_compound_proof(
                accounts.ultrahonk_verifier,
                accounts.vk_account,
                proof,
                ix_data.pool_merkle_root,
                ix_data.old_nullifier_hash,
                ix_data.new_pool_commitment,
                current_epoch,
                yield_rate_bps,
                ix_data.vk_hash,
            ).map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
        CompoundProofSource::Buffer => {
            let proof_buffer_account = accounts.proof_buffer.ok_or(ProgramError::NotEnoughAccountKeys)?;
            let buffer_data = proof_buffer_account.try_borrow_data()?;
            if buffer_data.len() <= CHADBUFFER_AUTHORITY_SIZE {
                return Err(ProgramError::InvalidAccountData);
            }
            let proof = &buffer_data[CHADBUFFER_AUTHORITY_SIZE..];
            if proof.len() > MAX_ULTRAHONK_PROOF_SIZE {
                return Err(ZVaultError::InvalidProofLength.into());
            }
            pinocchio::msg!("Verifying UltraHonk compound proof (buffer)...");
            verify_ultrahonk_pool_compound_proof(
                accounts.ultrahonk_verifier,
                accounts.vk_account,
                proof,
                ix_data.pool_merkle_root,
                ix_data.old_nullifier_hash,
                ix_data.new_pool_commitment,
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

        nullifier.nullifier_hash.copy_from_slice(ix_data.old_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.pool_id.copy_from_slice(&pool_id);
        nullifier.set_epoch_at_operation(current_epoch);
        nullifier.spent_by.copy_from_slice(accounts.compounder.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::Compound);
    }

    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;
        tree.insert_leaf(ix_data.new_pool_commitment)?;
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
