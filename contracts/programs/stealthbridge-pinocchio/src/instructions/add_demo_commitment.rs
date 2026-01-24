//! Add Demo Commitment instruction (Admin only)
//!
//! Allows adding commitments directly to the Merkle tree for demo purposes.
//! This bypasses SPV verification and is only for testing/demo.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{CommitmentTree, PoolState, COMMITMENT_TREE_DISCRIMINATOR};
use crate::utils::validate_program_owner;

/// Init commitment tree instruction data
/// Layout: tree_bump (1 byte)
pub struct InitCommitmentTreeData {
    pub tree_bump: u8,
}

impl InitCommitmentTreeData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(Self { tree_bump: data[0] })
    }
}

/// Add demo commitment instruction data
/// Layout: commitment (32) + amount (8) = 40 bytes
pub struct AddDemoCommitmentData {
    pub commitment: [u8; 32],
    pub amount: u64,
}

impl AddDemoCommitmentData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 40 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[0..32]);
        let amount = u64::from_le_bytes(data[32..40].try_into().unwrap());

        Ok(Self { commitment, amount })
    }
}

/// Initialize the commitment tree (admin only, called once)
pub fn process_init_commitment_tree(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state = &accounts[0];
    let commitment_tree = &accounts[1];
    let authority = &accounts[2];
    let _system_program = &accounts[3];

    let ix_data = InitCommitmentTreeData::from_bytes(data)?;

    // Validate authority is signer
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate pool state
    validate_program_owner(pool_state, program_id)?;

    // Validate authority matches pool
    {
        let pool_data = pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
    }

    // Initialize commitment tree
    {
        let mut tree_data = commitment_tree.try_borrow_mut_data()?;

        // Check if already initialized
        if tree_data.len() >= 1 && tree_data[0] == COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }

        let tree = CommitmentTree::init(&mut tree_data)?;
        tree.bump = ix_data.tree_bump;
        tree.current_root = empty_root();
    }

    Ok(())
}

/// Add a demo commitment directly to the Merkle tree (admin only)
pub fn process_add_demo_commitment(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state = &accounts[0];
    let commitment_tree = &accounts[1];
    let authority = &accounts[2];

    let ix_data = AddDemoCommitmentData::from_bytes(data)?;

    // Validate authority is signer
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate account owners
    validate_program_owner(pool_state, program_id)?;
    validate_program_owner(commitment_tree, program_id)?;

    // Validate authority matches pool
    {
        let pool_data = pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
    }

    let clock = Clock::get()?;

    // Insert commitment into tree
    let leaf_index = {
        let mut tree_data = commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.commitment)?
    };

    // Update pool statistics
    {
        let mut pool_data = pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.increment_deposit_count()?;
        pool.set_last_update(clock.unix_timestamp);
    }

    // Log for indexers
    pinocchio::msg!("Demo commitment added");

    Ok(())
}

/// Compute empty Merkle root (all zeros hashed up the tree)
fn empty_root() -> [u8; 32] {
    // For a simplified implementation, return zeros
    // In production, this would be the proper empty tree root
    [0u8; 32]
}
