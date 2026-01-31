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
  SpendSplitInputs,
  SpendPartialPublicInputs,
  CircuitType,
} from "@zvault/sdk";

// Re-export proof generation functions directly from SDK
export {
  initProver,
  isProverAvailable,
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,
  verifyProofWasm as verifyNoirProof,
  setCircuitPath,
  getCircuitPath,
  circuitExists,
  proofToBytes,
  cleanupProver,
  type ProofData,
  type MerkleProofInput,
} from "@zvault/sdk";

// Circuit CDN URL - defaults to local public folder
const CIRCUIT_CDN_URL = process.env.NEXT_PUBLIC_CIRCUIT_CDN_URL || "/circuits/noir";

// Set default circuit path for frontend (CDN or public folder)
// Only run in browser to avoid SSR issues
let circuitPathSet = false;

import { setCircuitPath as sdkSetCircuitPath } from "@zvault/sdk";

function ensureCircuitPath() {
  if (!circuitPathSet && typeof window !== "undefined") {
    sdkSetCircuitPath(CIRCUIT_CDN_URL);
    circuitPathSet = true;
  }
}

/**
 * Initialize the prover - preloads WASM modules
 */
export async function initNoirProver(): Promise<void> {
  ensureCircuitPath();
  const { initProver } = await import("@zvault/sdk");
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
  const { isProverAvailable } = await import("@zvault/sdk");
  return isProverAvailable();
}

/**
 * Check if a circuit artifact exists
 */
export async function circuitArtifactExists(
  circuitType: import("@zvault/sdk").CircuitType
): Promise<boolean> {
  const { circuitExists } = await import("@zvault/sdk");
  return circuitExists(circuitType);
}

/**
 * Cleanup all cached resources
 */
export async function cleanup(): Promise<void> {
  const { cleanupProver } = await import("@zvault/sdk");
  await cleanupProver();
}
