/**
 * Stealth Operations for Mobile
 *
 * Wraps SDK stealth functions for mobile use.
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
} from '@zvault/sdk';

export type { StealthDeposit, ScannedNote, ClaimInputs };

/**
 * Create a stealth deposit for a recipient
 */
export async function createDeposit(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthDeposit> {
  return createStealthDeposit(recipientMeta, amountSats);
}

/**
 * Scan announcements to find deposits for us
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

/**
 * Format amount in satoshis for display
 */
export function formatSats(sats: bigint): string {
  const btc = Number(sats) / 100_000_000;
  if (btc >= 0.001) {
    return `${btc.toFixed(8)} BTC`;
  }
  return `${sats.toString()} sats`;
}

/**
 * Parse amount string to satoshis
 */
export function parseSats(input: string): bigint {
  const cleaned = input.trim().toLowerCase();

  if (cleaned.endsWith('btc')) {
    const btc = parseFloat(cleaned.replace('btc', '').trim());
    return BigInt(Math.round(btc * 100_000_000));
  }

  if (cleaned.endsWith('sats')) {
    return BigInt(cleaned.replace('sats', '').trim());
  }

  // Assume satoshis if no unit
  return BigInt(cleaned);
}
