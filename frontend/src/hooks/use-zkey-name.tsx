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
  hasRegisteredName: boolean;
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
  verifyMyName: (name: string) => Promise<boolean>;

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
  const [hasRegisteredName, setHasRegisteredName] = useState(false);
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
   * Look up if current wallet has a registered name by querying on-chain registry
   * Note: On-chain stores name_hash, not the original name. We can detect
   * registration but can't recover the name without user input.
   */
  const lookupMyName = useCallback(async () => {
    if (!wallet.publicKey || !stealthAddress) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Query on-chain registry for names owned by this wallet
      // Filter by account size (180 bytes) and owner pubkey
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          // Filter by account size (NameRegistry = 180 bytes)
          { dataSize: 180 },
          // Filter by owner (at offset 34 = 1 discriminator + 1 bump + 32 name_hash)
          { memcmp: { offset: 34, bytes: wallet.publicKey.toBase58() } },
        ],
      });

      // Check each account for matching stealth address
      for (const { account } of accounts) {
        const entry = parseNameRegistry(new Uint8Array(account.data), "");
        if (entry) {
          const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
          const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");

          if (entrySpendingHex === ourSpendingHex) {
            // Found a matching registration
            // Note: We can't recover the name from on-chain data (only hash is stored)
            // User can use verifyMyName() to confirm ownership of a specific name
            setHasRegisteredName(true);
            return;
          }
        }
      }

      setHasRegisteredName(false);
      setRegisteredName(null);
    } catch (err) {
      console.error("Failed to lookup my name:", err);
      setError("Failed to check name registration");
    } finally {
      setIsLoading(false);
    }
  }, [wallet.publicKey, stealthAddress, connection]);

  /**
   * Verify ownership of a specific .zkey name
   * Since on-chain only stores name_hash, user must provide the name to verify
   */
  const verifyMyName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!wallet.publicKey || !stealthAddress) {
        return false;
      }

      const normalized = normalizeName(name);
      if (!isValidName(normalized)) {
        return false;
      }

      try {
        const entry = await lookupName(normalized);
        if (!entry) {
          return false;
        }

        // Check if this entry belongs to us (matches our stealth address)
        const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
        const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");

        if (entrySpendingHex === ourSpendingHex) {
          // Verified - this name belongs to us
          setRegisteredName(normalized);
          setHasRegisteredName(true);
          return true;
        }

        return false;
      } catch (err) {
        console.error("Failed to verify name:", err);
        return false;
      }
    },
    [wallet.publicKey, stealthAddress, lookupName]
  );

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
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;

        const signed = await wallet.signTransaction(transaction);
        const txid = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        // Wait for confirmation with proper parameters
        const confirmation = await connection.confirmTransaction(
          { signature: txid, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        // Name registered on-chain - no local storage needed
        setRegisteredName(normalized);
        setHasRegisteredName(true);
        console.log(`[zkey] Registered on-chain: ${formatZkeyName(normalized)} (tx: ${txid})`);
        return true;
      } catch (err) {
        console.error("Failed to register name:", err);

        const errorMessage = err instanceof Error ? err.message : String(err);

        // Check for "already processed" error - might mean name was registered
        if (errorMessage.includes("already been processed")) {
          // Transaction was already processed - check if name is now registered on-chain
          try {
            const entry = await lookupName(normalized);
            if (entry) {
              const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
              const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");
              if (entrySpendingHex === ourSpendingHex) {
                // Name was successfully registered by us
                setRegisteredName(normalized);
                setHasRegisteredName(true);
                return true;
              }
            }
          } catch {
            // Ignore lookup errors
          }
          setError("Transaction already processed. Please try again.");
          return false;
        }

        setError(errorMessage || "Failed to register name");
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
      setHasRegisteredName(false);
    }
  }, [wallet.publicKey, stealthAddress, lookupMyName]);

  return {
    registeredName,
    hasRegisteredName,
    isLoading,
    isRegistering,
    isCheckingAvailability,
    isNameTaken,
    error,
    lookupMyName,
    registerName,
    lookupName,
    checkAvailability,
    verifyMyName,
    validateName: getNameValidationError,
    formatName: formatZkeyName,
  };
}
