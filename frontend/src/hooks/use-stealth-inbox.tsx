"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useZVaultKeys } from "./use-zvault-keys";
import {
  scanAnnouncements,
  parseStealthAnnouncement,
  announcementToScanFormat,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  STEALTH_ANNOUNCEMENT_SIZE,
  type ScannedNote,
} from "@zvault/sdk";
import { ZVAULT_PROGRAM_ID } from "@/lib/constants";

export interface InboxNote extends ScannedNote {
  /** Unique ID for React key */
  id: string;
  /** When the deposit was created (unix timestamp) */
  createdAt: number;
  /** Original commitment as hex string */
  commitmentHex: string;
}

interface UseStealthInboxReturn {
  /** Array of notes addressed to this user */
  notes: InboxNote[];
  /** Whether the hook is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh the inbox */
  refresh: () => Promise<void>;
  /** Whether keys are available for scanning */
  hasKeys: boolean;
}

/**
 * Hook to fetch and scan stealth announcements for the current user
 *
 * Fetches all StealthAnnouncement PDAs from the zVault program and
 * scans them using the user's viewing key to find deposits addressed to them.
 */
export function useStealthInbox(): UseStealthInboxReturn {
  const { connection } = useConnection();
  const { keys, hasKeys } = useZVaultKeys();

  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndScan = useCallback(async () => {
    if (!keys) {
      setNotes([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const programId = new PublicKey(ZVAULT_PROGRAM_ID);

      // Fetch all StealthAnnouncement PDAs
      // Filter by discriminator (0x08) and size (98 bytes)
      const accounts = await connection.getProgramAccounts(programId, {
        filters: [
          { memcmp: { offset: 0, bytes: String.fromCharCode(STEALTH_ANNOUNCEMENT_DISCRIMINATOR) } },
          { dataSize: STEALTH_ANNOUNCEMENT_SIZE },
        ],
      });

      console.log(`[StealthInbox] Found ${accounts.length} stealth announcements`);

      // Parse announcements
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

      console.log(`[StealthInbox] Parsed ${announcements.length} valid announcements`);

      // Scan using viewing key
      const scanned = await scanAnnouncements(keys, announcements);

      console.log(`[StealthInbox] Found ${scanned.length} notes for this user`);

      // Convert to InboxNote format
      const inboxNotes: InboxNote[] = scanned.map((note, index) => {
        const originalAnn = announcements.find(
          (a) => Buffer.from(a.commitment).equals(Buffer.from(note.commitment))
        );

        return {
          ...note,
          id: `${Buffer.from(note.commitment).toString("hex").slice(0, 16)}-${index}`,
          createdAt: originalAnn?.createdAt || Date.now(),
          commitmentHex: Buffer.from(note.commitment).toString("hex"),
        };
      });

      // Sort by creation time (newest first)
      inboxNotes.sort((a, b) => b.createdAt - a.createdAt);

      setNotes(inboxNotes);
    } catch (err) {
      console.error("[StealthInbox] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch inbox");
    } finally {
      setIsLoading(false);
    }
  }, [connection, keys]);

  // Initial fetch when keys become available
  useEffect(() => {
    if (keys) {
      fetchAndScan();
    } else {
      setNotes([]);
    }
  }, [keys, fetchAndScan]);

  return {
    notes,
    isLoading,
    error,
    refresh: fetchAndScan,
    hasKeys,
  };
}
