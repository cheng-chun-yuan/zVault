//! Spend Split instruction (UltraHonk - Client-Side ZK)
//!
//! Splits one unified commitment into two new commitments.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: Commitment1 + Commitment2 (amount conservation enforced by ZK proof)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! The UltraHonk verifier must be called in an earlier instruction of the same transaction.
//! This instruction uses instruction introspection to verify the verifier was called.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, PoolState,
    StealthAnnouncement, STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
};
use crate::utils::{
    create_pda_account, read_bytes32, require_prior_zk_verification,
    validate_account_writable, validate_program_owner, verify_and_create_nullifier,
};


/// Split commitment instruction data
///
/// Layout:
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - output_commitment_1: [u8; 32]
/// - output_commitment_2: [u8; 32]
/// - vk_hash: [u8; 32]
/// - output1_ephemeral_pub_x: [u8; 32]
/// - output1_encrypted_amount_with_sign: [u8; 32]
/// - output2_ephemeral_pub_x: [u8; 32]
/// - output2_encrypted_amount_with_sign: [u8; 32]
///
/// Proof is in ChadBuffer account, verified by earlier verifier instruction in same TX.
pub struct SpendSplitData {
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub output_commitment_1: [u8; 32],
    pub output_commitment_2: [u8; 32],
    pub vk_hash: [u8; 32],
    pub output1_ephemeral_pub_x: [u8; 32],
    pub output1_encrypted_amount_with_sign: [u8; 32],
    pub output2_ephemeral_pub_x: [u8; 32],
    pub output2_encrypted_amount_with_sign: [u8; 32],
}

impl SpendSplitData {
    /// Size: root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) + eph1_x(32) + enc1(32) + eph2_x(32) + enc2(32) = 288 bytes
    pub const SIZE: usize = 32 * 9;

    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        let mut offset = 0;

        let root = read_bytes32(data, &mut offset)?;
        let nullifier_hash = read_bytes32(data, &mut offset)?;
        let output_commitment_1 = read_bytes32(data, &mut offset)?;
        let output_commitment_2 = read_bytes32(data, &mut offset)?;
        let vk_hash = read_bytes32(data, &mut offset)?;
        let output1_ephemeral_pub_x = read_bytes32(data, &mut offset)?;
        let output1_encrypted_amount_with_sign = read_bytes32(data, &mut offset)?;
        let output2_ephemeral_pub_x = read_bytes32(data, &mut offset)?;
        let output2_encrypted_amount_with_sign = read_bytes32(data, &mut offset)?;

        Ok(Self {
            root,
            nullifier_hash,
            output_commitment_1,
            output_commitment_2,
            vk_hash,
            output1_ephemeral_pub_x,
            output1_encrypted_amount_with_sign,
            output2_ephemeral_pub_x,
            output2_encrypted_amount_with_sign,
        })
    }

    /// Extract the y_sign bit from output1_encrypted_amount_with_sign (bit 64)
    pub fn get_output1_y_sign(&self) -> bool {
        (self.output1_encrypted_amount_with_sign[8] & 0x01) != 0
    }

    /// Extract encrypted amount from output1_encrypted_amount_with_sign (bits 0-63)
    pub fn get_output1_encrypted_amount(&self) -> [u8; 8] {
        let mut amount = [0u8; 8];
        amount.copy_from_slice(&self.output1_encrypted_amount_with_sign[0..8]);
        amount
    }

    /// Reconstruct the 33-byte compressed public key for output 1
    pub fn get_output1_ephemeral_pub_compressed(&self) -> [u8; 33] {
        let mut compressed = [0u8; 33];
        compressed[0] = if self.get_output1_y_sign() { 0x03 } else { 0x02 };
        compressed[1..33].copy_from_slice(&self.output1_ephemeral_pub_x);
        compressed
    }

    /// Extract the y_sign bit from output2_encrypted_amount_with_sign (bit 64)
    pub fn get_output2_y_sign(&self) -> bool {
        (self.output2_encrypted_amount_with_sign[8] & 0x01) != 0
    }

    /// Extract encrypted amount from output2_encrypted_amount_with_sign (bits 0-63)
    pub fn get_output2_encrypted_amount(&self) -> [u8; 8] {
        let mut amount = [0u8; 8];
        amount.copy_from_slice(&self.output2_encrypted_amount_with_sign[0..8]);
        amount
    }

    /// Reconstruct the 33-byte compressed public key for output 2
    pub fn get_output2_ephemeral_pub_compressed(&self) -> [u8; 33] {
        let mut compressed = [0u8; 33];
        compressed[0] = if self.get_output2_y_sign() { 0x03 } else { 0x02 };
        compressed[1..33].copy_from_slice(&self.output2_ephemeral_pub_x);
        compressed
    }
}

/// Split commitment accounts (10 accounts)
///
/// 0. pool_state (writable)
/// 1. commitment_tree (writable)
/// 2. nullifier_record (writable)
/// 3. user (signer)
/// 4. system_program
/// 5. ultrahonk_verifier - UltraHonk verifier program
/// 6. stealth_announcement_1 (writable) - StealthAnnouncement PDA for first output
/// 7. stealth_announcement_2 (writable) - StealthAnnouncement PDA for second output
/// 8. proof_buffer (readonly) - ChadBuffer account containing proof data
/// 9. instructions_sysvar (readonly) - For verifying prior verification instruction
pub struct SpendSplitAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
    pub stealth_announcement_1: &'a AccountInfo,
    pub stealth_announcement_2: &'a AccountInfo,
    pub proof_buffer: &'a AccountInfo,
    pub instructions_sysvar: &'a AccountInfo,
}

impl<'a> SpendSplitAccounts<'a> {
    pub const ACCOUNT_COUNT: usize = 10;

    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < Self::ACCOUNT_COUNT {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let user = &accounts[3];
        let system_program = &accounts[4];
        let ultrahonk_verifier = &accounts[5];
        let stealth_announcement_1 = &accounts[6];
        let stealth_announcement_2 = &accounts[7];
        let proof_buffer = &accounts[8];
        let instructions_sysvar = &accounts[9];

        // Validate user is signer
        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            commitment_tree,
            nullifier_record,
            user,
            system_program,
            ultrahonk_verifier,
            stealth_announcement_1,
            stealth_announcement_2,
            proof_buffer,
            instructions_sysvar,
        })
    }
}

/// Process split commitment (1-in-2-out) with UltraHonk proof
///
/// The UltraHonk verifier must be called in an earlier instruction of the same transaction.
pub fn process_spend_split(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts = SpendSplitAccounts::from_accounts(accounts)?;
    let ix_data = SpendSplitData::from_bytes(data)?;

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(accounts.pool_state, program_id)?;
    validate_program_owner(accounts.commitment_tree, program_id)?;

    // SECURITY: Validate writable accounts
    validate_account_writable(accounts.pool_state)?;
    validate_account_writable(accounts.commitment_tree)?;
    validate_account_writable(accounts.nullifier_record)?;
    validate_account_writable(accounts.stealth_announcement_1)?;
    validate_account_writable(accounts.stealth_announcement_2)?;

    // Reconstruct compressed pubkeys from x-coordinates and y_sign bits
    let ephemeral_pub_1_compressed = ix_data.get_output1_ephemeral_pub_compressed();
    let ephemeral_pub_2_compressed = ix_data.get_output2_ephemeral_pub_compressed();

    // Verify stealth announcement PDA for first output
    // Use bytes 1-32 of ephemeral_pub (skip prefix byte) - max seed length is 32 bytes
    let stealth_seeds_1: &[&[u8]] = &[StealthAnnouncement::SEED, &ephemeral_pub_1_compressed[1..33]];
    let (expected_stealth_pda_1, stealth_bump_1) = find_program_address(stealth_seeds_1, program_id);
    if accounts.stealth_announcement_1.key() != &expected_stealth_pda_1 {
        pinocchio::msg!("Invalid stealth announcement PDA for first output");
        return Err(ProgramError::InvalidSeeds);
    }

    // Verify stealth announcement PDA for second output
    let stealth_seeds_2: &[&[u8]] = &[StealthAnnouncement::SEED, &ephemeral_pub_2_compressed[1..33]];
    let (expected_stealth_pda_2, stealth_bump_2) = find_program_address(stealth_seeds_2, program_id);
    if accounts.stealth_announcement_2.key() != &expected_stealth_pda_2 {
        pinocchio::msg!("Invalid stealth announcement PDA for second output");
        return Err(ProgramError::InvalidSeeds);
    }

    // Load and validate pool state
    {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }
    }

    // Verify root is valid in commitment tree
    {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Get clock and rent for account creation
    let clock = Clock::get()?;
    let rent = Rent::get()?;

    // SECURITY: Create nullifier PDA FIRST to prevent race conditions
    // Verifies PDA, checks double-spend, creates and initializes in one call
    let user_key: &[u8; 32] = accounts.user.key();
    verify_and_create_nullifier(
        accounts.nullifier_record,
        accounts.user,
        program_id,
        &ix_data.nullifier_hash,
        NullifierOperationType::Split,
        clock.unix_timestamp,
        &user_key,
    )?;

    // Verify that UltraHonk verifier was called in an earlier instruction
    require_prior_zk_verification(
        accounts.instructions_sysvar,
        accounts.ultrahonk_verifier.key(),
        accounts.proof_buffer.key(),
    )?;

    // Update commitment tree with both new commitments and capture leaf indices
    let (leaf_index_1, leaf_index_2) = {
        let mut tree_data = accounts.commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if tree.next_index() + 2 > (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

        let idx1 = tree.insert_leaf(&ix_data.output_commitment_1)?;
        let idx2 = tree.insert_leaf(&ix_data.output_commitment_2)?;
        (idx1, idx2)
    };

    // Create stealth announcement PDA for first output (if it doesn't exist)
    let stealth_account_1_data_len = accounts.stealth_announcement_1.data_len();
    if stealth_account_1_data_len > 0 {
        let ann_data = accounts.stealth_announcement_1.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);

        let stealth_bump_1_bytes = [stealth_bump_1];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ephemeral_pub_1_compressed[1..33],
            &stealth_bump_1_bytes,
        ];

        create_pda_account(
            accounts.user,
            accounts.stealth_announcement_1,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize stealth announcement for first output
    // Extract encrypted amount from the packed field (bits 0-63)
    let encrypted_amount_1 = ix_data.get_output1_encrypted_amount();
    {
        let mut ann_data = accounts.stealth_announcement_1.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = stealth_bump_1;
        announcement.ephemeral_pub = ephemeral_pub_1_compressed;
        announcement.set_encrypted_amount(encrypted_amount_1);
        announcement.commitment.copy_from_slice(&ix_data.output_commitment_1);
        announcement.set_leaf_index(leaf_index_1);
        announcement.set_created_at(clock.unix_timestamp);
    }

    // Create stealth announcement PDA for second output (if it doesn't exist)
    let stealth_account_2_data_len = accounts.stealth_announcement_2.data_len();
    if stealth_account_2_data_len > 0 {
        let ann_data = accounts.stealth_announcement_2.try_borrow_data()?;
        if ann_data[0] == STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::AccountAlreadyInitialized);
        }
    } else {
        let lamports = rent.minimum_balance(StealthAnnouncement::SIZE);

        let stealth_bump_2_bytes = [stealth_bump_2];
        let signer_seeds: &[&[u8]] = &[
            StealthAnnouncement::SEED,
            &ephemeral_pub_2_compressed[1..33],
            &stealth_bump_2_bytes,
        ];

        create_pda_account(
            accounts.user,
            accounts.stealth_announcement_2,
            program_id,
            lamports,
            StealthAnnouncement::SIZE as u64,
            signer_seeds,
        )?;
    }

    // Initialize stealth announcement for second output
    let encrypted_amount_2 = ix_data.get_output2_encrypted_amount();
    {
        let mut ann_data = accounts.stealth_announcement_2.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = stealth_bump_2;
        announcement.ephemeral_pub = ephemeral_pub_2_compressed;
        announcement.set_encrypted_amount(encrypted_amount_2);
        announcement.commitment.copy_from_slice(&ix_data.output_commitment_2);
        announcement.set_leaf_index(leaf_index_2);
        announcement.set_created_at(clock.unix_timestamp);
    }

    // Update pool statistics
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        let split_count = pool.split_count();
        pool.set_split_count(split_count.saturating_add(1));
        pool.set_last_update(clock.unix_timestamp);
    }

    pinocchio::msg!("Split completed (UltraHonk)");

    Ok(())
}
