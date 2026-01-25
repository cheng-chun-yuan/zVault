/**
 * Name Registry Hook
 *
 * Resolves .zkey names to stealth addresses using the SDK.
 */

import { useState, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  lookupZkeyName,
  isValidName,
  normalizeName,
  formatZkeyName,
  decodeStealthMetaAddress,
  ZVAULT_PROGRAM_ID,
  type ZkeyStealthAddress,
  type StealthMetaAddress,
} from '@zvault/sdk';

// Devnet RPC endpoint
const SOLANA_RPC = 'https://api.devnet.solana.com';

export interface ResolvedRecipient {
  /** Original input (name or address) */
  input: string;
  /** Type of resolution */
  type: 'name' | 'address';
  /** Formatted display name (e.g., "alice.zkey" or truncated address) */
  displayName: string;
  /** Stealth meta-address for sending */
  stealthMetaAddress: StealthMetaAddress;
  /** Hex-encoded address */
  addressHex: string;
}

interface UseNameRegistryReturn {
  /** Resolve a .zkey name or raw stealth address */
  resolveRecipient: (input: string) => Promise<ResolvedRecipient | null>;
  /** Check if input looks like a .zkey name */
  isZkeyName: (input: string) => boolean;
  /** Loading state */
  isResolving: boolean;
  /** Error message */
  error: string | null;
}

/**
 * Hook for resolving .zkey names and stealth addresses
 */
export function useNameRegistry(): UseNameRegistryReturn {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Check if input looks like a .zkey name
   */
  const isZkeyName = useCallback((input: string): boolean => {
    const trimmed = input.trim().toLowerCase();
    // Check if it ends with .zkey or is a valid name format
    if (trimmed.endsWith('.zkey')) return true;
    // If it's a short string without special chars, it might be a name
    if (trimmed.length <= 32 && /^[a-z0-9_]+$/.test(trimmed)) return true;
    return false;
  }, []);

  /**
   * Resolve a .zkey name or raw stealth address
   */
  const resolveRecipient = useCallback(async (input: string): Promise<ResolvedRecipient | null> => {
    setIsResolving(true);
    setError(null);

    try {
      const trimmed = input.trim();

      // Check if it's a raw stealth address (132 hex chars = 66 bytes)
      if (/^[a-fA-F0-9]{132}$/.test(trimmed)) {
        const stealthMetaAddress = decodeStealthMetaAddress(trimmed);
        return {
          input: trimmed,
          type: 'address',
          displayName: `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`,
          stealthMetaAddress,
          addressHex: trimmed,
        };
      }

      // Try to resolve as .zkey name
      const normalized = normalizeName(trimmed);
      if (!isValidName(normalized)) {
        setError('Invalid name format. Use lowercase letters, numbers, and underscores (1-32 chars).');
        return null;
      }

      // Lookup on-chain using SDK's simplified interface
      const connection = new Connection(SOLANA_RPC, 'confirmed');
      // Cast connection to the SDK's expected interface
      const result = await lookupZkeyName(
        connection as unknown as { getAccountInfo: (pubkey: { toBytes(): Uint8Array }) => Promise<{ data: Uint8Array } | null> },
        normalized,
        ZVAULT_PROGRAM_ID
      );

      if (!result) {
        setError(`Name "${formatZkeyName(normalized)}" is not registered.`);
        return null;
      }

      return {
        input: trimmed,
        type: 'name',
        displayName: formatZkeyName(normalized),
        stealthMetaAddress: {
          spendingPubKey: result.spendingPubKey,
          viewingPubKey: result.viewingPubKey,
        },
        addressHex: result.stealthMetaAddressHex,
      };
    } catch (err) {
      console.error('Failed to resolve recipient:', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve recipient');
      return null;
    } finally {
      setIsResolving(false);
    }
  }, []);

  return {
    resolveRecipient,
    isZkeyName,
    isResolving,
    error,
  };
}
