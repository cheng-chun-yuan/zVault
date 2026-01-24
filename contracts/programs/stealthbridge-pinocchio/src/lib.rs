//! ZVault - Privacy-Preserving BTC to Solana Bridge (Pinocchio)
//!
//! A high-performance implementation using Pinocchio for ~84% CU savings
//! compared to Anchor on non-ZK operations.
//!
//! ## 6 Main Operations
//! 1. DEPOSIT: User sends BTC to taproot address, verify via SPV
//! 2. WITHDRAW: User burns sbBTC, requests BTC withdrawal
//! 3. PRIVATE_CLAIM: User claims sbBTC with ZK proof
//! 4. PRIVATE_SPLIT: Split 1 commitment into 2 outputs
//! 5. SEND_LINK: Share claim link (off-chain, no instruction)
//! 6. SEND_STEALTH: Create on-chain stealth announcement (ECDH)
//!
//! ## Privacy Guarantee
//! - commitment ≠ nullifier_hash (different hash functions)
//! - Without knowing 'secret', you can't link deposit → claim
//! - Stealth addresses use X25519 ECDH for recipient privacy

use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

/// Program ID - update this after deployment
/// This is a placeholder - update with actual deployed program ID
pub const ID: Pubkey = [
    0x0a, 0x6a, 0x3c, 0x1e, 0x87, 0x32, 0x1a, 0x5c,
    0x7f, 0x4b, 0x2d, 0x9e, 0x8a, 0x6c, 0x3f, 0x1b,
    0x5d, 0x2a, 0x8e, 0x4c, 0x7b, 0x3a, 0x1f, 0x6d,
    0x9c, 0x5e, 0x2b, 0x8f, 0x4a, 0x7d, 0x3c, 0x1e,
];

/// Instruction discriminators (single byte for gas efficiency)
///
/// Main user-facing instructions:
/// - VERIFY_DEPOSIT (8): Deposit BTC via SPV verification
/// - CLAIM (9): Claim sbBTC with ZK proof (private_claim)
/// - SPLIT_COMMITMENT (4): Split commitment 1→2 (private_split)
/// - REQUEST_REDEMPTION (5): Withdraw - burn sbBTC, request BTC
/// - ANNOUNCE_STEALTH (12): Send via stealth address (sendStealth)
pub mod instruction {
    pub const INITIALIZE: u8 = 0;
    // Discriminators 1-3 removed (record_deposit, claim_direct, mint_to_commitment)
    pub const SPLIT_COMMITMENT: u8 = 4;
    pub const REQUEST_REDEMPTION: u8 = 5;
    pub const COMPLETE_REDEMPTION: u8 = 6;
    pub const SET_PAUSED: u8 = 7;
    pub const VERIFY_DEPOSIT: u8 = 8;
    pub const CLAIM: u8 = 9;
    pub const INIT_COMMITMENT_TREE: u8 = 10;
    pub const ADD_DEMO_COMMITMENT: u8 = 11;
    pub const ANNOUNCE_STEALTH: u8 = 12;
}

entrypoint!(process_instruction);

/// Main program entrypoint
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Route based on first byte discriminator
    let (discriminator, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        instruction::INITIALIZE => {
            instructions::process_initialize(program_id, accounts, data)
        }
        instruction::SPLIT_COMMITMENT => {
            instructions::process_split_commitment(program_id, accounts, data)
        }
        instruction::REQUEST_REDEMPTION => {
            instructions::process_request_redemption(program_id, accounts, data)
        }
        instruction::COMPLETE_REDEMPTION => {
            instructions::process_complete_redemption(program_id, accounts, data)
        }
        instruction::SET_PAUSED => {
            process_set_paused(program_id, accounts, data)
        }
        instruction::VERIFY_DEPOSIT => {
            instructions::process_verify_deposit(program_id, accounts, data)
        }
        instruction::CLAIM => {
            instructions::process_claim(program_id, accounts, data)
        }
        instruction::INIT_COMMITMENT_TREE => {
            instructions::process_init_commitment_tree(program_id, accounts, data)
        }
        instruction::ADD_DEMO_COMMITMENT => {
            instructions::process_add_demo_commitment(program_id, accounts, data)
        }
        instruction::ANNOUNCE_STEALTH => {
            instructions::process_announce_stealth(program_id, accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Set pool paused state (admin only)
fn process_set_paused(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    use crate::error::ZVaultError;
    use crate::state::PoolState;
    use crate::utils::validate_program_owner;
    use pinocchio::sysvars::{clock::Clock, Sysvar};

    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_state = &accounts[0];
    let authority = &accounts[1];

    // SECURITY: Validate account owners BEFORE deserializing any data
    validate_program_owner(pool_state, program_id)?;

    // Validate authority is signer
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate data
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let paused = data[0] != 0;

    // Load pool and validate authority
    {
        let pool_data = pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
    }

    // Update paused state
    {
        let mut pool_data = pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.set_paused(paused);

        let clock = Clock::get()?;
        pool.set_last_update(clock.unix_timestamp);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instruction_discriminators() {
        // Ensure discriminators are unique
        let discriminators = [
            instruction::INITIALIZE,
            instruction::SPLIT_COMMITMENT,
            instruction::REQUEST_REDEMPTION,
            instruction::COMPLETE_REDEMPTION,
            instruction::SET_PAUSED,
            instruction::VERIFY_DEPOSIT,
            instruction::CLAIM,
            instruction::INIT_COMMITMENT_TREE,
            instruction::ADD_DEMO_COMMITMENT,
            instruction::ANNOUNCE_STEALTH,
        ];

        for (i, &d1) in discriminators.iter().enumerate() {
            for (j, &d2) in discriminators.iter().enumerate() {
                if i != j {
                    assert_ne!(d1, d2, "Duplicate discriminator at indices {} and {}", i, j);
                }
            }
        }
    }
}
