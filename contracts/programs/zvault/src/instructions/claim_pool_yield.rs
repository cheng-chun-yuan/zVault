//! Claim pool yield instruction - Claim earned yield while keeping principal staked

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
    CommitmentTree, PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{get_test_verification_key, verify_pool_claim_yield_proof, Groth16Proof, validate_program_owner, validate_account_writable};

/// Claim pool yield instruction data
pub struct ClaimPoolYieldData {
    /// Groth16 proof for position ownership and yield calculation
    pub proof: [u8; PROOF_SIZE],
    /// Old position's nullifier hash
    pub old_nullifier_hash: [u8; 32],
    /// New pool position commitment (same principal, reset epoch)
    pub new_pool_commitment: [u8; 32],
    /// Yield commitment (zkBTC note for earned yield)
    pub yield_commitment: [u8; 32],
    /// Merkle root of pool commitment tree
    pub pool_merkle_root: [u8; 32],
    /// Principal amount (stays staked)
    pub principal: u64,
    /// Original deposit epoch
    pub deposit_epoch: u64,
}

impl ClaimPoolYieldData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof (256) + old_nullifier_hash (32) + new_pool_commitment (32) + yield_commitment (32) + pool_merkle_root (32) + principal (8) + deposit_epoch (8) = 400 bytes
        if data.len() < 400 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut old_nullifier_hash = [0u8; 32];
        old_nullifier_hash.copy_from_slice(&data[256..288]);

        let mut new_pool_commitment = [0u8; 32];
        new_pool_commitment.copy_from_slice(&data[288..320]);

        let mut yield_commitment = [0u8; 32];
        yield_commitment.copy_from_slice(&data[320..352]);

        let mut pool_merkle_root = [0u8; 32];
        pool_merkle_root.copy_from_slice(&data[352..384]);

        let principal = u64::from_le_bytes([
            data[384], data[385], data[386], data[387], data[388], data[389], data[390], data[391],
        ]);

        let deposit_epoch = u64::from_le_bytes([
            data[392], data[393], data[394], data[395], data[396], data[397], data[398], data[399],
        ]);

        Ok(Self {
            proof,
            old_nullifier_hash,
            new_pool_commitment,
            yield_commitment,
            pool_merkle_root,
            principal,
            deposit_epoch,
        })
    }
}

/// Claim pool yield accounts
pub struct ClaimPoolYieldAccounts<'a> {
    pub yield_pool: &'a AccountInfo,
    pub pool_commitment_tree: &'a AccountInfo,
    pub main_commitment_tree: &'a AccountInfo,
    pub pool_nullifier_record: &'a AccountInfo,
    pub claimer: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> ClaimPoolYieldAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 6 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let main_commitment_tree = &accounts[2];
        let pool_nullifier_record = &accounts[3];
        let claimer = &accounts[4];
        let system_program = &accounts[5];

        // Validate claimer is signer
        if !claimer.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            pool_commitment_tree,
            main_commitment_tree,
            pool_nullifier_record,
            claimer,
            system_program,
        })
    }
}

/// Process claim pool yield instruction
pub fn process_claim_pool_yield(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = ClaimPoolYieldAccounts::from_accounts(accounts)?;
    let ix_data = ClaimPoolYieldData::from_bytes(data)?;

    // SECURITY: Validate account owners
    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;
    validate_program_owner(accounts.main_commitment_tree, program_id)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.pool_commitment_tree)?;
    validate_account_writable(accounts.main_commitment_tree)?;
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
        yield_amount = pool.calculate_yield(ix_data.principal, epochs_staked);

        // Check yield reserve
        if yield_amount > pool.yield_reserve() {
            return Err(ZVaultError::InsufficientYieldReserve.into());
        }

        // Ensure there's actually yield to claim
        if yield_amount == 0 {
            return Err(ZVaultError::ZeroAmount.into());
        }
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
        if nullifier_data.len() >= 1 && nullifier_data[0] == POOL_NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::PoolNullifierAlreadyUsed.into());
        }
    }

    // Verify Groth16 proof for claim yield
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(7); // pool_claim_yield has 7 public inputs

    if !verify_pool_claim_yield_proof(
        &vk,
        &groth16_proof,
        &ix_data.pool_merkle_root,
        &ix_data.old_nullifier_hash,
        &ix_data.new_pool_commitment,
        &ix_data.yield_commitment,
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
            .copy_from_slice(accounts.claimer.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::ClaimYield);
    }

    // Add new pool position to pool tree (same principal, reset epoch)
    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;

        tree.insert_leaf(&ix_data.new_pool_commitment)?;
    }

    // Add yield commitment to main zkBTC tree
    {
        let mut tree_data = accounts.main_commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.yield_commitment)?;
    }

    // Update yield pool stats
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        // Principal stays the same (position is refreshed, not withdrawn)
        pool.sub_yield_reserve(yield_amount)?;
        pool.add_yield_distributed(yield_amount)?;
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
