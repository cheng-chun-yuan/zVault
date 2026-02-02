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
pub use crate::shared::cpi::ultrahonk;
pub use crate::shared::introspection;
