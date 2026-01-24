//! State account definitions (zero-copy)
//!
//! ## Core State Accounts
//!
//! | Account | Purpose |
//! |---------|---------|
//! | `PoolState` | Global pool config and statistics |
//! | `CommitmentTree` | Merkle tree of shielded commitments |
//! | `DepositRecord` | Individual BTC deposit record |
//! | `NullifierRecord` | Spent nullifiers (prevents double-spend) |
//! | `RedemptionRequest` | Pending BTC withdrawal request |
//! | `BitcoinLightClient` | Bitcoin header chain state |
//! | `BlockHeader` | Individual Bitcoin block header |
//! | `StealthAnnouncementV2` | Stealth address announcement (ECDH) |

// Core state
pub mod pool;
pub mod commitment_tree;
pub mod deposit;
pub mod nullifier;
pub mod redemption;
pub mod btc_light_client;
pub mod block_header;
pub mod stealth_announcement;

// Re-exports
pub use pool::*;
pub use commitment_tree::*;
pub use deposit::*;
pub use nullifier::*;
pub use redemption::*;
pub use btc_light_client::*;
pub use block_header::*;
pub use stealth_announcement::*;
