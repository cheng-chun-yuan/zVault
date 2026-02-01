//! Spend Partial Public instruction (UltraHonk - Client-Side ZK)
//!
//! Claims part of a commitment to a public wallet, with change returned as a new commitment.
//!
//! Input:  Unified Commitment = Poseidon2(pub_key_x, amount)
//! Output: Public transfer + Change Commitment = Poseidon2(change_pub_key_x, change_amount)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! ## Proof Sources
//! - **Inline (proof_source=0)**: Proof data included directly in instruction data
//! - **Buffer (proof_source=1)**: Proof read from ChadBuffer account (for large proofs)

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
    create_pda_account, transfer_zbtc, verify_ultrahonk_spend_partial_public_proof,
    validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key, MAX_ULTRAHONK_PROOF_SIZE,
};

/// ChadBuffer authority size (first 32 bytes of account data)
const CHADBUFFER_AUTHORITY_SIZE: usize = 32;

/// Proof source indicator
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PartialPublicProofSource {
    /// Proof data is included inline in instruction data
    Inline = 0,
    /// Proof data is read from a ChadBuffer account
    Buffer = 1,
}

impl PartialPublicProofSource {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(PartialPublicProofSource::Inline),
            1 => Some(PartialPublicProofSource::Buffer),
            _ => None,
        }
    }
}

/// Spend partial public instruction data (UltraHonk proof - variable size)
///
/// ## Inline Mode (proof_source=0)
/// Layout:
/// - proof_source: u8 (0)
/// - proof_len: u32 (4 bytes, LE)
/// - proof: [u8; proof_len] - UltraHonk proof
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - public_amount: u64
/// - change_commitment: [u8; 32]
/// - recipient: [u8; 32]
/// - vk_hash: [u8; 32]
///
/// ## Buffer Mode (proof_source=1)
/// Layout:
/// - proof_source: u8 (1)
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - public_amount: u64
/// - change_commitment: [u8; 32]
/// - recipient: [u8; 32]
/// - vk_hash: [u8; 32]
/// - ephemeral_pub_change: [u8; 33] - Grumpkin pubkey for change stealth announcement
/// - encrypted_amount_change: [u8; 8] - XOR encrypted change amount
/// (proof is read from ChadBuffer account passed as additional account)
pub struct SpendPartialPublicData<'a> {
    pub proof_source: PartialPublicProofSource,
    pub proof: Option<&'a [u8]>,
    pub root: &'a [u8; 32],
    pub nullifier_hash: &'a [u8; 32],
    pub public_amount: u64,
    pub change_commitment: &'a [u8; 32],
    pub recipient: &'a [u8; 32],
    pub vk_hash: &'a [u8; 32],
    /// Grumpkin ephemeral pubkey for change stealth announcement (33 bytes compressed)
    pub ephemeral_pub_change: [u8; 33],
    /// XOR encrypted change amount (8 bytes)
    pub encrypted_amount_change: [u8; 8],
}

impl<'a> SpendPartialPublicData<'a> {
    /// Minimum size for inline mode: proof_source(1) + proof_len(4) + root(32) + nullifier(32) + amount(8) + change(32) + recipient(32) + vk_hash(32) + ephemeral_pub_change(33) + encrypted_amount_change(8) = 214 bytes + proof
    pub const MIN_SIZE_INLINE: usize = 1 + 4 + 32 + 32 + 8 + 32 + 32 + 32 + 33 + 8;

    /// Minimum size for buffer mode: proof_source(1) + root(32) + nullifier(32) + amount(8) + change(32) + recipient(32) + vk_hash(32) + ephemeral_pub_change(33) + encrypted_amount_change(8) = 210 bytes
    pub const MIN_SIZE_BUFFER: usize = 1 + 32 + 32 + 8 + 32 + 32 + 32 + 33 + 8;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_source = PartialPublicProofSource::from_u8(data[0]).ok_or_else(|| {
            pinocchio::msg!("Invalid proof source");
            ProgramError::InvalidInstructionData
        })?;

        match proof_source {
            PartialPublicProofSource::Inline => Self::parse_inline(data),
            PartialPublicProofSource::Buffer => Self::parse_buffer(data),
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

        let expected_size = 1 + 4 + proof_len + 32 + 32 + 8 + 32 + 32 + 32 + 33 + 8;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[5..5 + proof_len];
        let mut offset = 5 + proof_len;

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

        let mut ephemeral_pub_change = [0u8; 33];
        ephemeral_pub_change.copy_from_slice(&data[offset..offset + 33]);
        offset += 33;

        let mut encrypted_amount_change = [0u8; 8];
        encrypted_amount_change.copy_from_slice(&data[offset..offset + 8]);

        Ok(Self {
            proof_source: PartialPublicProofSource::Inline,
            proof: Some(proof),
            root,
            nullifier_hash,
            public_amount,
            change_commitment,
            recipient,
            vk_hash,
            ephemeral_pub_change,
            encrypted_amount_change,
        })
    }

    fn parse_buffer(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_BUFFER {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 1; // Skip proof_source byte

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

        let mut ephemeral_pub_change = [0u8; 33];
        ephemeral_pub_change.copy_from_slice(&data[offset..offset + 33]);
        offset += 33;

        let mut encrypted_amount_change = [0u8; 8];
        encrypted_amount_change.copy_from_slice(&data[offset..offset + 8]);

        Ok(Self {
            proof_source: PartialPublicProofSource::Buffer,
            proof: None,
            root,
            nullifier_hash,
            public_amount,
            change_commitment,
            recipient,
            vk_hash,
            ephemeral_pub_change,
            encrypted_amount_change,
        })
    }
}

/// Spend partial public accounts
///
/// ## Inline Mode (11 accounts)
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
///
/// ## Buffer Mode (12 accounts - adds proof_buffer)
/// 11. proof_buffer (readonly) - ChadBuffer account containing proof data
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
    pub proof_buffer: Option<&'a AccountInfo>,
}

impl<'a> SpendPartialPublicAccounts<'a> {
    pub fn from_accounts(
        accounts: &'a [AccountInfo],
        use_buffer: bool,
    ) -> Result<Self, ProgramError> {
        let min_accounts = if use_buffer { 12 } else { 11 };
        if accounts.len() < min_accounts {
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
        let proof_buffer = if use_buffer {
            Some(&accounts[11])
        } else {
            None
        };

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
        })
    }
}

/// Process spend partial public instruction (UltraHonk proof)
///
/// Claims part of a commitment to a public wallet, with change returned as a new commitment.
/// Amount conservation: input_amount == public_amount + change_amount (enforced by ZK proof)
///
/// Supports both inline proofs and ChadBuffer references.
pub fn process_spend_partial_public(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse instruction data first to determine proof source
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let use_buffer = data[0] == PartialPublicProofSource::Buffer as u8;

    let accounts = SpendPartialPublicAccounts::from_accounts(accounts, use_buffer)?;
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

    // Verify stealth announcement PDA for change output
    // Use bytes 1-32 of ephemeral_pub (skip prefix byte) - max seed length is 32 bytes
    let stealth_seeds: &[&[u8]] = &[StealthAnnouncement::SEED, &ix_data.ephemeral_pub_change[1..33]];
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
    let (pool_bump, min_deposit, total_shielded) = {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (pool.bump, pool.min_deposit(), pool.total_shielded())
    };

    // Validate public amount bounds
    if ix_data.public_amount < min_deposit {
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

    // Verify UltraHonk proof via CPI (after nullifier is claimed)
    // Get proof bytes and verify (either inline or from ChadBuffer)
    match ix_data.proof_source {
        PartialPublicProofSource::Inline => {
            let proof = ix_data.proof.ok_or(ProgramError::InvalidInstructionData)?;

            pinocchio::msg!("Verifying UltraHonk partial public proof (inline) via CPI...");

            verify_ultrahonk_spend_partial_public_proof(
                accounts.ultrahonk_verifier,
                proof,
                ix_data.root,
                ix_data.nullifier_hash,
                ix_data.public_amount,
                ix_data.change_commitment,
                ix_data.recipient,
                ix_data.vk_hash,
            ).map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
        PartialPublicProofSource::Buffer => {
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

            pinocchio::msg!("Verifying UltraHonk partial public proof (buffer) via CPI...");

            verify_ultrahonk_spend_partial_public_proof(
                accounts.ultrahonk_verifier,
                proof,
                ix_data.root,
                ix_data.nullifier_hash,
                ix_data.public_amount,
                ix_data.change_commitment,
                ix_data.recipient,
                ix_data.vk_hash,
            ).map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
    }

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
            &ix_data.ephemeral_pub_change[1..33],
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
    {
        let mut ann_data = accounts.stealth_announcement_change.try_borrow_mut_data()?;
        let announcement = StealthAnnouncement::init(&mut ann_data)?;

        announcement.bump = stealth_bump;
        announcement.ephemeral_pub = ix_data.ephemeral_pub_change;
        announcement.set_encrypted_amount(ix_data.encrypted_amount_change);
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
