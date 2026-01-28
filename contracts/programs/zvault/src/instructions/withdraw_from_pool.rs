//! Withdraw from pool instruction - Exit pool with principal + yield

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::constants::PROOF_SIZE;
use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, PoolCommitmentTree, PoolNullifierRecord, PoolOperationType, YieldPool,
    POOL_NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{create_pda_account, get_test_verification_key, verify_pool_withdraw_proof, Groth16Proof, validate_program_owner, validate_account_writable};

/// Withdraw from pool instruction data
pub struct WithdrawFromPoolData {
    /// Groth16 proof for position ownership and yield calculation
    pub proof: [u8; PROOF_SIZE],
    /// Nullifier hash of pool position being withdrawn
    pub pool_nullifier_hash: [u8; 32],
    /// Output commitment (zkBTC note with principal + yield)
    pub output_commitment: [u8; 32],
    /// Merkle root of pool commitment tree
    pub pool_merkle_root: [u8; 32],
    /// Principal amount (for stats update)
    pub principal: u64,
    /// Deposit epoch (for yield calculation verification)
    pub deposit_epoch: u64,
}

impl WithdrawFromPoolData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof (256) + pool_nullifier_hash (32) + output_commitment (32) + pool_merkle_root (32) + principal (8) + deposit_epoch (8) = 368 bytes
        if data.len() < 368 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut pool_nullifier_hash = [0u8; 32];
        pool_nullifier_hash.copy_from_slice(&data[256..288]);

        let mut output_commitment = [0u8; 32];
        output_commitment.copy_from_slice(&data[288..320]);

        let mut pool_merkle_root = [0u8; 32];
        pool_merkle_root.copy_from_slice(&data[320..352]);

        let principal = u64::from_le_bytes([
            data[352], data[353], data[354], data[355], data[356], data[357], data[358], data[359],
        ]);

        let deposit_epoch = u64::from_le_bytes([
            data[360], data[361], data[362], data[363], data[364], data[365], data[366], data[367],
        ]);

        Ok(Self {
            proof,
            pool_nullifier_hash,
            output_commitment,
            pool_merkle_root,
            principal,
            deposit_epoch,
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
}

impl<'a> WithdrawFromPoolAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 6 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let yield_pool = &accounts[0];
        let pool_commitment_tree = &accounts[1];
        let main_commitment_tree = &accounts[2];
        let pool_nullifier_record = &accounts[3];
        let withdrawer = &accounts[4];
        let system_program = &accounts[5];

        // Validate withdrawer is signer
        if !withdrawer.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            yield_pool,
            pool_commitment_tree,
            main_commitment_tree,
            pool_nullifier_record,
            withdrawer,
            system_program,
        })
    }
}

/// Process withdraw from pool instruction
pub fn process_withdraw_from_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = WithdrawFromPoolAccounts::from_accounts(accounts)?;
    let ix_data = WithdrawFromPoolData::from_bytes(data)?;

    // SECURITY: Validate non-zero principal
    if ix_data.principal == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // SECURITY: Validate account owners
    validate_program_owner(accounts.yield_pool, program_id)?;
    validate_program_owner(accounts.pool_commitment_tree, program_id)?;
    validate_program_owner(accounts.main_commitment_tree, program_id)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.yield_pool)?;
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

        // Calculate yield with overflow protection
        let epochs_staked = current_epoch.saturating_sub(ix_data.deposit_epoch);
        yield_amount = pool.calculate_yield_checked(ix_data.principal, epochs_staked)?;

        // Check yield reserve
        if yield_amount > pool.yield_reserve() {
            return Err(ZVaultError::InsufficientYieldReserve.into());
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
    }

    // Verify pool nullifier PDA
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

    // SECURITY: Create pool nullifier PDA FIRST to prevent race conditions
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

    // Verify Groth16 proof for pool withdrawal (after nullifier claimed)
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(6); // pool_withdraw has 6 public inputs

    if !verify_pool_withdraw_proof(
        &vk,
        &groth16_proof,
        &ix_data.pool_merkle_root,
        &ix_data.pool_nullifier_hash,
        &ix_data.output_commitment,
        current_epoch,
        yield_rate_bps,
    ) {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    // Initialize pool nullifier record
    {
        let mut nullifier_data = accounts.pool_nullifier_record.try_borrow_mut_data()?;
        let nullifier = PoolNullifierRecord::init(&mut nullifier_data)?;

        nullifier
            .nullifier_hash
            .copy_from_slice(&ix_data.pool_nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.pool_id.copy_from_slice(&pool_id);
        nullifier.set_epoch_at_operation(current_epoch);
        nullifier
            .spent_by
            .copy_from_slice(accounts.withdrawer.key().as_ref());
        nullifier.set_operation_type(PoolOperationType::Withdraw);
    }

    // Add output commitment to main zkBTC tree
    {
        let mut tree_data = accounts.main_commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.output_commitment)?;
    }

    // Update yield pool stats
    {
        let mut pool_data = accounts.yield_pool.try_borrow_mut_data()?;
        let pool = YieldPool::from_bytes_mut(&mut pool_data)?;

        pool.increment_total_withdrawals()?;
        pool.sub_principal(ix_data.principal)?;
        pool.sub_yield_reserve(yield_amount)?;
        pool.add_yield_distributed(yield_amount)?;
        pool.set_last_update(clock.unix_timestamp);

        // Try to advance epoch if needed
        pool.try_advance_epoch(clock.unix_timestamp);
    }

    Ok(())
}
