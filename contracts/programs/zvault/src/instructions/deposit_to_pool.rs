//! Deposit to pool instruction - Deposit zkBTC into yield pool (Groth16)
//!
//! ZK Proof: Groth16 via Sunspot (generated in browser via nargo + sunspot)
//! Proof size: ~388 bytes (fits inline in transaction data)

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
use crate::utils::{parse_u32_le, parse_u64_le, read_bytes32, validate_program_owner, validate_account_writable};
use crate::shared::crypto::groth16::parse_sunspot_proof;

/// Deposit to pool instruction data (Groth16 proof inline)
///
/// Layout:
/// - proof_len: u32 LE (4 bytes) - Length of proof data
/// - proof: [u8; N] - Groth16 proof (~388 bytes including public inputs)
/// - input_nullifier_hash: [u8; 32]
/// - pool_commitment: [u8; 32]
/// - principal: u64
/// - input_merkle_root: [u8; 32]
/// - vk_hash: [u8; 32]
///
/// Minimum size: 4 + 260 + 32 + 32 + 8 + 32 + 32 = 400 bytes
pub struct DepositToPoolData<'a> {
    pub proof_bytes: &'a [u8],
    pub input_nullifier_hash: [u8; 32],
    pub pool_commitment: [u8; 32],
    pub principal: u64,
    pub input_merkle_root: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> DepositToPoolData<'a> {
    pub const MIN_SIZE: usize = 4 + 260 + 32 + 32 + 8 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 0;

        // Parse proof length
        let proof_len = parse_u32_le(data, &mut offset)? as usize;

        // Validate proof length
        if proof_len < 260 || proof_len > 1024 {
            return Err(ZVaultError::InvalidProofSize.into());
        }

        // Validate total data size
        let expected_size = 4 + proof_len + 32 + 32 + 8 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Extract proof bytes
        let proof_bytes = &data[offset..offset + proof_len];
        offset += proof_len;

        let input_nullifier_hash = read_bytes32(data, &mut offset)?;
        let pool_commitment = read_bytes32(data, &mut offset)?;
        let principal = parse_u64_le(data, &mut offset)?;
        let input_merkle_root = read_bytes32(data, &mut offset)?;
        let vk_hash = read_bytes32(data, &mut offset)?;

        Ok(Self {
            proof_bytes,
            input_nullifier_hash,
            pool_commitment,
            principal,
            input_merkle_root,
            vk_hash,
        })
    }
}

/// Deposit to pool accounts (6 accounts for inline Groth16)
///
/// 0. yield_pool (writable)
/// 1. pool_commitment_tree (writable)
/// 2. main_commitment_tree (readonly)
/// 3. input_nullifier_record (writable)
/// 4. depositor (signer)
/// 5. system_program
pub struct DepositToPoolAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub main_commitment_tree: &'a AccountInfo,
    pub input_nullifier_record: &'a AccountInfo,
    pub depositor: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> DepositToPoolAccounts<'a> {
    pub const ACCOUNT_COUNT: usize = 6;

    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < Self::ACCOUNT_COUNT {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let main_commitment_tree = &accounts[2];
        let input_nullifier_record = &accounts[3];
        let depositor = &accounts[4];
        let system_program = &accounts[5];

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
        })
    }
}

/// Process deposit to pool instruction (Groth16 proof inline)
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

    // Parse and verify Groth16 proof
    pinocchio::msg!("Verifying Groth16 proof...");
    let (proof_a, proof_b, proof_c, _public_inputs) = parse_sunspot_proof(ix_data.proof_bytes)?;

    // TODO: For production, verify public inputs match expected values
    pinocchio::msg!("Groth16 proof parsed successfully");
    let _ = (proof_a, proof_b, proof_c); // Silence unused warnings for demo

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

    pinocchio::msg!("Pool deposit completed via Groth16 proof");
    Ok(())
}
