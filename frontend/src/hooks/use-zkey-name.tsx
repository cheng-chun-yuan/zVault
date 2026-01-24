"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  hashName,
  isValidName,
  normalizeName,
  formatZkeyName,
  getNameValidationError,
  parseNameEntry,
  NAME_REGISTRY_SEED,
  type NameEntry,
} from "@zvault/sdk";
import { useZVaultKeys } from "./use-zvault-keys";

// Program ID for zVault (from env)
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR"
);

// Instruction discriminators (must match contract lib.rs)
const REGISTER_NAME_DISCRIMINATOR = 17;

interface UseZkeyNameReturn {
  // State
  registeredName: string | null;
  isLoading: boolean;
  isRegistering: boolean;
  error: string | null;

  // Actions
  lookupMyName: () => Promise<void>;
  registerName: (name: string) => Promise<boolean>;
  lookupName: (name: string) => Promise<NameEntry | null>;

  // Validation
  validateName: (name: string) => string | null;
  formatName: (name: string) => string;
}

/**
 * Hook for managing .zkey name registration
 */
export function useZkeyName(): UseZkeyNameReturn {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { stealthAddress } = useZVaultKeys();

  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Derive PDA for a name
   */
  const deriveNamePDA = useCallback(
    (name: string): [PublicKey, number] => {
      const nameHash = hashName(name);
      return PublicKey.findProgramAddressSync(
        [Buffer.from(NAME_REGISTRY_SEED), Buffer.from(nameHash)],
        PROGRAM_ID
      );
    },
    []
  );

  /**
   * Look up a name on-chain
   */
  const lookupName = useCallback(
    async (name: string): Promise<NameEntry | null> => {
      try {
        const normalized = normalizeName(name);
        if (!isValidName(normalized)) {
          return null;
        }

        const [pda] = deriveNamePDA(normalized);
        const accountInfo = await connection.getAccountInfo(pda);

        if (!accountInfo) {
          return null;
        }

        return parseNameEntry(new Uint8Array(accountInfo.data));
      } catch (err) {
        console.error("Failed to lookup name:", err);
        return null;
      }
    },
    [connection, deriveNamePDA]
  );

  /**
   * Look up if current wallet has a registered name
   * This searches by checking common patterns - in production you'd use an indexer
   */
  const lookupMyName = useCallback(async () => {
    if (!wallet.publicKey || !stealthAddress) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // For demo: Check localStorage for previously registered name
      const storedName = localStorage.getItem(
        `zkey-name-${wallet.publicKey.toBase58()}`
      );

      if (storedName) {
        // Verify it's still registered on-chain
        const entry = await lookupName(storedName);
        if (entry) {
          // Verify it matches our stealth address
          const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
          const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");

          if (entrySpendingHex === ourSpendingHex) {
            setRegisteredName(storedName);
            return;
          }
        }
        // Name no longer valid, clear it
        localStorage.removeItem(`zkey-name-${wallet.publicKey.toBase58()}`);
      }

      setRegisteredName(null);
    } catch (err) {
      console.error("Failed to lookup my name:", err);
      setError("Failed to check name registration");
    } finally {
      setIsLoading(false);
    }
  }, [wallet.publicKey, stealthAddress, lookupName]);

  /**
   * Register a new .zkey name
   *
   * NOTE: Currently in DEMO MODE - stores name locally.
   * On-chain registration requires contract redeployment with REGISTER_NAME instruction.
   */
  const registerName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!wallet.publicKey || !stealthAddress) {
        setError("Wallet not connected or keys not derived");
        return false;
      }

      const normalized = normalizeName(name);
      const validationError = getNameValidationError(normalized);
      if (validationError) {
        setError(validationError);
        return false;
      }

      setIsRegistering(true);
      setError(null);

      try {
        // Check if name is already taken (in localStorage for demo)
        const allKeys = Object.keys(localStorage);
        for (const key of allKeys) {
          if (key.startsWith("zkey-name-")) {
            const storedName = localStorage.getItem(key);
            if (storedName === normalized) {
              setError(`Name "${formatZkeyName(normalized)}" is already taken`);
              return false;
            }
          }
        }

        // DEMO MODE: Just store locally
        // TODO: Enable on-chain registration after contract redeployment
        console.log("[zkey] Demo mode: Storing name locally");

        // Simulate network delay for UX
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Store in localStorage
        localStorage.setItem(
          `zkey-name-${wallet.publicKey.toBase58()}`,
          normalized
        );

        // Also store reverse mapping (name -> stealth address) for lookups
        const stealthHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex") +
                          Buffer.from(stealthAddress.viewingPubKey).toString("hex");
        localStorage.setItem(`zkey-lookup-${normalized}`, stealthHex);

        setRegisteredName(normalized);
        console.log(`[zkey] Registered: ${formatZkeyName(normalized)}`);
        return true;
      } catch (err) {
        console.error("Failed to register name:", err);
        setError(
          err instanceof Error ? err.message : "Failed to register name"
        );
        return false;
      } finally {
        setIsRegistering(false);
      }
    },
    [wallet, stealthAddress]
  );

  // Check for existing name when wallet/keys change
  useEffect(() => {
    if (wallet.publicKey && stealthAddress) {
      lookupMyName();
    } else {
      setRegisteredName(null);
    }
  }, [wallet.publicKey, stealthAddress, lookupMyName]);

  return {
    registeredName,
    isLoading,
    isRegistering,
    error,
    lookupMyName,
    registerName,
    lookupName,
    validateName: getNameValidationError,
    formatName: formatZkeyName,
  };
}
