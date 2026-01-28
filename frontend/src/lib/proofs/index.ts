/**
 * ZK Proof Generation for ZVault Frontend
 *
 * Re-exports SDK proof generation functions.
 * Uses Noir circuits with UltraHonk proofs via bb.js.
 */

// Re-export SDK proof generation functions directly
export {
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,
  verifyNoirProof,
  isNoirAvailable,
  initNoirProver,
  cleanup as cleanupNoirBackends,
  proofToBytes,
  type ClaimInputs,
  type SpendSplitInputs,
  type SpendPartialPublicInputs,
  type MerkleProof,
  type NoirProof,
} from "@/lib/noir/prover";

// Re-export crypto utilities from SDK
export { bigintToBytes, bytesToBigint } from "@zvault/sdk";

// Convenience aliases
export { bigintToBytes as bigintToBytes32, bytesToBigint as bytes32ToBigint } from "@zvault/sdk";

/**
 * Merkle proof structure (for backward compatibility)
 */
export interface MerkleProofLegacy {
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * Convert legacy merkle proof format to SDK format
 */
export function toSdkMerkleProof(proof: MerkleProofLegacy): import("@zvault/sdk").MerkleProofInput {
  return {
    siblings: proof.pathElements,
    indices: proof.pathIndices,
  };
}

/**
 * Proof result (for backward compatibility)
 */
export interface ProofResult {
  success: boolean;
  proof?: Uint8Array;
  publicSignals?: string[];
  proofBytes?: Uint8Array;
  error?: string;
}
