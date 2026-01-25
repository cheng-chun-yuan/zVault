//! Stealth announcement account state (zero-copy)
//!
//! EIP-5564/DKSAP Single Ephemeral Key Pattern:
//! - Single Grumpkin ephemeral key for ECDH stealth derivation
//! - Recipient uses viewing key to detect, spending key to claim
//!
//! Privacy Properties:
//! - No recipient hint (prevents linking deposits to same recipient)
//! - Single ephemeral pubkey: Grumpkin for stealth address derivation
//! - Viewing key can detect but CANNOT derive stealth private key
//!
//! Stealth Address Flow:
//! - Sender: stealthPub = spendingPub + hash(ECDH(ephemeral, viewingPub)) * G
//! - Recipient: stealthPriv = spendingPriv + hash(ECDH(viewingPriv, ephemeralPub))

use pinocchio::program_error::ProgramError;

/// Account discriminator for StealthAnnouncement
pub const STEALTH_ANNOUNCEMENT_DISCRIMINATOR: u8 = 0x08;

/// Stealth announcement account size (single ephemeral key)
///
/// Layout (98 bytes):
/// - discriminator (1 byte)
/// - bump (1 byte)
/// - ephemeral_pub (33 bytes, Grumpkin compressed)
/// - amount_sats (8 bytes, verified from BTC tx)
/// - commitment (32 bytes)
/// - leaf_index (8 bytes, position in Merkle tree)
/// - created_at (8 bytes)
pub const STEALTH_ANNOUNCEMENT_SIZE: usize = 1 + // discriminator
    1 + // bump
    33 + // ephemeral_pub (single Grumpkin key)
    8 + // amount_sats (verified from BTC tx, stored directly)
    32 + // commitment
    8 + // leaf_index (position in Merkle tree)
    8; // created_at = 98 bytes (saved 33 bytes from dual-key format)

/// Stealth address announcement with single ephemeral key
///
/// Uses EIP-5564/DKSAP pattern with single Grumpkin ephemeral key:
/// - sharedSecret = ECDH(ephemeralPriv, viewingPub) [sender]
/// - sharedSecret = ECDH(viewingPriv, ephemeralPub) [recipient]
/// - stealthPub = spendingPub + hash(sharedSecret) * G
///
/// Key Separation:
/// - Viewing key can detect deposits but CANNOT derive stealthPriv
/// - Spending key required for stealthPriv and nullifier derivation
///
/// Security Properties:
/// - Amount stored directly (BTC amount is public on Bitcoin blockchain)
/// - Commitment = Poseidon2(stealthPub.x, amount)
///
/// PDA: [b"stealth", ephemeral_pub]
#[repr(C)]
pub struct StealthAnnouncement {
    /// Discriminator (0x08)
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Single Grumpkin ephemeral public key (33 bytes compressed)
    /// Recipient: sharedSecret = ECDH(viewingPriv, ephemeral_pub)
    /// Then: stealthPub = spendingPub + hash(sharedSecret) * G
    pub ephemeral_pub: [u8; 33],

    /// Amount in satoshis (verified from BTC transaction, stored directly)
    /// No encryption needed - BTC amount is public on Bitcoin blockchain
    amount_sats_bytes: [u8; 8],

    /// Commitment for Merkle tree verification
    /// commitment = Poseidon2(stealthPub.x, amount)
    pub commitment: [u8; 32],

    /// Leaf index in Merkle tree (0 if not from direct deposit)
    /// Set by verify_stealth_deposit instruction
    leaf_index_bytes: [u8; 8],

    /// Timestamp (stored as bytes for alignment)
    created_at_bytes: [u8; 8],
}

impl StealthAnnouncement {
    pub const SEED: &'static [u8] = b"stealth";
    pub const SIZE: usize = STEALTH_ANNOUNCEMENT_SIZE;

    /// Get amount_sats as u64
    pub fn amount_sats(&self) -> u64 {
        u64::from_le_bytes(self.amount_sats_bytes)
    }

    /// Set amount_sats
    pub fn set_amount_sats(&mut self, value: u64) {
        self.amount_sats_bytes = value.to_le_bytes();
    }

    /// Get leaf_index as u64
    pub fn leaf_index(&self) -> u64 {
        u64::from_le_bytes(self.leaf_index_bytes)
    }

    /// Set leaf_index
    pub fn set_leaf_index(&mut self, value: u64) {
        self.leaf_index_bytes = value.to_le_bytes();
    }

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
