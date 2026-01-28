//! Split commitment instruction - split one commitment into two (1-in-2-out)

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
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolState,
    NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{
    get_test_verification_key, verify_split_proof, Groth16Proof,
    validate_program_owner, validate_account_writable,
};

/// Split commitment instruction data
pub struct SplitCommitmentData {
    pub proof: [u8; PROOF_SIZE],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub output_commitment_1: [u8; 32],
    pub output_commitment_2: [u8; 32],
}

impl SplitCommitmentData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof (256) + root (32) + nullifier_hash (32) + output_1 (32) + output_2 (32) = 384 bytes
        if data.len() < 384 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&data[0..256]);

        let mut root = [0u8; 32];
        root.copy_from_slice(&data[256..288]);

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[288..320]);

        let mut output_commitment_1 = [0u8; 32];
        output_commitment_1.copy_from_slice(&data[320..352]);

        let mut output_commitment_2 = [0u8; 32];
        output_commitment_2.copy_from_slice(&data[352..384]);

        Ok(Self {
            proof,
            root,
            nullifier_hash,
            output_commitment_1,
            output_commitment_2,
        })
    }
}

/// Split commitment accounts
pub struct SplitCommitmentAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> SplitCommitmentAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 5 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let user = &accounts[3];
        let system_program = &accounts[4];

        // Validate user is signer
        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            commitment_tree,
            nullifier_record,
            user,
            system_program,
        })
    }
}

/// Process split commitment (1-in-2-out)
pub fn process_split_commitment(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = SplitCommitmentAccounts::from_accounts(accounts)?;
    let ix_data = SplitCommitmentData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;
    // Note: nullifier_record may not exist yet (will be created), skip owner check

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.pool_state)?;
    validate_account_writable(accounts.commitment_tree)?;
    validate_account_writable(accounts.nullifier_record)?;

    // Load and validate pool state
    {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }
    }

    // Verify root is valid in commitment tree
    {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.nullifier_hash];
    let (expected_nullifier_pda, _) = find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent
    {
        let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
        if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Verify Groth16 proof
    let groth16_proof = Groth16Proof::from_bytes(&ix_data.proof);
    let vk = get_test_verification_key(4); // 4 public inputs

    if !verify_split_proof(
        &vk,
        &groth16_proof,
        &ix_data.root,
        &ix_data.nullifier_hash,
        &ix_data.output_commitment_1,
        &ix_data.output_commitment_2,
    ) {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    // Get clock for timestamp
    let clock = Clock::get()?;

    // Record nullifier
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(accounts.user.key().as_ref());
        nullifier.set_operation_type(NullifierOperationType::Split);
    }

    // Update commitment tree with both new commitments
    {
        let mut tree_data = accounts.commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        // Need capacity for 2 new leaves
        if tree.next_index() + 2 > (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

        // Insert both output commitments using Poseidon2 hashing
        tree.insert_leaf(&ix_data.output_commitment_1)?;
        tree.insert_leaf(&ix_data.output_commitment_2)?;
    }

    // Update pool statistics
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        let split_count = pool.split_count();
        pool.set_split_count(split_count.saturating_add(1));
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}
