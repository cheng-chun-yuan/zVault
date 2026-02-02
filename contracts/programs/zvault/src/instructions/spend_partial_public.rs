//! Spend Partial Public instruction (UltraHonk - Client-Side ZK)
//!
//! Claims part of a commitment to a public wallet, with change returned as a new commitment.
//!
//! Input:  Unified Commitment = Poseidon2(pub_key_x, amount)
//! Output: Public transfer + Change Commitment = Poseidon2(change_pub_key_x, change_amount)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! The UltraHonk verifier must be called in an earlier instruction of the same transaction.
//! This instruction uses instruction introspection to verify the verifier was called.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolState,
    StealthAnnouncement, NULLIFIER_RECORD_DISCRIMINATOR, STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
};
use crate::utils::{
    create_pda_account, transfer_zbtc,
    validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key,
};


/// Spend partial public instruction data
///
/// Layout:
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - public_amount: u64
/// - change_commitment: [u8; 32]
/// - recipient: [u8; 32]
/// - vk_hash: [u8; 32]
/// - change_ephemeral_pub_x: [u8; 32] - x-coordinate of ephemeral pubkey
/// - change_encrypted_amount_with_sign: [u8; 32] - bits 0-63: encrypted amount, bit 64: y_sign
///
/// Proof is in ChadBuffer account, verified by earlier verifier instruction in same TX.
pub struct SpendPartialPublicData<'a> {
    pub root: &'a [u8; 32],
    pub nullifier_hash: &'a [u8; 32],
    pub public_amount: u64,
    pub change_commitment: &'a [u8; 32],
    pub recipient: &'a [u8; 32],
    pub vk_hash: &'a [u8; 32],
    pub change_ephemeral_pub_x: [u8; 32],
    pub change_encrypted_amount_with_sign: [u8; 32],
}

impl<'a> SpendPartialPublicData<'a> {
    /// Size: root(32) + nullifier(32) + amount(8) + change(32) + recipient(32) + vk_hash(32) + eph_x(32) + enc_amount(32) = 232 bytes
    pub const SIZE: usize = 32 + 32 + 8 + 32 + 32 + 32 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 0;

        let root: &[u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;

        let nullifier_hash: &[u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;

        let public_amount = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let change_commitment: &[u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;

        let recipient: &[u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;

        let vk_hash: &[u8; 32] = data[offset..offset + 32].try_into().unwrap();
        offset += 32;

        let mut change_ephemeral_pub_x = [0u8; 32];
        change_ephemeral_pub_x.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut change_encrypted_amount_with_sign = [0u8; 32];
        change_encrypted_amount_with_sign.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            root,
            nullifier_hash,
            public_amount,
            change_commitment,
            recipient,
            vk_hash,
            change_ephemeral_pub_x,
            change_encrypted_amount_with_sign,
        })
    }

    /// Extract the y_sign bit from change_encrypted_amount_with_sign (bit 64)
    pub fn get_change_y_sign(&self) -> bool {
        // Bit 64 is in byte 8, bit 0
        (self.change_encrypted_amount_with_sign[8] & 0x01) != 0
    }

    /// Extract encrypted amount from change_encrypted_amount_with_sign (bits 0-63)
    pub fn get_change_encrypted_amount(&self) -> [u8; 8] {
        let mut amount = [0u8; 8];
        amount.copy_from_slice(&self.change_encrypted_amount_with_sign[0..8]);
        amount
    }

    /// Reconstruct the 33-byte compressed public key from x-coordinate and y_sign
    pub fn get_change_ephemeral_pub_compressed(&self) -> [u8; 33] {
        let mut compressed = [0u8; 33];
        // Prefix: 0x02 if y is even (y_sign=0), 0x03 if y is odd (y_sign=1)
        compressed[0] = if self.get_change_y_sign() { 0x03 } else { 0x02 };
        compressed[1..33].copy_from_slice(&self.change_ephemeral_pub_x);
        compressed
    }
}

/// Spend partial public accounts (SkipVerification mode - 13 accounts)
///
/// 0. pool_state (writable)
/// 1. commitment_tree (writable)
/// 2. nullifier_record (writable)
/// 3. zbtc_mint (readonly)
/// 4. pool_vault (writable)
/// 5. recipient_ata (writable)
/// 6. user (signer)
/// 7. token_program
/// 8. system_program
/// 9. ultrahonk_verifier - UltraHonk verifier program
/// 10. stealth_announcement_change (writable) - StealthAnnouncement PDA for change output
/// 11. proof_buffer (readonly) - ChadBuffer account containing proof data
/// 12. instructions_sysvar (readonly) - For verifying prior verification instruction
pub struct SpendPartialPublicAccounts<'a> {
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
    pub stealth_announcement_change: &'a AccountInfo,
    pub proof_buffer: &'a AccountInfo,
    pub instructions_sysvar: &'a AccountInfo,
}

impl<'a> SpendPartialPublicAccounts<'a> {
    pub const ACCOUNT_COUNT: usize = 13;

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
        let stealth_announcement_change = &accounts[10];
        let proof_buffer = &accounts[11];
        let instructions_sysvar = &accounts[12];

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
            stealth_announcement_change,
            proof_buffer,
            instructions_sysvar,
        })
    }
}

/// Process spend partial public instruction (UltraHonk proof with SkipVerification)
///
/// Claims part of a commitment to a public wallet, with change returned as a new commitment.
/// Amount conservation: input_amount == public_amount + change_amount (enforced by ZK proof)
///
/// Uses SkipVerification pattern: verifier must be called in earlier instruction of same TX.
pub fn process_spend_partial_public(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = SpendPartialPublicAccounts::from_accounts(accounts)?;
    let ix_data = SpendPartialPublicData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;
    validate_token_2022_owner(accounts.zbtc_mint)?;
    validate_token_2022_owner(accounts.pool_vault)?;
    validate_token_2022_owner(accounts.recipient_ata)?;
    validate_token_program_key(accounts.token_program)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.pool_state)?;
    validate_account_writable(accounts.commitment_tree)?;
    validate_account_writable(accounts.nullifier_record)?;
    validate_account_writable(accounts.pool_vault)?;
    validate_account_writable(accounts.recipient_ata)?;
    validate_account_writable(accounts.stealth_announcement_change)?;

    // Reconstruct compressed pubkey from x-coordinate and y_sign
    let ephemeral_pub_compressed = ix_data.get_change_ephemeral_pub_compressed();

    // Verify stealth announcement PDA for change output
    // Use bytes 1-32 of ephemeral_pub (skip prefix byte) - max seed length is 32 bytes
    let stealth_seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ephemeral_pub_compressed[1..33]];
    let (expected_stealth_pda, stealth_bump) = find_program_address(stealth_seeds, program_id);
    if accounts.stealth_announcement_change.key() != &expected_stealth_pda {
        pinocchio::msg!("Invalid stealth announcement PDA for change output");
        return Err(ProgramError::InvalidSeeds);
    }

    // Validate public amount
    if ix_data.public_amount == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }

    // Load and validate pool state
    let (pool_bump, _min_deposit, total_shielded) = {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (pool.bump, pool.min_deposit(), pool.total_shielded())
    };

    // Validate public amount bounds (minimum 1000 sats)
    if ix_data.public_amount < 1000 {
        return Err(ZVaultError::AmountTooSmall.into());
    }
    if ix_data.public_amount > total_shielded {
        return Err(ZVaultError::InsufficientFunds.into());
    }

    // Verify root is valid in commitment tree
    {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(ix_data.root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, ix_data.nullifier_hash];
    let (expected_nullifier_pda, nullifier_bump) = find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent
    {
        let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
        if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Get clock for timestamp
    let clock = Clock::get()?;

    // SECURITY: Create nullifier record FIRST to prevent race conditions
    let nullifier_bump_bytes = [nullifier_bump];
    let nullifier_signer_seeds: [Seed; 3] = [
        Seed::from(NullifierRecord::SEED),
        Seed::from(ix_data.nullifier_hash.as_slice()),
        Seed::from(&nullifier_bump_bytes),
    ];
    let nullifier_signer = [Signer::from(&nullifier_signer_seeds)];

    CreateAccount {
        from: accounts.user,
        to: accounts.nullifier_record,
        lamports: Rent::get()?.minimum_balance(NullifierRecord::LEN),
        space: NullifierRecord::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&nullifier_signer)?;

    // Verify that UltraHonk verifier was called in an earlier instruction of this TX.
    // Uses instruction introspection - the verifier must have been called with the
    // same buffer account. This avoids Solana's CPI data size limit (10KB < 16KB proof).
    pinocchio::msg!("Verifying prior verification instruction...");

    crate::utils::verify_prior_buffer_verification(
        accounts.instructions_sysvar,
        accounts.ultrahonk_verifier.key(),
        accounts.proof_buffer.key(),
    ).map_err(|_| {
        pinocchio::msg!("No valid prior verification instruction found");
        ZVaultError::ZkVerificationFailed
    })?;

    pinocchio::msg!("Prior verification confirmed");

    // Initialize nullifier record
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(ix_data.recipient);
        nullifier.set_operation_type(NullifierOperationType::Transfer);
    }

    // Add change commitment to tree and capture leaf index
    let change_leaf_index = {
        let mut tree_data = accounts.commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if tree.next_index() >= (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(ix_data.change_commitment)?
    };

    // Create stealth announcement PDA for change output (if it doesn't exist)
    let stealth_account_data_len = accounts.stealth_announcement_change.data_len();
    if stealth_account_data_len > 0 {
        let ann_data = accounts.stealth_announcement_change.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);

        let stealth_bump_bytes = [stealth_bump];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ephemeral_pub_compressed[1..33],
            &stealth_bump_bytes,
        ];

        create_pda_account(
            accounts.user,
            accounts.stealth_announcement_change,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize stealth announcement for change output
    // Extract encrypted amount from the packed field (bits 0-63)
    let encrypted_amount_change = ix_data.get_change_encrypted_amount();
    {
        let mut ann_data = accounts.stealth_announcement_change.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = stealth_bump;
        announcement.ephemeral_pub = ephemeral_pub_compressed;
        announcement.set_encrypted_amount(encrypted_amount_change);
        announcement.commitment.copy_from_slice(ix_data.change_commitment);
        announcement.set_leaf_index(change_leaf_index);
        announcement.set_created_at(clock.unix_timestamp);
    }

    // Transfer public amount from pool vault to recipient's ATA
    let bump_bytes = [pool_bump];
    let pool_signer_seeds: &[&[u8]] = &[PoolState::SEED, &bump_bytes];

    transfer_zbtc(
        accounts.token_program,
        accounts.pool_vault,
        accounts.recipient_ata,
        accounts.pool_state,
        ix_data.public_amount,
        pool_signer_seeds,
    )?;

    // Update pool state
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.sub_shielded(ix_data.public_amount)?;
        pool.set_last_update(clock.unix_timestamp);
    }

    pinocchio::msg!("Spent partial to public with change (UltraHonk)");

    Ok(())
}
