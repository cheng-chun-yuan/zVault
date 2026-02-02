//! Account utilities module
//!
//! Provides account validation, PDA creation helpers, and serialization utilities.
//!
//! ## Submodules
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `validation` | Security checks for accounts (owner, writable, etc.) |
//! | `pda` | PDA derivation and creation helpers |
//! | `serialization` | Zero-copy serialization traits and utilities |

pub mod pda;
pub mod serialization;
pub mod validation;

// Re-export all items for convenience
pub use pda::*;
pub use serialization::*;
pub use validation::*;
