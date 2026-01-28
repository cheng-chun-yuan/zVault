//! Instruction handlers for zVault (Unified Model)
//!
//! ## Core Operations
//!
//! | Instruction | Purpose |
//! |-------------|---------|
//! | `initialize` | Setup pool state and commitment tree |
//! | `verify_deposit` | Verify BTC via SPV, mint to pool, add commitment |
//! | `split_commitment` | Split 1 commitment into 2 (spend_split circuit) |
//! | `spend_partial_public` | Partial public claim with change (spend_partial_public circuit) |
//! | `claim_public` | Full claim to public wallet (claim circuit) |
//! | `request_redemption` | Prove ownership, burn from pool, queue BTC withdrawal |
//! | `complete_redemption` | Relayer marks redemption complete |
//! | `announce_stealth` | Create stealth announcement (EIP-5564/DKSAP) |
//!
//! ## Demo Operations (Testing only)
//!
//! | Instruction | Purpose |
//! |-------------|---------|
//! | `add_demo_note` | Add commitment without real BTC deposit |
//! | `add_demo_stealth` | Add stealth deposit without real BTC |

// Core operations (Unified Model)
pub mod initialize;
pub mod verify_deposit;
pub mod spend_split;
pub mod spend_partial_public;
pub mod claim;
pub mod request_redemption;
pub mod complete_redemption;
pub mod announce_stealth;

// Demo/testing
pub mod add_demo_note;
pub mod add_demo_stealth;

// Backend-managed stealth deposit v2
pub mod verify_stealth_deposit_v2;

// Name registry
pub mod register_name;

// Yield pool operations
pub mod create_yield_pool;
pub mod deposit_to_pool;
pub mod withdraw_from_pool;
pub mod claim_pool_yield;
pub mod compound_yield;
pub mod update_yield_rate;
pub mod harvest_yield;

// VK registry (deployment)
pub mod init_vk_registry;

// Re-exports
pub use initialize::*;
pub use verify_deposit::*;
pub use spend_split::*;
pub use spend_partial_public::*;
pub use claim::*;
pub use request_redemption::*;
pub use complete_redemption::*;
pub use announce_stealth::*;
pub use add_demo_note::*;
pub use add_demo_stealth::*;
pub use register_name::*;
pub use verify_stealth_deposit_v2::*;

// Yield pool re-exports
pub use create_yield_pool::*;
pub use deposit_to_pool::*;
pub use withdraw_from_pool::*;
pub use claim_pool_yield::*;
pub use compound_yield::*;
pub use update_yield_rate::*;
pub use harvest_yield::*;

// VK registry re-exports
pub use init_vk_registry::*;
