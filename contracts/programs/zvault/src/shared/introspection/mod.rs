//! Instruction Introspection Utilities
//!
//! Security utilities for verifying that specific instructions were executed
//! earlier in the same transaction.
//!
//! # Security Model
//!
//! Solana transactions are atomic - all instructions succeed or all fail.
//! By checking that a verifier instruction exists earlier in the transaction,
//! we can safely skip redundant verification in a later instruction.
//!
//! The Instructions sysvar is transaction-scoped, so this check cannot be
//! bypassed across transactions.

pub mod prior_verification;

pub use prior_verification::{
    verify_prior_buffer_verification, verify_prior_verification_any, verifier_instruction,
};
