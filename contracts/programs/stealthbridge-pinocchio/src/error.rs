//! Error definitions for ZVault program

use pinocchio::program_error::ProgramError;
use thiserror::Error;

/// Custom error codes for ZVault
/// Starting at 6000 to avoid conflicts with system errors
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ZVaultError {
    #[error("Pool is paused")]
    PoolPaused = 6000,

    #[error("Deposit amount too small")]
    AmountTooSmall = 6001,

    #[error("Deposit amount too large")]
    AmountTooLarge = 6002,

    #[error("Invalid Merkle proof")]
    InvalidMerkleProof = 6003,

    #[error("Nullifier already used (double-spend attempt)")]
    NullifierAlreadyUsed = 6004,

    #[error("Commitment not found in Merkle tree")]
    CommitmentNotFound = 6005,

    #[error("Invalid commitment hash")]
    InvalidCommitment = 6006,

    #[error("Invalid Bitcoin address")]
    InvalidBtcAddress = 6007,

    #[error("Redemption request not found")]
    RedemptionNotFound = 6008,

    #[error("Redemption already completed")]
    RedemptionAlreadyCompleted = 6009,

    #[error("Redemption in invalid state")]
    InvalidRedemptionState = 6010,

    #[error("Unauthorized")]
    Unauthorized = 6011,

    #[error("Insufficient balance")]
    InsufficientBalance = 6012,

    #[error("Arithmetic overflow")]
    Overflow = 6013,

    #[error("Invalid proof length")]
    InvalidProofLength = 6014,

    #[error("Deposit has already been minted")]
    AlreadyMinted = 6015,

    #[error("Amount must be greater than zero")]
    ZeroAmount = 6016,

    #[error("Invalid Bitcoin block header")]
    InvalidBlockHeader = 6017,

    #[error("Insufficient confirmations")]
    InsufficientConfirmations = 6018,

    #[error("Invalid SPV proof")]
    InvalidSpvProof = 6019,

    #[error("Commitment tree is full")]
    TreeFull = 6020,

    #[error("Invalid root")]
    InvalidRoot = 6021,

    #[error("Invalid ZK proof")]
    InvalidZkProof = 6022,

    #[error("ZK proof verification failed")]
    ZkVerificationFailed = 6023,

    #[error("Account not initialized")]
    NotInitialized = 6024,

    #[error("Account already initialized")]
    AlreadyInitialized = 6025,

    #[error("Invalid account owner")]
    InvalidAccountOwner = 6026,

    #[error("Invalid account data")]
    InvalidAccountData = 6027,
}

impl From<ZVaultError> for ProgramError {
    fn from(e: ZVaultError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
