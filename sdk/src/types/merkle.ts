/**
 * Merkle Types
 *
 * Type definitions for Merkle tree operations in zVault.
 *
 * @module types/merkle
 */

// ==========================================================================
// Core Merkle Types
// ==========================================================================

/**
 * Merkle proof structure
 */
export interface MerkleProof {
  /** Sibling nodes along the path (20 elements for depth 20) */
  pathElements: Uint8Array[];
  /** Path indices (0 = left, 1 = right) */
  pathIndices: number[];
  /** Leaf index */
  leafIndex: number;
  /** Merkle root */
  root: Uint8Array;
}

/**
 * Noir-formatted Merkle proof
 */
export interface NoirMerkleProof {
  merkle_path: string[];
  path_indices: string[];
  merkle_root: string;
}

/**
 * On-chain formatted Merkle proof
 */
export interface OnChainMerkleProof {
  siblings: number[][];
  path: boolean[];
}

// ==========================================================================
// Tree Configuration
// ==========================================================================

/**
 * Merkle tree configuration constants
 */
export interface MerkleTreeConfig {
  /** Tree depth (number of levels) */
  depth: number;
  /** Maximum number of leaves */
  maxLeaves: number;
  /** Root history size for on-chain verification */
  rootHistorySize: number;
  /** Zero value for empty nodes */
  zeroValue: Uint8Array;
}

// ==========================================================================
// Commitment Tree Types
// ==========================================================================

/**
 * Commitment tree state (on-chain)
 */
export interface CommitmentTreeState {
  /** Current Merkle root */
  root: Uint8Array;
  /** Next leaf index */
  nextIndex: number;
  /** Root history for verification */
  rootHistory: Uint8Array[];
  /** Current root history position */
  rootHistoryPosition: number;
}
