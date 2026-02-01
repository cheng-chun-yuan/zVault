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
    /// Proof verification failed
    VerificationFailed,
    /// Invalid G1 point
    InvalidG1Point,
    /// Invalid G2 point
    InvalidG2Point,
    /// Invalid field element
    InvalidFieldElement,
    /// Pairing check failed
    PairingFailed,
    /// Pairing verification check failed (shplemini)
    PairingCheckFailed,
    /// Sumcheck verification failed
    SumcheckFailed,
    /// Shplemini opening verification failed
    ShpleminiFailed,
    /// Transcript error
    TranscriptError,
    /// BN254 syscall error
    Bn254SyscallError,
    /// Buffer too small
    BufferTooSmall,
    /// Computation overflow
    Overflow,
}

impl From<UltraHonkError> for ProgramError {
    fn from(e: UltraHonkError) -> Self {
        match e {
            UltraHonkError::InvalidProofFormat => ProgramError::InvalidInstructionData,
            UltraHonkError::InvalidVerificationKey => ProgramError::InvalidAccountData,
            UltraHonkError::InvalidPublicInput => ProgramError::InvalidArgument,
            UltraHonkError::VerificationFailed => ProgramError::InvalidArgument,
            UltraHonkError::InvalidG1Point => ProgramError::InvalidArgument,
            UltraHonkError::InvalidG2Point => ProgramError::InvalidArgument,
            UltraHonkError::InvalidFieldElement => ProgramError::InvalidArgument,
            UltraHonkError::PairingFailed => ProgramError::InvalidArgument,
            UltraHonkError::PairingCheckFailed => ProgramError::InvalidArgument,
            UltraHonkError::SumcheckFailed => ProgramError::InvalidArgument,
            UltraHonkError::ShpleminiFailed => ProgramError::InvalidArgument,
            UltraHonkError::TranscriptError => ProgramError::InvalidArgument,
            UltraHonkError::Bn254SyscallError => ProgramError::InvalidArgument,
            UltraHonkError::BufferTooSmall => ProgramError::AccountDataTooSmall,
            UltraHonkError::Overflow => ProgramError::ArithmeticOverflow,
        }
    }
}
