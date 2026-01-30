/**
 * Server-Side Commitment Tree Index
 *
 * Maintains a persistent commitment tree index for Merkle proof generation.
 * Uses the SDK's CommitmentTreeIndex with JSON file persistence.
 *
 * This module is server-only (runs in Next.js API routes).
 */

import {
  CommitmentTreeIndex,
  DEVNET_CONFIG,
  parseCommitmentTreeData,
  parseStealthAnnouncement,
  STEALTH_ANNOUNCEMENT_SIZE,
  COMMITMENT_TREE_DISCRIMINATOR,
  ROOT_HISTORY_SIZE,
} from "@zvault/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection } from "./helius-server";

// zVault Program ID from SDK
const ZVAULT_PROGRAM_ID = new PublicKey(DEVNET_CONFIG.zvaultProgramId);

// Storage path for the commitment index
const DATA_DIR = process.cwd() + "/data";
const INDEX_FILE = DATA_DIR + "/commitment-index.json";

// Commitment tree PDA - from SDK config (single source of truth)
const COMMITMENT_TREE_ADDRESS = DEVNET_CONFIG.commitmentTreePda;

// Server-side singleton
let serverIndex: CommitmentTreeIndex | null = null;

/**
 * Get or create the server-side commitment index singleton
 */
export function getServerCommitmentIndex(): CommitmentTreeIndex {
  if (!serverIndex) {
    serverIndex = new CommitmentTreeIndex();

    // Try to load from file
    try {
      if (existsSync(INDEX_FILE)) {
        const stored = readFileSync(INDEX_FILE, "utf-8");
        serverIndex.import(JSON.parse(stored));
        console.log(
          `[CommitmentIndex] Loaded ${serverIndex.size()} commitments from ${INDEX_FILE}`
        );
      }
    } catch (e) {
      console.warn("[CommitmentIndex] Failed to load from file:", e);
    }
  }
  return serverIndex;
}

/**
 * Save the commitment index to disk
 */
export function saveServerCommitmentIndex(): void {
  if (!serverIndex) return;

  try {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    const data = serverIndex.export();
    writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
    console.log(
      `[CommitmentIndex] Saved ${serverIndex.size()} commitments to ${INDEX_FILE}`
    );
  } catch (e) {
    console.error("[CommitmentIndex] Failed to save to file:", e);
    throw e;
  }
}

/**
 * Add a commitment to the index and persist
 */
export function addCommitmentToIndex(
  commitment: bigint,
  amount: bigint
): { leafIndex: bigint; root: bigint } {
  const index = getServerCommitmentIndex();
  const leafIndex = index.addCommitment(commitment, amount);
  saveServerCommitmentIndex();

  return {
    leafIndex,
    root: index.getRoot(),
  };
}

/**
 * Get Merkle proof for a commitment
 */
export function getMerkleProof(commitment: bigint): {
  siblings: bigint[];
  indices: number[];
  leafIndex: bigint;
  root: bigint;
} | null {
  const index = getServerCommitmentIndex();
  return index.getMerkleProof(commitment);
}

/**
 * Get tree status
 */
export function getTreeStatus(): {
  root: string;
  nextIndex: number;
  size: number;
} {
  const index = getServerCommitmentIndex();
  return {
    root: index.getRoot().toString(16).padStart(64, "0"),
    nextIndex: index.size(),
    size: index.size(),
  };
}

/**
 * Fetch on-chain commitment tree state using SDK's parseCommitmentTreeData
 */
export async function fetchOnChainTreeState(): Promise<{
  currentRoot: string;
  nextIndex: bigint;
  rootHistoryIndex: number;
}> {
  const connection = getHeliusConnection("devnet");
  const pubkey = new PublicKey(COMMITMENT_TREE_ADDRESS);
  const accountInfo = await connection.getAccountInfo(pubkey);

  if (!accountInfo) {
    throw new Error("Commitment tree account not found on-chain");
  }

  // Use SDK's parseCommitmentTreeData (handles discriminator validation + parsing)
  const state = parseCommitmentTreeData(new Uint8Array(accountInfo.data));

  return {
    currentRoot: Buffer.from(state.currentRoot).toString("hex"),
    nextIndex: state.nextIndex,
    rootHistoryIndex: state.rootHistoryIndex,
  };
}

/**
 * Check if local index is synced with on-chain state
 */
export async function checkSyncStatus(): Promise<{
  localRoot: string;
  onChainRoot: string;
  localSize: number;
  onChainNextIndex: bigint;
  synced: boolean;
}> {
  const local = getTreeStatus();
  const onChain = await fetchOnChainTreeState();

  return {
    localRoot: local.root,
    onChainRoot: onChain.currentRoot,
    localSize: local.size,
    onChainNextIndex: onChain.nextIndex,
    synced: local.root === onChain.currentRoot,
  };
}

/**
 * Sync local index from on-chain stealth announcements
 *
 * Fetches all stealth announcement accounts and rebuilds the local index.
 * This ensures the local index matches on-chain state.
 */
export async function syncFromOnChain(): Promise<{
  synced: number;
  skipped: number;
  root: string;
}> {
  const connection = getHeliusConnection("devnet");

  console.log("[CommitmentIndex] Fetching stealth announcements from chain...");

  // Fetch all stealth announcement accounts
  const accounts = await connection.getProgramAccounts(ZVAULT_PROGRAM_ID, {
    filters: [{ dataSize: STEALTH_ANNOUNCEMENT_SIZE }],
  });

  console.log(`[CommitmentIndex] Found ${accounts.length} stealth announcements`);

  // Parse announcements and collect commitments with leaf indices
  const commitments: Array<{ commitment: bigint; leafIndex: number; amount: bigint }> = [];

  for (const account of accounts) {
    try {
      const parsed = parseStealthAnnouncement(new Uint8Array(account.account.data));
      if (parsed) {
        const commitmentBigInt = BigInt(
          "0x" +
            Array.from(parsed.commitment)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
        );
        commitments.push({
          commitment: commitmentBigInt,
          leafIndex: parsed.leafIndex,
          amount: 0n, // Amount is encrypted, we don't need it for merkle proofs
        });
      }
    } catch (e) {
      console.warn("[CommitmentIndex] Failed to parse announcement:", e);
    }
  }

  // Sort by leaf index to ensure correct order
  commitments.sort((a, b) => a.leafIndex - b.leafIndex);

  console.log(`[CommitmentIndex] Parsed ${commitments.length} valid commitments`);

  // Reset and rebuild index
  serverIndex = new CommitmentTreeIndex();
  let synced = 0;
  let skipped = 0;

  for (const { commitment, leafIndex, amount } of commitments) {
    try {
      const addedIndex = serverIndex.addCommitment(commitment, amount);
      if (Number(addedIndex) === leafIndex) {
        synced++;
      } else {
        console.warn(`[CommitmentIndex] Leaf index mismatch: expected ${leafIndex}, got ${addedIndex}`);
        skipped++;
      }
    } catch (e) {
      console.warn("[CommitmentIndex] Failed to add commitment:", e);
      skipped++;
    }
  }

  // Save to disk
  saveServerCommitmentIndex();

  const root = serverIndex.getRoot().toString(16).padStart(64, "0");
  console.log(`[CommitmentIndex] Synced ${synced} commitments, root: ${root.slice(0, 16)}...`);

  return { synced, skipped, root };
}
