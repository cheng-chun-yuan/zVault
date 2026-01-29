"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  // SNS subdomain functions from SDK
  isValidSubdomainName,
  formatSubdomainName,
  createSubdomainInstruction,
  resolveSubdomain,
  isSubdomainAvailable,
  type ResolvedSubdomain,
  type StealthMetaAddress,
} from "@zvault/sdk";
import { useZVaultKeys } from "./use-zvault";

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
  lookupName: (name: string) => Promise<ResolvedSubdomain | null>;
  checkAvailability: (name: string) => Promise<boolean>;
  verifyMyName: (name: string) => Promise<boolean>;

  // Validation
  validateName: (name: string) => string | null;
  formatName: (name: string) => string;
}

/**
 * Hook for managing .zkey.sol name registration via SNS subdomains
 *
 * Uses Solana Name Service (SNS) subdomains for discoverability.
 * Example: alice.zkey.sol → stealth meta-address
 *
 * Benefits:
 * - Free on devnet (only gas fees)
 * - Leverages SNS ecosystem (150+ apps)
 * - Cross-chain compatible (MetaMask integration)
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
   * Validate a subdomain name
   * Returns error message or null if valid
   */
  const validateName = useCallback((name: string): string | null => {
    const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "");

    if (!clean) {
      return "Name is required";
    }
    if (clean.length < 1) {
      return "Name must be at least 1 character";
    }
    if (clean.length > 32) {
      return "Name must be at most 32 characters";
    }
    if (!isValidSubdomainName(clean)) {
      return "Name must be lowercase letters and numbers only (a-z, 0-9)";
    }
    return null;
  }, []);

  /**
   * Format name with .zkey.sol suffix
   */
  const formatName = useCallback((name: string): string => {
    return formatSubdomainName(name);
  }, []);

  /**
   * Look up a name on SNS
   */
  const lookupName = useCallback(
    async (name: string): Promise<ResolvedSubdomain | null> => {
      try {
        const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "");
        if (!isValidSubdomainName(clean)) {
          return null;
        }

        const resolved = await resolveSubdomain(
          { connection: connection as any },
          clean
        );
        return resolved;
      } catch (err) {
        console.error("Failed to lookup name:", err);
        return null;
      }
    },
    [connection]
  );

  /**
   * Check if a name is available (not taken)
   * Returns true if available, false if taken
   */
  const checkAvailability = useCallback(
    async (name: string): Promise<boolean> => {
      const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "");
      if (!isValidSubdomainName(clean)) {
        setIsNameTaken(false);
        return true;
      }

      setIsCheckingAvailability(true);
      try {
        const available = await isSubdomainAvailable(
          { connection: connection as any },
          clean
        );
        setIsNameTaken(!available);
        return available;
      } catch (err) {
        console.error("Failed to check name availability:", err);
        setIsNameTaken(false);
        return true;
      } finally {
        setIsCheckingAvailability(false);
      }
    },
    [connection]
  );

  /**
   * Look up if current wallet has a registered .zkey.sol subdomain
   *
   * Note: SNS doesn't have a direct "get subdomains by owner" query,
   * so we can only detect registration if user provides the name.
   */
  const lookupMyName = useCallback(async () => {
    if (!wallet.publicKey || !stealthAddress) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // SNS doesn't support querying subdomains by owner directly
      // User needs to verify their name using verifyMyName()
      // For now, we just reset the state
      setHasRegisteredName(false);
      setRegisteredName(null);
    } catch (err) {
      console.error("Failed to lookup my name:", err);
      setError("Failed to check name registration");
    } finally {
      setIsLoading(false);
    }
  }, [wallet.publicKey, stealthAddress]);

  /**
   * Verify ownership of a specific .zkey.sol name
   */
  const verifyMyName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!wallet.publicKey || !stealthAddress) {
        return false;
      }

      const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "");
      if (!isValidSubdomainName(clean)) {
        return false;
      }

      try {
        const resolved = await lookupName(clean);
        if (!resolved) {
          return false;
        }

        // Check if this subdomain's stealth address matches ours
        const resolvedSpendingHex = Buffer.from(resolved.stealthAddress.spendingPubKey).toString("hex");
        const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");

        if (resolvedSpendingHex === ourSpendingHex) {
          // Verified - this name belongs to us
          setRegisteredName(clean);
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
   * Register a new .zkey.sol subdomain on SNS
   */
  const registerName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!wallet.publicKey || !wallet.signTransaction || !stealthAddress) {
        setError("Wallet not connected or keys not derived");
        return false;
      }

      const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "");
      const validationError = validateName(clean);
      if (validationError) {
        setError(validationError);
        return false;
      }

      setIsRegistering(true);
      setError(null);

      try {
        // Check if name is available
        const available = await isSubdomainAvailable(
          { connection: connection as any },
          clean
        );
        if (!available) {
          setError(`Name "${formatSubdomainName(clean)}" is already taken`);
          return false;
        }

        // Create stealth meta-address for storage
        const stealthMeta: StealthMetaAddress = {
          spendingPubKey: stealthAddress.spendingPubKey,
          viewingPubKey: stealthAddress.viewingPubKey,
        };

        // Create subdomain instruction
        const instructions = await createSubdomainInstruction(
          { connection: connection as any },
          {
            name: clean,
            owner: wallet.publicKey,
            stealthAddress: stealthMeta,
          }
        );

        // Build and send transaction
        const transaction = new Transaction();
        for (const ix of instructions) {
          transaction.add(ix);
        }
        transaction.feePayer = wallet.publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;

        const signed = await wallet.signTransaction(transaction);
        const txid = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(
          { signature: txid, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        // Registration successful
        setRegisteredName(clean);
        setHasRegisteredName(true);
        console.log(`[zkey.sol] Registered: ${formatSubdomainName(clean)} (tx: ${txid})`);
        return true;
      } catch (err) {
        console.error("Failed to register name:", err);

        const errorMessage = err instanceof Error ? err.message : String(err);

        // Handle specific errors
        if (errorMessage.includes("already been processed")) {
          // Check if registration succeeded
          try {
            const resolved = await lookupName(clean);
            if (resolved) {
              const resolvedSpendingHex = Buffer.from(resolved.stealthAddress.spendingPubKey).toString("hex");
              const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");
              if (resolvedSpendingHex === ourSpendingHex) {
                setRegisteredName(clean);
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
    [wallet, stealthAddress, connection, validateName, lookupName]
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
    validateName,
    formatName,
  };
}
