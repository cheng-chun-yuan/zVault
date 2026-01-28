//! Compound yield instruction - Reinvest yield into principal

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::constants::PROOF_SIZE;
use crate::error::ZVaultError;
use crate::state::{
    PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{get_test_verification_key, verify_pool_compound_proof, Groth16Proof, validate_program_owner, validate_account_writable};

/// Compound yield instruction data
pub struct CompoundYieldData {
    /// Groth16 proof for position ownership and yield calculation
    pub proof: [u8; PROOF_SIZE],
    /// Old position's nullifier hash
    pub old_nullifier_hash: [u8; 32],
    /// New pool position commitment (principal + yield, reset epoch)
    pub new_pool_commitment: [u8; 32],
    /// Merkle root of pool commitment tree
    pub pool_merkle_root: [u8; 32],
    /// Old principal amount
    pub old_principal: u64,
    /// Original deposit epoch
    pub deposit_epoch: u64,
}

impl CompoundYieldData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof (256) + old_nullifier_hash (32) + new_pool_commitment (32) + pool_merkle_root (32) + old_principal (8) + deposit_epoch (8) = 368 bytes
        if data.len() < 368 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut old_nullifier_hash = [0u8; 32];
        old_nullifier_hash.copy_from_slice(&data[256..288]);

        let mut new_pool_commitment = [0u8; 32];
        new_pool_commitment.copy_from_slice(&data[288..320]);

        let mut pool_merkle_root = [0u8; 32];
        pool_merkle_root.copy_from_slice(&data[320..352]);

        let old_principal = u64::from_le_bytes([
            data[352], data[353], data[354], data[355], data[356], data[357], data[358], data[359],
        ]);

        let deposit_epoch = u64::from_le_bytes([
            data[360], data[361], data[362], data[363], data[364], data[365], data[366], data[367],
        ]);

        Ok(Self {
            proof,
            old_nullifier_hash,
            new_pool_commitment,
            pool_merkle_root,
            old_principal,
            deposit_epoch,
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
}

impl<'a> CompoundYieldAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 5 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let pool_nullifier_record = &accounts[2];
        let compounder = &accounts[3];
        let system_program = &accounts[4];

        // Validate compounder is signer
        if !compounder.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            pool_commitment_tree,
            pool_nullifier_record,
            compounder,
            system_program,
        })
    }
}

/// Process compound yield instruction
pub fn process_compound_yield(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = CompoundYieldAccounts::from_accounts(accounts)?;
    let ix_data = CompoundYieldData::from_bytes(data)?;

    // SECURITY: Validate account owners
    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.pool_commitment_tree)?;
    validate_account_writable(accounts.pool_nullifier_record)?;

    // Load yield pool and get current state
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

        // Calculate yield
        let epochs_staked = current_epoch.saturating_sub(ix_data.deposit_epoch);
        yield_amount = pool.calculate_yield(ix_data.old_principal, epochs_staked);

        // Check yield reserve
        if yield_amount > pool.yield_reserve() {
            return Err(ZVaultError::InsufficientYieldReserve.into());
        }

        // Ensure there's actually yield to compound
        if yield_amount == 0 {
            return Err(ZVaultError::ZeroAmount.into());
        }

        // Validate new principal doesn't overflow (actual value verified in ZK proof)
        ix_data
            .old_principal
            .checked_add(yield_amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    // Verify pool commitment tree belongs to this pool
    {
        let tree_data = accounts.pool_commitment_tree.try_borrow_data()?;
        let tree = PoolCommitmentTree::from_bytes(&tree_data)?;

        if tree.pool_id != pool_id {
            return Err(ZVaultError::InvalidPoolId.into());
        }

        if !tree.is_valid_root(&ix_data.pool_merkle_root) {
            return Err(ZVaultError::InvalidPoolRoot.into());
        }

        // Need capacity for new position
        if !tree.has_capacity() {
            return Err(ZVaultError::PoolTreeFull.into());
        }
    }

    // Verify pool nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[
        PoolNullifierRecord::SEED,
        &pool_id,
        &ix_data.old_nullifier_hash,
    ];
    let (expected_nullifier_pda, _) = find_program_address(nullifier_seeds, program_id);
    if accounts.pool_nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if pool nullifier already spent
    {
        let nullifier_data = accounts.pool_nullifier_record.try_borrow_data()?;
        if !nullifier_data.is_empty() && nullifier_data[0] == POOL_NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::PoolNullifierAlreadyUsed.into());
        }
    }

    // Verify Groth16 proof for compound
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(5); // pool_compound has 5 public inputs

    if !verify_pool_compound_proof(
        &vk,
        &groth16_proof,
        &ix_data.pool_merkle_root,
        &ix_data.old_nullifier_hash,
        &ix_data.new_pool_commitment,
        current_epoch,
        yield_rate_bps,
    ) {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    let clock = Clock::get()?;

    // Record pool nullifier as spent
    {
        let mut nullifier_data = accounts.pool_nullifier_record.try_borrow_mut_data()?;
        let nullifier = PoolNullifierRecord::init(&mut nullifier_data)?;

        nullifier
            .nullifier_hash
            .copy_from_slice(&ix_data.old_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.pool_id.copy_from_slice(&pool_id);
        nullifier.set_epoch_at_operation(current_epoch);
        nullifier
            .spent_by
            .copy_from_slice(accounts.compounder.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::Compound);
    }

    // Add new pool position to pool tree (principal + yield, reset epoch)
    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;

        tree.insert_leaf(&ix_data.new_pool_commitment)?;
    }

    // Update yield pool stats
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        // Principal increases by yield amount (compounding)
        pool.add_principal(yield_amount)?;
        pool.sub_yield_reserve(yield_amount)?;
        pool.add_yield_distributed(yield_amount)?;
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
