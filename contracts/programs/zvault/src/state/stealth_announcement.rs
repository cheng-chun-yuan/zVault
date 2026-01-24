//! Stealth announcement account state (zero-copy)
//!
//! V1 (Legacy): 50-byte format with single X25519 ephemeral pubkey
//! V2 (New): 148-byte format with dual ECDH (X25519 viewing + Grumpkin spending)
//!
//! V2 Privacy Properties:
//! - No recipient hint (prevents linking deposits to same recipient)
//! - Dual ephemeral pubkeys: X25519 for scanning, Grumpkin for spending proofs
//! - Viewing key can decrypt but CANNOT derive nullifier (no spending)

use pinocchio::program_error::ProgramError;

/// Account discriminator for StealthAnnouncement (V1)
pub const STEALTH_ANNOUNCEMENT_DISCRIMINATOR: u8 = 0x06;

/// Account discriminator for StealthAnnouncementV2
pub const STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR: u8 = 0x08;

/// Stealth announcement account size (V1 minimal format)
pub const STEALTH_ANNOUNCEMENT_SIZE: usize = 1 + // discriminator
    1 + // bump
    32 + // ephemeral_pubkey (required for ECDH)
    8 + // encrypted_amount (required to compute commitment)
    8; // created_at = 50 bytes

/// Stealth announcement V2 account size (SIMPLIFIED dual-key ECDH format)
///
/// SECURITY IMPROVEMENTS:
/// - Removed encrypted_amount (8 bytes): BTC amount is public on blockchain, store directly
/// - Removed encrypted_random (32 bytes): Ephemeral key uniqueness is sufficient
/// - Total savings: 40 bytes (155 → 131 bytes on-chain, plus 43 bytes in OP_RETURN)
pub const STEALTH_ANNOUNCEMENT_V2_SIZE: usize = 1 + // discriminator
    1 + // bump
    32 + // ephemeral_view_pub (X25519 for scanning)
    33 + // ephemeral_spend_pub (Grumpkin compressed for spending)
    8 + // amount_sats (verified from BTC tx, stored directly)
    32 + // commitment
    8 + // leaf_index (position in Merkle tree)
    8; // created_at = 131 bytes

/// Stealth address announcement for deposit discovery (V1 - Legacy)
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

// ============================================================================
// V2: Dual-Key ECDH Format
// ============================================================================

/// Stealth address announcement V2 for dual-key ECDH (SIMPLIFIED)
///
/// Contains two ephemeral public keys:
/// - X25519 for fast off-chain scanning (viewing key)
/// - Grumpkin for efficient in-circuit spending proofs
///
/// Key Separation:
/// - Viewing key can see amounts but CANNOT derive nullifier
/// - Spending key required for nullifier and proof generation
///
/// SECURITY IMPROVEMENTS:
/// - Amount stored directly (was encrypted, but BTC amount is public anyway)
/// - Random field removed (ephemeral key uniqueness is sufficient)
/// - Commitment uses Poseidon2(notePubKey, amount) - no random
///
/// PDA: [b"stealth_v2", ephemeral_view_pub]
#[repr(C)]
pub struct StealthAnnouncementV2 {
    /// Discriminator (0x08)
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Ephemeral X25519 public key (32 bytes) - for off-chain scanning
    /// Recipient scans: view_shared = ECDH(viewing_priv, ephemeral_view_pub)
    pub ephemeral_view_pub: [u8; 32],

    /// Ephemeral Grumpkin public key (33 bytes compressed) - for spending proofs
    /// Recipient proves: spend_shared = ECDH(spending_priv, ephemeral_spend_pub)
    pub ephemeral_spend_pub: [u8; 33],

    /// Amount in satoshis (verified from BTC transaction, stored directly)
    /// No encryption needed - BTC amount is public on Bitcoin blockchain
    amount_sats_bytes: [u8; 8],

    /// Commitment for Merkle tree verification
    /// commitment = Poseidon2(notePubKey, amount) - simplified, no random
    pub commitment: [u8; 32],

    /// Leaf index in Merkle tree (0 if not from direct deposit)
    /// Set by verify_stealth_deposit instruction
    leaf_index_bytes: [u8; 8],

    /// Timestamp (stored as bytes for alignment)
    created_at_bytes: [u8; 8],
}

impl StealthAnnouncementV2 {
    pub const SEED: &'static [u8] = b"stealth_v2";
    pub const SIZE: usize = STEALTH_ANNOUNCEMENT_V2_SIZE;

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
        data[0] = STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR;

        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }

    /// Parse from bytes (read-only)
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::AccountDataTooSmall);
        }
        if data[0] != STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR {
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
        if data[0] != STEALTH_ANNOUNCEMENT_V2_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }

        let ptr = data.as_mut_ptr() as *mut Self;
        Ok(unsafe { &mut *ptr })
    }
}
