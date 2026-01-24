//! Instruction handlers
//!
//! Simplified to 6 main operations:
//! - verify_deposit: Verify BTC deposit via SPV and add commitment to tree
//! - claim: Claim sbBTC tokens with ZK proof
//! - split_commitment: Split 1 commitment into 2 outputs
//! - request_redemption: Request BTC withdrawal (burn sbBTC)
//! - complete_redemption: Relayer completes BTC withdrawal
//! - announce_stealth: Create stealth address announcement (ECDH)

pub mod initialize;
pub mod claim;
pub mod split_commitment;
pub mod request_redemption;
pub mod complete_redemption;
pub mod verify_deposit;
pub mod add_demo_commitment;
pub mod announce_stealth;

pub use initialize::*;
pub use claim::*;
pub use split_commitment::*;
pub use request_redemption::*;
pub use complete_redemption::*;
pub use verify_deposit::*;
pub use add_demo_commitment::*;
pub use announce_stealth::*;
