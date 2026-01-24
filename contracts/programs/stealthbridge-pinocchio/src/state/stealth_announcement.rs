//! Stealth announcement account state (zero-copy)
//!
//! Minimal 40-byte format for maximum privacy:
//! - No recipient_hint (prevents linking multiple deposits to same recipient)
//! - No commitment (recipient computes from nullifier/secret/amount)
//! - No leaf_index (can be emitted in logs or searched)

use pinocchio::program_error::ProgramError;

/// Account discriminator for StealthAnnouncement
pub const STEALTH_ANNOUNCEMENT_DISCRIMINATOR: u8 = 0x06;

/// Stealth announcement account size (minimal format)
pub const STEALTH_ANNOUNCEMENT_SIZE: usize = 1 + // discriminator
    1 + // bump
    32 + // ephemeral_pubkey (required for ECDH)
    8 + // encrypted_amount (required to compute commitment)
    8; // created_at = 50 bytes

/// Stealth address announcement for deposit discovery
///
/// Minimal format - recipient must try ECDH on all announcements
/// but no linkability between deposits to same recipient.
///
/// PDA: [b"stealth", ephemeral_pubkey]
#[repr(C)]
pub struct StealthAnnouncement {
    /// Discriminator (0x06)
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Ephemeral X25519 public key for ECDH
    /// Recipient uses: shared_secret = ECDH(view_priv_key, ephemeral_pubkey)
    pub ephemeral_pubkey: [u8; 32],

    /// Encrypted amount (XOR with derived key)
    /// Recipient decrypts to get amount for commitment computation
    pub encrypted_amount: [u8; 8],

    /// Timestamp (stored as bytes for alignment)
    created_at_bytes: [u8; 8],
}

impl StealthAnnouncement {
    pub const SEED: &'static [u8] = b"stealth";
    pub const SIZE: usize = STEALTH_ANNOUNCEMENT_SIZE;

    /// Get created_at as i64
    pub fn created_at(&self) -> i64 {
        i64::from_le_bytes(self.created_at_bytes)
    }

    /// Set created_at
    pub fn set_created_at(&mut self, value: i64) {
        self.created_at_bytes = value.to_le_bytes();
    }

    /// Initialize from mutable bytes
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }

        // Zero initialize
        data[..Self::SIZE].fill(0);
        data[0] = STEALTH_ANNOUNCEMENT_DISCRIMINATOR;

        // Safe because we checked size and initialized
        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }

    /// Parse from bytes (read-only)
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
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
        if data[0] != STEALTH_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }

        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }
}
