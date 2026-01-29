//! Yield pool state accounts (zero-copy)
//!
//! Privacy-preserving yield pool where users can deposit zkBTC,
//! earn yield, and manage positions without revealing their identity.

use pinocchio::program_error::ProgramError;

/// Discriminator for YieldPool account
pub const YIELD_POOL_DISCRIMINATOR: u8 = 0x10;

/// Discriminator for PoolNullifierRecord account
pub const POOL_NULLIFIER_RECORD_DISCRIMINATOR: u8 = 0x11;

/// Discriminator for PoolCommitmentTree account (separate from main tree)
pub const POOL_COMMITMENT_TREE_DISCRIMINATOR: u8 = 0x12;

/// Discriminator for StealthPoolAnnouncement account
pub const STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR: u8 = 0x13;

/// Type of operation that spent the pool nullifier
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolOperationType {
    /// Deposit into pool
    Deposit = 0,
    /// Claim yield (keep principal staked)
    ClaimYield = 1,
    /// Full withdrawal (principal + yield)
    Withdraw = 2,
    /// Compound yield into principal
    Compound = 3,
}

/// Yield pool state account (zero-copy layout)
/// All multi-byte integers stored as little-endian byte arrays for alignment safety
#[repr(C)]
pub struct YieldPool {
    /// Account discriminator (1 byte)
    pub discriminator: u8,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Flags: bit 0 = paused
    pub flags: u8,

    /// Padding for alignment
    _padding: u8,

    /// Unique pool identifier (8 bytes)
    pub pool_id: [u8; 8],

    /// Annual yield rate in basis points (e.g., 500 = 5%) - governance controlled
    yield_rate_bps: [u8; 2],

    /// Padding for alignment
    _padding2: [u8; 6],

    /// Total number of deposits (positions created)
    total_deposits: [u8; 8],

    /// Total number of withdrawals (positions exited)
    total_withdrawals: [u8; 8],

    /// Current yield epoch
    current_epoch: [u8; 8],

    /// Epoch duration in seconds
    epoch_duration: [u8; 8],

    /// Total principal in pool (sum of all active principal)
    total_principal: [u8; 8],

    /// Cumulative yield distributed
    total_yield_distributed: [u8; 8],

    /// Available yield from DeFi integration (yield reserve)
    yield_reserve: [u8; 8],

    /// External DeFi vault address (e.g., Kamino, Solend)
    pub defi_vault: [u8; 32],

    /// Last yield harvest timestamp
    last_harvest: [u8; 8],

    /// Pool-specific commitment tree reference
    pub commitment_tree: [u8; 32],

    /// Authority (governance) that can update pool config
    pub authority: [u8; 32],

    /// Pool creation timestamp
    created_at: [u8; 8],

    /// Last update timestamp
    last_update: [u8; 8],

    /// Reserved for future use
    _reserved: [u8; 64],
}

impl YieldPool {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"yield_pool";

    const FLAG_PAUSED: u8 = 1 << 0;

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != YIELD_POOL_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable from account data
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != YIELD_POOL_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new yield pool in the given buffer
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::LEN].fill(0);
        data[0] = YIELD_POOL_DISCRIMINATOR;
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    // Getters
    pub fn is_paused(&self) -> bool {
        self.flags & Self::FLAG_PAUSED != 0
    }

    pub fn yield_rate_bps(&self) -> u16 {
        u16::from_le_bytes(self.yield_rate_bps)
    }

    pub fn total_deposits(&self) -> u64 {
        u64::from_le_bytes(self.total_deposits)
    }

    pub fn total_withdrawals(&self) -> u64 {
        u64::from_le_bytes(self.total_withdrawals)
    }

    pub fn current_epoch(&self) -> u64 {
        u64::from_le_bytes(self.current_epoch)
    }

    pub fn epoch_duration(&self) -> i64 {
        i64::from_le_bytes(self.epoch_duration)
    }

    pub fn total_principal(&self) -> u64 {
        u64::from_le_bytes(self.total_principal)
    }

    pub fn total_yield_distributed(&self) -> u64 {
        u64::from_le_bytes(self.total_yield_distributed)
    }

    pub fn yield_reserve(&self) -> u64 {
        u64::from_le_bytes(self.yield_reserve)
    }

    pub fn last_harvest(&self) -> i64 {
        i64::from_le_bytes(self.last_harvest)
    }

    pub fn created_at(&self) -> i64 {
        i64::from_le_bytes(self.created_at)
    }

    pub fn last_update(&self) -> i64 {
        i64::from_le_bytes(self.last_update)
    }

    // Setters
    pub fn set_paused(&mut self, paused: bool) {
        if paused {
            self.flags |= Self::FLAG_PAUSED;
        } else {
            self.flags &= !Self::FLAG_PAUSED;
        }
    }

    pub fn set_yield_rate_bps(&mut self, value: u16) {
        self.yield_rate_bps = value.to_le_bytes();
    }

    pub fn set_total_deposits(&mut self, value: u64) {
        self.total_deposits = value.to_le_bytes();
    }

    pub fn set_total_withdrawals(&mut self, value: u64) {
        self.total_withdrawals = value.to_le_bytes();
    }

    pub fn set_current_epoch(&mut self, value: u64) {
        self.current_epoch = value.to_le_bytes();
    }

    pub fn set_epoch_duration(&mut self, value: i64) {
        self.epoch_duration = value.to_le_bytes();
    }

    pub fn set_total_principal(&mut self, value: u64) {
        self.total_principal = value.to_le_bytes();
    }

    pub fn set_total_yield_distributed(&mut self, value: u64) {
        self.total_yield_distributed = value.to_le_bytes();
    }

    pub fn set_yield_reserve(&mut self, value: u64) {
        self.yield_reserve = value.to_le_bytes();
    }

    pub fn set_last_harvest(&mut self, value: i64) {
        self.last_harvest = value.to_le_bytes();
    }

    pub fn set_created_at(&mut self, value: i64) {
        self.created_at = value.to_le_bytes();
    }

    pub fn set_last_update(&mut self, value: i64) {
        self.last_update = value.to_le_bytes();
    }

    // Increment helpers with overflow check
    pub fn increment_total_deposits(&mut self) -> Result<(), ProgramError> {
        let count = self.total_deposits();
        self.set_total_deposits(count.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn increment_total_withdrawals(&mut self) -> Result<(), ProgramError> {
        let count = self.total_withdrawals();
        self.set_total_withdrawals(count.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn add_principal(&mut self, amount: u64) -> Result<(), ProgramError> {
        let total = self.total_principal();
        self.set_total_principal(total.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn sub_principal(&mut self, amount: u64) -> Result<(), ProgramError> {
        let total = self.total_principal();
        self.set_total_principal(total.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn add_yield_distributed(&mut self, amount: u64) -> Result<(), ProgramError> {
        let total = self.total_yield_distributed();
        self.set_total_yield_distributed(total.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn add_yield_reserve(&mut self, amount: u64) -> Result<(), ProgramError> {
        let total = self.yield_reserve();
        self.set_yield_reserve(total.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    pub fn sub_yield_reserve(&mut self, amount: u64) -> Result<(), ProgramError> {
        let total = self.yield_reserve();
        self.set_yield_reserve(total.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?);
        Ok(())
    }

    /// Calculate yield for a given principal over epochs
    ///
    /// Uses checked arithmetic to prevent silent overflow.
    /// Returns error if calculation would overflow.
    ///
    /// Formula: yield = (principal * epochs * rate_bps) / 10000
    pub fn calculate_yield_checked(
        &self,
        principal: u64,
        epochs_staked: u64,
    ) -> Result<u64, ProgramError> {
        use crate::constants::{MAX_POOL_PRINCIPAL, MAX_YIELD_EPOCHS};

        // Bounds validation - prevents overflow in multiplication
        if principal > MAX_POOL_PRINCIPAL {
            return Err(ProgramError::ArithmeticOverflow);
        }
        if epochs_staked > MAX_YIELD_EPOCHS {
            return Err(ProgramError::ArithmeticOverflow);
        }

        let rate = self.yield_rate_bps() as u64;

        // Safe multiplication with checked arithmetic
        let step1 = principal
            .checked_mul(epochs_staked)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        let step2 = step1
            .checked_mul(rate)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        Ok(step2 / 10000)
    }

    /// Advance epoch if enough time has passed
    pub fn try_advance_epoch(&mut self, current_timestamp: i64) -> bool {
        let duration = self.epoch_duration();
        if duration <= 0 {
            return false;
        }

        let last = self.last_update();
        if current_timestamp - last >= duration {
            let epochs_passed = ((current_timestamp - last) / duration) as u64;
            let new_epoch = self.current_epoch().saturating_add(epochs_passed);
            self.set_current_epoch(new_epoch);
            self.set_last_update(current_timestamp);
            true
        } else {
            false
        }
    }
}

/// Pool-specific nullifier record to prevent double-spending of pool positions
#[repr(C)]
pub struct PoolNullifierRecord {
    /// Account discriminator
    pub discriminator: u8,

    /// Type of operation that spent this nullifier
    pub operation_type: u8,

    /// Padding for alignment
    _padding: [u8; 6],

    /// The nullifier hash (Poseidon2 hash of nullifier)
    pub nullifier_hash: [u8; 32],

    /// Timestamp when this nullifier was spent
    spent_at: [u8; 8],

    /// Pool ID this nullifier belongs to
    pub pool_id: [u8; 8],

    /// Epoch at the time of operation
    epoch_at_operation: [u8; 8],

    /// User who spent this nullifier (signer)
    pub spent_by: [u8; 32],

    /// Reserved for future use
    _reserved: [u8; 8],
}

impl PoolNullifierRecord {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"pool_nullifier";

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != POOL_NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable from account data
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != POOL_NULLIFIER_RECORD_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new pool nullifier record in the given buffer
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::LEN].fill(0);
        data[0] = POOL_NULLIFIER_RECORD_DISCRIMINATOR;
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    // Getters
    pub fn get_operation_type(&self) -> PoolOperationType {
        match self.operation_type {
            0 => PoolOperationType::Deposit,
            1 => PoolOperationType::ClaimYield,
            2 => PoolOperationType::Withdraw,
            3 => PoolOperationType::Compound,
            _ => PoolOperationType::Deposit,
        }
    }

    pub fn spent_at(&self) -> i64 {
        i64::from_le_bytes(self.spent_at)
    }

    pub fn epoch_at_operation(&self) -> u64 {
        u64::from_le_bytes(self.epoch_at_operation)
    }

    // Setters
    pub fn set_operation_type(&mut self, op_type: PoolOperationType) {
        self.operation_type = op_type as u8;
    }

    pub fn set_spent_at(&mut self, value: i64) {
        self.spent_at = value.to_le_bytes();
    }

    pub fn set_epoch_at_operation(&mut self, value: u64) {
        self.epoch_at_operation = value.to_le_bytes();
    }
}

/// Pool-specific commitment tree for yield pool positions
/// Uses same structure as main commitment tree but with different discriminator
#[repr(C)]
pub struct PoolCommitmentTree {
    /// Account discriminator
    pub discriminator: u8,

    /// Bump seed
    pub bump: u8,

    /// Padding for alignment
    _padding: [u8; 6],

    /// Pool ID this tree belongs to
    pub pool_id: [u8; 8],

    /// Current Merkle root
    pub current_root: [u8; 32],

    /// Number of leaves in the tree
    next_index: [u8; 8],

    /// Historical roots for validation (circular buffer)
    pub root_history: [[u8; 32]; 32],

    /// Current root history index
    root_history_index: [u8; 4],

    /// Reserved for future use
    _reserved: [u8; 52],
}

impl PoolCommitmentTree {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"pool_commitment_tree";
    pub const TREE_DEPTH: usize = 20;
    pub const ROOT_HISTORY_SIZE: usize = 32;

    /// Maximum number of leaves (2^20 = ~1M)
    pub const MAX_LEAVES: u64 = 1u64 << Self::TREE_DEPTH;

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != POOL_COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable from account data
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != POOL_COMMITMENT_TREE_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new pool commitment tree in the given buffer
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::LEN].fill(0);
        data[0] = POOL_COMMITMENT_TREE_DISCRIMINATOR;
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
        if self.current_root == *root {
            return true;
        }

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
        self.root_history[index % Self::ROOT_HISTORY_SIZE] = self.current_root;
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

        // Simplified update: XOR with new commitment
        // In production, properly recompute merkle path
        let mut new_root = [0u8; 32];
        for i in 0..32 {
            new_root[i] = self.current_root[i] ^ commitment[i];
        }
        self.update_root(new_root);

        self.set_next_index(index + 1);

        Ok(index)
    }
}

/// Stealth pool announcement for yield pool positions
///
/// Uses EIP-5564/DKSAP pattern with single ephemeral Grumpkin key:
/// - Sender generates ephemeral keypair
/// - sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
/// - stealthPub = spendingPub + hash(sharedSecret) * G
/// - poolCommitment = Poseidon2(stealthPub.x, principal, depositEpoch)
///
/// Recipient can scan with viewing key but needs spending key to claim.
#[repr(C)]
pub struct StealthPoolAnnouncement {
    /// Account discriminator
    pub discriminator: u8,

    /// Bump seed for PDA
    pub bump: u8,

    /// Padding for alignment
    _padding: [u8; 6],

    /// Pool ID this announcement belongs to
    pub pool_id: [u8; 8],

    /// Single ephemeral Grumpkin public key (33 bytes compressed)
    /// Used by recipient to derive shared secret via ECDH
    pub ephemeral_pub: [u8; 33],

    /// Padding for alignment after 33-byte key
    _padding2: [u8; 7],

    /// Principal amount in satoshis
    principal: [u8; 8],

    /// Deposit epoch when position was created
    deposit_epoch: [u8; 8],

    /// Pool position commitment: Poseidon2(stealthPub.x, principal, depositEpoch)
    pub pool_commitment: [u8; 32],

    /// Leaf index in pool commitment tree
    leaf_index: [u8; 8],

    /// Timestamp when created
    created_at: [u8; 8],

    /// Reserved for future use
    _reserved: [u8; 16],
}

impl StealthPoolAnnouncement {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"stealth_pool_ann";

    /// Parse from account data
    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    /// Parse as mutable from account data
    pub fn from_bytes_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    /// Initialize a new stealth pool announcement in the given buffer
    pub fn init(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        data[..Self::LEN].fill(0);
        data[0] = STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR;
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    // Getters
    pub fn principal(&self) -> u64 {
        u64::from_le_bytes(self.principal)
    }

    pub fn deposit_epoch(&self) -> u64 {
        u64::from_le_bytes(self.deposit_epoch)
    }

    pub fn leaf_index(&self) -> u64 {
        u64::from_le_bytes(self.leaf_index)
    }

    pub fn created_at(&self) -> i64 {
        i64::from_le_bytes(self.created_at)
    }

    // Setters
    pub fn set_principal(&mut self, value: u64) {
        self.principal = value.to_le_bytes();
    }

    pub fn set_deposit_epoch(&mut self, value: u64) {
        self.deposit_epoch = value.to_le_bytes();
    }

    pub fn set_leaf_index(&mut self, value: u64) {
        self.leaf_index = value.to_le_bytes();
    }

    pub fn set_created_at(&mut self, value: i64) {
        self.created_at = value.to_le_bytes();
    }
}
