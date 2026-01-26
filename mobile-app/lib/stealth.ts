/**
 * Stealth Operations for Mobile
 *
 * Wraps SDK stealth functions for mobile use.
 * Handles ECDH-based stealth deposits and scanning.
 *
 * @module lib/stealth
 */

import {
  createStealthDeposit,
  scanAnnouncements,
  prepareClaimInputs,
  type StealthDeposit,
  type ScannedNote,
  type ClaimInputs,
  type StealthMetaAddress,
  type ZVaultKeys,
} from "@zvault/sdk";

// Re-export SDK types
export type { StealthDeposit, ScannedNote, ClaimInputs };

// ============================================================================
// Stealth Operations
// ============================================================================

/**
 * Create a stealth deposit for a recipient
 *
 * Uses ECDH to derive a shared secret that only the recipient can compute.
 * Returns the Taproot address for BTC deposit and announcement data.
 */
export async function createDeposit(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthDeposit> {
  return createStealthDeposit(recipientMeta, amountSats);
}

/**
 * Scan announcements to find deposits for us
 *
 * Uses the viewing key to check each announcement for deposits
 * addressed to our stealth address.
 */
export async function scanForDeposits(
  keys: ZVaultKeys,
  announcements: Array<{
    ephemeralPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
  }>
): Promise<ScannedNote[]> {
  return scanAnnouncements(keys, announcements);
}

/**
 * Prepare inputs for claiming a deposit
 *
 * Computes the nullifier and secret needed for the ZK claim proof.
 */
export async function prepareClaim(
  keys: ZVaultKeys,
  note: ScannedNote,
  merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
  }
): Promise<ClaimInputs> {
  return prepareClaimInputs(keys, note, merkleProof);
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format amount in satoshis for display
 *
 * Shows BTC for larger amounts, sats for smaller.
 */
export function formatSats(sats: bigint | number): string {
  const satsNum = typeof sats === "bigint" ? Number(sats) : sats;
  const btc = satsNum / 100_000_000;

  if (btc >= 0.001) {
    return `${btc.toFixed(8)} BTC`;
  }
  return `${satsNum.toLocaleString()} sats`;
}

/**
 * Format as BTC only
 */
export function formatBtc(sats: bigint | number): string {
  const satsNum = typeof sats === "bigint" ? Number(sats) : sats;
  return (satsNum / 100_000_000).toFixed(8);
}

/**
 * Parse amount string to satoshis
 *
 * Supports formats: "100000", "100000 sats", "0.001 btc"
 */
export function parseSats(input: string): bigint {
  const cleaned = input.trim().toLowerCase();

  if (cleaned.endsWith("btc")) {
    const btc = parseFloat(cleaned.replace("btc", "").trim());
    return BigInt(Math.round(btc * 100_000_000));
  }

  if (cleaned.endsWith("sats")) {
    return BigInt(cleaned.replace("sats", "").trim());
  }

  // Assume satoshis if no unit
  return BigInt(cleaned);
}

/**
 * Truncate a hex string for display
 */
export function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 3) return hex;
  return `${hex.slice(0, chars)}...${hex.slice(-chars)}`;
}
