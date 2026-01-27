"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, TransactionInstruction, Transaction } from "@solana/web3.js";
import {
  // From SDK
  isValidName,
  normalizeName,
  formatZkeyName,
  getNameValidationError,
  hashName,
  parseNameRegistry,
  buildRegisterNameData,
  NAME_REGISTRY_SEED,
  ZVAULT_PROGRAM_ID,
  type NameRegistryEntry,
} from "@zvault/sdk";
import { useZVaultKeys } from "./use-zvault";

// Program ID for zVault (from SDK - single source of truth)
const PROGRAM_ID = new PublicKey(ZVAULT_PROGRAM_ID);

interface UseZkeyNameReturn {
  // State
  registeredName: string | null;
  isLoading: boolean;
  isRegistering: boolean;
  isCheckingAvailability: boolean;
  isNameTaken: boolean;
  error: string | null;

  // Actions
  lookupMyName: () => Promise<void>;
  registerName: (name: string) => Promise<boolean>;
  lookupName: (name: string) => Promise<NameRegistryEntry | null>;
  checkAvailability: (name: string) => Promise<boolean>;

  // Validation (from SDK)
  validateName: (name: string) => string | null;
  formatName: (name: string) => string;
}

/**
 * Hook for managing .zkey name registration
 *
 * Uses @zvault/sdk for name validation, hashing, and parsing.
 */
export function useZkeyName(): UseZkeyNameReturn {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { stealthAddress } = useZVaultKeys();

  const [registeredName, setRegisteredName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isNameTaken, setIsNameTaken] = useState(false);
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
    async (name: string): Promise<NameRegistryEntry | null> => {
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

        const entry = parseNameRegistry(new Uint8Array(accountInfo.data), normalized);
        return entry;
      } catch (err) {
        console.error("Failed to lookup name:", err);
        return null;
      }
    },
    [connection, deriveNamePDA]
  );

  /**
   * Check if a name is available (not taken)
   * Returns true if available, false if taken
   */
  const checkAvailability = useCallback(
    async (name: string): Promise<boolean> => {
      const normalized = normalizeName(name);
      if (!isValidName(normalized)) {
        setIsNameTaken(false);
        return true;
      }

      setIsCheckingAvailability(true);
      try {
        const existing = await lookupName(normalized);
        const taken = existing !== null;
        setIsNameTaken(taken);
        return !taken;
      } catch (err) {
        console.error("Failed to check name availability:", err);
        setIsNameTaken(false);
        return true;
      } finally {
        setIsCheckingAvailability(false);
      }
    },
    [lookupName]
  );

  /**
   * Look up if current wallet has a registered name
   */
  const lookupMyName = useCallback(async () => {
    if (!wallet.publicKey || !stealthAddress) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check localStorage for previously registered name
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
   * Register a new .zkey name on-chain
   */
  const registerName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!wallet.publicKey || !wallet.signTransaction || !stealthAddress) {
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
        // Check if name is already taken on-chain
        const existing = await lookupName(normalized);
        if (existing) {
          setError(`Name "${formatZkeyName(normalized)}" is already registered`);
          return false;
        }

        // Build instruction data using SDK
        const instructionData = buildRegisterNameData(
          normalized,
          stealthAddress.spendingPubKey,
          stealthAddress.viewingPubKey
        );

        // Derive PDA
        const [namePDA] = deriveNamePDA(normalized);

        // Create instruction
        const instruction = new TransactionInstruction({
          keys: [
            { pubkey: namePDA, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
          ],
          programId: PROGRAM_ID,
          data: Buffer.from(instructionData),
        });

        // Build and send transaction
        const transaction = new Transaction().add(instruction);
        transaction.feePayer = wallet.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const signed = await wallet.signTransaction(transaction);
        const txid = await connection.sendRawTransaction(signed.serialize());

        // Wait for confirmation
        await connection.confirmTransaction(txid, "confirmed");

        // Store in localStorage for quick lookup
        localStorage.setItem(
          `zkey-name-${wallet.publicKey.toBase58()}`,
          normalized
        );

        setRegisteredName(normalized);
        console.log(`[zkey] Registered on-chain: ${formatZkeyName(normalized)} (tx: ${txid})`);
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
    [wallet, stealthAddress, connection, deriveNamePDA, lookupName]
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
    isCheckingAvailability,
    isNameTaken,
    error,
    lookupMyName,
    registerName,
    lookupName,
    checkAvailability,
    validateName: getNameValidationError,
    formatName: formatZkeyName,
  };
}
