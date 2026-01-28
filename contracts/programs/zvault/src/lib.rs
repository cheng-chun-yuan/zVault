//! zVault - Privacy-Preserving BTC to Solana Bridge (Pinocchio)
//!
//! SHIELDED-ONLY ARCHITECTURE:
//! - zBTC exists only as commitments in Merkle tree
//! - Users never hold public zBTC tokens
//! - Amount revealed ONLY at BTC withdrawal
//!
//! ## Privacy Guarantee
//!
//! | Operation     | Amount Visible? |
//! |---------------|-----------------|
//! | Deposit       | No (in commitment) |
//! | Split         | No |
//! | Stealth Send  | No |
//! | Withdraw      | Yes (unavoidable) |
//!
//! ## Core Flow
//!
//! ```text
//! BTC Deposit → Verify SPV → Mint to Pool → Commitment in Tree
//!                                                    ↓
//!                            Split/Transfer (private, ZK proof)
//!                                                    ↓
//!                    Withdraw → ZK Proof → Burn from Pool → BTC
//! ```

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

/// Program ID (update after deployment)
pub const ID: Pubkey = [
    0x0a, 0x6a, 0x3c, 0x1e, 0x87, 0x32, 0x1a, 0x5c,
    0x7f, 0x4b, 0x2d, 0x9e, 0x8a, 0x6c, 0x3f, 0x1b,
    0x5d, 0x2a, 0x8e, 0x4c, 0x7b, 0x3a, 0x1f, 0x6d,
    0x9c, 0x5e, 0x2b, 0x8f, 0x4a, 0x7d, 0x3c, 0x1e,
];

/// Instruction discriminators
pub mod instruction {
    // Core operations
    pub const INITIALIZE: u8 = 0;
    pub const SPLIT_COMMITMENT: u8 = 4;
    pub const REQUEST_REDEMPTION: u8 = 5;
    pub const COMPLETE_REDEMPTION: u8 = 6;
    pub const SET_PAUSED: u8 = 7;
    pub const VERIFY_DEPOSIT: u8 = 8;
    pub const ANNOUNCE_STEALTH: u8 = 16;
    pub const TRANSFER_STEALTH: u8 = 24;

    // Name registry
    pub const REGISTER_NAME: u8 = 17;
    pub const UPDATE_NAME: u8 = 18;
    pub const TRANSFER_NAME: u8 = 19;

    // Demo/testing (admin only) - DISABLED IN PRODUCTION
    // SECURITY: These instructions are only available on devnet/testnet.
    // Set ZVAULT_DEMO_MODE=1 environment variable to enable.
    // DO NOT enable in production builds.
    #[cfg(feature = "devnet")]
    pub const ADD_DEMO_NOTE: u8 = 21;
    #[cfg(feature = "devnet")]
    pub const ADD_DEMO_STEALTH: u8 = 22;

    // Backend-managed stealth deposit v2 (authority only)
    pub const VERIFY_STEALTH_DEPOSIT_V2: u8 = 23;

    // Yield pool operations (zkEarn)
    pub const CREATE_YIELD_POOL: u8 = 30;
    pub const DEPOSIT_TO_POOL: u8 = 31;
    pub const WITHDRAW_FROM_POOL: u8 = 32;
    pub const CLAIM_POOL_YIELD: u8 = 33;
    pub const COMPOUND_YIELD: u8 = 34;
    pub const UPDATE_YIELD_RATE: u8 = 35;
    pub const HARVEST_YIELD: u8 = 36;

    // VK Registry (deployment/admin)
    pub const INIT_VK_REGISTRY: u8 = 40;
    pub const UPDATE_VK_REGISTRY: u8 = 41;
}

entrypoint!(process_instruction);

/// Main entrypoint - routes to instruction handlers
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        // Core operations
        instruction::INITIALIZE => {
            instructions::process_initialize(program_id, accounts, data)
        }
        instruction::VERIFY_DEPOSIT => {
            instructions::process_verify_deposit(program_id, accounts, data)
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
        instruction::ANNOUNCE_STEALTH => {
            instructions::process_announce_stealth(program_id, accounts, data)
        }
        instruction::TRANSFER_STEALTH => {
            instructions::process_transfer_stealth(program_id, accounts, data)
        }
        // Name registry
        instruction::REGISTER_NAME => {
            instructions::process_register_name(program_id, accounts, data)
        }
        instruction::UPDATE_NAME => {
            instructions::process_update_name(program_id, accounts, data)
        }
        instruction::TRANSFER_NAME => {
            instructions::process_transfer_name(program_id, accounts, data)
        }
        // Demo/testing - DISABLED IN PRODUCTION
        #[cfg(feature = "devnet")]
        instruction::ADD_DEMO_NOTE => {
            instructions::process_add_demo_note(program_id, accounts, data)
        }
        #[cfg(feature = "devnet")]
        instruction::ADD_DEMO_STEALTH => {
            instructions::process_add_demo_stealth(program_id, accounts, data)
        }
        // Backend-managed stealth deposit v2
        instruction::VERIFY_STEALTH_DEPOSIT_V2 => {
            instructions::process_verify_stealth_deposit_v2(program_id, accounts, data)
        }
        // Yield pool operations
        instruction::CREATE_YIELD_POOL => {
            instructions::process_create_yield_pool(program_id, accounts, data)
        }
        instruction::DEPOSIT_TO_POOL => {
            instructions::process_deposit_to_pool(program_id, accounts, data)
        }
        instruction::WITHDRAW_FROM_POOL => {
            instructions::process_withdraw_from_pool(program_id, accounts, data)
        }
        instruction::CLAIM_POOL_YIELD => {
            instructions::process_claim_pool_yield(program_id, accounts, data)
        }
        instruction::COMPOUND_YIELD => {
            instructions::process_compound_yield(program_id, accounts, data)
        }
        instruction::UPDATE_YIELD_RATE => {
            instructions::process_update_yield_rate(program_id, accounts, data)
        }
        instruction::HARVEST_YIELD => {
            instructions::process_harvest_yield(program_id, accounts, data)
        }
        // VK Registry
        instruction::INIT_VK_REGISTRY => {
            instructions::process_init_vk_registry(program_id, accounts, data)
        }
        instruction::UPDATE_VK_REGISTRY => {
            instructions::process_update_vk_registry(program_id, accounts, data)
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

    validate_program_owner(pool_state, program_id)?;

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let paused = data[0] != 0;

    // Validate authority
    {
        let pool_data = pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if authority.key().as_ref() != pool.authority {
            return Err(ZVaultError::Unauthorized.into());
        }
    }

    // Update state
    {
        let mut pool_data = pool_state.try_borrow_mut_data()?;
        let pool = PoolState::from_bytes_mut(&mut pool_data)?;

        pool.set_paused(paused);
        pool.set_last_update(Clock::get()?.unix_timestamp);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminators_unique() {
        let discriminators: &[u8] = &[
            instruction::INITIALIZE,
            instruction::SPLIT_COMMITMENT,
            instruction::REQUEST_REDEMPTION,
            instruction::COMPLETE_REDEMPTION,
            instruction::SET_PAUSED,
            instruction::VERIFY_DEPOSIT,
            instruction::ANNOUNCE_STEALTH,
            instruction::TRANSFER_STEALTH,
            instruction::REGISTER_NAME,
            instruction::UPDATE_NAME,
            instruction::TRANSFER_NAME,
            instruction::VERIFY_STEALTH_DEPOSIT_V2,
            // Yield pool operations
            instruction::CREATE_YIELD_POOL,
            instruction::DEPOSIT_TO_POOL,
            instruction::WITHDRAW_FROM_POOL,
            instruction::CLAIM_POOL_YIELD,
            instruction::COMPOUND_YIELD,
            instruction::UPDATE_YIELD_RATE,
            instruction::HARVEST_YIELD,
            instruction::INIT_VK_REGISTRY,
            instruction::UPDATE_VK_REGISTRY,
            // Demo instructions (only in devnet builds)
            #[cfg(feature = "devnet")]
            instruction::ADD_DEMO_NOTE,
            #[cfg(feature = "devnet")]
            instruction::ADD_DEMO_STEALTH,
        ];

        for (i, &d1) in discriminators.iter().enumerate() {
            for (j, &d2) in discriminators.iter().enumerate() {
                if i != j {
                    assert_ne!(d1, d2, "Duplicate at {} and {}", i, j);
                }
            }
        }
    }
}
