//! Backward compatibility re-exports from shared module
//!
//! This module re-exports everything from shared/ for compatibility.
//! New code should import directly from crate::shared.

// Re-export all items from shared module
pub use crate::shared::*;

// Re-export submodules for path compatibility (e.g., crate::utils::bitcoin)
pub use crate::shared::bitcoin;
pub use crate::shared::crypto;
pub use crate::shared::cpi::chadbuffer;
pub use crate::shared::introspection;

// Re-export Sunspot verifier program ID from introspection module (devnet only)
#[cfg(not(feature = "localnet"))]
pub use crate::shared::introspection::SUNSPOT_VERIFIER_PROGRAM_ID;
