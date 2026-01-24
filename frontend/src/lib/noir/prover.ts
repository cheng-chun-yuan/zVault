/**
 * Noir Proof Generator for ZVault
 *
 * Generates UltraHonk proofs using Noir circuits via bb.js.
 * Browser-compatible proof generation (lazy loaded to avoid SSR issues).
 */

// Types only - no runtime imports at top level to avoid SSR issues
import type { CompiledCircuit as BackendCompiledCircuit } from "@noir-lang/types";

// Merkle proof structure for Noir circuits
export interface MerkleProof {
  siblings: bigint[];
  indices: number[];
}

// Noir proof result structure
export interface NoirProof {
  proof: Uint8Array;
  publicInputs: string[];
  verificationKey?: Uint8Array;
}

// Circuit types
export type CircuitType = "claim" | "transfer" | "split" | "partial_withdraw";

// Circuit artifact paths (relative to public directory)
const CIRCUIT_PATHS: Record<CircuitType, string> = {
  claim: "/circuits/noir/zvault_claim.json",
  transfer: "/circuits/noir/zvault_transfer.json",
  split: "/circuits/noir/zvault_split.json",
  partial_withdraw: "/circuits/noir/zvault_partial_withdraw.json",
};

// Lazy-loaded modules (browser only)
let Noir: typeof import("@noir-lang/noir_js").Noir | null = null;
let UltraHonkBackend: typeof import("@noir-lang/backend_barretenberg").UltraHonkBackend | null = null;

// Cached instances
const circuitCache = new Map<CircuitType, BackendCompiledCircuit>();
const backendCache = new Map<CircuitType, InstanceType<typeof import("@noir-lang/backend_barretenberg").UltraHonkBackend>>();
const noirCache = new Map<CircuitType, InstanceType<typeof import("@noir-lang/noir_js").Noir>>();

/**
 * Lazy load Noir modules (browser only)
 */
async function ensureNoirLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Noir proof generation is only available in the browser");
  }

  if (!Noir || !UltraHonkBackend) {
    const [noirModule, backendModule] = await Promise.all([
      import("@noir-lang/noir_js"),
      import("@noir-lang/backend_barretenberg"),
    ]);
    Noir = noirModule.Noir;
    UltraHonkBackend = backendModule.UltraHonkBackend;
  }
}

/**
 * Load a circuit artifact
 */
async function loadCircuitArtifact(circuitType: CircuitType): Promise<BackendCompiledCircuit> {
  if (circuitCache.has(circuitType)) {
    return circuitCache.get(circuitType)!;
  }

  const path = CIRCUIT_PATHS[circuitType];
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(
      `Failed to load circuit artifact: ${circuitType} (${response.status}). ` +
      `Ensure circuit is compiled and placed in public${path}`
    );
  }

  const artifact = await response.json() as BackendCompiledCircuit;
  circuitCache.set(circuitType, artifact);
  return artifact;
}

/**
 * Get or create backend for a circuit
 */
async function getBackend(circuitType: CircuitType) {
  await ensureNoirLoaded();

  if (backendCache.has(circuitType)) {
    return backendCache.get(circuitType)!;
  }

  const circuit = await loadCircuitArtifact(circuitType);
  const backend = new UltraHonkBackend!(circuit);
  backendCache.set(circuitType, backend);
  return backend;
}

/**
 * Get or create Noir instance for a circuit
 */
async function getNoir(circuitType: CircuitType) {
  await ensureNoirLoaded();

  if (noirCache.has(circuitType)) {
    return noirCache.get(circuitType)!;
  }

  const circuit = await loadCircuitArtifact(circuitType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noir = new Noir!(circuit as any);
  noirCache.set(circuitType, noir);
  return noir;
}

// Input type for Noir circuits
type InputMap = Record<string, string | string[] | number[]>;

/**
 * Core Noir proof generation function
 */
async function generateNoirProof(
  circuitType: CircuitType,
  inputs: InputMap
): Promise<NoirProof> {
  console.log(`[Noir] Generating ${circuitType} proof...`);
  const startTime = performance.now();

  // Get Noir and backend instances (lazy loaded)
  const [noir, backend] = await Promise.all([
    getNoir(circuitType),
    getBackend(circuitType),
  ]);

  // Generate witness
  console.log(`[Noir] Executing circuit to generate witness...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { witness } = await noir.execute(inputs as any);

  // Generate proof
  console.log(`[Noir] Generating UltraHonk proof...`);
  const proof = await backend.generateProof(witness);

  const elapsed = performance.now() - startTime;
  console.log(`[Noir] Proof generated in ${elapsed.toFixed(0)}ms`);
  console.log(`[Noir] Proof size: ${proof.proof.length} bytes`);

  return {
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  };
}

/**
 * Generate Noir proof for claim operation
 */
export async function generateClaimProof(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProof
): Promise<NoirProof> {
  const pathElements = merkleProof.siblings.map((s) => s.toString());
  const pathIndices = merkleProof.indices;

  const inputs: InputMap = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    amount: amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    merkle_root: merkleRoot.toString(),
    nullifier_hash: "0", // Will be computed and checked in circuit
    amount_pub: amount.toString(),
  };

  return generateNoirProof("claim", inputs);
}

/**
 * Generate Noir proof for transfer operation
 */
export async function generateTransferProof(
  inputNullifier: bigint,
  inputSecret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProof,
  outputNullifier: bigint,
  outputSecret: bigint
): Promise<NoirProof> {
  const pathElements = merkleProof.siblings.map((s) => s.toString());
  const pathIndices = merkleProof.indices;

  const inputs: InputMap = {
    nullifier: inputNullifier.toString(),
    secret: inputSecret.toString(),
    amount: amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    output_nullifier: outputNullifier.toString(),
    output_secret: outputSecret.toString(),
    merkle_root: merkleRoot.toString(),
    nullifier_hash: "0",
    output_commitment: "0",
  };

  return generateNoirProof("transfer", inputs);
}

/**
 * Generate Noir proof for split operation
 */
export async function generateSplitProof(
  inputNullifier: bigint,
  inputSecret: bigint,
  inputAmount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProof,
  output1Nullifier: bigint,
  output1Secret: bigint,
  output1Amount: bigint,
  output2Nullifier: bigint,
  output2Secret: bigint,
  output2Amount: bigint
): Promise<NoirProof> {
  const pathElements = merkleProof.siblings.map((s) => s.toString());
  const pathIndices = merkleProof.indices;

  const inputs: InputMap = {
    input_nullifier: inputNullifier.toString(),
    input_secret: inputSecret.toString(),
    input_amount: inputAmount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    output1_nullifier: output1Nullifier.toString(),
    output1_secret: output1Secret.toString(),
    output1_amount: output1Amount.toString(),
    output2_nullifier: output2Nullifier.toString(),
    output2_secret: output2Secret.toString(),
    output2_amount: output2Amount.toString(),
    merkle_root: merkleRoot.toString(),
    input_nullifier_hash: "0",
    output_commitment1: "0",
    output_commitment2: "0",
  };

  return generateNoirProof("split", inputs);
}

/**
 * Generate Noir proof for partial withdraw operation
 */
export async function generatePartialWithdrawProofNoir(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
  merkleRoot: bigint,
  merkleProof: MerkleProof,
  withdrawAmount: bigint,
  changeNullifier: bigint,
  changeSecret: bigint,
  changeAmount: bigint,
  recipient: bigint
): Promise<NoirProof> {
  const pathElements = merkleProof.siblings.map((s) => s.toString());
  const pathIndices = merkleProof.indices;

  const inputs: InputMap = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    amount: amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    change_nullifier: changeNullifier.toString(),
    change_secret: changeSecret.toString(),
    change_amount: changeAmount.toString(),
    merkle_root: merkleRoot.toString(),
    nullifier_hash: "0",
    withdraw_amount: withdrawAmount.toString(),
    change_commitment: "0",
    recipient: recipient.toString(),
  };

  return generateNoirProof("partial_withdraw", inputs);
}

/**
 * Verify a Noir proof
 */
export async function verifyNoirProof(
  circuitType: CircuitType,
  proof: NoirProof
): Promise<boolean> {
  try {
    const backend = await getBackend(circuitType);
    const isValid = await backend.verifyProof({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
    });
    console.log(`[Noir] Proof verification: ${isValid ? "VALID" : "INVALID"}`);
    return isValid;
  } catch (error) {
    console.error("[Noir] Verification failed:", error);
    return false;
  }
}

/**
 * Check if Noir proving is available in the browser
 */
export async function isNoirAvailable(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    await loadCircuitArtifact("claim");
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert Noir proof to bytes format for Solana
 */
export function noirProofToBytes(proof: NoirProof): Uint8Array {
  return proof.proof;
}

/**
 * Check if circuit artifact exists
 */
export async function circuitArtifactExists(
  circuitType: CircuitType
): Promise<boolean> {
  try {
    await loadCircuitArtifact(circuitType);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cleanup backends (free WASM memory)
 */
export async function cleanup(): Promise<void> {
  for (const backend of backendCache.values()) {
    await backend.destroy();
  }
  backendCache.clear();
  noirCache.clear();
  circuitCache.clear();
}
