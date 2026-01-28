//! Deposit to pool instruction - Deposit zkBTC into yield pool

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
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolCommitmentTree,
    PoolNullifierRecord, PoolOperationType, YieldPool, NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{get_test_verification_key, verify_pool_deposit_proof, Groth16Proof, validate_program_owner, validate_account_writable};

/// Deposit to pool instruction data
pub struct DepositToPoolData {
    /// Groth16 proof for zkBTC ownership
    pub proof: [u8; PROOF_SIZE],
    /// Nullifier hash of zkBTC being deposited
    pub input_nullifier_hash: [u8; 32],
    /// New pool position commitment
    pub pool_commitment: [u8; 32],
    /// Principal amount being deposited (satoshis)
    pub principal: u64,
    /// Merkle root of main zkBTC tree
    pub input_merkle_root: [u8; 32],
}

impl DepositToPoolData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof (256) + input_nullifier_hash (32) + pool_commitment (32) + principal (8) + input_merkle_root (32) = 360 bytes
        if data.len() < 360 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut input_nullifier_hash = [0u8; 32];
        input_nullifier_hash.copy_from_slice(&data[256..288]);

        let mut pool_commitment = [0u8; 32];
        pool_commitment.copy_from_slice(&data[288..320]);

        let principal = u64::from_le_bytes([
            data[320], data[321], data[322], data[323], data[324], data[325], data[326], data[327],
        ]);

        let mut input_merkle_root = [0u8; 32];
        input_merkle_root.copy_from_slice(&data[328..360]);

        Ok(Self {
            proof,
            input_nullifier_hash,
            pool_commitment,
            principal,
            input_merkle_root,
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
}

impl<'a> DepositToPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 6 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let main_commitment_tree = &accounts[2];
        let input_nullifier_record = &accounts[3];
        let depositor = &accounts[4];
        let system_program = &accounts[5];

        // Validate depositor is signer
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

/// Process deposit to pool instruction
pub fn process_deposit_to_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = DepositToPoolAccounts::from_accounts(accounts)?;
    let ix_data = DepositToPoolData::from_bytes(data)?;

    // SECURITY: Validate account owners
    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;
    validate_program_owner(accounts.main_commitment_tree, program_id)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.yield_pool)?;
    validate_account_writable(accounts.pool_commitment_tree)?;
    validate_account_writable(accounts.input_nullifier_record)?;

    // Validate principal > 0
    if ix_data.principal == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // Load yield pool and check state
    let pool_id: [u8; 8];
    let current_epoch: u64;
    {
        let pool_data = accounts.yield_pool.try_borrow_data()?;
        let pool = YieldPool::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::YieldPoolPaused.into());
        }

        pool_id = pool.pool_id;
        current_epoch = pool.current_epoch();
    }

    // Verify pool commitment tree belongs to this pool
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

    // Verify input merkle root is valid in main commitment tree
    {
        let tree_data = accounts.main_commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.input_merkle_root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.input_nullifier_hash];
    let (expected_nullifier_pda, _) = find_program_address(nullifier_seeds, program_id);
    if accounts.input_nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent
    {
        let nullifier_data = accounts.input_nullifier_record.try_borrow_data()?;
        if nullifier_data.len() >= 1 && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Verify Groth16 proof for pool deposit
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(4); // pool_deposit has 4 public inputs

    if !verify_pool_deposit_proof(
        &vk,
        &groth16_proof,
        &ix_data.input_merkle_root,
        &ix_data.input_nullifier_hash,
        &ix_data.pool_commitment,
        ix_data.principal,
        current_epoch,
    ) {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    let clock = Clock::get()?;

    // Record input nullifier as spent
    {
        let mut nullifier_data = accounts.input_nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier
            .nullifier_hash
            .copy_from_slice(&ix_data.input_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier
            .spent_by
            .copy_from_slice(accounts.depositor.key().as_ref());
        nullifier.set_operation_type(NullifierOperationType::PrivateTransfer);
    }

    // Add pool commitment to pool tree
    {
        let mut tree_data = accounts.pool_commitment_tree.try_borrow_mut_data()?;
        let tree = PoolCommitmentTree::from_bytes_mut(&mut tree_data)?;

        tree.insert_leaf(&ix_data.pool_commitment)?;
    }

    // Update yield pool stats
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.increment_total_deposits()?;
        pool.add_principal(ix_data.principal)?;
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
