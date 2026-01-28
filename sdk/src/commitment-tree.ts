/**
 * Commitment Tree Client
 *
 * Fetches and parses on-chain commitment tree data.
 * Provides merkle proof generation for claims.
 *
 * On-chain tree only stores roots (incremental design).
 * This module maintains a local index of commitments for proof generation.
 */

import { poseidon2Hash } from "./poseidon2";
import { bytesToBigint } from "./crypto";

// Tree constants (must match on-chain)
export const TREE_DEPTH = 20;
export const ROOT_HISTORY_SIZE = 100;
export const MAX_LEAVES = 1n << BigInt(TREE_DEPTH);

// Discriminator for CommitmentTree account
export const COMMITMENT_TREE_DISCRIMINATOR = 0x05;

/**
 * On-chain commitment tree state
 */
export interface CommitmentTreeState {
  discriminator: number;
  bump: number;
  currentRoot: Uint8Array;
  nextIndex: bigint;
  rootHistory: Uint8Array[];
  rootHistoryIndex: number;
}

/**
 * Parse commitment tree account data
 */
export function parseCommitmentTreeData(data: Uint8Array): CommitmentTreeState {
  if (data.length < 8 + 32 + 8 + ROOT_HISTORY_SIZE * 32 + 4 + 60) {
    throw new Error("Invalid commitment tree data length");
  }

  if (data[0] !== COMMITMENT_TREE_DISCRIMINATOR) {
    throw new Error("Invalid commitment tree discriminator");
  }

  const discriminator = data[0];
  const bump = data[1];
  // Skip 6 bytes padding (indices 2-7)
  const currentRoot = data.slice(8, 40);
  const nextIndex = bytesToBigint(data.slice(40, 48));

  const rootHistory: Uint8Array[] = [];
  let offset = 48;
  for (let i = 0; i < ROOT_HISTORY_SIZE; i++) {
    rootHistory.push(data.slice(offset, offset + 32));
    offset += 32;
  }

  const rootHistoryIndex =
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24);

  return {
    discriminator,
    bump,
    currentRoot,
    nextIndex,
    rootHistory,
    rootHistoryIndex,
  };
}

/**
 * Check if a root is valid (current or in history)
 */
export function isValidRoot(
  state: CommitmentTreeState,
  root: Uint8Array
): boolean {
  // Check current root
  if (arraysEqual(state.currentRoot, root)) {
    return true;
  }

  // Check historical roots
  for (const histRoot of state.rootHistory) {
    if (arraysEqual(histRoot, root)) {
      return true;
    }
  }

  return false;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Local Commitment Tree Index
 *
 * Maintains an off-chain copy of the commitment tree for merkle proof generation.
 * Uses Poseidon2 hashing to match on-chain computation.
 */
export class CommitmentTreeIndex {
  private commitments: Map<string, { index: bigint; amount: bigint }> =
    new Map();
  private leaves: bigint[] = [];
  private tree: bigint[][] = [];
  private currentRoot: bigint = 0n;

  constructor() {
    // Initialize empty tree with zero values
    this.initializeEmptyTree();
  }

  private initializeEmptyTree(): void {
    // Initialize all levels with zero values
    this.tree = [];
    for (let level = 0; level <= TREE_DEPTH; level++) {
      const levelSize = 1 << (TREE_DEPTH - level);
      this.tree.push(new Array(levelSize).fill(0n));
    }
    this.currentRoot = 0n;
  }

  /**
   * Add a commitment to the index
   */
  addCommitment(commitment: bigint, amount: bigint): bigint {
    const index = BigInt(this.leaves.length);

    // Store in map for lookup
    const commitmentHex = commitment.toString(16).padStart(64, "0");
    this.commitments.set(commitmentHex, { index, amount });

    // Add to leaves
    this.leaves.push(commitment);

    // Update tree
    this.updateTree(Number(index), commitment);

    return index;
  }

  /**
   * Update merkle tree after adding a leaf
   */
  private updateTree(leafIndex: number, commitment: bigint): void {
    // Set leaf
    this.tree[0][leafIndex] = commitment;

    // Recompute path up to root
    let idx = leafIndex;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const siblingIdx = idx ^ 1; // XOR to get sibling
      const parentIdx = idx >> 1;

      const left = this.tree[level][idx & ~1] ?? 0n;
      const right = this.tree[level][(idx & ~1) + 1] ?? 0n;

      // Parent = Poseidon2(left, right)
      this.tree[level + 1][parentIdx] = poseidon2Hash([left, right]);

      idx = parentIdx;
    }

    // Update root
    this.currentRoot = this.tree[TREE_DEPTH][0];
  }

  /**
   * Get merkle proof for a commitment
   */
  getMerkleProof(commitment: bigint): {
    siblings: bigint[];
    indices: number[];
    leafIndex: bigint;
    root: bigint;
  } | null {
    const commitmentHex = commitment.toString(16).padStart(64, "0");
    const entry = this.commitments.get(commitmentHex);

    if (!entry) {
      return null;
    }

    const { index } = entry;
    const siblings: bigint[] = [];
    const indices: number[] = [];

    let idx = Number(index);
    for (let level = 0; level < TREE_DEPTH; level++) {
      const siblingIdx = idx ^ 1;
      siblings.push(this.tree[level][siblingIdx] ?? 0n);
      indices.push(idx & 1); // 0 if left, 1 if right

      idx = idx >> 1;
    }

    return {
      siblings,
      indices,
      leafIndex: index,
      root: this.currentRoot,
    };
  }

  /**
   * Get commitment info by hex string
   */
  getCommitment(
    commitmentHex: string
  ): { index: bigint; amount: bigint } | null {
    return this.commitments.get(commitmentHex) ?? null;
  }

  /**
   * Get current merkle root
   */
  getRoot(): bigint {
    return this.currentRoot;
  }

  /**
   * Get number of commitments
   */
  size(): number {
    return this.leaves.length;
  }

  /**
   * Export index for persistence
   */
  export(): { commitments: [string, { index: string; amount: string }][] } {
    return {
      commitments: Array.from(this.commitments.entries()).map(([k, v]) => [
        k,
        { index: v.index.toString(), amount: v.amount.toString() },
      ]),
    };
  }

  /**
   * Import index from persistence
   */
  import(data: {
    commitments: [string, { index: string; amount: string }][];
  }): void {
    this.initializeEmptyTree();
    this.commitments.clear();
    this.leaves = [];

    // Sort by index and add in order
    const sorted = [...data.commitments].sort(
      (a, b) => Number(BigInt(a[1].index)) - Number(BigInt(b[1].index))
    );

    for (const [hexCommitment, entry] of sorted) {
      const commitment = BigInt("0x" + hexCommitment);
      const amount = BigInt(entry.amount);
      this.addCommitment(commitment, amount);
    }
  }
}

/**
 * Fetch commitment tree state from Solana
 */
export async function fetchCommitmentTree(
  connection: { getAccountInfo: (pubkey: unknown) => Promise<{ data: Uint8Array } | null> },
  commitmentTreePDA: unknown
): Promise<CommitmentTreeState | null> {
  const accountInfo = await connection.getAccountInfo(commitmentTreePDA);

  if (!accountInfo) {
    return null;
  }

  return parseCommitmentTreeData(accountInfo.data);
}

// Global index instance (for frontend use)
let globalIndex: CommitmentTreeIndex | null = null;

/**
 * Get or create the global commitment index
 */
export function getCommitmentIndex(): CommitmentTreeIndex {
  if (!globalIndex) {
    globalIndex = new CommitmentTreeIndex();

    // Try to load from localStorage if available
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = localStorage.getItem("zvault_commitment_index");
        if (stored) {
          globalIndex.import(JSON.parse(stored));
          console.log(
            `[CommitmentIndex] Loaded ${globalIndex.size()} commitments from storage`
          );
        }
      } catch (e) {
        console.warn("[CommitmentIndex] Failed to load from storage:", e);
      }
    }
  }
  return globalIndex;
}

/**
 * Save the global commitment index to localStorage
 */
export function saveCommitmentIndex(): void {
  if (!globalIndex) return;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const data = globalIndex.export();
      localStorage.setItem("zvault_commitment_index", JSON.stringify(data));
      console.log(`[CommitmentIndex] Saved ${globalIndex.size()} commitments`);
    } catch (e) {
      console.warn("[CommitmentIndex] Failed to save to storage:", e);
    }
  }
}
