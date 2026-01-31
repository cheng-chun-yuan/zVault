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
