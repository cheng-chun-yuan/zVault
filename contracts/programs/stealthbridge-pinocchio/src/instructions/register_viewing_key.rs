//! Register Viewing Key instruction
//!
//! Creates a viewing key registry for a user.
//! This enables on-chain tracking of viewing key delegations.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::rent::Rent,
    ProgramResult, Sysvar,
};

use crate::state::{ViewingKeyRegistry, VIEWING_KEY_REGISTRY_DISCRIMINATOR};

/// Register viewing key instruction data
/// Layout:
/// - spending_pubkey: [u8; 32] (Grumpkin x-coordinate)
/// - viewing_pubkey: [u8; 32] (X25519 pubkey)
/// Total: 64 bytes
pub struct RegisterViewingKeyData {
    pub spending_pubkey: [u8; 32],
    pub viewing_pubkey: [u8; 32],
}

impl RegisterViewingKeyData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 64 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut spending_pubkey = [0u8; 32];
        spending_pubkey.copy_from_slice(&data[0..32]);

        let mut viewing_pubkey = [0u8; 32];
        viewing_pubkey.copy_from_slice(&data[32..64]);

        Ok(Self {
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

/// Register a viewing key for delegation management
///
/// Creates a PDA seeded by spending_pubkey that stores the viewing key
/// and allows delegation to auditors/compliance.
pub fn process_register_viewing_key(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let viewing_key_registry = &accounts[0];
    let payer = &accounts[1];
    let system_program = &accounts[2];

    let ix_data = RegisterViewingKeyData::from_bytes(data)?;

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA (seeded by spending_pubkey)
    let seeds: &[&[u8]] = &[ViewingKeyRegistry::SEED, &ix_data.spending_pubkey];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if viewing_key_registry.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if account already exists
    let account_data_len = viewing_key_registry.data_len();

    if account_data_len > 0 {
        let reg_data = viewing_key_registry.try_borrow_data()?;
        if reg_data[0] == VIEWING_KEY_REGISTRY_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        // Create the PDA account
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(ViewingKeyRegistry::SIZE);

        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            ViewingKeyRegistry::SEED,
            &ix_data.spending_pubkey,
            &bump_bytes,
        ];

        create_pda_account(
            payer,
            viewing_key_registry,
            system_program,
            program_id,
            lamports,
            ViewingKeyRegistry::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize viewing key registry
    {
        let mut reg_data = viewing_key_registry.try_borrow_mut_data()?;
        let registry = ViewingKeyRegistry::init(&mut reg_data)?;

        registry.bump = bump;
        registry.spending_pubkey = ix_data.spending_pubkey;
        registry.viewing_pubkey = ix_data.viewing_pubkey;
        registry.delegation_count = 0;
    }

    Ok(())
}
