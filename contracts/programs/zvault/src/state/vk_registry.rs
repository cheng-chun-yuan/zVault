//! Verification Key Registry state account
//!
//! Stores Groth16 verification keys on-chain for different circuit types.
//! This enables secure, upgradeable verification without redeploying the program.

use pinocchio::program_error::ProgramError;
use pinocchio::account_info::AccountInfo;
use pinocchio::pubkey::Pubkey;

/// Discriminator for VK Registry account
pub const VK_REGISTRY_DISCRIMINATOR: u8 = 0x14;

/// Circuit types that require verification keys
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CircuitType {
    /// Split commitment (4 public inputs)
    Split = 0,
    /// Private transfer (3 public inputs)
    Transfer = 1,
    /// Pool deposit (4 public inputs)
    PoolDeposit = 2,
    /// Pool withdraw (6 public inputs)
    PoolWithdraw = 3,
    /// Pool compound yield (5 public inputs)
    PoolCompound = 4,
    /// Pool claim yield (7 public inputs)
    PoolClaimYield = 5,
    /// Request redemption (3 public inputs)
    Redemption = 6,
}

impl CircuitType {
    /// Number of public inputs for this circuit type
    pub fn num_public_inputs(&self) -> usize {
        match self {
            CircuitType::Split => 4,
            CircuitType::Transfer => 3,
            CircuitType::PoolDeposit => 4,
            CircuitType::PoolWithdraw => 6,
            CircuitType::PoolCompound => 5,
            CircuitType::PoolClaimYield => 7,
            CircuitType::Redemption => 3,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(CircuitType::Split),
            1 => Some(CircuitType::Transfer),
            2 => Some(CircuitType::PoolDeposit),
            3 => Some(CircuitType::PoolWithdraw),
            4 => Some(CircuitType::PoolCompound),
            5 => Some(CircuitType::PoolClaimYield),
            6 => Some(CircuitType::Redemption),
            _ => None,
        }
    }
}

/// On-chain verification key storage
///
/// Layout (1024 bytes total):
/// - discriminator: 1 byte
/// - circuit_type: 1 byte
/// - version: 2 bytes (for upgrades)
/// - authority: 32 bytes (who can update)
/// - alpha: 64 bytes (G1)
/// - beta: 128 bytes (G2)
/// - gamma: 128 bytes (G2)
/// - delta: 128 bytes (G2)
/// - ic_length: 1 byte
/// - ic: 512 bytes (8 x 64 bytes for G1 points)
/// - reserved: 27 bytes
#[repr(C)]
pub struct VkRegistry {
    /// Account discriminator
    pub discriminator: u8,
    /// Circuit type this VK is for
    pub circuit_type: u8,
    /// Version number for VK upgrades
    version: [u8; 2],
    /// Authority that can update this VK
    pub authority: [u8; 32],
    /// Alpha point (G1)
    pub alpha: [u8; 64],
    /// Beta point (G2)
    pub beta: [u8; 128],
    /// Gamma point (G2)
    pub gamma: [u8; 128],
    /// Delta point (G2)
    pub delta: [u8; 128],
    /// Number of IC points (public inputs + 1)
    pub ic_length: u8,
    /// IC points (G1) - max 8 for 7 public inputs
    pub ic: [[u8; 64]; 8],
    /// Reserved for future use
    _reserved: [u8; 27],
}

impl VkRegistry {
    pub const SIZE: usize = 1024;
    pub const SEED: &'static [u8] = b"vk_registry";

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != VK_REGISTRY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != VK_REGISTRY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new VK registry
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::SIZE].fill(0);
        data[0] = VK_REGISTRY_DISCRIMINATOR;
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Get version number
    pub fn version(&self) -> u16 {
        u16::from_le_bytes(self.version)
    }

    /// Set version number
    pub fn set_version(&mut self, value: u16) {
        self.version = value.to_le_bytes();
    }

    /// Check if authority matches
    pub fn is_authority(&self, pubkey: &[u8; 32]) -> bool {
        self.authority == *pubkey
    }

    /// Get circuit type
    pub fn get_circuit_type(&self) -> Option<CircuitType> {
        CircuitType::from_u8(self.circuit_type)
    }
}

/// Load verification key from on-chain VK registry account
///
/// # Arguments
/// * `vk_account` - The VK registry account
/// * `expected_circuit` - The circuit type we need the VK for
/// * `program_id` - The program ID (to verify ownership)
///
/// # Returns
/// A VerificationKey struct loaded from the account
pub fn load_verification_key(
    vk_account: &AccountInfo,
    expected_circuit: CircuitType,
    program_id: &Pubkey,
) -> Result<crate::utils::groth16::VerificationKey, ProgramError> {
    // Verify account owner
    if vk_account.owner() != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let data = vk_account.try_borrow_data()?;
    let registry = VkRegistry::from_bytes(&data)?;

    // Verify circuit type matches
    if registry.circuit_type != expected_circuit as u8 {
        return Err(ProgramError::InvalidArgument);
    }

    // Convert to VerificationKey
    Ok(crate::utils::groth16::VerificationKey {
        alpha: registry.alpha,
        beta: registry.beta,
        gamma: registry.gamma,
        delta: registry.delta,
        ic_length: registry.ic_length,
        ic: registry.ic,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_type_public_inputs() {
        assert_eq!(CircuitType::Split.num_public_inputs(), 4);
        assert_eq!(CircuitType::Transfer.num_public_inputs(), 3);
        assert_eq!(CircuitType::PoolClaimYield.num_public_inputs(), 7);
    }

    #[test]
    fn test_vk_registry_size() {
        assert_eq!(VkRegistry::SIZE, 1024);
    }
}
