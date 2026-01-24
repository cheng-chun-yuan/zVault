"use strict";
/**
 * Poseidon Hash Types for ZVault SDK (Noir-compatible)
 *
 * NOTE: When using Noir circuits, Poseidon2 hashing is done INSIDE the circuit.
 * This module provides type definitions and placeholder functions for
 * note data that will be passed to Noir circuits.
 *
 * The actual Poseidon2 computation happens in:
 * - Noir circuits (for ZK proofs)
 * - Backend services (for commitment verification)
 *
 * For frontend/SDK: just generate random nullifier/secret and pass to circuit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_MODULUS = void 0;
exports.initPoseidon = initPoseidon;
exports.isPoseidonReady = isPoseidonReady;
exports.poseidon = poseidon;
exports.poseidon1 = poseidon1;
exports.poseidon2 = poseidon2;
exports.poseidon3 = poseidon3;
exports.poseidon4 = poseidon4;
exports.computeZeroHashes = computeZeroHashes;
// BN254 field modulus
exports.FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Poseidon state - tracks if initialized (for API compatibility)
let initialized = false;
/**
 * Initialize Poseidon (no-op for Noir - hashing is done in circuit)
 * Kept for API compatibility with frontend code.
 */
async function initPoseidon() {
    initialized = true;
    // No actual initialization needed - Noir circuit handles Poseidon2
}
/**
 * Check if Poseidon is ready (always true for Noir approach)
 */
function isPoseidonReady() {
    return initialized;
}
/**
 * Poseidon placeholder - throws error if called
 *
 * In Noir mode, commitments are computed by the circuit.
 * This function exists for API compatibility but should not be used.
 */
function poseidon(inputs) {
    throw new Error("Poseidon hash not available in SDK. " +
        "When using Noir, commitments are computed inside the circuit. " +
        "Use note data (nullifier, secret, amount) directly with your Noir circuit.");
}
function poseidon1(a) {
    return poseidon([a]);
}
function poseidon2(a, b) {
    return poseidon([a, b]);
}
function poseidon3(a, b, c) {
    return poseidon([a, b, c]);
}
function poseidon4(a, b, c, d) {
    return poseidon([a, b, c, d]);
}
/**
 * Compute zero hashes - placeholder for Noir
 * Returns dummy values as actual computation is in circuit
 */
function computeZeroHashes(depth) {
    throw new Error("computeZeroHashes not available in SDK for Noir. " +
        "Merkle tree operations should use the on-chain tree or Noir circuit.");
}
