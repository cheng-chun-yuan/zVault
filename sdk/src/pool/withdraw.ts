/**
 * Yield Pool Withdraw Functions
 *
 * Functions for withdrawing from the yield pool.
 */

import type { ZVaultKeys } from "../keys";
import type { MerkleProof } from "../merkle";
import {
  generatePoolWithdrawProof,
  type PoolWithdrawInputs,
  type MerkleProofInput,
} from "../prover/web";
import type {
  ScannedPoolPosition,
  PoolOperationProgressCallback,
} from "./types";
import { prepareStealthPoolClaimInputs } from "./claim-yield";
import { WITHDRAW_FROM_POOL_DISCRIMINATOR } from "./constants";

/**
 * Generate proof for pool withdraw operation (Unified Model)
 *
 * Generates the ZK proof for withdrawing from the yield pool (with yield).
 *
 * @param keys - User's ZVault keys
 * @param position - Scanned pool position
 * @param poolMerkleProof - Merkle proof for the pool position
 * @param outputPubKeyX - Public key x-coordinate for output unified commitment
 * @param poolConfig - Pool configuration (yield rate, current epoch)
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateWithdrawProof(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  poolMerkleProof: MerkleProof,
  outputPubKeyX: bigint,
  poolConfig: { currentEpoch: bigint; yieldRateBps: number; poolId: bigint },
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing withdraw inputs...", progress: 10 });

  // Prepare claim inputs (derives stealth private key)
  const claimInputs = prepareStealthPoolClaimInputs(keys, position, poolMerkleProof);

  // Convert merkle proof to prover format
  const poolMerkleProofInput: MerkleProofInput = {
    siblings: claimInputs.merklePath,
    indices: claimInputs.merkleIndices,
  };

  const proofInputs: PoolWithdrawInputs = {
    privKey: claimInputs.stealthPrivKey,
    pubKeyX: position.stealthPub.x,
    principal: claimInputs.principal,
    depositEpoch: claimInputs.depositEpoch,
    leafIndex: BigInt(claimInputs.leafIndex),
    poolMerkleRoot: claimInputs.merkleRoot,
    poolMerkleProof: poolMerkleProofInput,
    outputPubKeyX,
    currentEpoch: poolConfig.currentEpoch,
    yieldRateBps: BigInt(poolConfig.yieldRateBps),
    poolId: poolConfig.poolId,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolWithdrawProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}

/**
 * Prepare inputs for pool_withdraw_stealth circuit
 */
export function preparePoolWithdrawInputs(
  claimInputs: {
    stealthPrivKey: bigint;
    principal: bigint;
    depositEpoch: bigint;
    merklePath: bigint[];
    merkleIndices: number[];
    merkleRoot: bigint;
    nullifierHash: bigint;
  },
  outputNote: { nullifier: bigint; secret: bigint; commitment: bigint },
  currentEpoch: bigint,
  yieldRateBps: number,
  poolId: bigint
) {
  return {
    // Private inputs
    stealth_priv: claimInputs.stealthPrivKey.toString(),
    principal: claimInputs.principal.toString(),
    deposit_epoch: claimInputs.depositEpoch.toString(),
    pool_merkle_path: claimInputs.merklePath.map((p) => p.toString()),
    pool_path_indices: claimInputs.merkleIndices,

    output_nullifier: outputNote.nullifier.toString(),
    output_secret: outputNote.secret.toString(),

    // Public inputs
    pool_merkle_root: claimInputs.merkleRoot.toString(),
    pool_nullifier_hash: claimInputs.nullifierHash.toString(),
    output_commitment: outputNote.commitment.toString(),
    current_epoch: currentEpoch.toString(),
    yield_rate_bps: yieldRateBps.toString(),
    pool_id: poolId.toString(),
  };
}

/**
 * Build instruction data for WITHDRAW_FROM_POOL (Groth16 - inline proof)
 *
 * Format: discriminator(1) + proof_len(4) + proof(N) + nullifier(32) + commitment(32) +
 *         merkle_root(32) + principal(8) + deposit_epoch(8) + vk_hash(32)
 */
export function buildWithdrawFromPoolData(
  proof: Uint8Array,
  poolNullifierHash: Uint8Array,
  outputCommitment: Uint8Array,
  poolMerkleRoot: Uint8Array,
  principal: bigint,
  depositEpoch: bigint,
  vkHash: Uint8Array
): Uint8Array {
  const proofLen = proof.length;
  const totalSize = 1 + 4 + proofLen + 32 + 32 + 32 + 8 + 8 + 32;
  const data = new Uint8Array(totalSize);

  let offset = 0;

  // discriminator (1 byte)
  data[offset++] = WITHDRAW_FROM_POOL_DISCRIMINATOR;

  // proof_len (4 bytes, little-endian)
  data[offset++] = proofLen & 0xff;
  data[offset++] = (proofLen >> 8) & 0xff;
  data[offset++] = (proofLen >> 16) & 0xff;
  data[offset++] = (proofLen >> 24) & 0xff;

  // proof (variable length)
  data.set(proof, offset);
  offset += proofLen;

  // pool_nullifier_hash (32 bytes)
  data.set(poolNullifierHash.slice(0, 32), offset);
  offset += 32;

  // output_commitment (32 bytes)
  data.set(outputCommitment.slice(0, 32), offset);
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
