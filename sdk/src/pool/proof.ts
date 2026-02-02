/**
 * Yield Pool Proof Generation
 *
 * High-level proof generation functions for pool operations.
 */

import { bytesToBigint } from "../crypto";
import type { MerkleProof } from "../merkle";
import {
  generatePoolDepositProof,
  type PoolDepositInputs,
  type MerkleProofInput,
} from "../prover/web";
import type {
  UnifiedCommitmentInput,
  PoolOperationProgressCallback,
} from "./types";

/**
 * Generate proof for pool deposit operation (Unified Model)
 *
 * Generates the ZK proof for depositing a unified commitment into the yield pool.
 *
 * @param input - The unified commitment being deposited (privKey, pubKeyX, amount)
 * @param inputMerkleProof - Merkle proof for the input commitment
 * @param poolPubKeyX - Public key x-coordinate for the pool position
 * @param depositEpoch - Current epoch at deposit time
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateDepositProof(
  input: UnifiedCommitmentInput,
  inputMerkleProof: MerkleProof,
  poolPubKeyX: bigint,
  depositEpoch: bigint,
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing deposit inputs...", progress: 10 });

  // Convert merkle proof to prover format
  const merkleProofInput: MerkleProofInput = {
    siblings: inputMerkleProof.pathElements.map((el) =>
      bytesToBigint(new Uint8Array(el))
    ),
    indices: inputMerkleProof.pathIndices,
  };

  const proofInputs: PoolDepositInputs = {
    privKey: input.privKey,
    pubKeyX: input.pubKeyX,
    amount: input.amount,
    leafIndex: input.leafIndex,
    merkleRoot: bytesToBigint(new Uint8Array(inputMerkleProof.root)),
    merkleProof: merkleProofInput,
    poolPubKeyX,
    depositEpoch,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolDepositProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}
