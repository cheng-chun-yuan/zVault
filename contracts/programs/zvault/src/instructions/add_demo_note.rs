//! Add Demo Note instruction (Admin only)
//!
//! Creates a claimable note for demo purposes without requiring real BTC.
//! User provides a secret, contract generates nullifier and commitment.
//!
//! Demo flow:
//! 1. User provides secret (32 bytes)
//! 2. Contract generates nullifier = SHA256(secret || "nullifier")
//! 3. Contract computes commitment = SHA256(nullifier || secret)
//! 4. Fixed demo amount: 10,000 satoshis (0.0001 BTC)
//! 5. Commitment added to Merkle tree
//! 6. User can claim with note (secret) to:
//!    - Private account (via .zkey stealth address)
//!    - Public address directly

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{CommitmentTree, PoolState};
use crate::utils::{mint_zbtc, sha256, validate_program_owner, validate_token_2022_owner, validate_token_program_key};

/// Fixed demo amount: 10,000 satoshis = 0.0001 BTC
pub const DEMO_AMOUNT_SATS: u64 = 10_000;

/// Add demo note instruction data
/// Layout: secret (32 bytes)
///
/// The nullifier and commitment are derived on-chain from the secret.
pub struct AddDemoNoteData {
    pub secret: [u8; 32],
}

impl AddDemoNoteData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < 32 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut secret = [0u8; 32];
        secret.copy_from_slice(&data[0..32]);

        Ok(Self { secret })
    }
}

/// Derive nullifier from secret
/// nullifier = SHA256(secret || "nullifier_salt")
fn derive_nullifier(secret: &[u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 48]; // 32 + 16 bytes salt
    input[0..32].copy_from_slice(secret);
    input[32..48].copy_from_slice(b"nullifier_salt__"); // 16 byte salt
    sha256(&input)
}

/// Compute commitment from nullifier and secret
/// commitment = SHA256(nullifier || secret)
fn compute_commitment(nullifier: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 64];
    input[0..32].copy_from_slice(nullifier);
    input[32..64].copy_from_slice(secret);
    sha256(&input)
}

/// Add a demo note to the Merkle tree (admin only)
///
/// User provides secret, contract derives everything else.
/// Fixed amount: 0.0001 BTC for demo purposes.
/// Also mints zBTC to pool vault so users can claim.
///
/// Accounts:
/// 0. pool_state - Pool state PDA (writable)
/// 1. commitment_tree - Commitment tree PDA (writable)
/// 2. authority - Pool authority (signer)
/// 3. zbtc_mint - zBTC Token-2022 mint (writable)
/// 4. pool_vault - Pool vault token account (writable)
/// 5. token_program - Token-2022 program
pub fn process_add_demo_note(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state = &accounts[0];
    let commitment_tree = &accounts[1];
    let authority = &accounts[2];
    let zbtc_mint = &accounts[3];
    let pool_vault = &accounts[4];
    let token_program = &accounts[5];

    let ix_data = AddDemoNoteData::from_bytes(data)?;

    // Validate authority is signer
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
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

    // Derive nullifier and commitment from secret
    let nullifier = derive_nullifier(&ix_data.secret);
    let commitment = compute_commitment(&nullifier, &ix_data.secret);

    let clock = Clock::get()?;

    // Insert commitment into tree
    {
        let mut tree_data = commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if !tree.has_capacity() {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&commitment)?;
    }

    // Mint zBTC to pool vault so users can claim
    let bump_bytes = [pool_bump];
    let pool_signer_seeds: &[&[u8]] = &[PoolState::SEED, &bump_bytes];

    mint_zbtc(
        token_program,
        zbtc_mint,
        pool_vault,
        pool_state,
        DEMO_AMOUNT_SATS,
        pool_signer_seeds,
    )?;

    // Update pool statistics
    {
        let mut pool_data = pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.increment_deposit_count()?;
        pool.add_minted(DEMO_AMOUNT_SATS)?;
        pool.add_shielded(DEMO_AMOUNT_SATS)?;
        pool.set_last_update(clock.unix_timestamp);
    }

    // Log nullifier for frontend to capture (needed for claim link)
    // Frontend reconstructs: note = { secret, nullifier (derived), amount: 10000 }
    pinocchio::msg!("Demo note added");

    Ok(())
}
