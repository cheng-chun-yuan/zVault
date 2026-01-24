//! Announce Stealth instruction
//!
//! Creates a stealth announcement for deposit discovery.
//! Minimal 40-byte format for maximum privacy:
//! - No recipient_hint (prevents linking deposits to same recipient)
//! - No commitment (recipient computes from ECDH-derived secrets)
//! - Recipient must try ECDH on all announcements

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::state::{StealthAnnouncement, STEALTH_ANNOUNCEMENT_DISCRIMINATOR};

/// Announce stealth instruction data (minimal format)
/// Layout:
/// - ephemeral_pubkey: [u8; 32] (required for ECDH)
/// - encrypted_amount: [u8; 8] (required to compute commitment)
/// Total: 40 bytes
pub struct AnnounceStealthData {
    pub ephemeral_pubkey: [u8; 32],
    pub encrypted_amount: [u8; 8],
}

impl AnnounceStealthData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 40 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut ephemeral_pubkey = [0u8; 32];
        ephemeral_pubkey.copy_from_slice(&data[0..32]);

        let mut encrypted_amount = [0u8; 8];
        encrypted_amount.copy_from_slice(&data[32..40]);

        Ok(Self {
            ephemeral_pubkey,
            encrypted_amount,
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

/// Announce a stealth deposit
///
/// Creates a PDA seeded by ephemeral_pubkey for recipient discovery.
/// Recipient scans all announcements, tries ECDH with each ephemeral_pubkey,
/// and checks if they can derive valid secrets.
pub fn process_announce_stealth(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let stealth_announcement = &accounts[0];
    let payer = &accounts[1];
    let system_program = &accounts[2];

    let ix_data = AnnounceStealthData::from_bytes(data)?;

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA (seeded by ephemeral_pubkey for uniqueness)
    let seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ix_data.ephemeral_pubkey];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if stealth_announcement.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if account already exists with data
    let account_data_len = stealth_announcement.data_len();

    if account_data_len > 0 {
        // Account exists, check if initialized
        let ann_data = stealth_announcement.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        // Create the PDA account
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);

        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ix_data.ephemeral_pubkey,
            &bump_bytes,
        ];

        create_pda_account(
            payer,
            stealth_announcement,
            system_program,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    let clock = Clock::get()?;

    // Initialize stealth announcement
    {
        let mut ann_data = stealth_announcement.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = bump;
        announcement.ephemeral_pubkey = ix_data.ephemeral_pubkey;
        announcement.encrypted_amount = ix_data.encrypted_amount;
        announcement.set_created_at(clock.unix_timestamp);
    }

    Ok(())
}
