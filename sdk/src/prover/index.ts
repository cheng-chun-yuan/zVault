/**
 * ZVault Prover Module
 *
 * Supports two proof systems:
 * - Groth16 via Sunspot (recommended for on-chain verification)
 * - UltraHonk via bb.js (legacy, exceeds Solana CU limits)
 *
 * Default: Sunspot/Groth16 for smaller proofs (~388 bytes) that fit
 * within Solana's compute budget.
 */

export type ProofBackend = "sunspot" | "ultrahonk";

// Default to Sunspot for Solana compatibility
let currentBackend: ProofBackend = "sunspot";

/**
 * Set the proof generation backend
 */
export function setProofBackend(backend: ProofBackend): void {
  currentBackend = backend;
}

/**
 * Get the current proof backend
 */
export function getProofBackend(): ProofBackend {
  return currentBackend;
}

// Re-export Sunspot prover (recommended for on-chain verification)
export {
  configureSunspot,
  getSunspotConfig,
  isSunspotAvailable,
  generateGroth16Proof,
  getVerificationKey as getSunspotVk,
  getVkHash as getSunspotVkHash,
  verifyGroth16Proof,
  GROTH16_PROOF_SIZE,
  canFitInline,
  getSunspotVerifierProgramId,
  // High-level proof generators
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  generatePartialPublicProofGroth16,
  type SunspotProofResult,
  type SunspotConfig,
  type ClaimInputs as SunspotClaimInputs,
  type SpendSplitInputs as SunspotSplitInputs,
  type SpendPartialPublicInputs as SunspotPartialPublicInputs,
} from "./sunspot";

// Re-export UltraHonk prover (legacy)
export * from "./web";

// Re-export types
export type {
  MerkleProofInput,
  ProofData,
  CircuitType,
  ClaimInputs,
  SpendSplitInputs,
  SpendPartialPublicInputs,
  PoolDepositInputs,
  PoolWithdrawInputs,
  PoolClaimYieldInputs,
} from "./web";
