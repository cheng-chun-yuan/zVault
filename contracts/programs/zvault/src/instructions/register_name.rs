//! Register Name instruction
//!
//! Registers a human-readable .zkey name for a stealth address.
//! Example: "albert.zkey" → (spendingPubKey, viewingPubKey)
//!
//! This is OPTIONAL - users who want maximum privacy should share
//! their stealth meta-address off-chain instead.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::state::{NameRegistry, NAME_REGISTRY_DISCRIMINATOR, validate_name};

/// Register name instruction data
/// Layout:
/// - name_len: u8 (length of name)
/// - name: [u8; name_len] (the name without .zkey suffix)
/// - spending_pubkey: [u8; 33] (Grumpkin compressed)
/// - viewing_pubkey: [u8; 33] (Grumpkin compressed)
pub struct RegisterNameData {
    pub name: Vec<u8>,
    pub name_hash: [u8; 32],
    pub spending_pubkey: [u8; 33],
    pub viewing_pubkey: [u8; 33],
}

impl RegisterNameData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let name_len = data[0] as usize;
        if data.len() < 1 + name_len + 32 + 33 + 33 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let name = data[1..1 + name_len].to_vec();

        // Validate name format
        validate_name(&name)?;

        let mut name_hash = [0u8; 32];
        name_hash.copy_from_slice(&data[1 + name_len..1 + name_len + 32]);

        let mut spending_pubkey = [0u8; 33];
        spending_pubkey.copy_from_slice(&data[1 + name_len + 32..1 + name_len + 32 + 33]);

        let mut viewing_pubkey = [0u8; 33];
        viewing_pubkey.copy_from_slice(&data[1 + name_len + 32 + 33..1 + name_len + 32 + 33 + 33]);

        Ok(Self {
            name,
            name_hash,
            spending_pubkey,
            viewing_pubkey,
        })
    }
}

/// Update name instruction data (only owner can update)
/// Layout:
/// - name_hash: [u8; 32] (to identify the registry)
/// - spending_pubkey: [u8; 33] (new Grumpkin key)
/// - viewing_pubkey: [u8; 33] (new Grumpkin key)
pub struct UpdateNameData {
    pub name_hash: [u8; 32],
    pub spending_pubkey: [u8; 33],
    pub viewing_pubkey: [u8; 33],
}

impl UpdateNameData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 32 + 33 + 33 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut name_hash = [0u8; 32];
        name_hash.copy_from_slice(&data[0..32]);

        let mut spending_pubkey = [0u8; 33];
        spending_pubkey.copy_from_slice(&data[32..65]);

        let mut viewing_pubkey = [0u8; 33];
        viewing_pubkey.copy_from_slice(&data[65..98]);

        Ok(Self {
            name_hash,
            spending_pubkey,
            viewing_pubkey,
        })
    }
}

/// Create PDA account via CPI to system program
fn create_pda_account<'a>(
    payer: &'a AccountInfo,
    pda_account: &'a AccountInfo,
    _system_program: &'a AccountInfo,
    program_id: &Pubkey,
    lamports: u64,
    space: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let create_account = pinocchio_system::instructions::CreateAccount {
        from: payer,
        to: pda_account,
        lamports,
        space,
        owner: program_id,
    };

    let seeds: Vec<Seed> = signer_seeds.iter().map(|s| Seed::from(*s)).collect();
    let signer = Signer::from(&seeds[..]);

    create_account.invoke_signed(&[signer])
}

/// Register a .zkey name
///
/// Creates a PDA seeded by the name hash that stores the stealth address.
/// The registering wallet becomes the owner and can update the keys later.
///
/// Accounts:
/// 0. name_registry (PDA to create)
/// 1. owner (signer, pays rent, becomes owner)
/// 2. system_program
pub fn process_register_name(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let name_registry = &accounts[0];
    let owner = &accounts[1];
    let system_program = &accounts[2];

    let ix_data = RegisterNameData::from_bytes(data)?;

    // Validate owner is signer
    if !owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA (seeded by name_hash)
    let seeds: &[&[u8]] = &[NameRegistry::SEED, &ix_data.name_hash];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if name_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if account already exists
    let account_data_len = name_registry.data_len();

    if account_data_len > 0 {
        let reg_data = name_registry.try_borrow_data()?;
        if reg_data[0] == NAME_REGISTRY_DISCRIMINATOR {
            // Name already registered
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        // Create the PDA account
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(NameRegistry::SIZE);

        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            NameRegistry::SEED,
            &ix_data.name_hash,
            &bump_bytes,
        ];

        create_pda_account(
            owner,
            name_registry,
            system_program,
            program_id,
            lamports,
            NameRegistry::SIZE as u64,
            signer_seeds,
        )?;
    }

    let clock = Clock::get()?;

    // Initialize name registry
    {
        let mut reg_data = name_registry.try_borrow_mut_data()?;
        let registry = NameRegistry::init(&mut reg_data)?;

        registry.bump = bump;
        registry.name_hash = ix_data.name_hash;
        registry.owner.copy_from_slice(owner.key().as_ref());
        registry.spending_pubkey = ix_data.spending_pubkey;
        registry.viewing_pubkey = ix_data.viewing_pubkey;
        registry.set_created_at(clock.unix_timestamp);
        registry.set_updated_at(clock.unix_timestamp);
    }

    Ok(())
}

/// Update a .zkey name's keys
///
/// Only the owner can update the keys. This allows key rotation
/// without losing the name.
///
/// Accounts:
/// 0. name_registry (PDA to update)
/// 1. owner (signer, must match registry owner)
pub fn process_update_name(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let name_registry = &accounts[0];
    let owner = &accounts[1];

    let ix_data = UpdateNameData::from_bytes(data)?;

    // Validate owner is signer
    if !owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA
    let seeds: &[&[u8]] = &[NameRegistry::SEED, &ix_data.name_hash];
    let (expected_pda, _bump) = find_program_address(seeds, program_id);
    if name_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::get()?;

    // Update registry
    {
        let mut reg_data = name_registry.try_borrow_mut_data()?;
        let registry = NameRegistry::from_bytes_mut(&mut reg_data)?;

        // Verify caller is owner
        let mut owner_bytes = [0u8; 32];
        owner_bytes.copy_from_slice(owner.key().as_ref());
        if !registry.is_owner(&owner_bytes) {
            return Err(ProgramError::IllegalOwner);
        }

        // Update keys
        registry.spending_pubkey = ix_data.spending_pubkey;
        registry.viewing_pubkey = ix_data.viewing_pubkey;
        registry.set_updated_at(clock.unix_timestamp);
    }

    Ok(())
}

/// Transfer ownership of a .zkey name
///
/// Accounts:
/// 0. name_registry (PDA)
/// 1. current_owner (signer)
/// 2. new_owner (new owner pubkey)
pub fn process_transfer_name(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let name_registry = &accounts[0];
    let current_owner = &accounts[1];
    let new_owner = &accounts[2];

    // Validate current owner is signer
    if !current_owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse name_hash from data
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut name_hash = [0u8; 32];
    name_hash.copy_from_slice(&data[0..32]);

    // Verify PDA
    let seeds: &[&[u8]] = &[NameRegistry::SEED, &name_hash];
    let (expected_pda, _bump) = find_program_address(seeds, program_id);
    if name_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::get()?;

    // Transfer ownership
    {
        let mut reg_data = name_registry.try_borrow_mut_data()?;
        let registry = NameRegistry::from_bytes_mut(&mut reg_data)?;

        // Verify caller is current owner
        let mut owner_bytes = [0u8; 32];
        owner_bytes.copy_from_slice(current_owner.key().as_ref());
        if !registry.is_owner(&owner_bytes) {
            return Err(ProgramError::IllegalOwner);
        }

        // Transfer to new owner
        registry.owner.copy_from_slice(new_owner.key().as_ref());
        registry.set_updated_at(clock.unix_timestamp);
    }

    Ok(())
}
