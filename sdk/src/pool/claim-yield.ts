/**
 * Yield Pool Claim Yield Functions
 *
 * Functions for claiming yield from the yield pool.
 */

import { bytesToBigint, grumpkinEcdh, pointMul, GRUMPKIN_GENERATOR } from "../crypto";
import { poseidonHashSync } from "../poseidon";
import type { ZVaultKeys } from "../keys";
import type { MerkleProof } from "../merkle";
import {
  generatePoolClaimYieldProof,
  type PoolClaimYieldInputs,
  type MerkleProofInput,
} from "../prover/web";
import type {
  ScannedPoolPosition,
  StealthPoolClaimInputs,
  PoolOperationProgressCallback,
} from "./types";
import { deriveStealthPrivKey } from "./stealth";
import { CLAIM_POOL_YIELD_DISCRIMINATOR } from "./constants";

/**
 * Prepare claim/withdraw inputs for ZK proof
 *
 * REQUIRES spending key to derive stealthPriv and nullifier.
 *
 * @param keys - User's ZVaultKeys (needs spending key)
 * @param position - Scanned position to claim
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir circuit
 */
export function prepareStealthPoolClaimInputs(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  merkleProof: MerkleProof
): StealthPoolClaimInputs {
  // Recompute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, position.ephemeralPub);

  // Derive stealth private key (requires spending key!)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // Verify stealth key matches (sanity check)
  const expectedStealthPub = pointMul(stealthPrivKey, GRUMPKIN_GENERATOR);
  if (
    expectedStealthPub.x !== position.stealthPub.x ||
    expectedStealthPub.y !== position.stealthPub.y
  ) {
    throw new Error("Stealth key mismatch - position may not belong to you");
  }

  // Compute nullifier: Poseidon(stealthPriv, leafIndex)
  const nullifier = poseidonHashSync([stealthPrivKey, BigInt(position.leafIndex)]);
  const nullifierHash = poseidonHashSync([nullifier]);

  return {
    stealthPrivKey,
    principal: position.principal,
    depositEpoch: position.depositEpoch,
    leafIndex: position.leafIndex,
    merklePath: merkleProof.pathElements.map((el) => bytesToBigint(new Uint8Array(el))),
    merkleIndices: merkleProof.pathIndices,
    merkleRoot: bytesToBigint(new Uint8Array(merkleProof.root)),
    nullifier,
    nullifierHash,
  };
}

/**
 * Generate proof for pool claim yield operation (Unified Model)
 *
 * Generates the ZK proof for claiming yield while keeping principal staked.
 *
 * @param keys - User's ZVault keys
 * @param position - Scanned pool position
 * @param poolMerkleProof - Merkle proof for the pool position
 * @param newPubKeyX - Public key x-coordinate for new pool position
 * @param yieldPubKeyX - Public key x-coordinate for yield commitment
 * @param poolConfig - Pool configuration (yield rate, current epoch)
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateClaimYieldProof(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  poolMerkleProof: MerkleProof,
  newPubKeyX: bigint,
  yieldPubKeyX: bigint,
  poolConfig: { currentEpoch: bigint; yieldRateBps: number; poolId: bigint },
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing claim inputs...", progress: 10 });

  // Prepare claim inputs (derives stealth private key)
  const claimInputs = prepareStealthPoolClaimInputs(keys, position, poolMerkleProof);

  // Convert merkle proof to prover format
  const poolMerkleProofInput: MerkleProofInput = {
    siblings: claimInputs.merklePath,
    indices: claimInputs.merkleIndices,
  };

  const proofInputs: PoolClaimYieldInputs = {
    oldPrivKey: claimInputs.stealthPrivKey,
    oldPubKeyX: position.stealthPub.x,
    principal: claimInputs.principal,
    depositEpoch: claimInputs.depositEpoch,
    leafIndex: BigInt(claimInputs.leafIndex),
    poolMerkleRoot: claimInputs.merkleRoot,
    poolMerkleProof: poolMerkleProofInput,
    newPubKeyX,
    yieldPubKeyX,
    currentEpoch: poolConfig.currentEpoch,
    yieldRateBps: BigInt(poolConfig.yieldRateBps),
    poolId: poolConfig.poolId,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolClaimYieldProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}

/**
 * Prepare inputs for pool_claim_yield_stealth circuit
 */
export function preparePoolClaimYieldInputs(
  claimInputs: StealthPoolClaimInputs,
  newStealthPubX: bigint,
  newPrincipal: bigint,
  newDepositEpoch: bigint,
  yieldNote: { nullifier: bigint; secret: bigint; commitment: bigint },
  currentEpoch: bigint,
  yieldRateBps: number,
  poolId: bigint
) {
  return {
    // Private inputs (old position)
    stealth_priv: claimInputs.stealthPrivKey.toString(),
    principal: claimInputs.principal.toString(),
    deposit_epoch: claimInputs.depositEpoch.toString(),
    pool_merkle_path: claimInputs.merklePath.map((p) => p.toString()),
    pool_path_indices: claimInputs.merkleIndices,

    yield_nullifier: yieldNote.nullifier.toString(),
    yield_secret: yieldNote.secret.toString(),

    // Public inputs
    pool_merkle_root: claimInputs.merkleRoot.toString(),
    old_nullifier_hash: claimInputs.nullifierHash.toString(),
    new_stealth_pub_x: newStealthPubX.toString(),
    new_pool_commitment: poseidonHashSync([newStealthPubX, newPrincipal, newDepositEpoch]).toString(),
    yield_commitment: yieldNote.commitment.toString(),
    current_epoch: currentEpoch.toString(),
    yield_rate_bps: yieldRateBps.toString(),
    pool_id: poolId.toString(),
  };
}

/**
 * Build instruction data for CLAIM_POOL_YIELD (UltraHonk - variable-length proof)
 *
 * Format: discriminator(1) + proof_len(4) + proof(N) + nullifier(32) + new_commitment(32) +
 *         yield_commitment(32) + merkle_root(32) + principal(8) + deposit_epoch(8) + vk_hash(32)
 */
export function buildClaimPoolYieldData(
  proof: Uint8Array,
  oldNullifierHash: Uint8Array,
  newPoolCommitment: Uint8Array,
  yieldCommitment: Uint8Array,
  poolMerkleRoot: Uint8Array,
  principal: bigint,
  depositEpoch: bigint,
  vkHash: Uint8Array
): Uint8Array {
  const proofLen = proof.length;
  const totalSize = 1 + 4 + proofLen + 32 + 32 + 32 + 32 + 8 + 8 + 32;
  const data = new Uint8Array(totalSize);

  let offset = 0;

  // discriminator (1 byte)
  data[offset++] = CLAIM_POOL_YIELD_DISCRIMINATOR;

  // proof_len (4 bytes, little-endian)
  data[offset++] = proofLen & 0xff;
  data[offset++] = (proofLen >> 8) & 0xff;
  data[offset++] = (proofLen >> 16) & 0xff;
  data[offset++] = (proofLen >> 24) & 0xff;

  // proof (variable length)
  data.set(proof, offset);
  offset += proofLen;

  // old_nullifier_hash (32 bytes)
  data.set(oldNullifierHash.slice(0, 32), offset);
  offset += 32;

  // new_pool_commitment (32 bytes)
  data.set(newPoolCommitment.slice(0, 32), offset);
  offset += 32;

  // yield_commitment (32 bytes)
  data.set(yieldCommitment.slice(0, 32), offset);
  offset += 32;

  // pool_merkle_root (32 bytes)
  data.set(poolMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // principal (8 bytes)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, principal, true);
  offset += 8;

  // deposit_epoch (8 bytes)
  const epochView = new DataView(data.buffer, offset, 8);
  epochView.setBigUint64(0, depositEpoch, true);
  offset += 8;

  // vk_hash (32 bytes)
  data.set(vkHash.slice(0, 32), offset);

  return data;
}
