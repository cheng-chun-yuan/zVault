/**
 * Yield Pool Constants
 *
 * All constants, discriminators, and seeds for the yield pool module.
 */

// ==========================================================================
// Instruction Discriminators
// ==========================================================================

/** Discriminator for CREATE_YIELD_POOL instruction */
export const CREATE_YIELD_POOL_DISCRIMINATOR = 30;

/** Discriminator for DEPOSIT_TO_POOL instruction */
export const DEPOSIT_TO_POOL_DISCRIMINATOR = 31;

/** Discriminator for WITHDRAW_FROM_POOL instruction */
export const WITHDRAW_FROM_POOL_DISCRIMINATOR = 32;

/** Discriminator for CLAIM_POOL_YIELD instruction */
export const CLAIM_POOL_YIELD_DISCRIMINATOR = 33;

/** Discriminator for COMPOUND_YIELD instruction */
export const COMPOUND_YIELD_DISCRIMINATOR = 34;

/** Discriminator for UPDATE_YIELD_RATE instruction */
export const UPDATE_YIELD_RATE_DISCRIMINATOR = 35;

/** Discriminator for HARVEST_YIELD instruction */
export const HARVEST_YIELD_DISCRIMINATOR = 36;

// ==========================================================================
// PDA Seeds
// ==========================================================================

/** Seed for YieldPool PDA */
export const YIELD_POOL_SEED = "yield_pool";

/** Seed for PoolCommitmentTree PDA */
export const POOL_COMMITMENT_TREE_SEED = "pool_commitment_tree";

/** Seed for PoolNullifierRecord PDA */
export const POOL_NULLIFIER_SEED = "pool_nullifier";

/** Seed for StealthPoolAnnouncement PDA */
export const STEALTH_POOL_ANNOUNCEMENT_SEED = "stealth_pool_ann";

// ==========================================================================
// Account Discriminators
// ==========================================================================

/** YieldPool discriminator */
export const YIELD_POOL_DISCRIMINATOR = 0x10;

/** PoolCommitmentTree discriminator */
export const POOL_COMMITMENT_TREE_DISCRIMINATOR = 0x12;

/** StealthPoolAnnouncement discriminator */
export const STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR = 0x13;

// ==========================================================================
// Account Sizes
// ==========================================================================

/** StealthPoolAnnouncement account size */
export const STEALTH_POOL_ANNOUNCEMENT_SIZE = 136;

// ==========================================================================
// Domain Separators
// ==========================================================================

/** Domain separator for stealth key derivation */
export const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-pool-stealth-v1");
