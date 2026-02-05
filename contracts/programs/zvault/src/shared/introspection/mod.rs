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
//!
//! # Groth16 Verification (Sunspot)
//!
//! For Groth16 proofs, verification is done inline in the instruction data.
//! The introspection utilities are kept for optional prior-verification patterns.

pub mod prior_verification;

pub use prior_verification::{
    require_prior_groth16_verification, verify_prior_groth16_verification,
    verifier_instruction,
};

#[cfg(not(feature = "localnet"))]
pub use prior_verification::SUNSPOT_VERIFIER_PROGRAM_ID;
