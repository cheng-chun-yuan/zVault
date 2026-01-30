//! Deposit to pool instruction - Deposit zkBTC into yield pool (UltraHonk)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolCommitmentTree,
    YieldPool, NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{verify_ultrahonk_pool_deposit_proof, validate_program_owner, validate_account_writable, MAX_ULTRAHONK_PROOF_SIZE};

/// Deposit to pool instruction data (UltraHonk proof)
pub struct DepositToPoolData<'a> {
    pub proof: &'a [u8],
    pub input_nullifier_hash: [u8; 32],
    pub pool_commitment: [u8; 32],
    pub principal: u64,
    pub input_merkle_root: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> DepositToPoolData<'a> {
    pub const MIN_SIZE: usize = 4 + 32 + 32 + 8 + 32 + 32; // 140 bytes + proof

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 4 + proof_len + 32 + 32 + 8 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[4..4 + proof_len];
        let mut offset = 4 + proof_len;

        let mut input_nullifier_hash = [0u8; 32];
        input_nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut pool_commitment = [0u8; 32];
        pool_commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let principal = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut input_merkle_root = [0u8; 32];
        input_merkle_root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof,
            input_nullifier_hash,
            pool_commitment,
            principal,
            input_merkle_root,
            vk_hash,
        })
    }
}

/// Deposit to pool accounts
pub struct DepositToPoolAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub main_commitment_tree: &'a AccountInfo,
    pub input_nullifier_record: &'a AccountInfo,
    pub depositor: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
}

impl<'a> DepositToPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 7 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let main_commitment_tree = &accounts[2];
        let input_nullifier_record = &accounts[3];
        let depositor = &accounts[4];
        let system_program = &accounts[5];
        let ultrahonk_verifier = &accounts[6];

        if !depositor.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            pool_commitment_tree,
            main_commitment_tree,
            input_nullifier_record,
            depositor,
            system_program,
            ultrahonk_verifier,
        })
    }
}

/// Process deposit to pool instruction (UltraHonk proof)
pub fn process_deposit_to_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = DepositToPoolAccounts::from_accounts(accounts)?;
    let ix_data = DepositToPoolData::from_bytes(data)?;

    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;
    validate_program_owner(accounts.main_commitment_tree, program_id)?;

    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.pool_commitment_tree)?;
    validate_account_writable(accounts.input_nullifier_record)?;

    if ix_data.principal == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    let pool_id: [u8; 8];
    let _current_epoch: u64;
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::YieldPoolPaused.into());
        }

        pool_id = pool.pool_id;
        _current_epoch = pool.current_epoch();
    }

    {
        let tree_data = accounts.pool_commitment_tree.try_borrow_data()?;
        let tree = PoolCommitmentTree::from_bytes(&tree_data)?;

        if tree.pool_id != pool_id {
            return Err(ZVaultError::InvalidPoolId.into());
        }

        if !tree.has_capacity() {
            return Err(ZVaultError::PoolTreeFull.into());
        }
    }

    {
        let tree_data = accounts.main_commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.input_merkle_root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.input_nullifier_hash];
    let (expected_nullifier_pda, _) = find_program_address(nullifier_seeds, program_id);
    if accounts.input_nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    {
        let nullifier_data = accounts.input_nullifier_record.try_borrow_data()?;
        if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Verify UltraHonk proof via CPI
    pinocchio::msg!("Verifying UltraHonk pool deposit proof...");
    verify_ultrahonk_pool_deposit_proof(
        accounts.ultrahonk_verifier,
        ix_data.proof,
        &ix_data.input_merkle_root,
        &ix_data.input_nullifier_hash,
        &ix_data.pool_commitment,
        ix_data.principal,
        &ix_data.vk_hash,
    ).map_err(|_| {
        pinocchio::msg!("UltraHonk proof verification failed");
        ZVaultError::ZkVerificationFailed
    })?;

    let clock = Clock::get()?;

    {
        let mut nullifier_data = accounts.input_nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.input_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(accounts.depositor.key().as_ref());
        nullifier.set_operation_type(NullifierOperationType::PrivateTransfer);
    }

    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;
        tree.insert_leaf(&ix_data.pool_commitment)?;
    }

    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.increment_total_deposits()?;
        pool.add_principal(ix_data.principal)?;
        pool.set_last_update(clock.unix_timestamp);
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    pinocchio::msg!("Pool deposit completed (UltraHonk)");
    Ok(())
}
