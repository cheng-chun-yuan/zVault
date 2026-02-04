/**
 * Yield Pool Formatting Utilities
 *
 * Helper functions for formatting pool-related values for display.
 */

/**
 * Format yield rate for display
 * @param bps - Basis points (500 = 5%)
 * @returns Formatted string (e.g., "5.00%")
 */
export function formatYieldRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Format satoshis as BTC
 */
export function formatBtcAmount(sats: bigint): string {
  const btc = Number(sats) / 100_000_000;
  return btc.toFixed(8);
}

/**
 * Format epoch duration
 */
export function formatEpochDuration(seconds: number): string {
  if (seconds < 3600) return `${seconds}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
