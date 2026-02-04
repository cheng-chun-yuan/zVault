//! Cross-Program Invocation (CPI) helpers
//!
//! This module provides utilities for making CPI calls to other programs:
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `token_2022` | Token-2022 program operations (mint, burn, transfer) |
//! | `ultrahonk` | UltraHonk verifier program for ZK proof verification |
//! | `chadbuffer` | ChadBuffer program for reading large transaction data |
//! | `btc_light_client` | Bitcoin light client for SPV verification |

pub mod btc_light_client;
pub mod chadbuffer;
pub mod token_2022;
pub mod ultrahonk;

// Re-export commonly used items
pub use chadbuffer::{
    get_buffer_authority, read_transaction_from_buffer, validate_buffer_account,
    BUFFER_HEADER_SIZE, CHADBUFFER_PROGRAM_ID,
};

pub use token_2022::{
    burn_zbtc, burn_zbtc_signed, get_token_balance, is_token_2022_account, mint_zbtc,
    transfer_zbtc, validate_token_account,
};

pub use ultrahonk::{
    build_ultrahonk_verify_data, verify_ultrahonk_claim_proof,
    verify_ultrahonk_claim_proof_from_buffer, verify_ultrahonk_pool_claim_yield_proof,
    verify_ultrahonk_pool_compound_proof, verify_ultrahonk_pool_deposit_proof,
    verify_ultrahonk_pool_withdraw_proof, verify_ultrahonk_proof_cpi,
    verify_ultrahonk_proof_with_vk_cpi, verify_ultrahonk_spend_partial_public_proof,
    verify_ultrahonk_spend_partial_public_proof_from_buffer, verify_ultrahonk_split_proof,
    verify_ultrahonk_split_proof_from_buffer, UltraHonkProof, ULTRAHONK_VERIFIER_PROGRAM_ID,
};
