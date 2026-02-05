/**
 * ZVault Prover Module
 *
 * Uses Sunspot/Groth16 for ZK proof generation.
 * Groth16 proofs are ~388 bytes and fit within Solana's compute budget.
 *
 * Node.js: Uses Sunspot CLI (nargo + sunspot)
 * Browser: Not yet supported (future: gnark WASM)
 */

// Re-export everything from Sunspot prover
export {
  // Configuration
  configureSunspot,
  getSunspotConfig,
  isSunspotAvailable,
  getSunspotVerifierProgramId,

  // Proof generation
  generateGroth16Proof,
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  generatePartialPublicProofGroth16,

  // Verification
  getVerificationKey,
  getVkHash,
  verifyGroth16Proof,

  // Constants
  GROTH16_PROOF_SIZE,
  canFitInline,

  // Types
  type SunspotProofResult,
  type SunspotProofResult as ProofData,
  type SunspotConfig,
  type CircuitType,
  type MerkleProofInput,
  type ClaimInputs,
  type SpendSplitInputs,
  type SpendPartialPublicInputs,
} from "./sunspot";

// Re-export legacy compat functions from web prover
export {
  // Legacy aliases
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,

  // Legacy compat
  initProver,
  isProverAvailable,
  setCircuitPath,
  getCircuitPath,
  circuitExists,
  proofToBytes,
  verifyProof,
  cleanup,

  // Pool stubs
  generatePoolDepositProof,
  generatePoolWithdrawProof,
  generatePoolClaimYieldProof,
  type PoolDepositInputs,
  type PoolWithdrawInputs,
  type PoolClaimYieldInputs,
} from "./web";
