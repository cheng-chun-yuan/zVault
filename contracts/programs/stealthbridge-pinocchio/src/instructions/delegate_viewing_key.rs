//! Delegate Viewing Key instruction
//!
//! Adds a delegated viewing key to an existing registry.
//! Delegated keys can scan and view transactions but cannot spend.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    ProgramResult,
};

use crate::state::{ViewingKeyRegistry, VIEWING_KEY_REGISTRY_DISCRIMINATOR, MAX_DELEGATES};

/// Delegate viewing key instruction data
/// Layout:
/// - spending_pubkey: [u8; 32] (owner identity - for PDA derivation)
/// - delegated_key: [u8; 32] (X25519 pubkey of delegate)
/// - permissions: u8 (permission flags)
/// Total: 65 bytes
pub struct DelegateViewingKeyData {
    pub spending_pubkey: [u8; 32],
    pub delegated_key: [u8; 32],
    pub permissions: u8,
}

impl DelegateViewingKeyData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 65 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut spending_pubkey = [0u8; 32];
        spending_pubkey.copy_from_slice(&data[0..32]);

        let mut delegated_key = [0u8; 32];
        delegated_key.copy_from_slice(&data[32..64]);

        let permissions = data[64];

        Ok(Self {
            spending_pubkey,
            delegated_key,
            permissions,
        })
    }
}

/// Revoke delegation instruction data
/// Layout:
/// - spending_pubkey: [u8; 32] (owner identity)
/// - delegated_key: [u8; 32] (key to revoke)
/// Total: 64 bytes
pub struct RevokeDelegationData {
    pub spending_pubkey: [u8; 32],
    pub delegated_key: [u8; 32],
}

impl RevokeDelegationData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 64 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut spending_pubkey = [0u8; 32];
        spending_pubkey.copy_from_slice(&data[0..32]);

        let mut delegated_key = [0u8; 32];
        delegated_key.copy_from_slice(&data[32..64]);

        Ok(Self {
            spending_pubkey,
            delegated_key,
        })
    }
}

/// Add a delegated viewing key to the registry
///
/// The owner must sign this transaction to prove they control the registry.
pub fn process_delegate_viewing_key(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let viewing_key_registry = &accounts[0];
    let owner = &accounts[1];

    let ix_data = DelegateViewingKeyData::from_bytes(data)?;

    // Validate owner is signer
    if !owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA matches spending_pubkey
    let seeds: &[&[u8]] = &[ViewingKeyRegistry::SEED, &ix_data.spending_pubkey];
    let (expected_pda, _bump) = find_program_address(seeds, program_id);
    if viewing_key_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Verify registry exists and is initialized
    let reg_data = viewing_key_registry.try_borrow_data()?;
    if reg_data.len() < ViewingKeyRegistry::SIZE {
        return Err(ProgramError::UninitializedAccount);
    }
    if reg_data[0] != VIEWING_KEY_REGISTRY_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(reg_data);

    // Add delegation
    {
        let mut reg_data = viewing_key_registry.try_borrow_mut_data()?;
        let registry = ViewingKeyRegistry::from_bytes_mut(&mut reg_data)?;

        // Check max delegates not reached
        if registry.delegation_count >= MAX_DELEGATES as u8 {
            return Err(ProgramError::InvalidArgument);
        }

        // Check key not already delegated
        if registry.is_delegated(&ix_data.delegated_key) {
            return Err(ProgramError::AccountAlreadyInitialized);
        }

        // Add the delegate
        registry.add_delegate(ix_data.delegated_key, ix_data.permissions)?;
    }

    Ok(())
}

/// Revoke a delegated viewing key from the registry
pub fn process_revoke_delegation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let viewing_key_registry = &accounts[0];
    let owner = &accounts[1];

    let ix_data = RevokeDelegationData::from_bytes(data)?;

    // Validate owner is signer
    if !owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA matches spending_pubkey
    let seeds: &[&[u8]] = &[ViewingKeyRegistry::SEED, &ix_data.spending_pubkey];
    let (expected_pda, _bump) = find_program_address(seeds, program_id);
    if viewing_key_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Revoke delegation
    {
        let mut reg_data = viewing_key_registry.try_borrow_mut_data()?;
        let registry = ViewingKeyRegistry::from_bytes_mut(&mut reg_data)?;

        // Find and remove the delegated key
        let mut found_index = None;
        for i in 0..registry.delegation_count as usize {
            if registry.delegated_keys[i] == ix_data.delegated_key {
                found_index = Some(i);
                break;
            }
        }

        match found_index {
            Some(index) => registry.remove_delegate(index)?,
            None => return Err(ProgramError::InvalidArgument),
        }
    }

    Ok(())
}
