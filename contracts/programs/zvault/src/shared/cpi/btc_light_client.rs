//! Bitcoin Light Client CPI utilities
//!
//! Provides utilities for interacting with the Bitcoin light client program
//! for SPV verification of Bitcoin transactions.
//!
//! The light client tracks Bitcoin block headers and allows verification
//! that a transaction was included in a specific block.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Bitcoin Light Client program ID (devnet deployment)
/// S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn
pub const BTC_LIGHT_CLIENT_PROGRAM_ID: Pubkey = [
    0x07, 0x8a, 0x3b, 0x4c, 0x5d, 0x6e, 0x7f, 0x80,
    0x91, 0xa2, 0xb3, 0xc4, 0xd5, 0xe6, 0xf7, 0x08,
    0x19, 0x2a, 0x3b, 0x4c, 0x5d, 0x6e, 0x7f, 0x80,
    0x91, 0xa2, 0xb3, 0xc4, 0xd5, 0xe6, 0xf7, 0x08,
];

/// Light client instruction discriminators
pub mod light_client_instruction {
    /// Verify a transaction inclusion in the chain
    pub const VERIFY_TX_INCLUSION: u8 = 0;

    /// Submit a new block header
    pub const SUBMIT_HEADER: u8 = 1;

    /// Get the current tip height
    pub const GET_TIP_HEIGHT: u8 = 2;
}

/// Verify that a Bitcoin transaction was included in a block
///
/// # Arguments
/// * `light_client_program` - The light client program account
/// * `light_client_state` - The light client state account
/// * `tx_hash` - The transaction hash (little-endian)
/// * `block_height` - The block height where the transaction was included
/// * `merkle_proof` - The merkle proof for transaction inclusion
/// * `tx_index` - The index of the transaction in the block
///
/// # Returns
/// * `Ok(())` if the transaction is verified
/// * `Err(ProgramError)` if verification fails
pub fn verify_tx_inclusion(
    light_client_program: &AccountInfo,
    light_client_state: &AccountInfo,
    tx_hash: &[u8; 32],
    block_height: u32,
    merkle_proof: &[[u8; 32]],
    tx_index: u32,
) -> Result<(), ProgramError> {
    // Calculate instruction data size
    // Format: [disc(1)][tx_hash(32)][height(4)][proof_count(4)][proofs(N*32)][tx_index(4)]
    let proof_count = merkle_proof.len();
    let total_size = 1 + 32 + 4 + 4 + (proof_count * 32) + 4;
    let mut ix_data = Vec::with_capacity(total_size);

    // Discriminator
    ix_data.push(light_client_instruction::VERIFY_TX_INCLUSION);

    // Transaction hash
    ix_data.extend_from_slice(tx_hash);

    // Block height
    ix_data.extend_from_slice(&block_height.to_le_bytes());

    // Merkle proof count
    ix_data.extend_from_slice(&(proof_count as u32).to_le_bytes());

    // Merkle proof nodes
    for node in merkle_proof {
        ix_data.extend_from_slice(node);
    }

    // Transaction index
    ix_data.extend_from_slice(&tx_index.to_le_bytes());

    // Account metas
    let account_metas = [AccountMeta::readonly(light_client_state.key())];

    // Create instruction
    let instruction = Instruction {
        program_id: light_client_program.key(),
        accounts: &account_metas,
        data: &ix_data,
    };

    // Invoke
    invoke(&instruction, &[light_client_state])
}

/// Check if a block has sufficient confirmations
///
/// # Arguments
/// * `light_client_state` - The light client state account data
/// * `block_height` - The block height to check
/// * `required_confirmations` - Number of confirmations required
///
/// # Returns
/// * `true` if the block has sufficient confirmations
/// * `false` otherwise
pub fn has_sufficient_confirmations(
    light_client_state: &[u8],
    block_height: u32,
    required_confirmations: u32,
) -> Result<bool, ProgramError> {
    // Light client state layout:
    // [discriminator(1)][tip_height(4)]...
    if light_client_state.len() < 5 {
        return Err(ProgramError::InvalidAccountData);
    }

    let tip_height = u32::from_le_bytes(
        light_client_state[1..5].try_into().map_err(|_| ProgramError::InvalidAccountData)?
    );

    // Check if block has enough confirmations
    // tip_height - block_height >= required_confirmations
    Ok(tip_height >= block_height && tip_height - block_height >= required_confirmations)
}

/// Extract the current tip height from light client state
///
/// # Arguments
/// * `light_client_state` - The light client state account data
///
/// # Returns
/// The current tip block height
pub fn get_tip_height(light_client_state: &[u8]) -> Result<u32, ProgramError> {
    if light_client_state.len() < 5 {
        return Err(ProgramError::InvalidAccountData);
    }

    let tip_height = u32::from_le_bytes(
        light_client_state[1..5].try_into().map_err(|_| ProgramError::InvalidAccountData)?
    );

    Ok(tip_height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_sufficient_confirmations() {
        // Create mock state with tip height = 100
        let mut state = vec![0x01]; // discriminator
        state.extend_from_slice(&100u32.to_le_bytes());

        // Block 98 with 2 confirmations required should pass (100 - 98 = 2)
        assert!(has_sufficient_confirmations(&state, 98, 2).unwrap());

        // Block 99 with 2 confirmations required should fail (100 - 99 = 1)
        assert!(!has_sufficient_confirmations(&state, 99, 2).unwrap());

        // Block 100 with 1 confirmation required should fail (100 - 100 = 0)
        assert!(!has_sufficient_confirmations(&state, 100, 1).unwrap());

        // Block 100 with 0 confirmations required should pass
        assert!(has_sufficient_confirmations(&state, 100, 0).unwrap());
    }

    #[test]
    fn test_get_tip_height() {
        let mut state = vec![0x01];
        state.extend_from_slice(&12345u32.to_le_bytes());

        assert_eq!(get_tip_height(&state).unwrap(), 12345);
    }

    #[test]
    fn test_invalid_state() {
        let state = vec![0x01]; // Too short
        assert!(get_tip_height(&state).is_err());
        assert!(has_sufficient_confirmations(&state, 0, 0).is_err());
    }
}
