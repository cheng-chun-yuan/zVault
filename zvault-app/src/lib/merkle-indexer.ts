/**
 * Merkle Tree Indexer
 *
 * Queries on-chain commitment tree and provides merkle proofs
 * for ZK proof generation.
 *
 * Uses SDK's buildCommitmentTreeFromChain for on-chain queries
 * with caching to reduce RPC calls.
 */

import {
  CommitmentTreeIndex,
  buildCommitmentTreeFromChain,
  getMerkleProofFromTree,
  type OnChainMerkleProof,
  type MerkleProof,
} from "@zvault/sdk";

// Cache configuration
const CACHE_TTL_MS = 30_000; // 30 seconds

// Cached tree and timestamp
let cachedTree: CommitmentTreeIndex | null = null;
let cacheTimestamp = 0;

// In-memory cache of locally registered commitments (from demo deposits)
const localCommitmentCache = new Map<string, { leafIndex: number; amount: bigint }>();

/**
 * Get the RPC endpoint from environment
 */
function getRpcEndpoint(): string {
  return process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    "https://api.devnet.solana.com";
}

/**
 * Get the zVault program ID from environment
 */
function getProgramId(): string {
  const programId = process.env.NEXT_PUBLIC_ZVAULT_PROGRAM_ID;
  if (!programId) {
    throw new Error("NEXT_PUBLIC_ZVAULT_PROGRAM_ID environment variable not set");
  }
  return programId;
}

/**
 * Simple RPC client that wraps fetch for getProgramAccounts
 */
function createRpcClient(endpoint: string) {
  return {
    async getProgramAccounts(
      programId: string,
      config?: {
        filters?: Array<
          | { memcmp: { offset: number; bytes: string } }
          | { dataSize: number }
        >;
        encoding?: string;
      }
    ): Promise<Array<{ pubkey: string; account: { data: string } }>> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccounts",
          params: [
            programId,
            {
              encoding: config?.encoding || "base64",
              filters: config?.filters,
            },
          ],
        }),
      });

      const json = await response.json();
      if (json.error) {
        throw new Error(`RPC error: ${json.error.message}`);
      }

      return json.result || [];
    },
  };
}

/**
 * Get the merkle tree indexer (builds from chain if cache expired)
 *
 * @returns Promise<CommitmentTreeIndex> - The commitment tree with all on-chain commitments
 */
export async function getMerkleIndexer(): Promise<CommitmentTreeIndex> {
  const now = Date.now();

  // Return cached tree if fresh
  if (cachedTree && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log("[MerkleIndexer] Using cached tree");
    return cachedTree;
  }

  console.log("[MerkleIndexer] Building tree from chain...");

  try {
    const rpc = createRpcClient(getRpcEndpoint());
    const programId = getProgramId();

    cachedTree = await buildCommitmentTreeFromChain(rpc, programId);
    cacheTimestamp = now;

    console.log(`[MerkleIndexer] Built tree with ${cachedTree.size()} commitments`);

    // Merge any locally registered commitments that might not be on-chain yet
    for (const [commitment, data] of localCommitmentCache) {
      const normalized = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
      if (!cachedTree.getCommitment(normalized)) {
        console.log(`[MerkleIndexer] Adding local commitment at index ${data.leafIndex}`);
        // Note: Local commitments will be properly added when they appear on-chain
      }
    }

    return cachedTree;
  } catch (error) {
    console.error("[MerkleIndexer] Failed to build tree from chain:", error);

    // Fall back to cached tree if available
    if (cachedTree) {
      console.log("[MerkleIndexer] Using stale cached tree");
      return cachedTree;
    }

    // Create empty tree as last resort
    console.log("[MerkleIndexer] Creating empty tree");
    cachedTree = new CommitmentTreeIndex();
    cacheTimestamp = now;
    return cachedTree;
  }
}

/**
 * Get merkle proof for a commitment
 *
 * @param commitment - Commitment hash (hex string, with or without 0x prefix)
 * @returns Merkle proof or null if not found
 */
export async function getMerkleProofForCommitment(
  commitment: string
): Promise<MerkleProof | null> {
  try {
    const tree = await getMerkleIndexer();

    // Normalize commitment hex
    const normalized = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
    const commitmentBigint = BigInt("0x" + normalized);

    // Get proof from tree
    const proof = getMerkleProofFromTree(tree, commitmentBigint);

    if (!proof) {
      console.log("[MerkleIndexer] Commitment not found:", normalized.slice(0, 16) + "...");

      // Check local cache as fallback
      const cached = localCommitmentCache.get(normalized);
      if (cached) {
        console.log("[MerkleIndexer] Found in local cache at leaf", cached.leafIndex);
        // Return proof from tree at this index if possible
        const localProof = tree.getMerkleProof(commitmentBigint);
        if (localProof) {
          return convertToMerkleProof(localProof, proof?.root || tree.getRoot());
        }
      }

      return null;
    }

    console.log(`[MerkleIndexer] Found commitment at leaf ${proof.leafIndex}`);

    return convertToMerkleProof(
      {
        siblings: proof.siblings,
        indices: proof.indices,
        leafIndex: BigInt(proof.leafIndex),
        root: proof.root,
      },
      proof.root
    );
  } catch (error) {
    console.error("[MerkleIndexer] Error getting merkle proof:", error);
    return null;
  }
}

/**
 * Convert SDK proof format to MerkleProof type
 */
function convertToMerkleProof(
  proof: {
    siblings: bigint[];
    indices: number[];
    leafIndex: bigint;
    root: bigint;
  },
  root: bigint
): MerkleProof {
  return {
    pathElements: proof.siblings.map((s) => s.toString(16).padStart(64, "0")),
    pathIndices: proof.indices,
    leafIndex: Number(proof.leafIndex),
    root: root.toString(16).padStart(64, "0"),
  };
}

/**
 * Get merkle proof with full on-chain data
 *
 * @param commitment - Commitment hash as bigint
 * @returns Full on-chain merkle proof or null
 */
export async function getOnChainMerkleProof(
  commitment: bigint
): Promise<OnChainMerkleProof | null> {
  try {
    const tree = await getMerkleIndexer();
    return getMerkleProofFromTree(tree, commitment);
  } catch (error) {
    console.error("[MerkleIndexer] Error getting on-chain proof:", error);
    return null;
  }
}

/**
 * Register a commitment in the local cache
 *
 * Called after successful demo deposit to enable later proof generation
 * before the on-chain indexer picks up the commitment.
 */
export function registerCommitment(
  commitment: string,
  leafIndex: number,
  amount: bigint
): void {
  const normalized = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
  localCommitmentCache.set(normalized, { leafIndex, amount });
  console.log("[MerkleIndexer] Registered local commitment at leaf", leafIndex);

  // Invalidate cache so next fetch will include this
  invalidateCache();
}

/**
 * Get amount for a commitment from local cache
 */
export function getCommitmentAmount(commitment: string): bigint | null {
  const normalized = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
  return localCommitmentCache.get(normalized)?.amount ?? null;
}

/**
 * Invalidate the cached tree (forces rebuild on next access)
 */
export function invalidateCache(): void {
  cacheTimestamp = 0;
  console.log("[MerkleIndexer] Cache invalidated");
}

/**
 * Clear all caches (tree + local commitments)
 */
export function clearAllCaches(): void {
  cachedTree = null;
  cacheTimestamp = 0;
  localCommitmentCache.clear();
  console.log("[MerkleIndexer] All caches cleared");
}

/**
 * Get current merkle root
 *
 * @returns Root as hex string or null if tree not loaded
 */
export async function getCurrentRoot(): Promise<string | null> {
  try {
    const tree = await getMerkleIndexer();
    return tree.getRoot().toString(16).padStart(64, "0");
  } catch {
    return null;
  }
}

/**
 * Get tree statistics
 */
export async function getTreeStats(): Promise<{
  size: number;
  root: string;
  nextIndex: number;
  cacheAge: number;
} | null> {
  try {
    const tree = await getMerkleIndexer();
    const status = tree.getStatus();
    return {
      size: status.size,
      root: status.root,
      nextIndex: status.nextIndex,
      cacheAge: Date.now() - cacheTimestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Get all locally cached commitments (for debugging)
 */
export function getLocalCachedCommitments(): Array<{
  commitment: string;
  leafIndex: number;
  amount: bigint;
}> {
  return Array.from(localCommitmentCache.entries()).map(([commitment, data]) => ({
    commitment,
    ...data,
  }));
}

// Legacy exports for backwards compatibility
export { localCommitmentCache as commitmentCache };
export const clearCommitmentCache = clearAllCaches;
export const getCachedCommitments = getLocalCachedCommitments;
