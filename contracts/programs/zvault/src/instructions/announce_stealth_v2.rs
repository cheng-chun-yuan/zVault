//! Announce Stealth V2 instruction
//!
//! Creates a V2 stealth announcement with dual-key ECDH:
//! - X25519 ephemeral key for off-chain scanning (viewing key)
//! - Grumpkin ephemeral key for in-circuit spending proofs
//!
//! Key Separation:
//! - Viewing key can decrypt amount/random but CANNOT derive nullifier
//! - Spending key required for nullifier and proof generation

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::state::{StealthAnnouncementV2, STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR};

/// Announce stealth V2 instruction data
/// Layout:
/// - ephemeral_view_pub: [u8; 32] (X25519 for scanning)
/// - ephemeral_spend_pub: [u8; 33] (Grumpkin compressed for spending)
/// - encrypted_amount: [u8; 8]
/// - encrypted_random: [u8; 32]
/// - commitment: [u8; 32]
/// Total: 137 bytes
pub struct AnnounceStealthV2Data {
    pub ephemeral_view_pub: [u8; 32],
    pub ephemeral_spend_pub: [u8; 33],
    pub encrypted_amount: [u8; 8],
    pub encrypted_random: [u8; 32],
    pub commitment: [u8; 32],
}

impl AnnounceStealthV2Data {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 137 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut ephemeral_view_pub = [0u8; 32];
        ephemeral_view_pub.copy_from_slice(&data[0..32]);

        let mut ephemeral_spend_pub = [0u8; 33];
        ephemeral_spend_pub.copy_from_slice(&data[32..65]);

        let mut encrypted_amount = [0u8; 8];
        encrypted_amount.copy_from_slice(&data[65..73]);

        let mut encrypted_random = [0u8; 32];
        encrypted_random.copy_from_slice(&data[73..105]);

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[105..137]);

        Ok(Self {
            ephemeral_view_pub,
            ephemeral_spend_pub,
            encrypted_amount,
            encrypted_random,
            commitment,
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

/// Announce a V2 stealth deposit with dual-key ECDH
///
/// Creates a PDA seeded by ephemeral_view_pub for recipient discovery.
///
/// Recipient scanning flow:
/// 1. X25519 ECDH with viewing key to decrypt amount/random
/// 2. Grumpkin ECDH with spending key in ZK circuit to prove ownership
/// 3. Nullifier derived from spending key + leaf index (only recipient knows)
pub fn process_announce_stealth_v2(
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

    let ix_data = AnnounceStealthV2Data::from_bytes(data)?;

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA (seeded by ephemeral_view_pub for uniqueness)
    let seeds: &[&[u8]] = &[StealthAnnouncementV2::SEED, &ix_data.ephemeral_view_pub];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if stealth_announcement.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if account already exists with data
    let account_data_len = stealth_announcement.data_len();

    if account_data_len > 0 {
        let ann_data = stealth_announcement.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        // Create the PDA account
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(StealthAnnouncementV2::SIZE);

        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncementV2::SEED,
            &ix_data.ephemeral_view_pub,
            &bump_bytes,
        ];

        create_pda_account(
            payer,
            stealth_announcement,
            system_program,
            program_id,
            lamports,
            StealthAnnouncementV2::SIZE as u64,
            signer_seeds,
        )?;
    }

    let clock = Clock::get()?;

    // Initialize V2 stealth announcement
    {
        let mut ann_data = stealth_announcement.try_borrow_mut_data()?;
        let announcement = StealthAnnouncementV2::init(&mut ann_data)?;

        announcement.bump = bump;
        announcement.ephemeral_view_pub = ix_data.ephemeral_view_pub;
        announcement.ephemeral_spend_pub = ix_data.ephemeral_spend_pub;
        announcement.encrypted_amount = ix_data.encrypted_amount;
        announcement.encrypted_random = ix_data.encrypted_random;
        announcement.commitment = ix_data.commitment;
        announcement.set_created_at(clock.unix_timestamp);
    }

    Ok(())
}
