/**
 * Prover Subpath
 *
 * Auto-detects platform and exports the appropriate prover backend.
 * For explicit imports, use:
 * - @zvault/sdk/prover/web for browser WASM prover
 * - @zvault/sdk/prover/mobile for React Native mopro prover
 */

// Re-export everything from the web prover (default for browser/Node.js)
export * from "./web";

// Re-export proof conversion utilities
export { convertBBJSProofToAffine } from "./convertProof";
export { convertBBJSProofToSolana } from "./convertBBJSProof";

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
