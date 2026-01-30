//! Spend Split instruction (UltraHonk - Client-Side ZK)
//!
//! Splits one unified commitment into two new commitments.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: Commitment1 + Commitment2 (amount conservation enforced by ZK proof)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolState,
    NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{
    create_pda_account, verify_ultrahonk_split_proof,
    validate_program_owner, validate_account_writable, MAX_ULTRAHONK_PROOF_SIZE,
};

/// Split commitment instruction data (UltraHonk proof - variable size)
///
/// Layout:
/// - proof_len: u32 (4 bytes, LE)
/// - proof: [u8; proof_len] - UltraHonk proof
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - output_commitment_1: [u8; 32]
/// - output_commitment_2: [u8; 32]
/// - vk_hash: [u8; 32]
pub struct SpendSplitData<'a> {
    pub proof: &'a [u8],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub output_commitment_1: [u8; 32],
    pub output_commitment_2: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> SpendSplitData<'a> {
    /// Minimum size: proof_len(4) + root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) = 164 bytes + proof
    pub const MIN_SIZE: usize = 4 + 32 + 32 + 32 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse proof length
        let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 4 + proof_len + 32 + 32 + 32 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[4..4 + proof_len];
        let mut offset = 4 + proof_len;

        let mut root = [0u8; 32];
        root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_1 = [0u8; 32];
        output_commitment_1.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_2 = [0u8; 32];
        output_commitment_2.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof,
            root,
            nullifier_hash,
            output_commitment_1,
            output_commitment_2,
            vk_hash,
        })
    }
}

/// Split commitment accounts
///
/// 0. pool_state (writable)
/// 1. commitment_tree (writable)
/// 2. nullifier_record (writable)
/// 3. user (signer)
/// 4. system_program
/// 5. ultrahonk_verifier - UltraHonk verifier program
pub struct SpendSplitAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
}

impl<'a> SpendSplitAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 6 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let user = &accounts[3];
        let system_program = &accounts[4];
        let ultrahonk_verifier = &accounts[5];

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
            ultrahonk_verifier,
        })
    }
}

/// Process split commitment (1-in-2-out) with UltraHonk proof
pub fn process_spend_split(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = SpendSplitAccounts::from_accounts(accounts)?;
    let ix_data = SpendSplitData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;

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
    let (expected_nullifier_pda, nullifier_bump) = find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Get clock and rent for account creation
    let clock = Clock::get()?;
    let rent = Rent::get()?;

    // SECURITY: Create nullifier PDA FIRST to prevent race conditions
    {
        let nullifier_data_len = accounts.nullifier_record.data_len();
        if nullifier_data_len > 0 {
            let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
            if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
                return Err(ZVaultError::NullifierAlreadyUsed.into());
            }
        } else {
            let lamports = rent.minimum_balance(NullifierRecord::LEN);
            let bump_bytes = [nullifier_bump];
            let signer_seeds: &[&[u8]] = &[
                NullifierRecord::SEED,
                &ix_data.nullifier_hash,
                &bump_bytes,
            ];

            create_pda_account(
                accounts.user,
                accounts.nullifier_record,
                program_id,
                lamports,
                NullifierRecord::LEN as u64,
                signer_seeds,
            )?;
        }
    }

    // Verify UltraHonk proof via CPI (after nullifier is claimed)
    pinocchio::msg!("Verifying UltraHonk split proof via CPI...");

    verify_ultrahonk_split_proof(
        accounts.ultrahonk_verifier,
        ix_data.proof,
        &ix_data.root,
        &ix_data.nullifier_hash,
        &ix_data.output_commitment_1,
        &ix_data.output_commitment_2,
        &ix_data.vk_hash,
    ).map_err(|_| {
        pinocchio::msg!("UltraHonk split proof verification failed");
        ZVaultError::ZkVerificationFailed
    })?;

    // Initialize nullifier record
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

        if tree.next_index() + 2 > (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

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

    pinocchio::msg!("Split completed (UltraHonk)");

    Ok(())
}
