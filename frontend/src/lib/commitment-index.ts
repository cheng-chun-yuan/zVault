/**
 * Server-Side Commitment Tree Index
 *
 * Maintains a persistent commitment tree index for Merkle proof generation.
 * Uses the SDK's CommitmentTreeIndex with JSON file persistence.
 *
 * This module is server-only (runs in Next.js API routes).
 */

import { CommitmentTreeIndex, DEVNET_CONFIG } from "@zvault/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection } from "./helius-server";

// Storage path for the commitment index
const DATA_DIR = process.cwd() + "/data";
const INDEX_FILE = DATA_DIR + "/commitment-index.json";

// Commitment tree PDA - from SDK config (single source of truth)
const COMMITMENT_TREE_ADDRESS = DEVNET_CONFIG.commitmentTreePda;

// Discriminator for CommitmentTree account
const COMMITMENT_TREE_DISCRIMINATOR = 0x05;
const ROOT_HISTORY_SIZE = 100;

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
 * Read little-endian u64 from buffer
 */
function readU64LE(buffer: Buffer | Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(buffer[offset + i]) << BigInt(i * 8);
  }
  return result;
}

/**
 * Fetch on-chain commitment tree state
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

  const data = accountInfo.data;

  // Validate discriminator
  if (data[0] !== COMMITMENT_TREE_DISCRIMINATOR) {
    throw new Error("Invalid commitment tree discriminator");
  }

  // Parse state
  const currentRoot = Buffer.from(data.slice(8, 40)).toString("hex");
  const nextIndex = readU64LE(data, 40);

  // Skip root history for now (100 * 32 bytes)
  const rootHistoryOffset = 48 + ROOT_HISTORY_SIZE * 32;
  const rootHistoryIndex =
    data[rootHistoryOffset] |
    (data[rootHistoryOffset + 1] << 8) |
    (data[rootHistoryOffset + 2] << 16) |
    (data[rootHistoryOffset + 3] << 24);

  return {
    currentRoot,
    nextIndex,
    rootHistoryIndex,
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
