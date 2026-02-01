//! Spend Split instruction (UltraHonk - Client-Side ZK)
//!
//! Splits one unified commitment into two new commitments.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: Commitment1 + Commitment2 (amount conservation enforced by ZK proof)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! ## Proof Sources
//! - **Inline (proof_source=0)**: Proof data included directly in instruction data
//! - **Buffer (proof_source=1)**: Proof read from ChadBuffer account (for large proofs)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{
    CommitmentTree, NullifierOperationType, NullifierRecord, PoolState,
    StealthAnnouncement, NULLIFIER_RECORD_DISCRIMINATOR, STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
};
use crate::utils::{
    create_pda_account, validate_account_writable, validate_program_owner,
    verify_ultrahonk_split_proof, MAX_ULTRAHONK_PROOF_SIZE,
};

/// ChadBuffer authority size (first 32 bytes of account data)
const CHADBUFFER_AUTHORITY_SIZE: usize = 32;

/// Proof source indicator
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SplitProofSource {
    /// Proof data is included inline in instruction data
    Inline = 0,
    /// Proof data is read from a ChadBuffer account
    Buffer = 1,
}

impl SplitProofSource {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(SplitProofSource::Inline),
            1 => Some(SplitProofSource::Buffer),
            _ => None,
        }
    }
}

/// Split commitment instruction data (UltraHonk proof - variable size)
///
/// ## Inline Mode (proof_source=0)
/// Layout:
/// - proof_source: u8 (0)
/// - proof_len: u32 (4 bytes, LE)
/// - proof: [u8; proof_len] - UltraHonk proof
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - output_commitment_1: [u8; 32]
/// - output_commitment_2: [u8; 32]
/// - vk_hash: [u8; 32]
/// - output1_ephemeral_pub_x: [u8; 32] - x-coordinate of ephemeral pubkey for output 1 (circuit public input)
/// - output1_encrypted_amount_with_sign: [u8; 32] - bits 0-63: encrypted amount, bit 64: y_sign (circuit public input)
/// - output2_ephemeral_pub_x: [u8; 32] - x-coordinate of ephemeral pubkey for output 2 (circuit public input)
/// - output2_encrypted_amount_with_sign: [u8; 32] - bits 0-63: encrypted amount, bit 64: y_sign (circuit public input)
///
/// ## Buffer Mode (proof_source=1)
/// Layout:
/// - proof_source: u8 (1)
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - output_commitment_1: [u8; 32]
/// - output_commitment_2: [u8; 32]
/// - vk_hash: [u8; 32]
/// - output1_ephemeral_pub_x: [u8; 32]
/// - output1_encrypted_amount_with_sign: [u8; 32]
/// - output2_ephemeral_pub_x: [u8; 32]
/// - output2_encrypted_amount_with_sign: [u8; 32]
/// (proof is read from ChadBuffer account passed as additional account)
///
/// Note: The ephemeral pubkey and encrypted amount fields are circuit public inputs,
/// so the proof commits to these values. A malicious relayer cannot tamper with them.
pub struct SpendSplitData<'a> {
    pub proof_source: SplitProofSource,
    pub proof: Option<&'a [u8]>,
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub output_commitment_1: [u8; 32],
    pub output_commitment_2: [u8; 32],
    pub vk_hash: [u8; 32],
    /// Ephemeral pubkey x-coordinate for first output (32 bytes) - circuit public input
    pub output1_ephemeral_pub_x: [u8; 32],
    /// Packed: bits 0-63 = encrypted amount, bit 64 = y_sign for output 1 - circuit public input
    pub output1_encrypted_amount_with_sign: [u8; 32],
    /// Ephemeral pubkey x-coordinate for second output (32 bytes) - circuit public input
    pub output2_ephemeral_pub_x: [u8; 32],
    /// Packed: bits 0-63 = encrypted amount, bit 64 = y_sign for output 2 - circuit public input
    pub output2_encrypted_amount_with_sign: [u8; 32],
}

impl<'a> SpendSplitData<'a> {
    /// Minimum size for inline mode: proof_source(1) + proof_len(4) + root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) + output1_ephemeral_pub_x(32) + output1_encrypted_amount_with_sign(32) + output2_ephemeral_pub_x(32) + output2_encrypted_amount_with_sign(32) = 293 bytes + proof
    pub const MIN_SIZE_INLINE: usize = 1 + 4 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32;

    /// Minimum size for buffer mode: proof_source(1) + root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) + output1_ephemeral_pub_x(32) + output1_encrypted_amount_with_sign(32) + output2_ephemeral_pub_x(32) + output2_encrypted_amount_with_sign(32) = 289 bytes
    pub const MIN_SIZE_BUFFER: usize = 1 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_source = SplitProofSource::from_u8(data[0]).ok_or_else(|| {
            pinocchio::msg!("Invalid proof source");
            ProgramError::InvalidInstructionData
        })?;

        match proof_source {
            SplitProofSource::Inline => Self::parse_inline(data),
            SplitProofSource::Buffer => Self::parse_buffer(data),
        }
    }

    fn parse_inline(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_INLINE {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse proof length (after proof_source byte)
        let proof_len = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;

        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 1 + 4 + proof_len + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[5..5 + proof_len];
        let mut offset = 5 + proof_len;

        let mut root = [0u8; 32];
        root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_1 = [0u8; 32];
        output_commitment_1.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_2 = [0u8; 32];
        output_commitment_2.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output1_ephemeral_pub_x = [0u8; 32];
        output1_ephemeral_pub_x.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output1_encrypted_amount_with_sign = [0u8; 32];
        output1_encrypted_amount_with_sign.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output2_ephemeral_pub_x = [0u8; 32];
        output2_ephemeral_pub_x.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output2_encrypted_amount_with_sign = [0u8; 32];
        output2_encrypted_amount_with_sign.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof_source: SplitProofSource::Inline,
            proof: Some(proof),
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

    fn parse_buffer(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_BUFFER {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 1; // Skip proof_source byte

        let mut root = [0u8; 32];
        root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_1 = [0u8; 32];
        output_commitment_1.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output_commitment_2 = [0u8; 32];
        output_commitment_2.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output1_ephemeral_pub_x = [0u8; 32];
        output1_ephemeral_pub_x.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output1_encrypted_amount_with_sign = [0u8; 32];
        output1_encrypted_amount_with_sign.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output2_ephemeral_pub_x = [0u8; 32];
        output2_ephemeral_pub_x.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut output2_encrypted_amount_with_sign = [0u8; 32];
        output2_encrypted_amount_with_sign.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof_source: SplitProofSource::Buffer,
            proof: None,
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

/// Split commitment accounts
///
/// ## Inline Mode (8 accounts)
/// 0. pool_state (writable)
/// 1. commitment_tree (writable)
/// 2. nullifier_record (writable)
/// 3. user (signer)
/// 4. system_program
/// 5. ultrahonk_verifier - UltraHonk verifier program
/// 6. stealth_announcement_1 (writable) - StealthAnnouncement PDA for first output
/// 7. stealth_announcement_2 (writable) - StealthAnnouncement PDA for second output
///
/// ## Buffer Mode (9 accounts - adds proof_buffer)
/// 8. proof_buffer (readonly) - ChadBuffer account containing proof data
pub struct SpendSplitAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub ultrahonk_verifier: &'a AccountInfo,
    pub stealth_announcement_1: &'a AccountInfo,
    pub stealth_announcement_2: &'a AccountInfo,
    pub proof_buffer: Option<&'a AccountInfo>,
}

impl<'a> SpendSplitAccounts<'a> {
    pub fn from_accounts(
        accounts: &'a [AccountInfo],
        use_buffer: bool,
    ) -> Result<Self, ProgramError> {
        let min_accounts = if use_buffer { 9 } else { 8 };
        if accounts.len() < min_accounts {
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
        let proof_buffer = if use_buffer {
            Some(&accounts[8])
        } else {
            None
        };

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
        })
    }
}

/// Process split commitment (1-in-2-out) with UltraHonk proof
///
/// Supports both inline proofs and ChadBuffer references.
pub fn process_spend_split(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse instruction data first to determine proof source
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let use_buffer = data[0] == SplitProofSource::Buffer as u8;

    let accounts = SpendSplitAccounts::from_accounts(accounts, use_buffer)?;
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

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.nullifier_hash];
    let (expected_nullifier_pda, nullifier_bump) =
        find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Get clock and rent for account creation
    let clock = Clock::get()?;
    let rent = Rent::get()?;

    // SECURITY: Create nullifier PDA FIRST to prevent race conditions
    {
        let nullifier_data_len = accounts.nullifier_record.data_len();
        if nullifier_data_len > 0 {
            let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
            if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
                return Err(ZVaultError::NullifierAlreadyUsed.into());
            }
        } else {
            let lamports = rent.minimum_balance(NullifierRecord::LEN);
            let bump_bytes = [nullifier_bump];
            let signer_seeds: &[&[u8]] = &[
                NullifierRecord::SEED,
                &ix_data.nullifier_hash,
                &bump_bytes,
            ];

            create_pda_account(
                accounts.user,
                accounts.nullifier_record,
                program_id,
                lamports,
                NullifierRecord::LEN as u64,
                signer_seeds,
            )?;
        }
    }

    // Get proof bytes and verify (either inline or from ChadBuffer)
    // Note: The ephemeral pubkey and encrypted amount fields are circuit public inputs,
    // so the proof commits to these values. If a relayer tries to tamper with them, verification fails.
    match ix_data.proof_source {
        SplitProofSource::Inline => {
            let proof = ix_data.proof.ok_or(ProgramError::InvalidInstructionData)?;

            pinocchio::msg!("Verifying UltraHonk split proof (inline) via CPI...");

            verify_ultrahonk_split_proof(
                accounts.ultrahonk_verifier,
                proof,
                &ix_data.root,
                &ix_data.nullifier_hash,
                &ix_data.output_commitment_1,
                &ix_data.output_commitment_2,
                &ix_data.output1_ephemeral_pub_x,
                &ix_data.output1_encrypted_amount_with_sign,
                &ix_data.output2_ephemeral_pub_x,
                &ix_data.output2_encrypted_amount_with_sign,
                &ix_data.vk_hash,
            )
            .map_err(|_| {
                pinocchio::msg!("UltraHonk split proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
        SplitProofSource::Buffer => {
            let proof_buffer_account = accounts
                .proof_buffer
                .ok_or(ProgramError::NotEnoughAccountKeys)?;

            // Read proof from ChadBuffer (data starts after 32-byte authority)
            let buffer_data = proof_buffer_account.try_borrow_data()?;

            if buffer_data.len() <= CHADBUFFER_AUTHORITY_SIZE {
                pinocchio::msg!("ChadBuffer too small");
                return Err(ProgramError::InvalidAccountData);
            }

            let proof = &buffer_data[CHADBUFFER_AUTHORITY_SIZE..];

            if proof.len() > MAX_ULTRAHONK_PROOF_SIZE {
                pinocchio::msg!("Proof in buffer too large");
                return Err(ZVaultError::InvalidProofLength.into());
            }

            pinocchio::msg!("Verifying UltraHonk split proof (buffer) via CPI...");

            verify_ultrahonk_split_proof(
                accounts.ultrahonk_verifier,
                proof,
                &ix_data.root,
                &ix_data.nullifier_hash,
                &ix_data.output_commitment_1,
                &ix_data.output_commitment_2,
                &ix_data.output1_ephemeral_pub_x,
                &ix_data.output1_encrypted_amount_with_sign,
                &ix_data.output2_ephemeral_pub_x,
                &ix_data.output2_encrypted_amount_with_sign,
                &ix_data.vk_hash,
            )
            .map_err(|_| {
                pinocchio::msg!("UltraHonk split proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
    }

    // Initialize nullifier record
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier
            .nullifier_hash
            .copy_from_slice(&ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier
            .spent_by
            .copy_from_slice(accounts.user.key().as_ref());
        nullifier.set_operation_type(NullifierOperationType::Split);
    }

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
