/**
 * Deposit Hook
 *
 * Handles BTC deposit creation with real SDK integration.
 * Uses deterministic note derivation for secure deposits.
 */

import { useState, useCallback } from 'react';
import {
  deriveNote,
  deriveTaprootAddress,
  createClaimLink,
  bigintToBytes,
  type Note,
} from '@zvault/sdk';
import * as Crypto from 'expo-crypto';

export interface DepositResult {
  /** Unique deposit ID */
  id: string;
  /** BTC Taproot address to send to */
  taprootAddress: string;
  /** Amount in satoshis */
  amountSats: bigint;
  /** Commitment hash (hex) */
  commitment: string;
  /** Claim link for recovery */
  claimLink: string;
  /** Note data for local storage */
  note: {
    nullifier: string;
    secret: string;
    amount: bigint;
  };
  /** Creation timestamp */
  createdAt: number;
}

interface UseDepositReturn {
  /** Create a new deposit */
  createDeposit: (amountSats: bigint, seed?: string) => Promise<DepositResult>;
  /** Loading state */
  isCreating: boolean;
  /** Error message */
  error: string | null;
}

/**
 * Generate a random seed for note derivation
 */
async function generateRandomSeed(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hook for creating BTC deposits with proper SDK integration
 */
export function useDeposit(): UseDepositReturn {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createDeposit = useCallback(async (
    amountSats: bigint,
    providedSeed?: string
  ): Promise<DepositResult> => {
    setIsCreating(true);
    setError(null);

    try {
      // Generate or use provided seed
      const seed = providedSeed || await generateRandomSeed();

      // Derive note from seed using SDK
      const note = deriveNote(seed, 0, amountSats);

      // Convert commitment to bytes for Taproot derivation
      const commitmentBytes = bigintToBytes(note.commitment);

      // Derive Taproot address from commitment (async)
      const taprootResult = await deriveTaprootAddress(commitmentBytes, 'testnet');

      // Generate claim link (takes a Note object)
      const claimLink = createClaimLink(note);

      // Generate unique deposit ID
      const id = Date.now().toString();

      const result: DepositResult = {
        id,
        taprootAddress: taprootResult.address,
        amountSats,
        commitment: note.commitment.toString(16).padStart(64, '0'),
        claimLink,
        note: {
          nullifier: note.nullifier.toString(16).padStart(64, '0'),
          secret: note.secret.toString(16).padStart(64, '0'),
          amount: amountSats,
        },
        createdAt: Date.now(),
      };

      return result;
    } catch (err) {
      console.error('Failed to create deposit:', err);
      const message = err instanceof Error ? err.message : 'Failed to create deposit';
      setError(message);
      throw new Error(message);
    } finally {
      setIsCreating(false);
    }
  }, []);

  return {
    createDeposit,
    isCreating,
    error,
  };
}
