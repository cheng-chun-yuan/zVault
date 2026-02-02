/**
 * Yield Pool Account Parsing
 *
 * Functions for parsing on-chain yield pool account data.
 */

import type { YieldPoolConfig, OnChainStealthPoolAnnouncement } from "./types";
import {
  YIELD_POOL_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_SIZE,
} from "./constants";

/**
 * Parse StealthPoolAnnouncement account data
 *
 * Layout (136 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - padding (6 bytes)
 * - pool_id (8 bytes)
 * - ephemeral_pub (33 bytes)
 * - padding2 (7 bytes)
 * - principal (8 bytes)
 * - deposit_epoch (8 bytes)
 * - pool_commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 * - reserved (16 bytes)
 */
export function parseStealthPoolAnnouncement(
  data: Uint8Array
): OnChainStealthPoolAnnouncement | null {
  if (data.length < STEALTH_POOL_ANNOUNCEMENT_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR) {
    return null;
  }

  let offset = 8; // Skip discriminator, bump, padding

  const poolId = data.slice(offset, offset + 8);
  offset += 8;

  const ephemeralPub = data.slice(offset, offset + 33);
  offset += 33 + 7; // Skip padding2

  const view = new DataView(data.buffer, data.byteOffset);

  const principal = view.getBigUint64(offset, true);
  offset += 8;

  const depositEpoch = view.getBigUint64(offset, true);
  offset += 8;

  const poolCommitment = data.slice(offset, offset + 32);
  offset += 32;

  // Safe BigInt to Number conversion with overflow check
  const leafIndexBigInt = view.getBigUint64(offset, true);
  if (leafIndexBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Leaf index overflow - value exceeds safe integer range");
  }
  const leafIndex = Number(leafIndexBigInt);
  offset += 8;

  const createdAtBigInt = view.getBigInt64(offset, true);
  const maxSafeTimestamp = BigInt(Number.MAX_SAFE_INTEGER);
  const createdAt = createdAtBigInt < 0n ? 0 :
    createdAtBigInt > maxSafeTimestamp ? Number.MAX_SAFE_INTEGER :
    Number(createdAtBigInt);

  return {
    poolId: new Uint8Array(poolId),
    ephemeralPub: new Uint8Array(ephemeralPub),
    principal,
    depositEpoch,
    poolCommitment: new Uint8Array(poolCommitment),
    leafIndex,
    createdAt,
  };
}

/**
 * Parse YieldPool account data
 */
export function parseYieldPool(data: Uint8Array): YieldPoolConfig | null {
  if (data.length < 200 || data[0] !== YIELD_POOL_DISCRIMINATOR) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = data.slice(4, 12);
  const yieldRateBps = view.getUint16(12, true);
  const currentEpoch = view.getBigUint64(36, true);

  // Safe BigInt to Number conversion for epochDuration
  const epochDurationBigInt = view.getBigInt64(44, true);
  const maxSafeDuration = BigInt(Number.MAX_SAFE_INTEGER);
  const epochDuration = epochDurationBigInt < 0n ? 0 :
    epochDurationBigInt > maxSafeDuration ? Number.MAX_SAFE_INTEGER :
    Number(epochDurationBigInt);

  const totalPrincipal = view.getBigUint64(52, true);
  const paused = (data[2] & 1) !== 0;

  return {
    poolId: new Uint8Array(poolId),
    yieldRateBps,
    epochDuration,
    currentEpoch,
    totalPrincipal,
    paused,
  };
}
