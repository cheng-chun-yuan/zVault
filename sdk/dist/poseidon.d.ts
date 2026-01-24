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
export declare const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Initialize Poseidon (no-op for Noir - hashing is done in circuit)
 * Kept for API compatibility with frontend code.
 */
export declare function initPoseidon(): Promise<void>;
/**
 * Check if Poseidon is ready (always true for Noir approach)
 */
export declare function isPoseidonReady(): boolean;
/**
 * Poseidon placeholder - throws error if called
 *
 * In Noir mode, commitments are computed by the circuit.
 * This function exists for API compatibility but should not be used.
 */
export declare function poseidon(inputs: bigint[]): bigint;
export declare function poseidon1(a: bigint): bigint;
export declare function poseidon2(a: bigint, b: bigint): bigint;
export declare function poseidon3(a: bigint, b: bigint, c: bigint): bigint;
export declare function poseidon4(a: bigint, b: bigint, c: bigint, d: bigint): bigint;
/**
 * Compute zero hashes - placeholder for Noir
 * Returns dummy values as actual computation is in circuit
 */
export declare function computeZeroHashes(depth: number): bigint[];
