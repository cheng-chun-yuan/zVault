//! Claim instruction (Groth16 - Client-Side ZK)
//!
//! Claims a unified commitment to a public Solana wallet.
//! Input:  Commitment = Poseidon2(pub_key_x, amount)
//! Output: zkBTC transferred to recipient's ATA (amount revealed)
//!
//! ZK Proof: Groth16 via Sunspot (generated in browser via nargo + sunspot)
//! Proof size: 388 bytes (fits inline in transaction data)
//!
//! Flow:
//! 1. User generates Groth16 proof client-side (no backend)
//! 2. Proof is included inline in instruction data (388 bytes)
//! 3. On-chain Groth16 verification via BN254 precompiles (~200k CU)
//! 4. Nullifier is recorded (prevents double-spend)
//! 5. zkBTC is transferred from pool vault to recipient's ATA

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::error::ZVaultError;
use crate::state::{CircuitType, CommitmentTree, NullifierOperationType, PoolState, VkRegistry};
use crate::utils::{
    parse_u32_le, parse_u64_le, read_bytes32, transfer_zbtc,
    validate_account_writable, validate_program_owner, validate_token_2022_owner,
    validate_token_program_key, verify_and_create_nullifier,
};
use crate::shared::crypto::groth16::parse_sunspot_proof;
use crate::shared::cpi::verify_groth16_proof_components;

/// Claim instruction data (Groth16 proof inline)
///
/// Layout:
/// - proof_len: u32 LE (4 bytes) - Length of proof data
/// - proof: [u8; N] - Groth16 proof (~388 bytes including public inputs)
/// - root: [u8; 32] - Merkle tree root
/// - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
/// - amount_sats: u64 LE (8 bytes) - Amount to claim (revealed)
/// - recipient: [u8; 32] - Recipient Solana wallet address
/// - vk_hash: [u8; 32] - Verification key hash
///
/// Minimum size: 4 + 260 + 32 + 32 + 8 + 32 + 32 = 400 bytes
pub struct ClaimData<'a> {
    /// Raw proof bytes (includes public inputs)
    pub proof_bytes: &'a [u8],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub amount_sats: u64,
    pub recipient: [u8; 32],
    pub vk_hash: [u8; 32],
}

impl<'a> ClaimData<'a> {
    /// Minimum data size (proof_len + min_proof + root + nullifier + amount + recipient + vk_hash)
    pub const MIN_SIZE: usize = 4 + 260 + 32 + 32 + 8 + 32 + 32;

    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::MIN_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        let mut offset = 0;

        // Parse proof length
        let proof_len = parse_u32_le(data, &mut offset)? as usize;

        // Validate proof length
        if proof_len < 260 || proof_len > 1024 {
            return Err(ZVaultError::InvalidProofSize.into());
        }

        // Validate total data size
        let expected_size = 4 + proof_len + 32 + 32 + 8 + 32 + 32;
        if data.len() < expected_size {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Extract proof bytes (don't copy, just reference)
        let proof_bytes = &data[offset..offset + proof_len];
        offset += proof_len;

        let root = read_bytes32(data, &mut offset)?;
        let nullifier_hash = read_bytes32(data, &mut offset)?;
        let amount_sats = parse_u64_le(data, &mut offset)?;
        let recipient = read_bytes32(data, &mut offset)?;
        let vk_hash = read_bytes32(data, &mut offset)?;

        Ok(Self {
            proof_bytes,
            root,
            nullifier_hash,
            amount_sats,
            recipient,
            vk_hash,
        })
    }
}

/// Claim accounts (12 accounts for inline Groth16 with VK registry)
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
/// 9. vk_registry (readonly) - VK registry PDA for claim circuit
/// 10. sunspot_verifier - Sunspot verifier program (reserved for future CPI)
/// 11. instructions_sysvar (readonly) - Instructions sysvar (reserved for future use)
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
    pub vk_registry: &'a AccountInfo,
    pub sunspot_verifier: &'a AccountInfo,
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
        let vk_registry = &accounts[9];
        let sunspot_verifier = &accounts[10];
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
            vk_registry,
            sunspot_verifier,
            instructions_sysvar,
        })
    }
}

/// Process claim instruction (Groth16 proof inline)
///
/// Claims zkBTC directly to a Solana wallet, revealing the amount.
/// Groth16 proof is verified inline using BN254 precompiles.
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
    validate_program_owner(accounts.vk_registry, program_id)?;
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

    // Validate VK registry and get VK hash
    let stored_vk_hash = {
        let vk_data = accounts.vk_registry.try_borrow_data()?;
        let registry = VkRegistry::from_bytes(&vk_data)?;

        // Verify this is the claim circuit VK
        if registry.get_circuit_type() != Some(CircuitType::Claim) {
            pinocchio::msg!("VK registry is not for claim circuit");
            return Err(ZVaultError::InvalidCircuitType.into());
        }

        *registry.get_vk_hash()
    };

    // Verify VK hash matches what was provided
    if stored_vk_hash != ix_data.vk_hash {
        pinocchio::msg!("VK hash mismatch");
        return Err(ZVaultError::InvalidVkHash.into());
    }

    // Parse Groth16 proof
    pinocchio::msg!("Parsing Groth16 proof...");
    let (proof_a, proof_b, proof_c, public_inputs) = parse_sunspot_proof(ix_data.proof_bytes)?;

    // Verify public inputs match expected values
    // Claim circuit public inputs: [merkle_root, nullifier_hash, amount, recipient]
    if public_inputs.len() < 4 {
        pinocchio::msg!("Insufficient public inputs");
        return Err(ZVaultError::PublicInputsMismatch.into());
    }

    // Check merkle root
    if public_inputs[0] != ix_data.root {
        pinocchio::msg!("Merkle root mismatch in public inputs");
        return Err(ZVaultError::PublicInputsMismatch.into());
    }

    // Check nullifier hash
    if public_inputs[1] != ix_data.nullifier_hash {
        pinocchio::msg!("Nullifier hash mismatch in public inputs");
        return Err(ZVaultError::PublicInputsMismatch.into());
    }

    // Verify Groth16 proof via CPI to Sunspot verifier
    pinocchio::msg!("Verifying Groth16 proof via Sunspot verifier CPI...");

    // Build public inputs array for verification
    let pi_array: [[u8; 32]; 4] = [
        public_inputs[0],
        public_inputs[1],
        public_inputs[2],
        public_inputs[3],
    ];

    // Call Sunspot verifier via CPI
    verify_groth16_proof_components(
        accounts.sunspot_verifier,
        &proof_a,
        &proof_b,
        &proof_c,
        &pi_array,
    ).map_err(|e| {
        pinocchio::msg!("Groth16 proof verification failed");
        e
    })?;

    pinocchio::msg!("Groth16 proof verified successfully");

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

    pinocchio::msg!("Claimed sats via Groth16 proof");

    Ok(())
}
