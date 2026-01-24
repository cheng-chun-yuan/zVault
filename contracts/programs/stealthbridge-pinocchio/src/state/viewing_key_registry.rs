//! Viewing Key Registry account state (zero-copy)
//!
//! Optional on-chain registry for viewing key delegation.
//! Allows users to register delegated viewing keys for auditors/compliance.
//!
//! Features:
//! - Up to 4 delegated viewing keys per user
//! - Permission flags for each delegate (scan, history, incoming-only)
//! - On-chain verification of delegation relationships

use pinocchio::program_error::ProgramError;

/// Account discriminator for ViewingKeyRegistry
pub const VIEWING_KEY_REGISTRY_DISCRIMINATOR: u8 = 0x07;

/// Maximum number of delegated viewing keys per registry
pub const MAX_DELEGATES: usize = 4;

/// Permission flags for delegated viewing keys
pub mod permissions {
    /// Can scan announcements and see amounts
    pub const SCAN: u8 = 1 << 0;
    /// Can see full transaction history
    pub const HISTORY: u8 = 1 << 1;
    /// Can only see incoming transactions
    pub const INCOMING_ONLY: u8 = 1 << 2;
    /// Full viewing access (scan + history)
    pub const FULL: u8 = SCAN | HISTORY;
}

/// Viewing key registry account size
pub const VIEWING_KEY_REGISTRY_SIZE: usize = 1 + // discriminator
    1 + // bump
    32 + // spending_pubkey (owner identity)
    32 + // viewing_pubkey (current view key)
    (32 * MAX_DELEGATES) + // delegated_keys (4 * 32 = 128)
    MAX_DELEGATES + // delegated_permissions (4 bytes)
    1 + // delegation_count
    32; // _reserved = 229 bytes

/// Viewing key registry for delegation management
///
/// PDA: [b"viewing_registry", spending_pubkey]
#[repr(C)]
pub struct ViewingKeyRegistry {
    /// Discriminator (0x07)
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Owner's Grumpkin spending public key (33 bytes compressed, padded to 32)
    /// Note: We store only x-coordinate for space efficiency
    pub spending_pubkey: [u8; 32],

    /// Owner's current X25519 viewing public key
    pub viewing_pubkey: [u8; 32],

    /// Delegated viewing public keys (up to 4)
    pub delegated_keys: [[u8; 32]; MAX_DELEGATES],

    /// Permission flags for each delegate
    pub delegated_permissions: [u8; MAX_DELEGATES],

    /// Number of active delegations (0-4)
    pub delegation_count: u8,

    /// Reserved for future expansion
    _reserved: [u8; 32],
}

impl ViewingKeyRegistry {
    pub const SEED: &'static [u8] = b"viewing_registry";
    pub const SIZE: usize = VIEWING_KEY_REGISTRY_SIZE;

    /// Initialize from mutable bytes
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }

        // Zero initialize
        data[..Self::SIZE].fill(0);
        data[0] = VIEWING_KEY_REGISTRY_DISCRIMINATOR;

        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }

    /// Parse from bytes (read-only)
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != VIEWING_KEY_REGISTRY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }

        let ptr = data.as_ptr() as *const Self;
        Ok(unsafe { &*ptr })
    }

    /// Parse from bytes (mutable)
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != VIEWING_KEY_REGISTRY_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }

        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }

    /// Add a delegated viewing key
    ///
    /// Returns error if max delegates reached
    pub fn add_delegate(
        &mut self,
        viewing_key: [u8; 32],
        permissions: u8,
    ) -> Result<usize, ProgramError> {
        if self.delegation_count >= MAX_DELEGATES as u8 {
            return Err(ProgramError::InvalidArgument);
        }

        let index = self.delegation_count as usize;
        self.delegated_keys[index] = viewing_key;
        self.delegated_permissions[index] = permissions;
        self.delegation_count += 1;

        Ok(index)
    }

    /// Remove a delegated viewing key by index
    pub fn remove_delegate(&mut self, index: usize) -> Result<(), ProgramError> {
        if index >= self.delegation_count as usize {
            return Err(ProgramError::InvalidArgument);
        }

        // Shift remaining delegates down
        let count = self.delegation_count as usize;
        for i in index..(count - 1) {
            self.delegated_keys[i] = self.delegated_keys[i + 1];
            self.delegated_permissions[i] = self.delegated_permissions[i + 1];
        }

        // Clear last slot
        self.delegated_keys[count - 1] = [0u8; 32];
        self.delegated_permissions[count - 1] = 0;
        self.delegation_count -= 1;

        Ok(())
    }

    /// Check if a viewing key is delegated
    pub fn is_delegated(&self, viewing_key: &[u8; 32]) -> bool {
        for i in 0..self.delegation_count as usize {
            if self.delegated_keys[i] == *viewing_key {
                return true;
            }
        }
        false
    }

    /// Get permissions for a delegated key
    pub fn get_delegate_permissions(&self, viewing_key: &[u8; 32]) -> Option<u8> {
        for i in 0..self.delegation_count as usize {
            if self.delegated_keys[i] == *viewing_key {
                return Some(self.delegated_permissions[i]);
            }
        }
        None
    }

    /// Check if a delegate has a specific permission
    pub fn has_permission(&self, viewing_key: &[u8; 32], permission: u8) -> bool {
        self.get_delegate_permissions(viewing_key)
            .map(|p| p & permission == permission)
            .unwrap_or(false)
    }

    /// Update permissions for a delegated key
    pub fn update_delegate_permissions(
        &mut self,
        viewing_key: &[u8; 32],
        new_permissions: u8,
    ) -> Result<(), ProgramError> {
        for i in 0..self.delegation_count as usize {
            if self.delegated_keys[i] == *viewing_key {
                self.delegated_permissions[i] = new_permissions;
                return Ok(());
            }
        }
        Err(ProgramError::InvalidArgument)
    }
}
