"use client";

import { create } from "zustand";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  initPoseidon,
  deriveKeysFromWallet,
  createStealthMetaAddress,
  encodeStealthMetaAddress,
  scanAnnouncements,
  parseStealthAnnouncement,
  announcementToScanFormat,
  STEALTH_ANNOUNCEMENT_SIZE,
  type ZVaultKeys,
  type StealthMetaAddress,
  type ScannedNote,
} from "@zvault/sdk";
import { ZVAULT_PROGRAM_ID } from "@/lib/constants";

// ============================================================================
// Types
// ============================================================================

export interface InboxNote extends ScannedNote {
  id: string;
  createdAt: number;
  commitmentHex: string;
}

interface ZVaultState {
  // Poseidon
  isPoseidonReady: boolean;

  // Keys
  keys: ZVaultKeys | null;
  stealthAddress: StealthMetaAddress | null;
  stealthAddressEncoded: string | null;
  isLoading: boolean;
  error: string | null;
  hasKeys: boolean;

  // Inbox
  inboxNotes: InboxNote[];
  inboxTotalSats: bigint;
  inboxDepositCount: number;
  inboxLoading: boolean;
  inboxError: string | null;

  // Actions
  initPoseidon: () => Promise<void>;
  deriveKeys: (wallet: {
    publicKey: PublicKey;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  }) => Promise<void>;
  clearKeys: () => void;
  refreshInbox: (connection: Connection) => Promise<void>;
}

// ============================================================================
// Store
// ============================================================================

export const useZVaultStore = create<ZVaultState>((set, get) => ({
  // Initial state
  isPoseidonReady: false,
  keys: null,
  stealthAddress: null,
  stealthAddressEncoded: null,
  isLoading: false,
  error: null,
  hasKeys: false,
  inboxNotes: [],
  inboxTotalSats: 0n,
  inboxDepositCount: 0,
  inboxLoading: false,
  inboxError: null,

  initPoseidon: async () => {
    try {
      await initPoseidon();
      set({ isPoseidonReady: true });
    } catch (err) {
      console.error("[ZVault] Failed to init Poseidon:", err);
    }
  },

  deriveKeys: async (wallet) => {
    set({ isLoading: true, error: null });

    try {
      const derivedKeys = await deriveKeysFromWallet({
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
      });

      const meta = createStealthMetaAddress(derivedKeys);
      const encoded = encodeStealthMetaAddress(meta);

      set({
        keys: derivedKeys,
        stealthAddress: meta,
        stealthAddressEncoded: encoded,
        hasKeys: true,
        isLoading: false,
      });
    } catch (err) {
      if (err instanceof Error) {
        const isUserRejection =
          err.name === "WalletSignMessageError" ||
          err.message.includes("User rejected") ||
          err.message.includes("user rejected");

        if (isUserRejection) {
          set({ isLoading: false });
          return;
        }

        if (err.message.includes("Internal JSON-RPC")) {
          set({ error: "Wallet error - please try reconnecting", isLoading: false });
        } else {
          set({ error: err.message, isLoading: false });
        }
      } else {
        set({ error: "Failed to derive keys", isLoading: false });
      }
    }
  },

  clearKeys: () => {
    set({
      keys: null,
      stealthAddress: null,
      stealthAddressEncoded: null,
      error: null,
      hasKeys: false,
      inboxNotes: [],
      inboxTotalSats: 0n,
      inboxDepositCount: 0,
      inboxError: null,
    });
  },

  refreshInbox: async (connection) => {
    const { keys } = get();
    if (!keys) {
      set({ inboxNotes: [], inboxTotalSats: 0n, inboxDepositCount: 0 });
      return;
    }

    set({ inboxLoading: true, inboxError: null });

    try {
      const programId = new PublicKey(ZVAULT_PROGRAM_ID);
      const accounts = await connection.getProgramAccounts(programId, {
        filters: [{ dataSize: STEALTH_ANNOUNCEMENT_SIZE }],
      });

      const announcements = accounts
        .map((account) => {
          const parsed = parseStealthAnnouncement(
            new Uint8Array(account.account.data)
          );
          if (!parsed) return null;
          return {
            ...announcementToScanFormat(parsed),
            createdAt: parsed.createdAt,
            pubkey: account.pubkey.toBase58(),
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      const scanned = await scanAnnouncements(keys, announcements);

      const notes: InboxNote[] = scanned.map((note, index) => {
        const originalAnn = announcements.find((a) =>
          Buffer.from(a.commitment).equals(Buffer.from(note.commitment))
        );
        return {
          ...note,
          id: `${Buffer.from(note.commitment).toString("hex").slice(0, 16)}-${index}`,
          createdAt: originalAnn?.createdAt
            ? originalAnn.createdAt * 1000
            : Date.now(),
          commitmentHex: Buffer.from(note.commitment).toString("hex"),
        };
      });

      notes.sort((a, b) => b.createdAt - a.createdAt);

      const totalSats = notes.reduce(
        (sum, note) => sum + BigInt(note.amount ?? 0),
        0n
      );

      set({
        inboxNotes: notes,
        inboxTotalSats: totalSats,
        inboxDepositCount: notes.length,
        inboxLoading: false,
      });
    } catch (err) {
      console.error("[ZVault] Inbox error:", err);
      set({
        inboxError: err instanceof Error ? err.message : "Failed to fetch inbox",
        inboxLoading: false,
      });
    }
  },
}));

// ============================================================================
// Convenience Hooks (backwards compatible)
// ============================================================================

export function useZVault() {
  return useZVaultStore();
}

export function useZVaultKeys() {
  const store = useZVaultStore();
  return {
    keys: store.keys,
    stealthAddress: store.stealthAddress,
    stealthAddressEncoded: store.stealthAddressEncoded,
    isLoading: store.isLoading,
    error: store.error,
    deriveKeys: store.deriveKeys,
    clearKeys: store.clearKeys,
    hasKeys: store.hasKeys,
  };
}

export function useStealthInbox() {
  const store = useZVaultStore();
  return {
    notes: store.inboxNotes,
    totalAmountSats: store.inboxTotalSats,
    depositCount: store.inboxDepositCount,
    isLoading: store.inboxLoading,
    error: store.inboxError,
    refresh: store.refreshInbox,
    hasKeys: store.hasKeys,
  };
}
