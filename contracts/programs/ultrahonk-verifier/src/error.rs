//! UltraHonk verification errors

use pinocchio::program_error::ProgramError;

/// Errors that can occur during UltraHonk proof verification
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UltraHonkError {
    /// Invalid proof format
    InvalidProofFormat,
    /// Invalid verification key
    InvalidVerificationKey,
    /// Invalid public input
    InvalidPublicInput,
    /// Invalid G1 point
    InvalidG1Point,
    /// Invalid G2 point
    InvalidG2Point,
    /// Invalid field element
    InvalidFieldElement,
    /// Pairing verification check failed (shplemini)
    PairingCheckFailed,
    /// BN254 syscall error
    Bn254SyscallError,
    /// VK hash mismatch - computed hash doesn't match provided hash
    VkHashMismatch,
}

impl From<UltraHonkError> for ProgramError {
    fn from(e: UltraHonkError) -> Self {
        match e {
            UltraHonkError::InvalidProofFormat => ProgramError::InvalidInstructionData,
            UltraHonkError::InvalidVerificationKey => ProgramError::InvalidAccountData,
            UltraHonkError::InvalidPublicInput => ProgramError::InvalidArgument,
            UltraHonkError::InvalidG1Point => ProgramError::InvalidArgument,
            UltraHonkError::InvalidG2Point => ProgramError::InvalidArgument,
            UltraHonkError::InvalidFieldElement => ProgramError::InvalidArgument,
            UltraHonkError::PairingCheckFailed => ProgramError::InvalidArgument,
            UltraHonkError::Bn254SyscallError => ProgramError::InvalidArgument,
            UltraHonkError::VkHashMismatch => ProgramError::InvalidArgument,
        }
    }
}
