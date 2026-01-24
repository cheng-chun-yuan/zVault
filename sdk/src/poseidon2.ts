/**
 * Poseidon2 Hash - BN254 compatible with Noir circuits
 *
 * Uses @zkpassport/poseidon2 which matches Noir's Poseidon2 exactly.
 */

import { poseidon2Hash as zkPoseidon2 } from "@zkpassport/poseidon2";

// Re-export the hash function directly
export const poseidon2Hash = zkPoseidon2;

// Sync version (same function, @zkpassport/poseidon2 is synchronous)
export const poseidon2HashSync = zkPoseidon2;

// BN254 scalar field prime
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Domain-specific helpers (thin wrappers for clarity)

/** Derive note public key from ECDH shared secret */
export const deriveNotePubKey = (sharedX: bigint, sharedY: bigint): bigint =>
  zkPoseidon2([sharedX, sharedY]);

/** Compute commitment for Merkle tree */
export const computeCommitment = (notePubKey: bigint, amount: bigint, random: bigint = 0n): bigint =>
  zkPoseidon2([notePubKey, amount, random]);

/** Compute nullifier from spending key and leaf index */
export const computeNullifier = (spendingPriv: bigint, leafIndex: bigint): bigint =>
  zkPoseidon2([spendingPriv, leafIndex]);

/** Hash nullifier for double-spend prevention */
export const hashNullifier = (nullifier: bigint): bigint =>
  zkPoseidon2([nullifier]);

/** Compute note from nullifier and secret (legacy) */
export const computeNote = (nullifier: bigint, secret: bigint): bigint =>
  zkPoseidon2([nullifier, secret]);

// Legacy helpers

/** @deprecated Use computeCommitment */
export const computeCommitmentLegacy = (nullifier: bigint, secret: bigint, amount: bigint): bigint =>
  zkPoseidon2([zkPoseidon2([nullifier, secret]), amount]);

/** @deprecated Use computeNullifier */
export const computeNullifierHashLegacy = (nullifier: bigint): bigint =>
  zkPoseidon2([nullifier]);

// No-op for backwards compatibility
export const initPoseidon2Sync = async (): Promise<void> => {};
