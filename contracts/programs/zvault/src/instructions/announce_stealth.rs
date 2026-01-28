//! Announce Stealth instruction
//!
//! Creates a stealth announcement with single ephemeral key (EIP-5564/DKSAP):
//! - Single Grumpkin ephemeral key for ECDH stealth derivation
//! - Recipient uses viewing key to detect, spending key to claim
//!
//! Key Separation:
//! - Viewing key can detect amount but CANNOT derive stealth private key
//! - Spending key required for stealthPriv and nullifier derivation

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::state::{StealthAnnouncement, STEALTH_ANNOUNCEMENT_DISCRIMINATOR};
use crate::utils::create_pda_account;

/// Announce stealth instruction data (single ephemeral key)
///
/// Layout:
/// - ephemeral_pub: [u8; 33] (Grumpkin compressed)
/// - amount_sats: u64 (8 bytes, public amount from BTC tx)
/// - commitment: [u8; 32]
///
/// Total: 73 bytes (was 105 with dual keys)
pub struct AnnounceStealthData {
    pub ephemeral_pub: [u8; 33],
    pub amount_sats: u64,
    pub commitment: [u8; 32],
}

impl AnnounceStealthData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 73 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut ephemeral_pub = [0u8; 33];
        ephemeral_pub.copy_from_slice(&data[0..33]);

        let amount_sats = u64::from_le_bytes(data[33..41].try_into().unwrap());

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[41..73]);

        Ok(Self {
            ephemeral_pub,
            amount_sats,
            commitment,
        })
    }
}

/// Announce a stealth deposit with single ephemeral key (EIP-5564/DKSAP)
///
/// Creates a PDA seeded by ephemeral_pub for recipient discovery.
///
/// Recipient scanning flow:
/// 1. Compute sharedSecret = ECDH(viewingPriv, ephemeralPub)
/// 2. Derive stealthPub = spendingPub + hash(sharedSecret) * G
/// 3. Verify commitment = Poseidon2(stealthPub.x, amount)
/// 4. If match, derive stealthPriv = spendingPriv + hash(sharedSecret)
/// 5. Compute nullifier = Poseidon2(stealthPriv, leafIndex)
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
    let _system_program = &accounts[2];

    let ix_data = AnnounceStealthData::from_bytes(data)?;

    // Validate payer is signer
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA (seeded by ephemeral_pub for uniqueness)
    let seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ix_data.ephemeral_pub];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if stealth_announcement.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if account already exists with data
    let account_data_len = stealth_announcement.data_len();

    if account_data_len > 0 {
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
            &ix_data.ephemeral_pub,
            &bump_bytes,
        ];

        create_pda_account(
            payer,
            stealth_announcement,
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
        announcement.ephemeral_pub = ix_data.ephemeral_pub;
        announcement.set_amount_sats(ix_data.amount_sats);
        announcement.commitment = ix_data.commitment;
        announcement.set_created_at(clock.unix_timestamp);
    }

    Ok(())
}
