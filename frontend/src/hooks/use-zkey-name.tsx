"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, TransactionInstruction, Transaction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { useZVaultKeys } from "./use-zvault";

// Program ID for zVault
const PROGRAM_ID = new PublicKey("DjnryiDxMsUY8pzYCgynVUGDgv45J9b3XbSDnp4qDYrq");

// Constants
const NAME_REGISTRY_SEED = "zkey";
const NAME_REGISTRY_DISCRIMINATOR = 0x09;
const REGISTER_NAME_DISCRIMINATOR = 17;

interface NameRegistryEntry {
  name: string;
  owner: Uint8Array;
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
}

interface UseZkeyNameReturn {
  registeredName: string | null;
  hasRegisteredName: boolean;
  isLoading: boolean;
  isRegistering: boolean;
  isCheckingAvailability: boolean;
  isNameTaken: boolean;
  error: string | null;
  lookupMyName: () => Promise<void>;
  registerName: (name: string) => Promise<boolean>;
  lookupName: (name: string) => Promise<NameRegistryEntry | null>;
  checkAvailability: (name: string) => Promise<boolean>;
  verifyMyName: (name: string) => Promise<boolean>;
  validateName: (name: string) => string | null;
  formatName: (name: string) => string;
}

// Hash name using SHA256
function hashName(name: string): Uint8Array {
  const normalized = name.toLowerCase().replace(/\.zkey\.sol$/, "").replace(/\.zkey$/, "");
  return sha256(new TextEncoder().encode(normalized));
}

// Validate name
function isValidName(name: string): boolean {
  if (!name || name.length < 1 || name.length > 32) return false;
  return /^[a-z0-9_]+$/.test(name);
}

// Normalize name
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\.zkey\.sol$/, "").replace(/\.zkey$/, "").trim();
}

// Format with .zkey.sol suffix
function formatZkeyName(name: string): string {
  return `${normalizeName(name)}.zkey.sol`;
}

// Get validation error
function getNameValidationError(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length < 1) return "Name must be at least 1 character";
  if (name.length > 32) return "Name must be at most 32 characters";
  if (!/^[a-z0-9_]+$/.test(name)) return "Name can only contain lowercase letters, numbers, and underscores";
  return null;
}

// Parse name registry account data
function parseNameRegistry(data: Uint8Array, name: string): NameRegistryEntry | null {
  if (data.length < 100) return null;
  if (data[0] !== NAME_REGISTRY_DISCRIMINATOR) return null;

  return {
    name,
    owner: data.slice(34, 66),
    spendingPubKey: data.slice(66, 99),
    viewingPubKey: data.slice(99, 132),
  };
}

// Build register name instruction data
function buildRegisterNameData(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(1 + 1 + nameBytes.length + 33 + 33);
  let offset = 0;

  data[offset++] = REGISTER_NAME_DISCRIMINATOR;
  data[offset++] = nameBytes.length;
  data.set(nameBytes, offset);
  offset += nameBytes.length;
  data.set(spendingPubKey, offset);
  offset += 33;
  data.set(viewingPubKey, offset);

  return data;
}

/**
 * Hook for managing .zkey.sol name registration
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

  // Derive PDA for a name
  const deriveNamePDA = useCallback((name: string): [PublicKey, number] => {
    const nameHash = hashName(name);
    return PublicKey.findProgramAddressSync(
      [Buffer.from(NAME_REGISTRY_SEED), Buffer.from(nameHash)],
      PROGRAM_ID
    );
  }, []);

  // Look up a name on-chain
  const lookupName = useCallback(async (name: string): Promise<NameRegistryEntry | null> => {
    try {
      const normalized = normalizeName(name);
      if (!isValidName(normalized)) return null;

      const [pda] = deriveNamePDA(normalized);
      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) return null;

      return parseNameRegistry(new Uint8Array(accountInfo.data), normalized);
    } catch (err) {
      console.error("Failed to lookup name:", err);
      return null;
    }
  }, [connection, deriveNamePDA]);

  // Check availability
  const checkAvailability = useCallback(async (name: string): Promise<boolean> => {
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
    } catch {
      setIsNameTaken(false);
      return true;
    } finally {
      setIsCheckingAvailability(false);
    }
  }, [lookupName]);

  // Look up if current wallet has a registered name
  const lookupMyName = useCallback(async () => {
    if (!wallet.publicKey || !stealthAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 180 },
          { memcmp: { offset: 34, bytes: wallet.publicKey.toBase58() } },
        ],
      });

      for (const { account } of accounts) {
        const entry = parseNameRegistry(new Uint8Array(account.data), "");
        if (entry) {
          const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
          const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");
          if (entrySpendingHex === ourSpendingHex) {
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

  // Verify ownership of a specific name
  const verifyMyName = useCallback(async (name: string): Promise<boolean> => {
    if (!wallet.publicKey || !stealthAddress) return false;

    const normalized = normalizeName(name);
    if (!isValidName(normalized)) return false;

    try {
      const entry = await lookupName(normalized);
      if (!entry) return false;

      const entrySpendingHex = Buffer.from(entry.spendingPubKey).toString("hex");
      const ourSpendingHex = Buffer.from(stealthAddress.spendingPubKey).toString("hex");

      if (entrySpendingHex === ourSpendingHex) {
        setRegisteredName(normalized);
        setHasRegisteredName(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [wallet.publicKey, stealthAddress, lookupName]);

  // Register a new name
  const registerName = useCallback(async (name: string): Promise<boolean> => {
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
      // Check if taken
      const existing = await lookupName(normalized);
      if (existing) {
        setError(`Name "${formatZkeyName(normalized)}" is already registered`);
        return false;
      }

      // Build instruction
      const instructionData = buildRegisterNameData(
        normalized,
        stealthAddress.spendingPubKey,
        stealthAddress.viewingPubKey
      );

      const [namePDA] = deriveNamePDA(normalized);

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: namePDA, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: Buffer.from(instructionData),
      });

      const transaction = new Transaction().add(instruction);
      transaction.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      const signed = await wallet.signTransaction(transaction);
      const txid = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      const confirmation = await connection.confirmTransaction(
        { signature: txid, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      setRegisteredName(normalized);
      setHasRegisteredName(true);
      console.log(`[zkey.sol] Registered: ${formatZkeyName(normalized)} (tx: ${txid})`);
      return true;
    } catch (err) {
      console.error("Failed to register name:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || "Failed to register name");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [wallet, stealthAddress, connection, deriveNamePDA, lookupName]);

  // Check for existing name on mount
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
