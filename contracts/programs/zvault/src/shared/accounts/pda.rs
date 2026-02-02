//! PDA creation and derivation helpers
//!
//! This module provides utilities for creating Program Derived Addresses (PDAs)
//! and initializing PDA accounts via CPI to the system program.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    pubkey::Pubkey,
    ProgramResult,
};

/// Create a PDA account via CPI to system program
///
/// This is a shared helper to eliminate duplication across instruction files.
/// Previously duplicated in: announce_stealth, transfer_stealth, add_demo_stealth,
/// initialize, register_name (5 files, ~100 lines saved)
///
/// # Arguments
/// * `payer` - Account paying for rent
/// * `pda_account` - The PDA account to create
/// * `program_id` - Owner program for the new account
/// * `lamports` - Lamports to transfer to the new account
/// * `space` - Size of the account data
/// * `signer_seeds` - Seeds used to derive the PDA (without bump)
///
/// # Note
/// The bump seed must be included in `signer_seeds` for the CPI to succeed.
#[inline]
pub fn create_pda_account<'a>(
    payer: &'a AccountInfo,
    pda_account: &'a AccountInfo,
    program_id: &Pubkey,
    lamports: u64,
    space: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let create_account = pinocchio_system::instructions::CreateAccount {
        from: payer,
        to: pda_account,
        lamports,
        space,
        owner: program_id,
    };

    // Convert seeds to Pinocchio format
    let seeds: [Seed; 4] = [
        if !signer_seeds.is_empty() { Seed::from(signer_seeds[0]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 1 { Seed::from(signer_seeds[1]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 2 { Seed::from(signer_seeds[2]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 3 { Seed::from(signer_seeds[3]) } else { Seed::from(&[][..]) },
    ];

    let signer = Signer::from(&seeds[..signer_seeds.len()]);
    create_account.invoke_signed(&[signer])
}

/// Create a PDA account with up to 6 seeds
///
/// Extended version that supports more seeds for complex PDA derivations.
#[inline]
pub fn create_pda_account_extended<'a>(
    payer: &'a AccountInfo,
    pda_account: &'a AccountInfo,
    program_id: &Pubkey,
    lamports: u64,
    space: u64,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    let create_account = pinocchio_system::instructions::CreateAccount {
        from: payer,
        to: pda_account,
        lamports,
        space,
        owner: program_id,
    };

    // Convert seeds to Pinocchio format (supports up to 6 seeds)
    let seeds: [Seed; 6] = [
        if !signer_seeds.is_empty() { Seed::from(signer_seeds[0]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 1 { Seed::from(signer_seeds[1]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 2 { Seed::from(signer_seeds[2]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 3 { Seed::from(signer_seeds[3]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 4 { Seed::from(signer_seeds[4]) } else { Seed::from(&[][..]) },
        if signer_seeds.len() > 5 { Seed::from(signer_seeds[5]) } else { Seed::from(&[][..]) },
    ];

    let signer = Signer::from(&seeds[..signer_seeds.len()]);
    create_account.invoke_signed(&[signer])
}

/// Common PDA seed prefixes used throughout the program
pub mod seeds {
    /// Pool state account seed
    pub const POOL_STATE: &[u8] = b"pool_state";

    /// Commitment tree account seed
    pub const COMMITMENT_TREE: &[u8] = b"commitment_tree";

    /// Nullifier record account seed
    pub const NULLIFIER: &[u8] = b"nullifier";

    /// Deposit record account seed
    pub const DEPOSIT: &[u8] = b"deposit";

    /// Redemption request account seed
    pub const REDEMPTION: &[u8] = b"redemption";

    /// Stealth announcement account seed
    pub const STEALTH_ANNOUNCEMENT: &[u8] = b"stealth";

    /// Name registry account seed
    pub const NAME_REGISTRY: &[u8] = b"name";

    /// Reverse registry account seed
    pub const REVERSE_REGISTRY: &[u8] = b"reverse";

    /// Yield pool account seed
    pub const YIELD_POOL: &[u8] = b"yield_pool";

    /// Pool position account seed
    pub const POOL_POSITION: &[u8] = b"pool_position";

    /// VK registry account seed
    pub const VK_REGISTRY: &[u8] = b"vk";
}

#[cfg(test)]
mod tests {
    use super::seeds;

    #[test]
    fn test_seed_prefixes_unique() {
        let all_seeds = [
            seeds::POOL_STATE,
            seeds::COMMITMENT_TREE,
            seeds::NULLIFIER,
            seeds::DEPOSIT,
            seeds::REDEMPTION,
            seeds::STEALTH_ANNOUNCEMENT,
            seeds::NAME_REGISTRY,
            seeds::REVERSE_REGISTRY,
            seeds::YIELD_POOL,
            seeds::POOL_POSITION,
            seeds::VK_REGISTRY,
        ];

        // Check all seeds are unique
        for (i, seed1) in all_seeds.iter().enumerate() {
            for (j, seed2) in all_seeds.iter().enumerate() {
                if i != j {
                    assert_ne!(seed1, seed2, "Seed collision detected");
                }
            }
        }
    }
}
