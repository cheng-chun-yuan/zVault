//! Add Demo Stealth instruction (Admin only)
//!
//! Creates a stealth deposit for demo purposes without requiring real BTC.
//! Adds a user-owned commitment to the Merkle tree and publishes ephemeral
//! public key so user can find their balance with viewing key and spend
//! with spending key.
//!
//! Demo flow (EIP-5564/DKSAP pattern):
//! 1. SDK generates single ephemeral Grumpkin keypair
//! 2. SDK computes sharedSecret = ECDH(ephemeral.priv, viewingPub)
//! 3. SDK derives stealthPub = spendingPub + hash(sharedSecret) * G
//! 4. SDK computes commitment = Poseidon2(stealthPub.x, amount)
//! 5. This instruction adds commitment to Merkle tree
//! 6. This instruction creates stealth announcement with ephemeral pubkey
//! 7. User scans announcements with viewing key to detect deposits
//! 8. User generates ZK proof with spending key to claim

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{CommitmentTree, PoolState, StealthAnnouncement, STEALTH_ANNOUNCEMENT_DISCRIMINATOR};
use crate::utils::{mint_zbtc, validate_program_owner, validate_token_2022_owner, validate_token_program_key, create_pda_account};

/// Add demo stealth instruction data (single ephemeral key)
/// Layout:
/// - ephemeral_pub: [u8; 33] (Grumpkin compressed)
/// - commitment: [u8; 32] (pre-computed by SDK)
/// - amount: u64 (8 bytes)
/// Total: 73 bytes (was 105 with dual keys)
pub struct AddDemoStealthData {
    pub ephemeral_pub: [u8; 33],
    pub commitment: [u8; 32],
    pub amount: u64,
}

impl AddDemoStealthData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 73 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut ephemeral_pub = [0u8; 33];
        ephemeral_pub.copy_from_slice(&data[0..33]);

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[33..65]);

        let amount = u64::from_le_bytes(data[65..73].try_into().unwrap());

        Ok(Self {
            ephemeral_pub,
            commitment,
            amount,
        })
    }
}

/// Add a demo stealth deposit (admin only)
///
/// Creates a private deposit that user can find with viewing key
/// and spend with spending key. No real BTC required.
/// Also mints zBTC to pool vault so users can claim.
///
/// Accounts:
/// 0. pool_state - Pool state PDA (writable)
/// 1. commitment_tree - Commitment tree PDA (writable)
/// 2. stealth_announcement - Stealth announcement PDA (to create, writable)
/// 3. authority - Pool authority (signer, pays for announcement)
/// 4. system_program - System program
/// 5. zbtc_mint - zBTC Token-2022 mint (writable)
/// 6. pool_vault - Pool vault token account (writable)
/// 7. token_program - Token-2022 program
pub fn process_add_demo_stealth(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 8 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state = &accounts[0];
    let commitment_tree = &accounts[1];
    let stealth_announcement = &accounts[2];
    let authority = &accounts[3];
    let _system_program = &accounts[4];
    let zbtc_mint = &accounts[5];
    let pool_vault = &accounts[6];
    let token_program = &accounts[7];

    let ix_data = AddDemoStealthData::from_bytes(data)?;

    // Validate authority is signer
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate amount
    if ix_data.amount == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // Validate account owners
    validate_program_owner(pool_state, program_id)?;
    validate_program_owner(commitment_tree, program_id)?;
    validate_token_2022_owner(zbtc_mint)?;
    validate_token_2022_owner(pool_vault)?;
    validate_token_program_key(token_program)?;

    // Validate authority matches pool and get bump
    let pool_bump = {
        let pool_data = pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
        pool.bump
    };

    // Verify stealth announcement PDA
    // Use bytes 1-32 of ephemeral_pub (skip prefix byte) - max seed length is 32 bytes
    let seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ix_data.ephemeral_pub[1..33]];
    let (expected_pda, bump) = find_program_address(seeds, program_id);
    if stealth_announcement.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let clock = Clock::get()?;

    // Insert commitment into Merkle tree
    let leaf_index = {
        let mut tree_data = commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.commitment)?
    };

    // Create stealth announcement PDA if it doesn't exist
    let account_data_len = stealth_announcement.data_len();
    if account_data_len > 0 {
        let ann_data = stealth_announcement.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);

        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ix_data.ephemeral_pub[1..33],
            &bump_bytes,
        ];

        create_pda_account(
            authority,
            stealth_announcement,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize stealth announcement
    {
        let mut ann_data = stealth_announcement.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = bump;
        announcement.ephemeral_pub = ix_data.ephemeral_pub;
        announcement.set_amount_sats(ix_data.amount);
        announcement.commitment = ix_data.commitment;
        announcement.set_leaf_index(leaf_index);
        announcement.set_created_at(clock.unix_timestamp);
    }

    // Mint zBTC to pool vault so users can claim
    let bump_bytes = [pool_bump];
    let pool_signer_seeds: &[&[u8]] = &[PoolState::SEED, &bump_bytes];

    mint_zbtc(
        token_program,
        zbtc_mint,
        pool_vault,
        pool_state,
        ix_data.amount,
        pool_signer_seeds,
    )?;

    // Update pool statistics
    {
        let mut pool_data = pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.increment_deposit_count()?;
        pool.add_minted(ix_data.amount)?;
        pool.add_shielded(ix_data.amount)?;
        pool.set_last_update(clock.unix_timestamp);
    }

    pinocchio::msg!("Demo stealth deposit added");

    Ok(())
}
