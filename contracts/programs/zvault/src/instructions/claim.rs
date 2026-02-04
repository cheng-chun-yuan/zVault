//! Claim instruction (UltraHonk - Client-Side ZK)
//!
//! Claims a unified commitment to a public Solana wallet.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: zkBTC transferred to recipient's ATA (amount revealed)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! The UltraHonk verifier must be called in an earlier instruction of the same transaction.
//! This instruction uses instruction introspection to verify the verifier was called.
//!
//! Flow:
//! 1. User generates UltraHonk proof client-side (no backend)
//! 2. Upload proof via ChadBuffer (external program)
//! 3. Call ultrahonk-verifier with buffer reference
//! 4. Call this instruction - verifies prior verification via introspection
//! 5. Nullifier is recorded (prevents double-spend)
//! 6. zkBTC is transferred from pool vault to recipient's ATA

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{CommitmentTree, NullifierOperationType, PoolState};
use crate::utils::{
    parse_u64_le, read_bytes32, require_prior_zk_verification, transfer_zbtc,
    validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key, verify_and_create_nullifier,
};

/// Claim instruction data (UltraHonk proof via buffer)
///
/// Layout:
/// - root: [u8; 32] - Merkle tree root
/// - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
/// - amount_sats: u64 - Amount to claim (revealed)
/// - recipient: [u8; 32] - Recipient Solana wallet address
/// - vk_hash: [u8; 32] - Verification key hash
///
/// Proof is in ChadBuffer account, verified by earlier verifier instruction in same TX.
pub struct ClaimData {
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub amount_sats: u64,
    pub recipient: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl ClaimData {
    /// Data size: root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32) = 136 bytes
    pub const SIZE: usize = 32 + 32 + 8 + 32 + 32;

    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        let mut offset = 0;

        let root = read_bytes32(data, &mut offset)?;
        let nullifier_hash = read_bytes32(data, &mut offset)?;
        let amount_sats = parse_u64_le(data, &mut offset)?;
        let recipient = read_bytes32(data, &mut offset)?;
        let vk_hash = read_bytes32(data, &mut offset)?;

        Ok(Self {
            root,
            nullifier_hash,
            amount_sats,
            recipient,
            vk_hash,
        })
    }
}

/// Claim accounts (12 accounts)
///
/// 0. pool_state (writable) - Pool state PDA
/// 1. commitment_tree (readonly) - Commitment tree for root validation
/// 2. nullifier_record (writable) - Nullifier PDA (created)
/// 3. zbtc_mint (writable) - zBTC Token-2022 mint
/// 4. pool_vault (writable) - Pool vault holding zBTC
/// 5. recipient_ata (writable) - Recipient's associated token account
/// 6. user (signer) - Transaction fee payer
/// 7. token_program - Token-2022 program
/// 8. system_program - System program
/// 9. ultrahonk_verifier - UltraHonk verifier program (for introspection check)
/// 10. proof_buffer (readonly) - ChadBuffer account containing proof data
/// 11. instructions_sysvar (readonly) - For verifying prior verification instruction
pub struct ClaimAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub zbtc_mint: &'a AccountInfo,
    pub pool_vault: &'a AccountInfo,
    pub recipient_ata: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub token_program: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
    pub proof_buffer: &'a AccountInfo,
    pub instructions_sysvar: &'a AccountInfo,
}

impl<'a> ClaimAccounts<'a> {
    pub const ACCOUNT_COUNT: usize = 12;

    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < Self::ACCOUNT_COUNT {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let zbtc_mint = &accounts[3];
        let pool_vault = &accounts[4];
        let recipient_ata = &accounts[5];
        let user = &accounts[6];
        let token_program = &accounts[7];
        let system_program = &accounts[8];
        let ultrahonk_verifier = &accounts[9];
        let proof_buffer = &accounts[10];
        let instructions_sysvar = &accounts[11];

        // Validate user is signer (fee payer)
        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            commitment_tree,
            nullifier_record,
            zbtc_mint,
            pool_vault,
            recipient_ata,
            user,
            token_program,
            system_program,
            ultrahonk_verifier,
            proof_buffer,
            instructions_sysvar,
        })
    }
}

/// Process claim instruction (UltraHonk proof via introspection)
///
/// Claims zkBTC directly to a Solana wallet, revealing the amount.
/// The UltraHonk verifier must be called in an earlier instruction of the same transaction.
pub fn process_claim(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = ClaimAccounts::from_accounts(accounts)?;
    let ix_data = ClaimData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;
    // Note: nullifier_record may not exist yet (will be created)
    validate_token_2022_owner(accounts.zbtc_mint)?;
    validate_token_2022_owner(accounts.pool_vault)?;
    validate_token_2022_owner(accounts.recipient_ata)?;
    validate_token_program_key(accounts.token_program)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.pool_state)?;
    validate_account_writable(accounts.nullifier_record)?;
    validate_account_writable(accounts.pool_vault)?;
    validate_account_writable(accounts.recipient_ata)?;

    // Validate amount
    if ix_data.amount_sats == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // Load and validate pool state
    let (pool_bump, min_deposit, total_shielded) = {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (pool.bump, pool.min_deposit(), pool.total_shielded())
    };

    // Validate amount bounds
    if ix_data.amount_sats < min_deposit {
        return Err(ZVaultError::AmountTooSmall.into());
    }
    if ix_data.amount_sats > total_shielded {
        return Err(ZVaultError::InsufficientFunds.into());
    }

    // Verify root is valid in commitment tree
    {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Get clock for timestamp
    let clock = Clock::get()?;

    // SECURITY: Create nullifier record FIRST to prevent race conditions
    // Verifies PDA, checks double-spend, creates and initializes in one call
    verify_and_create_nullifier(
        accounts.nullifier_record,
        accounts.user,
        program_id,
        &ix_data.nullifier_hash,
        NullifierOperationType::Transfer,
        clock.unix_timestamp,
        &ix_data.recipient,
    )?;

    // Verify that UltraHonk verifier was called in an earlier instruction
    require_prior_zk_verification(
        accounts.instructions_sysvar,
        accounts.ultrahonk_verifier.key(),
        accounts.proof_buffer.key(),
    )?;

    // Transfer zBTC from pool vault to recipient's ATA
    // Pool PDA is the authority for the pool vault
    let bump_bytes = [pool_bump];
    let pool_signer_seeds: &[&[u8]] = &[PoolState::SEED, &bump_bytes];

    transfer_zbtc(
        accounts.token_program,
        accounts.pool_vault,
        accounts.recipient_ata,
        accounts.pool_state,
        ix_data.amount_sats,
        pool_signer_seeds,
    )?;

    // Update pool state
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        // Subtract from shielded pool (tokens moved to public wallet)
        pool.sub_shielded(ix_data.amount_sats)?;
        pool.increment_direct_claims()?;
        pool.set_last_update(clock.unix_timestamp);
    }

    pinocchio::msg!("Claimed sats to public wallet (UltraHonk)");

    Ok(())
}
