//! Bitcoin Light Client - Simple, Transparent, Permissionless
//!
//! A standalone Bitcoin header relay for Solana. Anyone can submit headers.
//! No fees, no permissions, just trustless Bitcoin state on Solana.
//!
//! ## Design Principles:
//! - **Simple**: Minimal code, easy to audit
//! - **Permissionless**: Anyone can submit headers and pays only for storage
//! - **Transparent**: All state is on-chain and verifiable
//! - **Fair**: First valid submitter wins, no frontrunning possible (PDA uniqueness)

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

declare_id!("8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG");

/// Required confirmations for finality (6 blocks)
pub const REQUIRED_CONFIRMATIONS: u64 = 6;

#[program]
pub mod btc_light_client {
    use super::*;

    /// Initialize the light client with a starting block
    ///
    /// This sets the "genesis" point for this light client instance.
    /// Use a recent block hash to avoid syncing from Bitcoin genesis.
    ///
    /// # Arguments
    /// * `start_height` - The block height to start from
    /// * `start_block_hash` - The block hash at start_height (will be tip)
    /// * `network` - 0=mainnet, 1=testnet, 2=signet
    pub fn initialize(
        ctx: Context<Initialize>,
        start_height: u64,
        start_block_hash: [u8; 32],
        network: u8,
    ) -> Result<()> {
        let light_client = &mut ctx.accounts.light_client;
        let clock = Clock::get()?;

        light_client.bump = ctx.bumps.light_client;
        light_client.tip_height = start_height;
        light_client.tip_hash = start_block_hash;
        light_client.start_height = start_height;
        light_client.start_hash = start_block_hash;
        light_client.finalized_height = start_height.saturating_sub(REQUIRED_CONFIRMATIONS);
        light_client.header_count = 1; // Starting block counts as first
        light_client.last_update = clock.unix_timestamp;
        light_client.network = network;

        msg!("Bitcoin Light Client initialized");
        msg!("  Network: {}", network);
        msg!("  Start height: {}", start_height);
        msg!("  Start hash: {:?}", &start_block_hash[..8]);

        Ok(())
    }

    /// Submit a Bitcoin block header (PERMISSIONLESS)
    ///
    /// Anyone can submit. The submitter pays for BlockHeader PDA storage (~0.002 SOL).
    /// Duplicate submissions fail automatically (PDA already exists).
    ///
    /// # Arguments
    /// * `raw_header` - 80-byte raw Bitcoin block header
    /// * `height` - Block height (must be tip_height + 1)
    pub fn submit_header(
        ctx: Context<SubmitHeader>,
        raw_header: [u8; 80],
        height: u64,
    ) -> Result<()> {
        let light_client = &mut ctx.accounts.light_client;
        let block_header = &mut ctx.accounts.block_header;
        let clock = Clock::get()?;

        // Parse header
        let parsed = ParsedHeader::from_raw(&raw_header);

        // Compute block hash (double SHA256)
        let block_hash = double_sha256(&raw_header);

        // Verify: height must be exactly tip + 1
        require!(
            height == light_client.tip_height + 1,
            LightClientError::InvalidHeight
        );

        // Verify: prev_block_hash must match current tip
        require!(
            parsed.prev_block_hash == light_client.tip_hash,
            LightClientError::InvalidPrevHash
        );

        // Verify: proof of work meets difficulty target
        let target = bits_to_target(parsed.bits);
        require!(
            hash_meets_target(&block_hash, &target),
            LightClientError::InsufficientPoW
        );

        // Store block header
        block_header.height = height;
        block_header.block_hash = block_hash;
        block_header.prev_block_hash = parsed.prev_block_hash;
        block_header.merkle_root = parsed.merkle_root;
        block_header.timestamp = parsed.timestamp;
        block_header.bits = parsed.bits;
        block_header.nonce = parsed.nonce;
        block_header.submitted_by = ctx.accounts.submitter.key();
        block_header.submitted_at = clock.unix_timestamp;

        // Update light client state
        light_client.tip_height = height;
        light_client.tip_hash = block_hash;
        light_client.header_count += 1;
        light_client.last_update = clock.unix_timestamp;

        // Update finalized height
        if height >= REQUIRED_CONFIRMATIONS {
            light_client.finalized_height = height - REQUIRED_CONFIRMATIONS;
        }

        msg!("Block {} submitted by {}", height, ctx.accounts.submitter.key());

        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = LightClientState::SIZE,
        seeds = [b"light_client"],
        bump,
    )]
    pub light_client: Account<'info, LightClientState>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(raw_header: [u8; 80], height: u64)]
pub struct SubmitHeader<'info> {
    #[account(
        mut,
        seeds = [b"light_client"],
        bump = light_client.bump,
    )]
    pub light_client: Account<'info, LightClientState>,

    /// Block header PDA - unique per height, prevents duplicates
    #[account(
        init,
        payer = submitter,
        space = BlockHeader::SIZE,
        seeds = [b"block", height.to_le_bytes().as_ref()],
        bump,
    )]
    pub block_header: Account<'info, BlockHeader>,

    /// Anyone can submit (permissionless) - pays for storage
    #[account(mut)]
    pub submitter: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// State
// ============================================================================

/// Light client state - tracks Bitcoin chain tip
#[account]
pub struct LightClientState {
    pub bump: u8,
    /// Current chain tip height
    pub tip_height: u64,
    /// Current chain tip hash
    pub tip_hash: [u8; 32],
    /// Starting height (genesis for this instance)
    pub start_height: u64,
    /// Starting block hash
    pub start_hash: [u8; 32],
    /// Finalized height (tip - 6)
    pub finalized_height: u64,
    /// Total headers stored
    pub header_count: u64,
    /// Last update timestamp
    pub last_update: i64,
    /// Network: 0=mainnet, 1=testnet, 2=signet
    pub network: u8,
}

impl LightClientState {
    pub const SIZE: usize = 8 + // discriminator
        1 +  // bump
        8 +  // tip_height
        32 + // tip_hash
        8 +  // start_height
        32 + // start_hash
        8 +  // finalized_height
        8 +  // header_count
        8 +  // last_update
        1 +  // network
        32;  // padding
}

/// Individual block header
#[account]
pub struct BlockHeader {
    pub height: u64,
    pub block_hash: [u8; 32],
    pub prev_block_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub timestamp: u32,
    pub bits: u32,
    pub nonce: u32,
    pub submitted_by: Pubkey,
    pub submitted_at: i64,
}

impl BlockHeader {
    pub const SIZE: usize = 8 + // discriminator
        8 +  // height
        32 + // block_hash
        32 + // prev_block_hash
        32 + // merkle_root
        4 +  // timestamp
        4 +  // bits
        4 +  // nonce
        32 + // submitted_by
        8 +  // submitted_at
        32;  // padding
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum LightClientError {
    #[msg("Invalid block height - must be tip + 1")]
    InvalidHeight,
    #[msg("Invalid prev_block_hash - doesn't match current tip")]
    InvalidPrevHash,
    #[msg("Insufficient proof of work")]
    InsufficientPoW,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parsed Bitcoin block header
struct ParsedHeader {
    prev_block_hash: [u8; 32],
    merkle_root: [u8; 32],
    timestamp: u32,
    bits: u32,
    nonce: u32,
}

impl ParsedHeader {
    fn from_raw(raw: &[u8; 80]) -> Self {
        let mut prev_block_hash = [0u8; 32];
        let mut merkle_root = [0u8; 32];
        prev_block_hash.copy_from_slice(&raw[4..36]);
        merkle_root.copy_from_slice(&raw[36..68]);

        Self {
            prev_block_hash,
            merkle_root,
            timestamp: u32::from_le_bytes(raw[68..72].try_into().unwrap()),
            bits: u32::from_le_bytes(raw[72..76].try_into().unwrap()),
            nonce: u32::from_le_bytes(raw[76..80].try_into().unwrap()),
        }
    }
}

/// Double SHA256 hash (Bitcoin standard)
fn double_sha256(data: &[u8]) -> [u8; 32] {
    let first = hashv(&[data]);
    let second = hashv(&[first.as_ref()]);
    second.to_bytes()
}

/// Convert compact bits to full target
fn bits_to_target(bits: u32) -> [u8; 32] {
    let mut target = [0u8; 32];
    let exponent = ((bits >> 24) & 0xff) as usize;
    let mantissa = bits & 0x007fffff;

    if exponent <= 3 {
        let shift = 8 * (3 - exponent);
        let value = mantissa >> shift;
        target[0..4].copy_from_slice(&value.to_le_bytes());
    } else if exponent <= 34 {
        let byte_offset = exponent - 3;
        if byte_offset < 30 {
            target[byte_offset] = (mantissa & 0xff) as u8;
            target[byte_offset + 1] = ((mantissa >> 8) & 0xff) as u8;
            target[byte_offset + 2] = ((mantissa >> 16) & 0xff) as u8;
        }
    }

    target
}

/// Check if hash meets difficulty target
fn hash_meets_target(hash: &[u8; 32], target: &[u8; 32]) -> bool {
    // Compare from most significant byte (index 31) down
    // Hash must be <= target
    for i in (0..32).rev() {
        if hash[i] > target[i] {
            return false;
        }
        if hash[i] < target[i] {
            return true;
        }
    }
    true // Equal is valid
}
