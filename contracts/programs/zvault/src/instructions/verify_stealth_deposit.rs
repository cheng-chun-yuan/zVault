//! Verify Stealth Deposit instruction (Pinocchio)
//!
//! Combines verify_deposit + announce_stealth_v2 atomically.
//! When a sender deposits BTC to a recipient's stealth address,
//! after SPV verification the commitment goes directly to the recipient
//! with a stealth announcement - no separate claim step needed.
//!
//! Flow:
//! 1. Sender specifies recipient's stealth address (viewing + spending pubkeys)
//! 2. Sender sends BTC with stealth data in OP_RETURN
//! 3. verify_stealth_deposit → adds to tree + creates stealth announcement
//! 4. Recipient scans, finds deposit, can spend immediately (no claim step)
//!
//! OP_RETURN Format (SIMPLIFIED - 99 bytes, down from 142):
//! - [0]      Magic: 0x7A ('z' for zVault stealth)
//! - [1]      Version: 2
//! - [2-33]   ephemeral_view_pub (32 bytes, X25519)
//! - [34-66]  ephemeral_spend_pub (33 bytes, Grumpkin compressed)
//! - [67-98]  commitment (32 bytes, Poseidon2 hash)
//!
//! SECURITY IMPROVEMENTS:
//! - Removed encrypted_amount: BTC amount is public, stored directly from verified tx
//! - Removed encrypted_random: Ephemeral key uniqueness is sufficient
//! - Total savings: 43 bytes in OP_RETURN, 40 bytes on-chain

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::error::ZVaultError;
use crate::state::{
    BitcoinLightClient, BlockHeader, CommitmentTree, DepositRecord,
    PoolState, StealthAnnouncementV2, TxMerkleProof, REQUIRED_CONFIRMATIONS,
};
use crate::utils::bitcoin::{compute_tx_hash, ParsedTransaction};
use crate::utils::chadbuffer::read_transaction_from_buffer;
use crate::utils::validate_program_owner;

/// Magic byte for stealth OP_RETURN
pub const STEALTH_OP_RETURN_MAGIC: u8 = 0x7A; // 'z' for zVault stealth

/// Current version for stealth OP_RETURN format (simplified)
pub const STEALTH_OP_RETURN_VERSION: u8 = 2;

/// Legacy version for backward compatibility
pub const STEALTH_OP_RETURN_VERSION_V1: u32 = 1;

/// Total size of stealth OP_RETURN data (SIMPLIFIED - 99 bytes)
/// = 1 (magic) + 1 (version) + 32 (view pub) + 33 (spend pub) + 32 (commitment)
pub const STEALTH_OP_RETURN_SIZE: usize = 99;

/// Legacy size for V1 format
pub const STEALTH_OP_RETURN_SIZE_V1: usize = 142;

/// Parsed stealth data from OP_RETURN (SIMPLIFIED)
pub struct StealthOpReturnData {
    pub version: u8,
    pub ephemeral_view_pub: [u8; 32],
    pub ephemeral_spend_pub: [u8; 33],
    pub commitment: [u8; 32],
}

impl StealthOpReturnData {
    /// Parse stealth data from OP_RETURN output data (SIMPLIFIED FORMAT)
    ///
    /// Supports both V2 (simplified 99 bytes) and V1 (legacy 142 bytes) formats.
    /// Expects data AFTER the OP_RETURN opcode and push length.
    pub fn parse(data: &[u8]) -> Result<Self, ProgramError> {
        // Check minimum size for V2
        if data.len() < STEALTH_OP_RETURN_SIZE {
            return Err(ZVaultError::InvalidStealthOpReturn.into());
        }

        // Check magic byte
        if data[0] != STEALTH_OP_RETURN_MAGIC {
            return Err(ZVaultError::InvalidStealthOpReturn.into());
        }

        // Parse version (1 byte in V2, first byte of 4-byte field in V1)
        let version = data[1];

        if version == STEALTH_OP_RETURN_VERSION {
            // V2: Simplified format (99 bytes)
            // Layout: magic(1) + version(1) + view_pub(32) + spend_pub(33) + commitment(32)

            let mut ephemeral_view_pub = [0u8; 32];
            ephemeral_view_pub.copy_from_slice(&data[2..34]);

            let mut ephemeral_spend_pub = [0u8; 33];
            ephemeral_spend_pub.copy_from_slice(&data[34..67]);

            let mut commitment = [0u8; 32];
            commitment.copy_from_slice(&data[67..99]);

            Ok(Self {
                version,
                ephemeral_view_pub,
                ephemeral_spend_pub,
                commitment,
            })
        } else if data.len() >= STEALTH_OP_RETURN_SIZE_V1 {
            // V1: Legacy format (142 bytes) - version is 4 bytes LE
            let version_v1 = u32::from_le_bytes(data[1..5].try_into().unwrap());
            if version_v1 != STEALTH_OP_RETURN_VERSION_V1 {
                return Err(ZVaultError::InvalidStealthOpReturn.into());
            }

            let mut ephemeral_view_pub = [0u8; 32];
            ephemeral_view_pub.copy_from_slice(&data[5..37]);

            let mut ephemeral_spend_pub = [0u8; 33];
            ephemeral_spend_pub.copy_from_slice(&data[37..70]);

            // Skip encrypted_amount (70..78) and encrypted_random (78..110)
            // These are no longer used in V2

            let mut commitment = [0u8; 32];
            commitment.copy_from_slice(&data[110..142]);

            Ok(Self {
                version: 1,
                ephemeral_view_pub,
                ephemeral_spend_pub,
                commitment,
            })
        } else {
            Err(ZVaultError::InvalidStealthOpReturn.into())
        }
    }
}

/// Verify a Bitcoin stealth deposit via SPV proof and create announcement
///
/// Combines verify_deposit + announce_stealth_v2 atomically.
///
/// # Accounts
/// 0. `[writable]` Pool state
/// 1. `[]` Light client
/// 2. `[]` Block header (at block_height)
/// 3. `[writable]` Commitment tree
/// 4. `[writable]` Deposit record (PDA to be created, seeded by txid)
/// 5. `[writable]` Stealth announcement (PDA to be created, seeded by ephemeral_view_pub)
/// 6. `[]` Transaction buffer (ChadBuffer)
/// 7. `[signer]` Submitter (pays for storage)
/// 8. `[]` System program
///
/// # Instruction data
/// - txid: [u8; 32]
/// - block_height: u64
/// - expected_value: u64
/// - transaction_size: u32
/// - merkle_proof: TxMerkleProof (variable length)
pub fn process_verify_stealth_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state_info = &accounts[0];
    let light_client_info = &accounts[1];
    let block_header_info = &accounts[2];
    let commitment_tree_info = &accounts[3];
    let deposit_record_info = &accounts[4];
    let stealth_announcement_info = &accounts[5];
    let tx_buffer_info = &accounts[6];
    let submitter = &accounts[7];
    let _system_program = &accounts[8];

    // Validate accounts
    validate_program_owner(pool_state_info, program_id)?;
    validate_program_owner(light_client_info, program_id)?;
    validate_program_owner(block_header_info, program_id)?;
    validate_program_owner(commitment_tree_info, program_id)?;

    if !submitter.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data header
    if data.len() < 52 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut txid = [0u8; 32];
    txid.copy_from_slice(&data[0..32]);
    let block_height = u64::from_le_bytes(data[32..40].try_into().unwrap());
    let expected_value = u64::from_le_bytes(data[40..48].try_into().unwrap());
    let transaction_size = u32::from_le_bytes(data[48..52].try_into().unwrap());

    // Parse merkle proof from remaining data
    let merkle_proof = TxMerkleProof::parse(&data[52..])?;

    // Check pool is not paused and get bounds
    let (min_deposit, max_deposit) = {
        let pool_data = pool_state_info.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(ZVaultError::PoolPaused.into());
        }

        (pool.min_deposit(), pool.max_deposit())
    };

    // Verify block height matches the stored header
    let merkle_root = {
        let header_data = block_header_info.try_borrow_data()?;
        let header = BlockHeader::from_bytes(&header_data)?;

        if header.height() != block_height {
            return Err(ZVaultError::InvalidBlockHeader.into());
        }

        header.merkle_root
    };

    // Verify block has sufficient confirmations (6+)
    {
        let lc_data = light_client_info.try_borrow_data()?;
        let lc = BitcoinLightClient::from_bytes(&lc_data)?;

        let confirmations = lc.confirmations(block_height);
        if confirmations < REQUIRED_CONFIRMATIONS {
            return Err(ZVaultError::InsufficientConfirmations.into());
        }
    }

    // Read raw transaction from ChadBuffer account
    let buffer_data = tx_buffer_info
        .try_borrow_data()
        .map_err(|_| ZVaultError::InvalidBlockHeader)?;

    let raw_tx = read_transaction_from_buffer(&buffer_data, transaction_size as usize)?;

    // Verify transaction hash matches txid
    let computed_hash = compute_tx_hash(raw_tx);
    let mut computed_txid = computed_hash;
    computed_txid.reverse(); // txid is reversed hash

    if computed_txid != txid {
        return Err(ZVaultError::InvalidSpvProof.into());
    }

    // Verify the merkle proof
    if merkle_proof.txid != txid {
        return Err(ZVaultError::InvalidSpvProof.into());
    }
    if !merkle_proof.verify(&merkle_root) {
        return Err(ZVaultError::InvalidSpvProof.into());
    }

    // Parse transaction to extract outputs
    let parsed_tx = ParsedTransaction::parse(raw_tx)?;

    // Find stealth data from OP_RETURN output
    let stealth_data = parsed_tx
        .find_stealth_op_return()
        .ok_or(ZVaultError::StealthDataNotFound)?;

    // Find deposit output (the actual BTC payment)
    let deposit_output = parsed_tx
        .find_deposit_output()
        .ok_or(ZVaultError::InvalidSpvProof)?;

    // Verify amount matches and is within bounds
    if deposit_output.value != expected_value {
        return Err(ZVaultError::InvalidSpvProof.into());
    }
    if deposit_output.value < min_deposit {
        return Err(ZVaultError::AmountTooSmall.into());
    }
    if deposit_output.value > max_deposit {
        return Err(ZVaultError::AmountTooLarge.into());
    }

    // Derive deposit record PDA
    let (expected_deposit_pda, deposit_bump) = pinocchio::pubkey::find_program_address(
        &[DepositRecord::SEED, &txid],
        program_id,
    );

    if deposit_record_info.key() != &expected_deposit_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Derive stealth announcement PDA (seeded by ephemeral_view_pub)
    let (expected_stealth_pda, stealth_bump) = pinocchio::pubkey::find_program_address(
        &[StealthAnnouncementV2::SEED, &stealth_data.ephemeral_view_pub],
        program_id,
    );

    if stealth_announcement_info.key() != &expected_stealth_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create deposit record account
    let deposit_bump_bytes = [deposit_bump];
    let deposit_signer_seeds: [Seed; 3] = [
        Seed::from(DepositRecord::SEED),
        Seed::from(txid.as_slice()),
        Seed::from(&deposit_bump_bytes),
    ];
    let deposit_signer = [Signer::from(&deposit_signer_seeds)];

    CreateAccount {
        from: submitter,
        to: deposit_record_info,
        lamports: Rent::get()?.minimum_balance(DepositRecord::LEN),
        space: DepositRecord::LEN as u64,
        owner: program_id,
    }.invoke_signed(&deposit_signer)?;

    // Create stealth announcement account
    let stealth_bump_bytes = [stealth_bump];
    let stealth_signer_seeds: [Seed; 3] = [
        Seed::from(StealthAnnouncementV2::SEED),
        Seed::from(stealth_data.ephemeral_view_pub.as_slice()),
        Seed::from(&stealth_bump_bytes),
    ];
    let stealth_signer = [Signer::from(&stealth_signer_seeds)];

    CreateAccount {
        from: submitter,
        to: stealth_announcement_info,
        lamports: Rent::get()?.minimum_balance(StealthAnnouncementV2::SIZE),
        space: StealthAnnouncementV2::SIZE as u64,
        owner: program_id,
    }.invoke_signed(&stealth_signer)?;

    // Insert commitment into merkle tree
    let leaf_index = {
        let mut tree_data = commitment_tree_info.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        let index = tree.next_index();
        if index >= CommitmentTree::MAX_LEAVES as u64 {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&stealth_data.commitment)?;
        index
    };

    let clock = Clock::get()?;

    // Record the deposit
    {
        let mut deposit_data = deposit_record_info.try_borrow_mut_data()?;
        let deposit = DepositRecord::init(&mut deposit_data)?;

        deposit.commitment = stealth_data.commitment;
        deposit.set_amount_sats(deposit_output.value);
        deposit.btc_txid = txid;
        deposit.set_block_height(block_height);
        deposit.set_leaf_index(leaf_index);
        deposit.depositor.copy_from_slice(submitter.key());
        deposit.set_timestamp(clock.unix_timestamp);
        deposit.set_minted(false);
    }

    // Initialize stealth announcement with leaf_index and verified amount
    {
        let mut ann_data = stealth_announcement_info.try_borrow_mut_data()?;
        let announcement = StealthAnnouncementV2::init(&mut ann_data)?;

        announcement.bump = stealth_bump;
        announcement.ephemeral_view_pub = stealth_data.ephemeral_view_pub;
        announcement.ephemeral_spend_pub = stealth_data.ephemeral_spend_pub;
        // Store verified BTC amount directly (from SPV-verified transaction)
        // This is more secure than encrypted amount since it's verified on-chain
        announcement.set_amount_sats(deposit_output.value);
        announcement.commitment = stealth_data.commitment;
        announcement.set_leaf_index(leaf_index);
        announcement.set_created_at(clock.unix_timestamp);
    }

    // Update pool statistics
    {
        let mut pool_data = pool_state_info.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.increment_deposit_count()?;
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}
