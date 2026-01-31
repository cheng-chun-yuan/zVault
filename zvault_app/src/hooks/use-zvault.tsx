"use client";

import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
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

interface ZVaultContextValue {
  // Poseidon
  isPoseidonReady: boolean;

  // Keys
  keys: ZVaultKeys | null;
  stealthAddress: StealthMetaAddress | null;
  stealthAddressEncoded: string | null;
  isLoading: boolean;
  error: string | null;
  deriveKeys: () => Promise<void>;
  clearKeys: () => Promise<void>;
  hasKeys: boolean;
  isWalletConnected: boolean;

  // Inbox
  inboxNotes: InboxNote[];
  inboxTotalSats: bigint;
  inboxDepositCount: number;
  inboxLoading: boolean;
  inboxError: string | null;
  refreshInbox: () => Promise<void>;
}

const ZVaultContext = createContext<ZVaultContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

/**
 * Combined provider for zVault keys and stealth inbox
 */
export function ZVaultProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const { connection } = useConnection();

  // Poseidon state
  const [isPoseidonReady, setIsPoseidonReady] = useState(false);

  // Keys state
  const [keys, setKeys] = useState<ZVaultKeys | null>(null);
  const [stealthAddress, setStealthAddress] = useState<StealthMetaAddress | null>(null);
  const [stealthAddressEncoded, setStealthAddressEncoded] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inbox state
  const [inboxNotes, setInboxNotes] = useState<InboxNote[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [hasFetchedInbox, setHasFetchedInbox] = useState(false);

  // Initialize Poseidon on mount (required for stealth functions)
  useEffect(() => {
    initPoseidon()
      .then(() => setIsPoseidonReady(true))
      .catch((err) => console.error("[ZVault] Failed to init Poseidon:", err));
  }, []);

  // Clear everything when wallet disconnects
  useEffect(() => {
    if (!wallet.connected) {
      setKeys(null);
      setStealthAddress(null);
      setStealthAddressEncoded(null);
      setError(null);
      setInboxNotes([]);
      setInboxError(null);
      setHasFetchedInbox(false);
    }
  }, [wallet.connected]);

  // Derive keys from wallet signature
  const deriveKeys = useCallback(async () => {
    if (!wallet.connected || !wallet.signMessage || !wallet.publicKey) {
      setError("Wallet not connected or doesn't support message signing");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const derivedKeys = await deriveKeysFromWallet({
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
      });

      const meta = createStealthMetaAddress(derivedKeys);
      const encoded = encodeStealthMetaAddress(meta);

      setKeys(derivedKeys);
      setStealthAddress(meta);
      setStealthAddressEncoded(encoded);
    } catch (err) {
      // User rejected signature - don't show as error, just silently return
      if (err instanceof Error) {
        const isUserRejection =
          err.name === "WalletSignMessageError" ||
          err.message.includes("User rejected") ||
          err.message.includes("user rejected");

        if (isUserRejection) {
          // User cancelled - not an error, just return silently
          return;
        }

        if (err.message.includes("Internal JSON-RPC")) {
          setError("Wallet error - please try reconnecting");
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to derive keys");
      }
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const clearKeys = useCallback(async () => {
    setKeys(null);
    setStealthAddress(null);
    setStealthAddressEncoded(null);
    setError(null);
    setInboxNotes([]);
    setHasFetchedInbox(false);
    // Also disconnect the wallet
    try {
      if (wallet.connected) {
        await wallet.disconnect();
      }
    } catch {
      // Ignore disconnect errors (wallet may already be disconnected)
    }
  }, [wallet]);

  // Fetch and scan stealth inbox
  const refreshInbox = useCallback(async () => {
    if (!keys) {
      setInboxNotes([]);
      return;
    }

    setInboxLoading(true);
    setInboxError(null);

    try {
      const programId = new PublicKey(ZVAULT_PROGRAM_ID);
      const accounts = await connection.getProgramAccounts(programId, {
        filters: [{ dataSize: STEALTH_ANNOUNCEMENT_SIZE }],
      });

      const announcements = accounts
        .map((account) => {
          const parsed = parseStealthAnnouncement(new Uint8Array(account.account.data));
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
        const originalAnn = announcements.find(
          (a) => Buffer.from(a.commitment).equals(Buffer.from(note.commitment))
        );
        return {
          ...note,
          id: `${Buffer.from(note.commitment).toString("hex").slice(0, 16)}-${index}`,
          createdAt: originalAnn?.createdAt ? originalAnn.createdAt * 1000 : Date.now(),
          commitmentHex: Buffer.from(note.commitment).toString("hex"),
        };
      });

      notes.sort((a, b) => b.createdAt - a.createdAt);
      setInboxNotes(notes);
      setHasFetchedInbox(true);
    } catch (err) {
      console.error("[ZVault] Inbox error:", err);
      setInboxError(err instanceof Error ? err.message : "Failed to fetch inbox");
    } finally {
      setInboxLoading(false);
    }
  }, [connection, keys]);

  // Auto-fetch inbox once when keys become available
  useEffect(() => {
    if (keys && !hasFetchedInbox && !inboxLoading) {
      refreshInbox();
    }
  }, [keys, hasFetchedInbox, inboxLoading, refreshInbox]);

  // Calculate totals
  const inboxTotalSats = inboxNotes.reduce((sum, note) => sum + BigInt(note.amount ?? 0), 0n);
  const inboxDepositCount = inboxNotes.length;

  return (
    <ZVaultContext.Provider
      value={{
        // Poseidon
        isPoseidonReady,
        // Keys
        keys,
        stealthAddress,
        stealthAddressEncoded,
        isLoading,
        error,
        deriveKeys,
        clearKeys,
        hasKeys: keys !== null,
        isWalletConnected: wallet.connected,
        // Inbox
        inboxNotes,
        inboxTotalSats,
        inboxDepositCount,
        inboxLoading,
        inboxError,
        refreshInbox,
      }}
    >
      {children}
    </ZVaultContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Full zVault context (keys + inbox)
 */
export function useZVault(): ZVaultContextValue {
  const context = useContext(ZVaultContext);
  if (!context) {
    throw new Error("useZVault must be used within ZVaultProvider");
  }
  return context;
}

/**
 * Just keys (backwards compatible)
 */
export function useZVaultKeys() {
  const ctx = useZVault();
  return {
    keys: ctx.keys,
    stealthAddress: ctx.stealthAddress,
    stealthAddressEncoded: ctx.stealthAddressEncoded,
    isLoading: ctx.isLoading,
    error: ctx.error,
    deriveKeys: ctx.deriveKeys,
    clearKeys: ctx.clearKeys,
    hasKeys: ctx.hasKeys,
    isWalletConnected: ctx.isWalletConnected,
  };
}

/**
 * Just inbox (backwards compatible)
 */
export function useStealthInbox() {
  const ctx = useZVault();
  return {
    notes: ctx.inboxNotes,
    totalAmountSats: ctx.inboxTotalSats,
    depositCount: ctx.inboxDepositCount,
    isLoading: ctx.inboxLoading,
    error: ctx.inboxError,
    refresh: ctx.refreshInbox,
    hasKeys: ctx.hasKeys,
  };
}
