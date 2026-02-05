/**
 * Web Prover (Sunspot Groth16)
 *
 * Re-exports Sunspot Groth16 prover with legacy function names.
 * Groth16 proofs are 388 bytes and fit inline in transactions.
 *
 * @module prover/web
 */

// Re-export types from sunspot
export {
  type SunspotProofResult as ProofData,
  type CircuitType,
  type ClaimInputs,
  type SpendSplitInputs,
  type SpendPartialPublicInputs,
  type MerkleProofInput,
  type SunspotConfig,
  GROTH16_PROOF_SIZE,
  canFitInline,
  configureSunspot,
  getSunspotConfig,
  isSunspotAvailable,
  getSunspotVerifierProgramId,
  getVerificationKey,
  getVkHash,
  verifyGroth16Proof,
  generateGroth16Proof,
} from "./sunspot";

// Import for function implementations
import {
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  generatePartialPublicProofGroth16,
  configureSunspot as _configureSunspot,
  type SunspotProofResult,
  type MerkleProofInput,
} from "./sunspot";

// Legacy aliases for proof generation
export const generateClaimProof = generateClaimProofGroth16;
export const generateSpendSplitProof = generateSplitProofGroth16;
export const generateSpendPartialPublicProof = generatePartialPublicProofGroth16;

// =============================================================================
// Pool Types (for backwards compatibility)
// =============================================================================

export interface PoolDepositInputs {
  privKey: bigint;
  pubKeyX: bigint;
  amount: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  poolPubKeyX: bigint;
  depositEpoch: bigint;
}

export interface PoolWithdrawInputs {
  privKey: bigint;
  pubKeyX: bigint;
  principal: bigint;
  depositEpoch: bigint;
  leafIndex: bigint;
  poolMerkleRoot: bigint;
  poolMerkleProof: MerkleProofInput;
  outputPubKeyX: bigint;
  currentEpoch: bigint;
  yieldRateBps: bigint;
  poolId: bigint;
}

export interface PoolClaimYieldInputs {
  oldPrivKey: bigint;
  oldPubKeyX: bigint;
  principal: bigint;
  depositEpoch: bigint;
  leafIndex: bigint;
  poolMerkleRoot: bigint;
  poolMerkleProof: MerkleProofInput;
  newPubKeyX: bigint;
  yieldPubKeyX: bigint;
  currentEpoch: bigint;
  yieldRateBps: bigint;
  poolId: bigint;
}

// =============================================================================
// Pool Proof Generation Stubs
// =============================================================================

export async function generatePoolDepositProof(
  _inputs: PoolDepositInputs
): Promise<SunspotProofResult> {
  throw new Error("Pool deposit proof generation not yet implemented for Sunspot");
}

export async function generatePoolWithdrawProof(
  _inputs: PoolWithdrawInputs
): Promise<SunspotProofResult> {
  throw new Error("Pool withdraw proof generation not yet implemented for Sunspot");
}

export async function generatePoolClaimYieldProof(
  _inputs: PoolClaimYieldInputs
): Promise<SunspotProofResult> {
  throw new Error("Pool claim yield proof generation not yet implemented for Sunspot");
}

// =============================================================================
// Legacy Compatibility Functions
// =============================================================================

let _circuitPath: string | undefined;
let _initialized = false;

/**
 * Initialize prover (no-op for Sunspot - just sets circuit path)
 */
export async function initProver(): Promise<void> {
  _initialized = true;
}

/**
 * Check if prover is available
 */
export async function isProverAvailable(): Promise<boolean> {
  return _initialized;
}

/**
 * Set circuit path
 */
export function setCircuitPath(path: string): void {
  _circuitPath = path;
  _configureSunspot({ circuitsBasePath: path });
}

/**
 * Get circuit path
 */
export function getCircuitPath(): string | undefined {
  return _circuitPath;
}

/**
 * Check if circuit exists at configured path
 */
export function circuitExists(_circuitType: string): boolean {
  // For now, assume circuits exist if path is set
  return _circuitPath !== undefined;
}

/**
 * Convert proof to bytes (no-op for Sunspot - already bytes)
 */
export function proofToBytes(proof: SunspotProofResult): Uint8Array {
  return proof.proof;
}

/**
 * Verify proof locally (basic validation for Groth16)
 * Full verification happens on-chain via Sunspot verifier
 */
export async function verifyProof(
  _circuitType: string,
  proof: SunspotProofResult,
  _publicInputs?: unknown[]
): Promise<boolean> {
  // Basic validation: check proof is correct size (388 bytes for Groth16)
  if (!proof || !proof.proof) return false;
  if (proof.proof.length !== 388) return false;
  // Full verification requires on-chain Sunspot verifier
  return true;
}

/**
 * Cleanup (no-op for Sunspot)
 */
export function cleanup(): void {
  // No-op
}
