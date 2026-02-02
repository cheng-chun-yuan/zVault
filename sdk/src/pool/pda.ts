/**
 * Yield Pool PDA Derivation
 *
 * Functions for deriving Program Derived Addresses for yield pool accounts.
 */

import {
  YIELD_POOL_SEED,
  POOL_COMMITMENT_TREE_SEED,
  POOL_NULLIFIER_SEED,
  STEALTH_POOL_ANNOUNCEMENT_SEED,
} from "./constants";

/**
 * Get seeds for YieldPool PDA
 */
export function getYieldPoolPDASeeds(poolId: Uint8Array): Uint8Array[] {
  return [Buffer.from(YIELD_POOL_SEED), poolId.slice(0, 8)];
}

/**
 * Get seeds for PoolCommitmentTree PDA
 */
export function getPoolCommitmentTreePDASeeds(poolId: Uint8Array): Uint8Array[] {
  return [Buffer.from(POOL_COMMITMENT_TREE_SEED), poolId.slice(0, 8)];
}

/**
 * Get seeds for PoolNullifierRecord PDA
 */
export function getPoolNullifierPDASeeds(
  poolId: Uint8Array,
  nullifierHash: Uint8Array
): Uint8Array[] {
  return [
    Buffer.from(POOL_NULLIFIER_SEED),
    poolId.slice(0, 8),
    nullifierHash.slice(0, 32),
  ];
}

/**
 * Get seeds for StealthPoolAnnouncement PDA
 */
export function getStealthPoolAnnouncementPDASeeds(
  poolId: Uint8Array,
  commitment: Uint8Array
): Uint8Array[] {
  return [
    Buffer.from(STEALTH_POOL_ANNOUNCEMENT_SEED),
    poolId.slice(0, 8),
    commitment.slice(0, 32),
  ];
}
