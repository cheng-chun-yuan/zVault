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
//! | `parsing` | Instruction data parsing helpers |
//! | `nullifier` | Nullifier record creation and validation |

pub mod nullifier;
pub mod parsing;
pub mod pda;
pub mod serialization;
pub mod validation;

// Re-export all items for convenience
pub use nullifier::*;
pub use parsing::*;
pub use pda::*;
pub use serialization::*;
pub use validation::*;
