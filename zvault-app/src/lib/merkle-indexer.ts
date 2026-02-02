/**
 * Merkle Tree Indexer
 *
 * Queries on-chain commitment tree and provides merkle proofs
 * for ZK proof generation.
 *
 * TODO: Implement full indexer that:
 * 1. Subscribes to commitment tree updates
 * 2. Maintains local copy of tree leaves
 * 3. Generates merkle proofs for any commitment
 */

import { createEmptyMerkleProof, type MerkleProof } from "@zvault/sdk";

// In-memory cache of known commitments
const commitmentCache = new Map<string, { leafIndex: number; amount: bigint }>();

/**
 * Get merkle proof for a commitment
 *
 * @param commitment - Commitment hash (hex string)
 * @returns Merkle proof or null if not found
 */
export async function getMerkleProofForCommitment(
  commitment: string
): Promise<MerkleProof | null> {
  // Check cache first
  const cached = commitmentCache.get(commitment);
  if (!cached) {
    console.log("[MerkleIndexer] Commitment not found in cache:", commitment.slice(0, 16) + "...");
    return null;
  }

  // TODO: Query on-chain tree state and compute actual merkle proof
  // For now, return empty proof as placeholder
  console.log("[MerkleIndexer] Found commitment at leaf", cached.leafIndex);
  return createEmptyMerkleProof();
}

/**
 * Register a commitment in the local cache
 *
 * Called after successful demo deposit to enable later proof generation.
 */
export function registerCommitment(
  commitment: string,
  leafIndex: number,
  amount: bigint
): void {
  commitmentCache.set(commitment, { leafIndex, amount });
  console.log("[MerkleIndexer] Registered commitment at leaf", leafIndex);
}

/**
 * Get amount for a commitment from cache
 */
export function getCommitmentAmount(commitment: string): bigint | null {
  return commitmentCache.get(commitment)?.amount ?? null;
}

/**
 * Clear the commitment cache
 */
export function clearCommitmentCache(): void {
  commitmentCache.clear();
  console.log("[MerkleIndexer] Cache cleared");
}

/**
 * Get all cached commitments (for debugging)
 */
export function getCachedCommitments(): Array<{ commitment: string; leafIndex: number; amount: bigint }> {
  return Array.from(commitmentCache.entries()).map(([commitment, data]) => ({
    commitment,
    ...data,
  }));
}
