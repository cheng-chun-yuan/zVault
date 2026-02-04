/**
 * Stealth Utility Functions
 *
 * Shared utility functions to avoid circular dependencies.
 */

import type { WalletSignerAdapter } from "../keys";

/**
 * Type guard to distinguish between WalletSignerAdapter and ZVaultKeys
 */
export function isWalletAdapter(source: unknown): source is WalletSignerAdapter {
  return (
    typeof source === "object" &&
    source !== null &&
    "signMessage" in source &&
    typeof (source as WalletSignerAdapter).signMessage === "function"
  );
}
