//! Shared infrastructure modules for zVault program
//!
//! This module provides common utilities, error types, constants, and CPI helpers
//! that are used across multiple instruction handlers.
//!
//! ## Module Organization
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `error` | Custom error types for the program |
//! | `constants` | Program constants (limits, IDs, sizes) |
//! | `accounts` | Account validation, PDA helpers, serialization |
//! | `crypto` | Cryptographic primitives (Poseidon, Merkle, SHA256) |
//! | `cpi` | Cross-Program Invocation helpers |
//! | `bitcoin` | Bitcoin transaction parsing and utilities |
//! | `introspection` | Instruction introspection for security checks |

pub mod accounts;
pub mod bitcoin;
pub mod constants;
pub mod cpi;
pub mod crypto;
pub mod error;
pub mod introspection;

// Re-export commonly used items for convenience
pub use accounts::{
    close_account_securely, create_pda_account, validate_account_writable,
    validate_accounts_different, validate_initialized, validate_not_initialized,
    validate_program_accounts, validate_program_accounts_writable, validate_program_owner,
    validate_program_owners, validate_rent_exempt, validate_system_program,
    validate_token_2022_owner, validate_token_mint, validate_token_program_key,
    verify_and_create_nullifier, verify_nullifier_pda, create_nullifier_record,
    read_bytes32, parse_u64_le, parse_u32_le, parse_u16_le, parse_u8, read_bytes, ensure_min_len,
};

pub use constants::{
    MAX_BTC_ADDRESS_LEN, MAX_BTC_TXID_LEN, MAX_POOL_PRINCIPAL, MAX_GROTH16_PROOF_SIZE,
    MAX_YIELD_EPOCHS, MIN_DEPOSIT_SATS, MAX_DEPOSIT_SATS, REQUIRED_CONFIRMATIONS,
    TOKEN_2022_PROGRAM_ID,
};

pub use crypto::{compute_merkle_root, poseidon2_hash, TREE_DEPTH, ZERO_HASHES};

pub use error::ZVaultError;

pub use bitcoin::{
    compute_tx_hash, compute_txid, double_sha256, double_sha256_pair, sha256,
    ParsedTransaction, StealthOpReturnData, TxOutput,
};

pub use cpi::token_2022::{burn_zbtc, burn_zbtc_signed, mint_zbtc, transfer_zbtc};

pub use cpi::chadbuffer::{
    get_buffer_authority, read_transaction_from_buffer, validate_buffer_account,
    BUFFER_HEADER_SIZE, CHADBUFFER_PROGRAM_ID,
};
