/**
 * Noir Proof Generator for ZVault Frontend
 *
 * Re-exports the SDK's WASM prover with frontend-specific defaults.
 * The SDK handles both browser and Node.js environments.
 */

// Re-export types from SDK
export type {
  ProofData as NoirProof,
  MerkleProofInput as MerkleProof,
  ClaimInputs,
  SplitInputs,
  TransferInputs,
  WithdrawInputs,
} from "@zvault/sdk";

export type CircuitType = "claim" | "transfer" | "split" | "partial_withdraw";

// Import SDK prover functions
import {
  initProver,
  isProverAvailable,
  generateClaimProofWasm,
  generateSplitProofWasm,
  generateTransferProofWasm,
  generateWithdrawProofWasm,
  verifyProofWasm,
  setCircuitPath,
  circuitExists,
  proofToBytes,
  cleanupProver,
  type ProofData,
  type MerkleProofInput,
} from "@zvault/sdk";

// Set default circuit path for frontend (public folder)
// Only run in browser to avoid SSR issues
let circuitPathSet = false;
function ensureCircuitPath() {
  if (!circuitPathSet && typeof window !== "undefined") {
    setCircuitPath("/circuits/noir");
    circuitPathSet = true;
  }
}

/**
 * Initialize the prover - preloads WASM modules
 */
export async function initNoirProver(): Promise<void> {
  ensureCircuitPath();
  await initProver();
}

/**
 * Check if Noir proofs are available
 */
export async function isNoirAvailable(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  ensureCircuitPath();
  return isProverAvailable();
}

/**
 * Generate a claim proof
 */
export async function generateClaimProof(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProofInput
): Promise<ProofData> {
  ensureCircuitPath();
  return generateClaimProofWasm({
    nullifier,
    secret,
    amount,
    merkleRoot,
    merkleProof,
  });
}

/**
 * Generate a transfer proof
 */
export async function generateTransferProof(
  inputNullifier: bigint,
  inputSecret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProofInput,
  outputNullifier: bigint,
  outputSecret: bigint
): Promise<ProofData> {
  return generateTransferProofWasm({
    inputNullifier,
    inputSecret,
    amount,
    merkleRoot,
    merkleProof,
    outputNullifier,
    outputSecret,
  });
}

/**
 * Generate a split proof
 */
export async function generateSplitProof(
  inputNullifier: bigint,
  inputSecret: bigint,
  inputAmount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProofInput,
  output1Nullifier: bigint,
  output1Secret: bigint,
  output1Amount: bigint,
  output2Nullifier: bigint,
  output2Secret: bigint,
  output2Amount: bigint
): Promise<ProofData> {
  return generateSplitProofWasm({
    inputNullifier,
    inputSecret,
    inputAmount,
    merkleRoot,
    merkleProof,
    output1Nullifier,
    output1Secret,
    output1Amount,
    output2Nullifier,
    output2Secret,
    output2Amount,
  });
}

/**
 * Generate a partial withdraw proof
 */
export async function generatePartialWithdrawProofNoir(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProofInput,
  withdrawAmount: bigint,
  changeNullifier: bigint,
  changeSecret: bigint,
  changeAmount: bigint,
  recipient: bigint
): Promise<ProofData> {
  return generateWithdrawProofWasm({
    nullifier,
    secret,
    amount,
    merkleRoot,
    merkleProof,
    withdrawAmount,
    changeNullifier,
    changeSecret,
    changeAmount,
    recipient,
  });
}

/**
 * Verify a proof locally
 */
export async function verifyNoirProof(
  circuitType: CircuitType,
  proof: ProofData
): Promise<boolean> {
  return verifyProofWasm(circuitType, proof);
}

/**
 * Check if a circuit artifact exists
 */
export async function circuitArtifactExists(
  circuitType: CircuitType
): Promise<boolean> {
  return circuitExists(circuitType);
}

/**
 * Convert proof to raw bytes for on-chain submission
 */
export function noirProofToBytes(proof: ProofData): Uint8Array {
  return proofToBytes(proof);
}

/**
 * Cleanup all cached resources
 */
export async function cleanup(): Promise<void> {
  await cleanupProver();
}
