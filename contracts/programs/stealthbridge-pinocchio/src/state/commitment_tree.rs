//! Commitment tree state account (zero-copy)

use pinocchio::program_error::ProgramError;

/// Discriminator for CommitmentTree account
pub const COMMITMENT_TREE_DISCRIMINATOR: u8 = 0x05;

/// Maximum tree depth (supports 2^20 = ~1M commitments)
pub const TREE_DEPTH: usize = 20;

/// Number of historical roots to keep
pub const ROOT_HISTORY_SIZE: usize = 32;

/// Commitment tree for Merkle proofs (zero-copy layout)
#[repr(C)]
pub struct CommitmentTree {
    /// Account discriminator
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Padding for alignment
    _padding: [u8; 6],

    /// Current Merkle root
    pub current_root: [u8; 32],

    /// Number of leaves in the tree
    next_index: [u8; 8],

    /// Historical roots for validation (circular buffer)
    pub root_history: [[u8; 32]; ROOT_HISTORY_SIZE],

    /// Current root history index
    root_history_index: [u8; 4],

    /// Reserved for future use
    _reserved: [u8; 60],
}

impl CommitmentTree {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"commitment_tree";

    /// Maximum number of leaves (2^20 = ~1M)
    pub const MAX_LEAVES: u64 = 1u64 << TREE_DEPTH;

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable from account data
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new commitment tree in the given buffer
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::LEN].fill(0);
        data[0] = COMMITMENT_TREE_DISCRIMINATOR;
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    // Getters
    pub fn next_index(&self) -> u64 {
        u64::from_le_bytes(self.next_index)
    }

    pub fn root_history_index(&self) -> u32 {
        u32::from_le_bytes(self.root_history_index)
    }

    // Setters
    pub fn set_next_index(&mut self, value: u64) {
        self.next_index = value.to_le_bytes();
    }

    pub fn set_root_history_index(&mut self, value: u32) {
        self.root_history_index = value.to_le_bytes();
    }

    /// Check if a root is valid (current or in history)
    pub fn is_valid_root(&self, root: &[u8; 32]) -> bool {
        // Check current root
        if self.current_root == *root {
            return true;
        }

        // Check historical roots
        for historical_root in &self.root_history {
            if historical_root == root {
                return true;
            }
        }

        false
    }

    /// Add new root to history (called after tree update)
    pub fn update_root(&mut self, new_root: [u8; 32]) {
        let index = self.root_history_index() as usize;
        self.root_history[index % ROOT_HISTORY_SIZE] = self.current_root;
        self.set_root_history_index((index + 1) as u32);
        self.current_root = new_root;
    }

    /// Check if tree has capacity for more leaves
    pub fn has_capacity(&self) -> bool {
        self.next_index() < Self::MAX_LEAVES
    }

    /// Insert a new leaf commitment into the tree
    /// Returns the leaf index
    pub fn insert_leaf(&mut self, commitment: &[u8; 32]) -> Result<u64, ProgramError> {
        let index = self.next_index();
        if index >= Self::MAX_LEAVES {
            return Err(ProgramError::InvalidAccountData); // Tree full
        }

        // Note: In a full implementation, we would:
        // 1. Store the commitment at the leaf position
        // 2. Recompute the Merkle path to update the root
        // For now, we do a simplified update that just tracks the commitment

        // Update the root (simplified - in production, recompute merkle path)
        // For now, we hash the old root with the new commitment
        let mut new_root = [0u8; 32];
        for i in 0..32 {
            new_root[i] = self.current_root[i] ^ commitment[i];
        }
        self.update_root(new_root);

        // Increment leaf counter
        self.set_next_index(index + 1);

        Ok(index)
    }
}
