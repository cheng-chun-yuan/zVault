//! Verify Bitcoin deposit instruction (Pinocchio)
//!
//! PERMISSIONLESS: Anyone can verify deposits via SPV proof.
//! Duplicate prevention via PDA seeds (txid-based).
//!
//! Flow:
//! 1. Raw tx data uploaded to ChadBuffer (off-chain)
//! 2. Call verify_deposit with buffer account
//! 3. Contract verifies: hash(raw_tx) == txid
//! 4. Contract verifies: SPV merkle proof
//! 5. Contract parses: OP_RETURN → extracts commitment
//! 6. Contract stores: commitment in deposit record

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
    PoolState, TxMerkleProof, REQUIRED_CONFIRMATIONS,
};
use crate::utils::bitcoin::{compute_tx_hash, ParsedTransaction};
use crate::utils::chadbuffer::read_transaction_from_buffer;
use crate::utils::validate_program_owner;

/// Verify a Bitcoin deposit via SPV proof (PERMISSIONLESS)
///
/// # Accounts
/// 0. `[writable]` Pool state
/// 1. `[]` Light client
/// 2. `[]` Block header (at block_height)
/// 3. `[writable]` Commitment tree
/// 4. `[writable]` Deposit record (PDA to be created, seeded by txid)
/// 5. `[]` Transaction buffer (ChadBuffer)
/// 6. `[signer]` Submitter (pays for storage)
/// 7. `[]` System program
///
/// # Instruction data
/// - txid: [u8; 32]
/// - block_height: u64
/// - expected_value: u64
/// - transaction_size: u32
/// - merkle_proof: TxMerkleProof (variable length)
pub fn process_verify_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 8 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state_info = &accounts[0];
    let light_client_info = &accounts[1];
    let block_header_info = &accounts[2];
    let commitment_tree_info = &accounts[3];
    let deposit_record_info = &accounts[4];
    let tx_buffer_info = &accounts[5];
    let submitter = &accounts[6];
    let _system_program = &accounts[7];

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

    // Find commitment from OP_RETURN output
    let commitment = parsed_tx
        .find_commitment()
        .ok_or(ZVaultError::CommitmentNotFound)?;

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
    let (expected_pda, bump) = pinocchio::pubkey::find_program_address(
        &[DepositRecord::SEED, &txid],
        program_id,
    );

    if deposit_record_info.key() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create deposit record account (duplicate prevention: if exists, fails)
    let bump_bytes = [bump];
    let signer_seeds: [Seed; 3] = [
        Seed::from(DepositRecord::SEED),
        Seed::from(txid.as_slice()),
        Seed::from(&bump_bytes),
    ];
    let signer = [Signer::from(&signer_seeds)];

    CreateAccount {
        from: submitter,
        to: deposit_record_info,
        lamports: Rent::get()?.minimum_balance(DepositRecord::LEN),
        space: DepositRecord::LEN as u64,
        owner: program_id,
    }.invoke_signed(&signer)?;

    // Insert commitment into merkle tree
    let leaf_index = {
        let mut tree_data = commitment_tree_info.try_borrow_mut_data()?;
        let tree = CommitmentTree::from_bytes_mut(&mut tree_data)?;

        let index = tree.next_index();
        if index >= CommitmentTree::MAX_LEAVES as u64 {
            return Err(ZVaultError::TreeFull.into());
        }

        tree.insert_leaf(&commitment)?;
        index
    };

    // Record the deposit
    let clock = Clock::get()?;
    {
        let mut deposit_data = deposit_record_info.try_borrow_mut_data()?;
        let deposit = DepositRecord::init(&mut deposit_data)?;

        deposit.commitment = commitment;
        deposit.set_amount_sats(deposit_output.value);
        deposit.btc_txid = txid;
        deposit.set_block_height(block_height);
        deposit.set_leaf_index(leaf_index);
        deposit.depositor.copy_from_slice(submitter.key());
        deposit.set_timestamp(clock.unix_timestamp);
        deposit.set_minted(false);
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
