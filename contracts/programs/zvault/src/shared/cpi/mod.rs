//! Cross-Program Invocation (CPI) helpers
//!
//! This module provides utilities for making CPI calls to other programs:
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `token_2022` | Token-2022 program operations (mint, burn, transfer) |
//! | `chadbuffer` | ChadBuffer program for reading large transaction data |
//! | `btc_light_client` | Bitcoin light client for SPV verification |
//!
//! Note: UltraHonk verification uses instruction introspection, not CPI.
//! See `shared::introspection` module for verification helpers.

pub mod btc_light_client;
pub mod chadbuffer;
pub mod token_2022;

// Re-export commonly used items
pub use chadbuffer::{
    get_buffer_authority, read_transaction_from_buffer, validate_buffer_account,
    BUFFER_HEADER_SIZE, CHADBUFFER_PROGRAM_ID,
};

pub use token_2022::{burn_zbtc, burn_zbtc_signed, mint_zbtc, transfer_zbtc};
