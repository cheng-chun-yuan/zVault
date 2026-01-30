//! Spend Partial Public instruction (UltraHonk - Client-Side ZK)
//!
//! Claims part of a commitment to a public wallet, with change returned as a new commitment.
//!
//! Input:  Unified Commitment = Poseidon2(pub_key_x, amount)
//! Output: Public transfer + Change Commitment = Poseidon2(change_pub_key_x, change_amount)
//!
//! ZK Proof: UltraHonk (generated in browser via bb.js or mobile via mopro)

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
    transfer_zbtc, verify_ultrahonk_spend_partial_public_proof,
    validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key, MAX_ULTRAHONK_PROOF_SIZE,
};

/// Spend partial public instruction data (UltraHonk proof - variable size)
///
/// Layout:
/// - proof_len: u32 (4 bytes, LE)
/// - proof: [u8; proof_len] - UltraHonk proof
/// - root: [u8; 32]
/// - nullifier_hash: [u8; 32]
/// - public_amount: u64
/// - change_commitment: [u8; 32]
/// - recipient: [u8; 32]
/// - vk_hash: [u8; 32]
pub struct SpendPartialPublicData<'a> {
    pub proof: &'a [u8],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub public_amount: u64,
    pub change_commitment: [u8; 32],
    pub recipient: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> SpendPartialPublicData<'a> {
    /// Minimum size: proof_len(4) + root(32) + nullifier(32) + amount(8) + change(32) + recipient(32) + vk_hash(32) = 172 bytes + proof
    pub const MIN_SIZE: usize = 4 + 32 + 32 + 8 + 32 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse proof length
        let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let expected_size = 4 + proof_len + 32 + 32 + 8 + 32 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof = &data[4..4 + proof_len];
        let mut offset = 4 + proof_len;

        let mut root = [0u8; 32];
        root.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let public_amount = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut change_commitment = [0u8; 32];
        change_commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut recipient = [0u8; 32];
        recipient.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[offset..offset + 32]);

        Ok(Self {
            proof,
            root,
            nullifier_hash,
            public_amount,
            change_commitment,
            recipient,
            vk_hash,
        })
    }
}

/// Spend partial public accounts
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
}

impl<'a> SpendPartialPublicAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 10 {
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
        })
    }
}

/// Process spend partial public instruction (UltraHonk proof)
///
/// Claims part of a commitment to a public wallet, with change returned as a new commitment.
/// Amount conservation: input_amount == public_amount + change_amount (enforced by ZK proof)
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

        if !tree.is_valid_root(&ix_data.root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.nullifier_hash];
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
    pinocchio::msg!("Verifying UltraHonk partial public proof via CPI...");

    verify_ultrahonk_spend_partial_public_proof(
        accounts.ultrahonk_verifier,
        ix_data.proof,
        &ix_data.root,
        &ix_data.nullifier_hash,
        ix_data.public_amount,
        &ix_data.change_commitment,
        &ix_data.recipient,
        &ix_data.vk_hash,
    ).map_err(|_| {
        pinocchio::msg!("UltraHonk proof verification failed");
        ZVaultError::ZkVerificationFailed
    })?;

    // Initialize nullifier record
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(&ix_data.recipient);
        nullifier.set_operation_type(NullifierOperationType::Transfer);
    }

    // Add change commitment to tree
    {
        let mut tree_data = accounts.commitment_tree.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        if tree.next_index() >= (1u64 << 20) {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&ix_data.change_commitment)?;
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
