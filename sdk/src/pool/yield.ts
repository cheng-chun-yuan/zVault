/**
 * Yield Pool Yield Calculations
 *
 * Functions for calculating yield and total value of pool positions.
 */

import type { ScannedPoolPosition } from "./types";

/**
 * Calculate earned yield for a position
 *
 * @param principal - Principal amount (satoshis)
 * @param depositEpoch - When the position was created
 * @param currentEpoch - Current epoch
 * @param yieldRateBps - Annual yield rate in basis points (500 = 5%)
 * @returns Earned yield amount (satoshis)
 */
export function calculateYield(
  principal: bigint,
  depositEpoch: bigint,
  currentEpoch: bigint,
  yieldRateBps: number
): bigint {
  if (currentEpoch <= depositEpoch) {
    return 0n;
  }

  const epochsStaked = currentEpoch - depositEpoch;
  // yield = (principal * epochsStaked * yieldRateBps) / 10000
  return (principal * epochsStaked * BigInt(yieldRateBps)) / 10000n;
}

/**
 * Calculate total value (principal + yield) for a position
 */
export function calculateTotalValue(
  position: ScannedPoolPosition,
  currentEpoch: bigint,
  yieldRateBps: number
): bigint {
  const yieldAmount = calculateYield(
    position.principal,
    position.depositEpoch,
    currentEpoch,
    yieldRateBps
  );
  return position.principal + yieldAmount;
}
