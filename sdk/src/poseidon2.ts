/**
 * Poseidon2 Hash - BN254 compatible with Noir circuits
 *
 * Uses @zkpassport/poseidon2 which matches Noir's Poseidon2 exactly.
 *
 * UNIFIED MODEL:
 * - Commitment = Poseidon2(pub_key_x, amount)
 * - Nullifier = Poseidon2(priv_key, leaf_index)
 * - Nullifier Hash = Poseidon2(nullifier)
 * - Pool Commitment = Poseidon2(pub_key_x, principal, deposit_epoch)
 */

import { poseidon2Hash as zkPoseidon2 } from "@zkpassport/poseidon2";

// Re-export the hash function directly
export const poseidon2Hash = zkPoseidon2;

// Sync version (same function, @zkpassport/poseidon2 is synchronous)
export const poseidon2HashSync = zkPoseidon2;

// BN254 scalar field prime
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ============================================================================
// Unified Model Functions (Primary API)
// ============================================================================

/**
 * Compute unified commitment from public key x-coordinate and amount
 * commitment = Poseidon2(pub_key_x, amount)
 */
export const computeUnifiedCommitment = (pubKeyX: bigint, amount: bigint): bigint =>
  zkPoseidon2([pubKeyX, amount]);

/**
 * Compute nullifier from private key and leaf index
 * nullifier = Poseidon2(priv_key, leaf_index)
 */
export const computeNullifier = (privKey: bigint, leafIndex: bigint): bigint =>
  zkPoseidon2([privKey, leafIndex]);

/**
 * Hash nullifier for double-spend prevention
 * nullifier_hash = Poseidon2(nullifier)
 */
export const hashNullifier = (nullifier: bigint): bigint =>
  zkPoseidon2([nullifier]);

/**
 * Compute pool position commitment
 * pool_commitment = Poseidon2(pub_key_x, principal, deposit_epoch)
 */
export const computePoolCommitment = (pubKeyX: bigint, principal: bigint, depositEpoch: bigint): bigint =>
  zkPoseidon2([pubKeyX, principal, depositEpoch]);

// No-op for backwards compatibility
export const initPoseidon2Sync = async (): Promise<void> => {};
