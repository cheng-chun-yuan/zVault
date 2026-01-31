/**
 * Mobile Prover for React Native
 *
 * Uses NoirReactNative from zkmopro for proof generation on iOS/Android.
 * Same API as web.ts but uses native Barretenberg backend.
 *
 * @see https://github.com/zkmopro/NoirReactNative
 */

// Re-export types from web for API compatibility
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

// Note: This is a stub. Full implementation requires:
// 1. Install: bun add github:zkmopro/NoirReactNative
// 2. Add circuit JSON files to app assets
// 3. Configure Android minSdkVersion: 28

/**
 * Initialize the mobile prover
 */
export async function initProver(): Promise<void> {
  throw new Error(
    "Mobile prover not implemented. Install NoirReactNative and configure circuit paths."
  );
}

/**
 * Check if mobile prover is available
 */
export async function isProverAvailable(): Promise<boolean> {
  return false;
}

/**
 * Set the circuit path (mobile uses file paths)
 */
export function setCircuitPath(_path: string): void {
  // Mobile implementation would configure native module paths
}

/**
 * Get the current circuit path
 */
export function getCircuitPath(): string {
  return "";
}

// Stub implementations that throw until properly configured
export async function generateClaimProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function generateSpendSplitProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function generateSpendPartialPublicProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function generatePoolDepositProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function generatePoolWithdrawProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function generatePoolClaimYieldProof(): Promise<never> {
  throw new Error("Mobile prover not configured");
}

export async function verifyProof(): Promise<boolean> {
  throw new Error("Mobile prover not configured");
}

export async function circuitExists(): Promise<boolean> {
  return false;
}

export function proofToBytes(): Uint8Array {
  throw new Error("Mobile prover not configured");
}

export async function cleanup(): Promise<void> {
  // No-op for uninitialized prover
}
