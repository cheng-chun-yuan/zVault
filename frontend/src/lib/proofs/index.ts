/**
 * ZK Proof Generation for ZVault Frontend
 *
 * Uses Noir circuits with UltraHonk proofs via bb.js.
 * Browser-compatible proof generation.
 */

import { bigintToBytes, bytesToBigint, type NoteData } from "@zvault/sdk";
import {
  generatePartialWithdrawProofNoir,
  generateClaimProof as generateClaimProofNoir,
  type NoirProof,
  type MerkleProof as NoirMerkleProof,
} from "@/lib/noir/prover";

/**
 * Merkle proof structure
 */
export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * Proof result
 */
export interface ProofResult {
  success: boolean;
  proof?: Uint8Array;
  publicSignals?: string[];
  proofBytes?: Uint8Array;
  error?: string;
}

/**
 * Deposit proof input
 */
export interface DepositProofInput {
  nullifier: bigint;
  secret: bigint;
  commitment: bigint;
  amount: bigint;
}

/**
 * Partial withdraw proof input
 */
export interface PartialWithdrawProofInput {
  // Current state
  root: bigint;
  merkleProof: MerkleProof;

  // Input note (being spent)
  inputNote: NoteData;

  // Withdraw params
  withdrawAmount: bigint;
  recipient: bigint; // Hash of BTC address

  // Change note (new note for remaining balance)
  changeNote: NoteData;
}

/**
 * Convert MerkleProof to Noir format
 */
function toNoirMerkleProof(proof: MerkleProof): NoirMerkleProof {
  return {
    siblings: proof.pathElements,
    indices: proof.pathIndices,
  };
}

/**
 * Convert NoirProof to ProofResult
 */
function noirProofToResult(noirProof: NoirProof): ProofResult {
  return {
    success: true,
    proof: noirProof.proof,
    proofBytes: noirProof.proof,
    publicSignals: noirProof.publicInputs,
  };
}

/**
 * Generate deposit proof (claim proof in Noir)
 *
 * Proves knowledge of (nullifier, secret) for a commitment in the Merkle tree.
 */
export async function generateDepositProof(
  input: DepositProofInput
): Promise<ProofResult> {
  console.log("[ZK] Deposit proof requested for amount:", input.amount.toString());

  try {
    // For deposit/claim, we need a merkle proof
    // In the actual flow, this would come from the on-chain tree
    // For now, create an empty proof (leaf at index 0 in empty tree)
    const emptyMerkleProof: NoirMerkleProof = {
      siblings: Array(10).fill(0n),
      indices: Array(10).fill(0),
    };

    // Generate the claim proof
    const noirProof = await generateClaimProofNoir(
      input.nullifier,
      input.secret,
      input.amount,
      0n, // merkle root - would come from chain
      emptyMerkleProof
    );

    return noirProofToResult(noirProof);
  } catch (error) {
    console.error("[ZK] Deposit proof failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Generate partial withdraw proof
 *
 * Proves:
 * 1. Input note exists in tree (Merkle proof)
 * 2. Withdraw amount <= input amount
 * 3. Change commitment is correctly computed
 * 4. Amount conservation: input = withdraw + change
 */
export async function generatePartialWithdrawProof(
  input: PartialWithdrawProofInput
): Promise<ProofResult> {
  console.log("[ZK] Partial withdraw proof requested");
  console.log(`[ZK] Withdrawing ${input.withdrawAmount} sats`);
  console.log(`[ZK] Change: ${input.changeNote.amount} sats`);

  // Validate amounts
  if (input.withdrawAmount <= 0n) {
    return { success: false, error: "Withdraw amount must be positive" };
  }
  if (input.withdrawAmount > input.inputNote.amount) {
    return { success: false, error: "Withdraw amount exceeds note balance" };
  }

  const expectedChange = input.inputNote.amount - input.withdrawAmount;
  if (input.changeNote.amount !== expectedChange) {
    return {
      success: false,
      error: `Change amount mismatch: expected ${expectedChange}, got ${input.changeNote.amount}`,
    };
  }

  try {
    const noirProof = await generatePartialWithdrawProofNoir(
      input.inputNote.nullifier,
      input.inputNote.secret,
      input.inputNote.amount,
      input.root,
      toNoirMerkleProof(input.merkleProof),
      input.withdrawAmount,
      input.changeNote.nullifier,
      input.changeNote.secret,
      input.changeNote.amount,
      input.recipient
    );

    return noirProofToResult(noirProof);
  } catch (error) {
    console.error("[ZK] Partial withdraw proof failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Parse partial withdraw public signals
 */
export interface PartialWithdrawPublicSignals {
  root: bigint;
  nullifierHash: bigint;
  withdrawAmount: bigint;
  changeCommitment: bigint;
  recipient: bigint;
}

export function parsePartialWithdrawSignals(
  signals: string[]
): PartialWithdrawPublicSignals {
  // Noir public inputs order matches circuit definition:
  // merkle_root, nullifier_hash, withdraw_amount, change_commitment, recipient
  return {
    root: BigInt(signals[0]),
    nullifierHash: BigInt(signals[1]),
    withdrawAmount: BigInt(signals[2]),
    changeCommitment: BigInt(signals[3]),
    recipient: BigInt(signals[4]),
  };
}

/**
 * Convert bigint to 32-byte array (big-endian)
 * Re-exported from SDK for convenience
 */
export { bigintToBytes as bigintToBytes32, bytesToBigint as bytes32ToBigint };

// Re-export Noir prover functions for direct access
export {
  generateClaimProof as generateClaimProofNoir,
  generatePartialWithdrawProofNoir,
  verifyNoirProof,
  isNoirAvailable,
  cleanup as cleanupNoirBackends,
} from "@/lib/noir/prover";
