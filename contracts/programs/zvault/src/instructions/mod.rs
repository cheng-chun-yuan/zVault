//! Instruction handlers
//!
//! Main operations:
//! - verify_deposit: Verify BTC deposit via SPV and add commitment to tree
//! - claim: Claim sbBTC tokens with ZK proof
//! - split_commitment: Split 1 commitment into 2 outputs
//! - request_redemption: Request BTC withdrawal (burn sbBTC)
//! - complete_redemption: Relayer completes BTC withdrawal
//! - announce_stealth: Create stealth address announcement (ECDH)
//!
//! V2 RAILGUN-style operations:
//! - announce_stealth_v2: Dual-key ECDH announcement (X25519 + Grumpkin)
//! - register_viewing_key: Create viewing key registry for delegation
//! - delegate_viewing_key: Add/revoke delegated viewing keys
//!
//! Optional .zkey name registry:
//! - register_name: Register a human-readable name (e.g., "albert.zkey")
//! - update_name: Update keys for a registered name
//! - transfer_name: Transfer ownership of a name

pub mod initialize;
pub mod claim;
pub mod split_commitment;
pub mod request_redemption;
pub mod complete_redemption;
pub mod verify_deposit;
pub mod add_demo_commitment;
pub mod announce_stealth;
pub mod announce_stealth_v2;
pub mod register_viewing_key;
pub mod delegate_viewing_key;
pub mod register_name;
pub mod verify_stealth_deposit;

pub use initialize::*;
pub use claim::*;
pub use split_commitment::*;
pub use request_redemption::*;
pub use complete_redemption::*;
pub use verify_deposit::*;
pub use add_demo_commitment::*;
pub use announce_stealth::*;
pub use announce_stealth_v2::*;
pub use register_viewing_key::*;
pub use delegate_viewing_key::*;
pub use register_name::*;
pub use verify_stealth_deposit::*;
