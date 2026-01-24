"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZERO_VALUE = exports.MAX_LEAVES = exports.ROOT_HISTORY_SIZE = exports.TREE_DEPTH = void 0;
exports.createMerkleProof = createMerkleProof;
exports.createMerkleProofFromBigints = createMerkleProofFromBigints;
exports.proofToNoirFormat = proofToNoirFormat;
exports.proofToOnChainFormat = proofToOnChainFormat;
exports.pathIndicesToLeafIndex = pathIndicesToLeafIndex;
exports.leafIndexToPathIndices = leafIndexToPathIndices;
exports.createEmptyMerkleProof = createEmptyMerkleProof;
exports.validateMerkleProofStructure = validateMerkleProofStructure;
const crypto_1 = require("./crypto");
// Tree configuration - matches on-chain constants
exports.TREE_DEPTH = 10;
exports.ROOT_HISTORY_SIZE = 30;
exports.MAX_LEAVES = 1 << exports.TREE_DEPTH; // 1024
// Zero value for empty nodes (matches on-chain)
exports.ZERO_VALUE = (0, crypto_1.bigintToBytes)(0x2fe54c60d3ada40e0000000000000000000000000000000000000000n);
/**
 * Create a Merkle proof from on-chain data
 *
 * @param pathElements - Sibling hashes as 32-byte arrays
 * @param pathIndices - Direction at each level (0=left, 1=right)
 * @param leafIndex - Index of the leaf in the tree
 * @param root - Current Merkle root
 */
function createMerkleProof(pathElements, pathIndices, leafIndex, root) {
    if (pathElements.length !== exports.TREE_DEPTH) {
        throw new Error(`Expected ${exports.TREE_DEPTH} path elements, got ${pathElements.length}`);
    }
    if (pathIndices.length !== exports.TREE_DEPTH) {
        throw new Error(`Expected ${exports.TREE_DEPTH} path indices, got ${pathIndices.length}`);
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
function createMerkleProofFromBigints(pathElements, pathIndices, leafIndex, root) {
    return createMerkleProof(pathElements.map(crypto_1.bigintToBytes), pathIndices, leafIndex, (0, crypto_1.bigintToBytes)(root));
}
/**
 * Convert Merkle proof to format expected by Noir circuits
 */
function proofToNoirFormat(proof) {
    return {
        merkle_path: proof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: proof.pathIndices.map((i) => i.toString()),
        merkle_root: "0x" + Buffer.from(proof.root).toString("hex"),
    };
}
/**
 * Convert Merkle proof to format expected by on-chain program
 */
function proofToOnChainFormat(proof) {
    return {
        siblings: proof.pathElements.map((el) => Array.from(el)),
        path: proof.pathIndices.map((i) => i === 1),
    };
}
/**
 * Compute leaf index from path indices
 */
function pathIndicesToLeafIndex(pathIndices) {
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
function leafIndexToPathIndices(leafIndex, depth = exports.TREE_DEPTH) {
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
function createEmptyMerkleProof() {
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < exports.TREE_DEPTH; i++) {
        pathElements.push(new Uint8Array(exports.ZERO_VALUE));
        pathIndices.push(0);
    }
    return {
        pathElements,
        pathIndices,
        leafIndex: 0,
        root: new Uint8Array(exports.ZERO_VALUE),
    };
}
/**
 * Validate Merkle proof structure
 */
function validateMerkleProofStructure(proof) {
    if (proof.pathElements.length !== exports.TREE_DEPTH)
        return false;
    if (proof.pathIndices.length !== exports.TREE_DEPTH)
        return false;
    if (proof.leafIndex < 0 || proof.leafIndex >= exports.MAX_LEAVES)
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
