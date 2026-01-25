/**
 * Merkle tree utilities for zVault
 *
 * Provides structures and helpers for Merkle proofs.
 * Actual tree operations use Poseidon2 hashing which is computed
 * on-chain or via Noir circuits.
 *
 * Note: This module does NOT compute Poseidon2 hashes in JavaScript.
 * The on-chain program maintains the Merkle tree. This SDK provides
 * proof structures for interaction with the program.
 */
export declare const TREE_DEPTH = 20;
export declare const ROOT_HISTORY_SIZE = 30;
export declare const MAX_LEAVES: number;
export declare const ZERO_VALUE: Uint8Array<ArrayBufferLike>;
/**
 * Merkle proof structure
 */
export interface MerkleProof {
    pathElements: Uint8Array[];
    pathIndices: number[];
    leafIndex: number;
    root: Uint8Array;
}
/**
 * Create a Merkle proof from on-chain data
 *
 * @param pathElements - Sibling hashes as 32-byte arrays
 * @param pathIndices - Direction at each level (0=left, 1=right)
 * @param leafIndex - Index of the leaf in the tree
 * @param root - Current Merkle root
 */
export declare function createMerkleProof(pathElements: Uint8Array[], pathIndices: number[], leafIndex: number, root: Uint8Array): MerkleProof;
/**
 * Create a Merkle proof from bigint values
 */
export declare function createMerkleProofFromBigints(pathElements: bigint[], pathIndices: number[], leafIndex: number, root: bigint): MerkleProof;
/**
 * Convert Merkle proof to format expected by Noir circuits
 */
export declare function proofToNoirFormat(proof: MerkleProof): {
    merkle_path: string[];
    path_indices: string[];
    merkle_root: string;
};
/**
 * Convert Merkle proof to format expected by on-chain program
 */
export declare function proofToOnChainFormat(proof: MerkleProof): {
    siblings: number[][];
    path: boolean[];
};
/**
 * Compute leaf index from path indices
 */
export declare function pathIndicesToLeafIndex(pathIndices: number[]): number;
/**
 * Compute path indices from leaf index
 */
export declare function leafIndexToPathIndices(leafIndex: number, depth?: number): number[];
/**
 * Create an empty/placeholder Merkle proof
 * Used when constructing proofs before on-chain data is available
 */
export declare function createEmptyMerkleProof(): MerkleProof;
/**
 * Validate Merkle proof structure
 */
export declare function validateMerkleProofStructure(proof: MerkleProof): boolean;
