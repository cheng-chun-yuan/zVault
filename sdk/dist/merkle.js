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
import { bigintToBytes } from "./crypto";
// Tree configuration - matches on-chain constants
// Updated to depth 20 for ~1M leaves capacity
export const TREE_DEPTH = 20;
export const ROOT_HISTORY_SIZE = 30;
export const MAX_LEAVES = 1 << TREE_DEPTH; // ~1M (1,048,576)
// Zero value for empty nodes (matches on-chain)
export const ZERO_VALUE = bigintToBytes(0x2fe54c60d3ada40e0000000000000000000000000000000000000000n);
/**
 * Create a Merkle proof from on-chain data
 *
 * @param pathElements - Sibling hashes as 32-byte arrays
 * @param pathIndices - Direction at each level (0=left, 1=right)
 * @param leafIndex - Index of the leaf in the tree
 * @param root - Current Merkle root
 */
export function createMerkleProof(pathElements, pathIndices, leafIndex, root) {
    if (pathElements.length !== TREE_DEPTH) {
        throw new Error(`Expected ${TREE_DEPTH} path elements, got ${pathElements.length}`);
    }
    if (pathIndices.length !== TREE_DEPTH) {
        throw new Error(`Expected ${TREE_DEPTH} path indices, got ${pathIndices.length}`);
    }
    return {
        pathElements: pathElements.map((el) => new Uint8Array(el)),
        pathIndices: [...pathIndices],
        leafIndex,
        root: new Uint8Array(root),
    };
}
/**
 * Create a Merkle proof from bigint values
 */
export function createMerkleProofFromBigints(pathElements, pathIndices, leafIndex, root) {
    return createMerkleProof(pathElements.map(bigintToBytes), pathIndices, leafIndex, bigintToBytes(root));
}
/**
 * Convert Merkle proof to format expected by Noir circuits
 */
export function proofToNoirFormat(proof) {
    return {
        merkle_path: proof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: proof.pathIndices.map((i) => i.toString()),
        merkle_root: "0x" + Buffer.from(proof.root).toString("hex"),
    };
}
/**
 * Convert Merkle proof to format expected by on-chain program
 */
export function proofToOnChainFormat(proof) {
    return {
        siblings: proof.pathElements.map((el) => Array.from(el)),
        path: proof.pathIndices.map((i) => i === 1),
    };
}
/**
 * Compute leaf index from path indices
 */
export function pathIndicesToLeafIndex(pathIndices) {
    let index = 0;
    for (let i = 0; i < pathIndices.length; i++) {
        if (pathIndices[i] === 1) {
            index |= 1 << i;
        }
    }
    return index;
}
/**
 * Compute path indices from leaf index
 */
export function leafIndexToPathIndices(leafIndex, depth = TREE_DEPTH) {
    const indices = [];
    let idx = leafIndex;
    for (let i = 0; i < depth; i++) {
        indices.push(idx & 1);
        idx >>= 1;
    }
    return indices;
}
/**
 * Create an empty/placeholder Merkle proof
 * Used when constructing proofs before on-chain data is available
 */
export function createEmptyMerkleProof() {
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < TREE_DEPTH; i++) {
        pathElements.push(new Uint8Array(ZERO_VALUE));
        pathIndices.push(0);
    }
    return {
        pathElements,
        pathIndices,
        leafIndex: 0,
        root: new Uint8Array(ZERO_VALUE),
    };
}
/**
 * Validate Merkle proof structure
 */
export function validateMerkleProofStructure(proof) {
    if (proof.pathElements.length !== TREE_DEPTH)
        return false;
    if (proof.pathIndices.length !== TREE_DEPTH)
        return false;
    if (proof.leafIndex < 0 || proof.leafIndex >= MAX_LEAVES)
        return false;
    if (proof.root.length !== 32)
        return false;
    for (const el of proof.pathElements) {
        if (el.length !== 32)
            return false;
    }
    for (const idx of proof.pathIndices) {
        if (idx !== 0 && idx !== 1)
            return false;
    }
    return true;
}
