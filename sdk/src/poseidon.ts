/**
 * Poseidon Hash - BN254 compatible with Noir circuits and Solana's sol_poseidon
 *
 * Uses circomlibjs which matches:
 * - Noir's std::hash::poseidon::bn254
 * - Solana's sol_poseidon syscall (light-poseidon)
 *
 * UNIFIED MODEL:
 * - Commitment = Poseidon(pub_key_x, amount)
 * - Nullifier = Poseidon(priv_key, leaf_index)
 * - Nullifier Hash = Poseidon(nullifier)
 * - Pool Commitment = Poseidon(pub_key_x, principal, deposit_epoch)
 *
 * LOCALNET MODE:
 * When useLocalnetMode(true) is called, the SDK uses SHA256 for Merkle tree hashing
 * to match the on-chain program which uses SHA256 on localnet (test validator lacks Poseidon syscall).
 */

import { buildPoseidon, type Poseidon } from "circomlibjs";
import { createHash } from "crypto";

// Singleton poseidon instance
let poseidonInstance: Poseidon | null = null;

// Localnet mode flag - when true, uses SHA256 for Merkle tree hashing
let localnetMode = false;

/**
 * Enable/disable localnet mode
 * When enabled, Merkle tree hashing uses SHA256 to match on-chain behavior on localnet
 * (the test validator lacks the Poseidon syscall)
 */
export function useLocalnetMode(enabled: boolean): void {
  localnetMode = enabled;
}

/**
 * Check if localnet mode is enabled
 */
export function isLocalnetMode(): boolean {
  return localnetMode;
}

/**
 * Initialize poseidon (must be called before using hash functions)
 */
export async function initPoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

/**
 * Get the poseidon instance (lazy initialization)
 */
async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    await initPoseidon();
  }
  return poseidonInstance!;
}

/**
 * Hash inputs using Circom-compatible Poseidon (async)
 * Returns bigint result
 */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Synchronous hash (requires prior initialization via initPoseidon)
 * Throws if not initialized
 */
export function poseidonHashSync(inputs: bigint[]): bigint {
  if (!poseidonInstance) {
    throw new Error("Poseidon not initialized. Call initPoseidon() first.");
  }
  const hash = poseidonInstance(inputs);
  return poseidonInstance.F.toObject(hash) as bigint;
}

/**
 * SHA256-based Merkle tree hash for localnet compatibility
 * Matches the on-chain sha256_hash_for_localnet function
 *
 * Note: The result is NOT reduced modulo BN254 field here because the on-chain
 * program stores the raw SHA256 output. The SDK must use the raw value to match
 * the on-chain tree root. When passing to Noir circuits, values must be reduced
 * separately using reduceToBN254Field().
 */
export function sha256MerkleHash(left: bigint, right: bigint): bigint {
  // Convert bigints to 32-byte big-endian arrays
  const leftBytes = bigintTo32BytesBE(left);
  const rightBytes = bigintTo32BytesBE(right);

  // Concatenate and hash
  const input = new Uint8Array(64);
  input.set(leftBytes, 0);
  input.set(rightBytes, 32);

  const hash = createHash("sha256").update(input).digest();
  return bytes32ToBigintBE(hash);
}

/**
 * Reduce a value modulo BN254 scalar field
 * Use this when passing SHA256 values to Noir circuits
 */
export function reduceToBN254Field(value: bigint): bigint {
  return value % BN254_SCALAR_FIELD;
}

/**
 * Merkle tree hash - uses Poseidon or SHA256 depending on localnet mode
 * This is specifically for Merkle tree operations to match on-chain behavior
 */
export function merkleHashSync(left: bigint, right: bigint): bigint {
  if (localnetMode) {
    return sha256MerkleHash(left, right);
  }
  return poseidonHashSync([left, right]);
}

// Helper: bigint to 32-byte big-endian array
function bigintTo32BytesBE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Helper: 32-byte big-endian array to bigint
function bytes32ToBigintBE(bytes: Uint8Array | Buffer): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

// BN254 scalar field prime
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ============================================================================
// Unified Model Functions (Primary API) - Async versions
// ============================================================================

/**
 * Compute unified commitment from public key x-coordinate and amount
 * commitment = Poseidon(pub_key_x, amount)
 */
export async function computeUnifiedCommitment(pubKeyX: bigint, amount: bigint): Promise<bigint> {
  return poseidonHash([pubKeyX, amount]);
}

/**
 * Compute nullifier from private key and leaf index
 * nullifier = Poseidon(priv_key, leaf_index)
 */
export async function computeNullifier(privKey: bigint, leafIndex: bigint): Promise<bigint> {
  return poseidonHash([privKey, leafIndex]);
}

/**
 * Hash nullifier for double-spend prevention
 * nullifier_hash = Poseidon(nullifier)
 */
export async function hashNullifier(nullifier: bigint): Promise<bigint> {
  return poseidonHash([nullifier]);
}

/**
 * Compute pool position commitment
 * pool_commitment = Poseidon(pub_key_x, principal, deposit_epoch)
 */
export async function computePoolCommitment(
  pubKeyX: bigint,
  principal: bigint,
  depositEpoch: bigint
): Promise<bigint> {
  return poseidonHash([pubKeyX, principal, depositEpoch]);
}

// ============================================================================
// Synchronous versions (internal use only - require prior initPoseidon call)
// These are used by prover.ts which needs sync computation for circuit inputs
// ============================================================================

export function computeUnifiedCommitmentSync(pubKeyX: bigint, amount: bigint): bigint {
  return poseidonHashSync([pubKeyX, amount]);
}

export function computeNullifierSync(privKey: bigint, leafIndex: bigint): bigint {
  return poseidonHashSync([privKey, leafIndex]);
}

export function hashNullifierSync(nullifier: bigint): bigint {
  return poseidonHashSync([nullifier]);
}

export function computePoolCommitmentSync(
  pubKeyX: bigint,
  principal: bigint,
  depositEpoch: bigint
): bigint {
  return poseidonHashSync([pubKeyX, principal, depositEpoch]);
}
