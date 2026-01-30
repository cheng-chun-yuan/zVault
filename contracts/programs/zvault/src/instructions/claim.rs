//! Claim instruction (UltraHonk - Client-Side ZK)
//!
//! Claims a unified commitment to a public Solana wallet.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: zkBTC transferred to recipient's ATA (amount revealed)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)
//!
//! ## Proof Sources
//! - **Inline (proof_source=0)**: Proof data included directly in instruction data
//! - **Buffer (proof_source=1)**: Proof read from ChadBuffer account (for large proofs)
//!
//! Flow:
//! 1. User generates UltraHonk proof client-side (no backend)
//! 2. For large proofs: Upload via ChadBuffer (external program)
//! 3. Contract verifies proof via CPI to ultrahonk-verifier
//! 4. Nullifier is recorded (prevents double-spend)
//! 5. zkBTC is transferred from pool vault to recipient's ATA

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
    NULLIFIER_RECORD_DISCRIMINATOR,
};
use crate::utils::{
    transfer_zbtc, validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key, verify_ultrahonk_claim_proof, MAX_ULTRAHONK_PROOF_SIZE,
};

/// ChadBuffer authority size (first 32 bytes of account data)
const CHADBUFFER_AUTHORITY_SIZE: usize = 32;

/// Proof source indicator
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ProofSource {
    /// Proof data is included inline in instruction data
    Inline = 0,
    /// Proof data is read from a ChadBuffer account
    Buffer = 1,
}

impl ProofSource {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(ProofSource::Inline),
            1 => Some(ProofSource::Buffer),
            _ => None,
        }
    }
}

/// Claim instruction data (UltraHonk proof - variable size)
///
/// ## Inline Mode (proof_source=0)
/// Layout:
/// - proof_source: u8 (0)
/// - proof_len: u32 (4 bytes, LE) - Length of proof bytes
/// - proof: [u8; proof_len] - UltraHonk proof (8-16KB typical)
/// - root: [u8; 32] - Merkle tree root
/// - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
/// - amount_sats: u64 - Amount to claim (revealed)
/// - recipient: [u8; 32] - Recipient Solana wallet address
/// - vk_hash: [u8; 32] - Verification key hash
///
/// ## Buffer Mode (proof_source=1)
/// Layout:
/// - proof_source: u8 (1)
/// - root: [u8; 32] - Merkle tree root
/// - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
/// - amount_sats: u64 - Amount to claim (revealed)
/// - recipient: [u8; 32] - Recipient Solana wallet address
/// - vk_hash: [u8; 32] - Verification key hash
/// (proof is read from ChadBuffer account passed as additional account)
pub struct ClaimData<'a> {
    pub proof_source: ProofSource,
    pub proof: Option<&'a [u8]>,
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub amount_sats: u64,
    pub recipient: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> ClaimData<'a> {
    /// Minimum data size for inline mode: proof_source(1) + proof_len(4) + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32) = 141 bytes + proof
    pub const MIN_SIZE_INLINE: usize = 1 + 4 + 32 + 32 + 8 + 32 + 32;

    /// Minimum data size for buffer mode: proof_source(1) + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32) = 137 bytes
    pub const MIN_SIZE_BUFFER: usize = 1 + 32 + 32 + 8 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_source = ProofSource::from_u8(data[0]).ok_or_else(|| {
            pinocchio::msg!("Invalid proof source");
            ProgramError::InvalidInstructionData
        })?;

        match proof_source {
            ProofSource::Inline => Self::parse_inline(data),
            ProofSource::Buffer => Self::parse_buffer(data),
        }
    }

    fn parse_inline(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE_INLINE {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse proof length (after proof_source byte)
        let proof_len = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;

        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            pinocchio::msg!("Proof too large");
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 1 + 4 + proof_len + 32 + 32 + 8 + 32 + 32;
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

        let amount_sats = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut recipient = [0u8; 32];
        recipient.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof_source: ProofSource::Inline,
            proof: Some(proof),
            root,
            nullifier_hash,
            amount_sats,
            recipient,
            vk_hash,
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

        let amount_sats = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut recipient = [0u8; 32];
        recipient.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof_source: ProofSource::Buffer,
            proof: None,
            root,
            nullifier_hash,
            amount_sats,
            recipient,
            vk_hash,
        })
    }
}

/// Claim accounts
///
/// ## Inline Mode (10 accounts)
/// 0. pool_state (writable) - Pool state PDA
/// 1. commitment_tree (readonly) - Commitment tree for root validation
/// 2. nullifier_record (writable) - Nullifier PDA (created)
/// 3. zbtc_mint (writable) - zBTC Token-2022 mint
/// 4. pool_vault (writable) - Pool vault holding zBTC
/// 5. recipient_ata (writable) - Recipient's associated token account
/// 6. user (signer) - Transaction fee payer
/// 7. token_program - Token-2022 program
/// 8. system_program - System program
/// 9. ultrahonk_verifier - UltraHonk verifier program
///
/// ## Buffer Mode (11 accounts - adds proof_buffer)
/// 10. proof_buffer (readonly) - ChadBuffer account containing proof data
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
    pub proof_buffer: Option<&'a AccountInfo>,
}

impl<'a> ClaimAccounts<'a> {
    pub fn from_accounts(
        accounts: &'a [AccountInfo],
        use_buffer: bool,
    ) -> Result<Self, ProgramError> {
        let min_accounts = if use_buffer { 11 } else { 10 };
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
        let proof_buffer = if use_buffer {
            Some(&accounts[10])
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
            proof_buffer,
        })
    }
}

/// Process claim instruction (UltraHonk proof)
///
/// Claims zkBTC directly to a Solana wallet, revealing the amount.
/// Proof is verified via CPI to ultrahonk-verifier program.
/// Supports both inline proofs and ChadBuffer references.
pub fn process_claim(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse instruction data first to determine proof source
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let use_buffer = data[0] == ProofSource::Buffer as u8;

    let accounts = ClaimAccounts::from_accounts(accounts, use_buffer)?;
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

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.nullifier_hash];
    let (expected_nullifier_pda, nullifier_bump) =
        find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent (account already exists and initialized)
    {
        let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
        if !nullifier_data.is_empty() && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Get clock for timestamp
    let clock = Clock::get()?;

    // SECURITY: Create nullifier record FIRST to prevent race conditions
    // If account already exists, CreateAccount will fail (double-spend prevented)
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

    // Get proof bytes and verify (either inline or from ChadBuffer)
    match ix_data.proof_source {
        ProofSource::Inline => {
            let proof = ix_data.proof.ok_or(ProgramError::InvalidInstructionData)?;

            pinocchio::msg!("Verifying UltraHonk proof (inline) via CPI...");

            verify_ultrahonk_claim_proof(
                accounts.ultrahonk_verifier,
                proof,
                &ix_data.root,
                &ix_data.nullifier_hash,
                ix_data.amount_sats,
                &ix_data.recipient,
                &ix_data.vk_hash,
            )
            .map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
        ProofSource::Buffer => {
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

            pinocchio::msg!("Verifying UltraHonk proof (buffer) via CPI...");

            verify_ultrahonk_claim_proof(
                accounts.ultrahonk_verifier,
                proof,
                &ix_data.root,
                &ix_data.nullifier_hash,
                ix_data.amount_sats,
                &ix_data.recipient,
                &ix_data.vk_hash,
            )
            .map_err(|_| {
                pinocchio::msg!("UltraHonk proof verification failed");
                ZVaultError::ZkVerificationFailed
            })?;
        }
    }

    pinocchio::msg!("UltraHonk proof verified successfully");

    // Initialize nullifier record
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier
            .nullifier_hash
            .copy_from_slice(&ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(&ix_data.recipient);
        nullifier.set_operation_type(NullifierOperationType::Transfer);
    }

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
