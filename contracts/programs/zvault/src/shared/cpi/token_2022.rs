//! Token-2022 CPI helper functions
//!
//! Provides utilities for interacting with the Token-2022 program
//! for minting, burning, and transferring zBTC tokens.

use pinocchio::{
    account_info::AccountInfo,
    cpi::{invoke, invoke_signed},
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::shared::constants::TOKEN_2022_PROGRAM_ID;

/// Token-2022 instruction discriminators
mod token_instruction {
    pub const MINT_TO: u8 = 7;
    pub const BURN: u8 = 8;
    pub const TRANSFER: u8 = 3;
}

/// Mint zBTC tokens to a user account
///
/// # Arguments
/// * `_token_program` - The Token-2022 program account (for validation)
/// * `mint` - The zBTC mint account
/// * `destination` - The user's token account
/// * `authority` - The mint authority (pool PDA)
/// * `amount` - Amount to mint (in satoshis)
/// * `signer_seeds` - PDA signer seeds
pub fn mint_zbtc(
    _token_program: &AccountInfo,
    mint: &AccountInfo,
    destination: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    // Build instruction data: [discriminator, amount (8 bytes LE)]
    let mut data = [0u8; 9];
    data[0] = token_instruction::MINT_TO;
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let token_program_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);

    let accounts = [
        AccountMeta::writable(mint.key()),
        AccountMeta::writable(destination.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let instruction = Instruction {
        program_id: &token_program_id,
        accounts: &accounts,
        data: &data,
    };

    // Create signer from seeds
    let seeds: Vec<Seed> = signer_seeds.iter().map(|s| Seed::from(*s)).collect();
    let signer = Signer::from(&seeds[..]);
    let signers = [signer];

    invoke_signed(&instruction, &[mint, destination, authority], &signers)
}

/// Burn zBTC tokens from a user account
///
/// # Arguments
/// * `_token_program` - The Token-2022 program account (for validation)
/// * `mint` - The zBTC mint account
/// * `source` - The user's token account to burn from
/// * `authority` - The token account authority (user)
/// * `amount` - Amount to burn (in satoshis)
pub fn burn_zbtc(
    _token_program: &AccountInfo,
    mint: &AccountInfo,
    source: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = token_instruction::BURN;
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let token_program_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);

    let accounts = [
        AccountMeta::writable(source.key()),
        AccountMeta::writable(mint.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let instruction = Instruction {
        program_id: &token_program_id,
        accounts: &accounts,
        data: &data,
    };

    invoke(&instruction, &[source, mint, authority])
}

/// Burn zBTC tokens from a PDA-controlled account (e.g., pool vault)
///
/// # Arguments
/// * `_token_program` - The Token-2022 program account (for validation)
/// * `mint` - The zBTC mint account
/// * `source` - The PDA-controlled token account to burn from
/// * `authority` - The PDA authority
/// * `amount` - Amount to burn (in satoshis)
/// * `signer_seeds` - PDA signer seeds
pub fn burn_zbtc_signed(
    _token_program: &AccountInfo,
    mint: &AccountInfo,
    source: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = token_instruction::BURN;
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let token_program_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);

    let accounts = [
        AccountMeta::writable(source.key()),
        AccountMeta::writable(mint.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let instruction = Instruction {
        program_id: &token_program_id,
        accounts: &accounts,
        data: &data,
    };

    let seeds: Vec<Seed> = signer_seeds.iter().map(|s| Seed::from(*s)).collect();
    let signer = Signer::from(&seeds[..]);
    let signers = [signer];

    invoke_signed(&instruction, &[source, mint, authority], &signers)
}

/// Transfer zBTC tokens between accounts
///
/// # Arguments
/// * `_token_program` - The Token-2022 program account (for validation)
/// * `source` - The source token account
/// * `destination` - The destination token account
/// * `authority` - The source account authority
/// * `amount` - Amount to transfer
/// * `signer_seeds` - Optional PDA signer seeds (empty for user-signed transfers)
pub fn transfer_zbtc(
    _token_program: &AccountInfo,
    source: &AccountInfo,
    destination: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = [0u8; 9];
    data[0] = token_instruction::TRANSFER;
    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let token_program_id = Pubkey::from(TOKEN_2022_PROGRAM_ID);

    let accounts = [
        AccountMeta::writable(source.key()),
        AccountMeta::writable(destination.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];

    let instruction = Instruction {
        program_id: &token_program_id,
        accounts: &accounts,
        data: &data,
    };

    if signer_seeds.is_empty() {
        invoke(&instruction, &[source, destination, authority])
    } else {
        let seeds: Vec<Seed> = signer_seeds.iter().map(|s| Seed::from(*s)).collect();
        let signer = Signer::from(&seeds[..]);
        let signers = [signer];
        invoke_signed(&instruction, &[source, destination, authority], &signers)
    }
}

/// Check if an account is owned by Token-2022 program
#[inline(always)]
pub fn is_token_2022_account(account: &AccountInfo) -> bool {
    account.owner() == &Pubkey::from(TOKEN_2022_PROGRAM_ID)
}

/// Validate token account basics
///
/// Checks that the account:
/// 1. Is owned by Token-2022 program
/// 2. Has the expected mint
/// 3. Has the expected owner
///
/// # Token Account Layout (Token-2022)
/// - [0..32] mint
/// - [32..64] owner
/// - [64..72] amount
pub fn validate_token_account(
    account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<(), ProgramError> {
    // Check program owner
    if !is_token_2022_account(account) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let data = account.try_borrow_data()?;
    if data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check mint
    let mint = Pubkey::from(<[u8; 32]>::try_from(&data[0..32]).unwrap());
    if &mint != expected_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check owner
    let owner = Pubkey::from(<[u8; 32]>::try_from(&data[32..64]).unwrap());
    if &owner != expected_owner {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(())
}

/// Get token account balance
///
/// # Token Account Layout (Token-2022)
/// - [64..72] amount (u64, little-endian)
pub fn get_token_balance(account: &AccountInfo) -> Result<u64, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}
