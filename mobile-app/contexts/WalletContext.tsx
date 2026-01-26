/**
 * Wallet Context
 *
 * Global state management for the zVault mobile wallet.
 * Uses React Context + Zustand for persistent state.
 *
 * @module contexts/WalletContext
 */

import React, {
  createContext,
  useContext,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { create } from "zustand";
import * as Crypto from "expo-crypto";

// Local imports
import {
  MobileKeys,
  loadKeys,
  loadStealthMetaAddressEncoded,
  saveKeys,
  deriveKeysFromMnemonic,
  generateMnemonic,
} from "../lib/keys";
import {
  isWalletInitialized,
  getCachedItem,
  setCachedItem,
  STORAGE_KEYS,
} from "../lib/storage";
import {
  generateClaimProof,
  isNoirAvailable,
  requestBackendProof,
  createEmptyMerkleProof,
  numberToString,
  type ProofResult,
  CIRCUITS,
} from "../lib/proof";

// SDK imports
import {
  deriveNote,
  deriveTaprootAddress,
  createClaimLink,
  decodeClaimLink,
  prepareStealthDeposit,
  decodeStealthMetaAddress,
  bigintToBytes,
  type StealthMetaAddress,
} from "@zvault/sdk";

// ============================================================================
// Types
// ============================================================================

export interface Note {
  id: string;
  nullifier: string;
  secret: string;
  amount: number; // satoshis
  commitment: string;
  status: "pending" | "confirmed" | "spent";
  createdAt: number;
}

export interface Deposit {
  id: string;
  amount: number; // satoshis
  taprootAddress: string;
  commitment: string;
  claimLink?: string;
  status: "waiting" | "detected" | "confirming" | "claimable" | "claimed";
  confirmations: number;
  txHash?: string;
  createdAt: number;
  claimedAt?: number;
}

export interface ClaimResult {
  success: boolean;
  note?: Note;
  proofDuration?: number;
  error?: string;
}

// ============================================================================
// Zustand Store
// ============================================================================

interface WalletState {
  // Initialization
  isInitialized: boolean;
  isLoading: boolean;

  // Keys (only public parts stored in state)
  stealthMetaAddress: string | null;

  // Balance
  balance: number; // satoshis
  notes: Note[];

  // Deposits
  deposits: Deposit[];

  // Actions
  setInitialized: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setStealthMetaAddress: (address: string) => void;
  setBalance: (balance: number) => void;
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  removeNote: (id: string) => void;
  setDeposits: (deposits: Deposit[]) => void;
  addDeposit: (deposit: Deposit) => void;
  updateDeposit: (id: string, updates: Partial<Deposit>) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  isInitialized: false,
  isLoading: true,
  stealthMetaAddress: null,
  balance: 0,
  notes: [],
  deposits: [],

  setInitialized: (value) => set({ isInitialized: value }),
  setLoading: (value) => set({ isLoading: value }),
  setStealthMetaAddress: (address) => set({ stealthMetaAddress: address }),
  setBalance: (balance) => set({ balance }),
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set((state) => ({ notes: [...state.notes, note] })),
  updateNote: (id, updates) =>
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  removeNote: (id) =>
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
    })),
  setDeposits: (deposits) => set({ deposits }),
  addDeposit: (deposit) =>
    set((state) => ({ deposits: [...state.deposits, deposit] })),
  updateDeposit: (id, updates) =>
    set((state) => ({
      deposits: state.deposits.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      ),
    })),
}));

// ============================================================================
// Context Interface
// ============================================================================

interface WalletContextValue {
  // Wallet operations
  createWallet: () => Promise<string>;
  importWallet: (mnemonic: string) => Promise<void>;
  unlockWallet: () => Promise<MobileKeys | null>;

  // Deposit operations
  createDeposit: (amount: number) => Promise<Deposit>;

  // Send operations
  sendToStealth: (recipientAddress: string, amount: number) => Promise<string>;
  sendByNote: (amount: number) => Promise<{ claimLink: string; note: Note }>;

  // Claim operations
  claimNote: (claimLink: string) => Promise<ClaimResult>;
  claimNoteWithProof: (
    nullifier: string,
    secret: string,
    amount: number
  ) => Promise<ClaimResult>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export function WalletProvider({ children }: { children: ReactNode }) {
  const store = useWalletStore();

  // Initialize wallet state on mount
  useEffect(() => {
    initializeWallet();
  }, []);

  /**
   * Initialize wallet from persistent storage
   */
  async function initializeWallet() {
    store.setLoading(true);
    try {
      const initialized = await isWalletInitialized();
      store.setInitialized(initialized);

      if (initialized) {
        // Load stealth address (doesn't require Face ID)
        const stealthAddressEncoded = await loadStealthMetaAddressEncoded();
        if (stealthAddressEncoded) {
          store.setStealthMetaAddress(stealthAddressEncoded);
        }

        // Load cached deposits
        const cachedDeposits = await getCachedItem<Deposit[]>(
          STORAGE_KEYS.PENDING_DEPOSITS
        );
        if (cachedDeposits) {
          store.setDeposits(cachedDeposits);
        }

        // Load cached notes and calculate balance
        const cachedNotes = await getCachedItem<Note[]>(
          STORAGE_KEYS.SCANNED_NOTES
        );
        if (cachedNotes) {
          store.setNotes(cachedNotes);
          const balance = cachedNotes
            .filter((n) => n.status === "confirmed")
            .reduce((sum, n) => sum + n.amount, 0);
          store.setBalance(balance);
        }
      }
    } catch (error) {
      console.error("[Wallet] Failed to initialize:", error);
    } finally {
      store.setLoading(false);
    }
  }

  /**
   * Create a new wallet with fresh mnemonic
   */
  const createWallet = useCallback(async (): Promise<string> => {
    const mnemonic = generateMnemonic();
    const keys = deriveKeysFromMnemonic(mnemonic);
    await saveKeys(keys);

    store.setStealthMetaAddress(keys.stealthMetaAddressEncoded);
    store.setInitialized(true);

    return mnemonic;
  }, [store]);

  /**
   * Import wallet from existing mnemonic
   */
  const importWallet = useCallback(
    async (mnemonic: string): Promise<void> => {
      const keys = deriveKeysFromMnemonic(mnemonic);
      await saveKeys(keys);

      store.setStealthMetaAddress(keys.stealthMetaAddressEncoded);
      store.setInitialized(true);
    },
    [store]
  );

  /**
   * Unlock wallet (prompts Face ID)
   */
  const unlockWallet = useCallback(async (): Promise<MobileKeys | null> => {
    return loadKeys();
  }, []);

  /**
   * Create a new BTC deposit
   */
  const createDeposit = useCallback(
    async (amount: number): Promise<Deposit> => {
      // Generate cryptographically secure random seed
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      const seed = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Derive note from seed using SDK
      const amountSats = BigInt(amount);
      const note = deriveNote(seed, 0, amountSats);

      // Convert commitment to bytes for Taproot derivation
      const commitmentBytes = bigintToBytes(note.commitment);

      // Derive real Taproot address from commitment
      const taprootResult = await deriveTaprootAddress(
        commitmentBytes,
        "testnet"
      );

      // Generate claim link for recovery
      const claimLink = createClaimLink(note);

      // Generate unique deposit ID
      const id = Date.now().toString();

      const deposit: Deposit = {
        id,
        amount,
        taprootAddress: taprootResult.address,
        commitment: note.commitment.toString(16).padStart(64, "0"),
        claimLink,
        status: "waiting",
        confirmations: 0,
        createdAt: Date.now(),
      };

      // Store claim link separately (for recovery)
      await setCachedItem(`claim_link_${id}`, claimLink);

      store.addDeposit(deposit);

      // Persist deposits
      const deposits = [...store.deposits, deposit];
      await setCachedItem(STORAGE_KEYS.PENDING_DEPOSITS, deposits);

      return deposit;
    },
    [store]
  );

  /**
   * Send to stealth address (prepares deposit data)
   */
  const sendToStealth = useCallback(
    async (recipientAddress: string, amount: number): Promise<string> => {
      // Parse recipient's stealth meta-address
      let recipientMeta: StealthMetaAddress;
      try {
        recipientMeta = decodeStealthMetaAddress(recipientAddress);
      } catch {
        throw new Error("Invalid stealth address format");
      }

      // Prepare stealth deposit using SDK
      const stealthDeposit = await prepareStealthDeposit({
        recipientMeta,
        network: "testnet",
      });

      // Store the pending stealth send
      const id = Date.now().toString();
      await setCachedItem(`stealth_send_${id}`, {
        btcDepositAddress: stealthDeposit.btcDepositAddress,
        amount: amount.toString(),
        recipient: recipientAddress.slice(0, 16) + "...",
        createdAt: Date.now(),
      });

      // Return the Taproot address for BTC send
      return stealthDeposit.btcDepositAddress;
    },
    []
  );

  /**
   * Create a shareable note (claim link)
   */
  const sendByNote = useCallback(
    async (
      amount: number
    ): Promise<{ claimLink: string; note: Note }> => {
      // Generate random seed for note
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      const seed = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Derive note using SDK
      const sdkNote = deriveNote(seed, 0, BigInt(amount));

      const note: Note = {
        id: Date.now().toString(),
        nullifier: sdkNote.nullifier.toString(),
        secret: sdkNote.secret.toString(),
        amount,
        commitment: sdkNote.commitment.toString(16).padStart(64, "0"),
        status: "confirmed",
        createdAt: Date.now(),
      };

      // Generate claim link using SDK
      const claimLink = createClaimLink(sdkNote);

      return { claimLink, note };
    },
    []
  );

  /**
   * Claim a note with ZK proof generation
   */
  const claimNoteWithProof = useCallback(
    async (
      nullifier: string,
      secret: string,
      amount: number
    ): Promise<ClaimResult> => {
      try {
        // Check if native prover is available
        const noirAvailable = await isNoirAvailable();

        let proofResult: ProofResult;

        if (noirAvailable) {
          // Generate proof using native Noir prover (mopro)
          console.log("[Wallet] Generating claim proof with native prover...");

          proofResult = await generateClaimProof({
            nullifier,
            secret,
            amount: numberToString(amount),
            merkleRoot: "0", // TODO: Get from chain
            merkleProof: createEmptyMerkleProof(10),
          });
        } else {
          // Fallback to backend prover
          console.log("[Wallet] Using backend prover...");

          proofResult = await requestBackendProof(CIRCUITS.CLAIM, {
            nullifier,
            secret,
            amount: numberToString(amount),
            merkle_root: "0",
            merkle_path: Array(10).fill("0"),
            path_indices: Array(10).fill("0"),
          });
        }

        if (!proofResult.success) {
          return {
            success: false,
            error: proofResult.error || "Proof generation failed",
            proofDuration: proofResult.duration,
          };
        }

        console.log(
          `[Wallet] Proof generated in ${proofResult.duration}ms`
        );

        // TODO: Submit proof to Solana
        // const tx = await submitClaimTransaction(proofResult.proof, ...);

        // Create note from claim
        const note: Note = {
          id: Date.now().toString(),
          nullifier,
          secret,
          amount,
          commitment: `${nullifier}_${secret}`, // Simplified
          status: "confirmed",
          createdAt: Date.now(),
        };

        // Update state
        store.addNote(note);
        store.setBalance(store.balance + amount);

        // Persist
        const notes = [...store.notes, note];
        await setCachedItem(STORAGE_KEYS.SCANNED_NOTES, notes);

        return {
          success: true,
          note,
          proofDuration: proofResult.duration,
        };
      } catch (error) {
        console.error("[Wallet] Claim with proof failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Claim failed",
        };
      }
    },
    [store]
  );

  /**
   * Claim a note from claim link
   */
  const claimNote = useCallback(
    async (claimLink: string): Promise<ClaimResult> => {
      try {
        // Decode claim link using SDK
        const decoded = decodeClaimLink(claimLink);
        if (!decoded) {
          return { success: false, error: "Invalid claim link" };
        }

        // Handle different return types from SDK
        if (typeof decoded === "string") {
          // Seed format - derive note from seed
          const note = deriveNote(decoded, 0, 0n);
          return claimNoteWithProof(
            note.nullifier.toString(),
            note.secret.toString(),
            0 // Amount not available in seed format
          );
        }

        // Legacy format with nullifier and secret
        const { nullifier, secret } = decoded;
        return claimNoteWithProof(
          nullifier,
          secret,
          0 // Amount not available in legacy format
        );
      } catch (error) {
        console.error("[Wallet] Claim failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Claim failed",
        };
      }
    },
    [claimNoteWithProof]
  );

  const value: WalletContextValue = {
    createWallet,
    importWallet,
    unlockWallet,
    createDeposit,
    sendToStealth,
    sendByNote,
    claimNote,
    claimNoteWithProof,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access wallet context
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}

/**
 * Hook for formatted balance display
 */
export function useFormattedBalance() {
  const balance = useWalletStore((state) => state.balance);

  const btc = balance / 100_000_000;
  const sats = balance;

  return {
    btc: btc.toFixed(8),
    sats: sats.toLocaleString(),
    usd: (btc * 100000).toFixed(2), // Placeholder BTC price
  };
}
