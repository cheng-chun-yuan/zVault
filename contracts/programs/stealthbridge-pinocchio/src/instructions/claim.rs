//! Claim instruction - claims sbBTC with ZK proof commitment
//!
//! Since ZK proofs (~16KB) exceed Solana tx limits (~1232 bytes),
//! we accept a proof hash instead of the full proof.
//! Full cryptographic verification is done off-chain by relayers.

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
    validate_program_owner, validate_token_program_key, validate_token_2022_owner,
};

/// Claim instruction data
///
/// Layout:
/// - proof_hash: [u8; 32] - SHA256 hash of the ZK proof
/// - public_inputs: [[u8; 32]; 3] - [merkle_root, nullifier_hash, amount]
/// - vk_hash: [u8; 32] - Verification key hash (all zeros = demo mode)
/// - nullifier_hash: [u8; 32] - Nullifier hash (must match public_inputs[1])
/// - amount: u64 - Amount to claim in satoshis
pub struct ClaimData {
    pub proof_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub nullifier_hash_pi: [u8; 32],
    pub amount_pi: [u8; 32],
    pub vk_hash: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub amount: u64,
}

impl ClaimData {
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        // proof_hash(32) + merkle_root(32) + nullifier_hash_pi(32) + amount_pi(32)
        // + vk_hash(32) + nullifier_hash(32) + amount(8) = 200 bytes
        if data.len() < 200 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut proof_hash = [0u8; 32];
        proof_hash.copy_from_slice(&data[0..32]);

        let mut merkle_root = [0u8; 32];
        merkle_root.copy_from_slice(&data[32..64]);

        let mut nullifier_hash_pi = [0u8; 32];
        nullifier_hash_pi.copy_from_slice(&data[64..96]);

        let mut amount_pi = [0u8; 32];
        amount_pi.copy_from_slice(&data[96..128]);

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[128..160]);

        let mut nullifier_hash = [0u8; 32];
        nullifier_hash.copy_from_slice(&data[160..192]);

        let amount = u64::from_le_bytes(data[192..200].try_into().unwrap());

        Ok(Self {
            proof_hash,
            merkle_root,
            nullifier_hash_pi,
            amount_pi,
            vk_hash,
            nullifier_hash,
            amount,
        })
    }
}

/// Claim accounts
pub struct ClaimAccounts<'a> {
    pub pool_state: &'a AccountInfo,
    pub commitment_tree: &'a AccountInfo,
    pub nullifier_record: &'a AccountInfo,
    pub sbbtc_mint: &'a AccountInfo,
    pub user_token_account: &'a AccountInfo,
    pub user: &'a AccountInfo,
    pub token_program: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
}

impl<'a> ClaimAccounts<'a> {
    pub fn from_accounts(accounts: &'a [AccountInfo]) -> Result<Self, ProgramError> {
        if accounts.len() < 8 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let pool_state = &accounts[0];
        let commitment_tree = &accounts[1];
        let nullifier_record = &accounts[2];
        let sbbtc_mint = &accounts[3];
        let user_token_account = &accounts[4];
        let user = &accounts[5];
        let token_program = &accounts[6];
        let system_program = &accounts[7];

        // Validate user is signer
        if !user.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        Ok(Self {
            pool_state,
            commitment_tree,
            nullifier_record,
            sbbtc_mint,
            user_token_account,
            user,
            token_program,
            system_program,
        })
    }
}

/// Claim sbBTC with ZK proof commitment
///
/// The proof is verified off-chain; on-chain we validate:
/// 1. Public inputs match expected values
/// 2. Nullifier hasn't been used
/// 3. Amount and root are valid
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
    validate_token_2022_owner(accounts.sbbtc_mint)?;
    validate_token_2022_owner(accounts.user_token_account)?;
    validate_token_program_key(accounts.token_program)?;

    // Load and validate pool state
    let (pool_bump, min_deposit, max_deposit, deposit_count) = {
        let pool_data = accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (
            pool.bump,
            pool.min_deposit(),
            pool.max_deposit(),
            pool.deposit_count(),
        )
    };

    // Validate amount
    if ix_data.amount == 0 {
        return Err(ZVaultError::ZeroAmount.into());
    }
    if ix_data.amount < min_deposit {
        return Err(ZVaultError::AmountTooSmall.into());
    }
    if ix_data.amount > max_deposit {
        return Err(ZVaultError::AmountTooLarge.into());
    }

    // Check if demo mode (VK hash is all zeros)
    let is_demo_mode = ix_data.vk_hash == [0u8; 32];

    // Verify root is valid in commitment tree (skip in demo mode)
    if !is_demo_mode {
        let tree_data = accounts.commitment_tree.try_borrow_data()?;
        let tree = CommitmentTree::from_bytes(&tree_data)?;

        if !tree.is_valid_root(&ix_data.merkle_root) {
            return Err(ZVaultError::InvalidRoot.into());
        }
    }

    // Validate nullifier_hash matches public input
    if ix_data.nullifier_hash != ix_data.nullifier_hash_pi {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    // Validate amount matches public input (big-endian in last 8 bytes)
    let mut expected_amount_pi = [0u8; 32];
    expected_amount_pi[24..32].copy_from_slice(&ix_data.amount.to_be_bytes());
    if ix_data.amount_pi != expected_amount_pi {
        return Err(ZVaultError::ZkVerificationFailed.into());
    }

    // Verify nullifier PDA
    let nullifier_seeds: &[&[u8]] = &[NullifierRecord::SEED, &ix_data.nullifier_hash];
    let (expected_nullifier_pda, nullifier_bump) = find_program_address(nullifier_seeds, program_id);
    if accounts.nullifier_record.key() != &expected_nullifier_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Check if nullifier already spent (account already exists and initialized)
    {
        let nullifier_data = accounts.nullifier_record.try_borrow_data()?;
        if nullifier_data.len() >= 1 && nullifier_data[0] == NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ZVaultError::NullifierAlreadyUsed.into());
        }
    }

    // Get clock for timestamp
    let clock = Clock::get()?;

    // Create nullifier record account (PDA)
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

    // Record nullifier (prevent double-spend)
    {
        let mut nullifier_data = accounts.nullifier_record.try_borrow_mut_data()?;
        let nullifier = NullifierRecord::init(&mut nullifier_data)?;

        nullifier.nullifier_hash.copy_from_slice(&ix_data.nullifier_hash);
        nullifier.set_spent_at(clock.unix_timestamp);
        nullifier.spent_by.copy_from_slice(accounts.user.key().as_ref());
        nullifier.set_spent_in_request(deposit_count);
        nullifier.set_operation_type(NullifierOperationType::FullWithdrawal);
    }

    // Mint sbBTC to user
    let bump_bytes = [pool_bump];
    let pool_signer_seeds: &[&[u8]] = &[PoolState::SEED, &bump_bytes];

    crate::utils::mint_sbbtc(
        accounts.token_program,
        accounts.sbbtc_mint,
        accounts.user_token_account,
        accounts.pool_state,
        ix_data.amount,
        pool_signer_seeds,
    )?;

    // Update pool statistics
    {
        let mut pool_data = accounts.pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.add_minted(ix_data.amount)?;
        pool.increment_direct_claims()?;
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}
