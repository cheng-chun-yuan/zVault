/**
 * WASM-based Noir Proof Generator for ZVault
 *
 * Universal prover that works in both Browser and Node.js environments.
 * Uses UltraHonk proofs via @aztec/bb.js with lazy loading.
 */

import {
  computeNullifierHashLegacy,
  computeCommitmentLegacy,
} from "./poseidon2";

export interface MerkleProofInput {
  siblings: bigint[];
  indices: number[];
}

export interface ProofData {
  proof: Uint8Array;
  publicInputs: string[];
  verificationKey?: Uint8Array;
}

export type CircuitType =
  | "claim"
  | "transfer"
  | "split"
  | "partial_withdraw"
  | "stealth_transfer"
  | "pool_deposit"
  | "pool_withdraw"
  | "pool_claim_yield";

// Environment detection
const isBrowser = typeof window !== "undefined";
const isNode = typeof process !== "undefined" && process.versions?.node;

// Configurable circuit paths
let circuitBasePath = isBrowser ? "/circuits/noir" : "./circuits";

/**
 * Set the base path for circuit artifacts
 *
 * @example Browser: setCircuitPath("/circuits/noir")
 * @example Node.js: setCircuitPath("../sdk/circuits")
 */
export function setCircuitPath(path: string): void {
  circuitBasePath = path;
}

/**
 * Get the current circuit base path
 */
export function getCircuitPath(): string {
  return circuitBasePath;
}

const CIRCUIT_NAMES: Record<CircuitType, string> = {
  claim: "zvault_claim.json",
  transfer: "zvault_transfer.json",
  split: "zvault_split.json",
  partial_withdraw: "zvault_partial_withdraw.json",
  stealth_transfer: "zvault_stealth_transfer.json",
  pool_deposit: "zvault_pool_deposit.json",
  pool_withdraw: "zvault_pool_withdraw.json",
  pool_claim_yield: "zvault_pool_claim_yield.json",
};

// Lazy-loaded modules
let Noir: typeof import("@noir-lang/noir_js").Noir | null = null;
let UltraHonkBackend: typeof import("@aztec/bb.js").UltraHonkBackend | null = null;

interface CircuitArtifact {
  bytecode: string;
  abi: unknown;
}

const circuitCache = new Map<CircuitType, CircuitArtifact>();
const backendCache = new Map<CircuitType, InstanceType<typeof import("@aztec/bb.js").UltraHonkBackend>>();
const noirCache = new Map<CircuitType, InstanceType<typeof import("@noir-lang/noir_js").Noir>>();

let wasmInitialized = false;

/**
 * Initialize WASM modules for browser environment
 *
 * Uses dynamic imports for @noir-lang/acvm_js and @noir-lang/noirc_abi
 * which are transitive dependencies of @noir-lang/noir_js.
 */
async function initWasmBrowser(): Promise<void> {
  if (wasmInitialized) return;

  console.log("[Prover] Initializing WASM modules (browser)...");

  // Dynamic import the WASM initialization modules
  // These are peer/transitive dependencies of @noir-lang/noir_js
  const [acvmModule, noircModule] = await Promise.all([
    import("@noir-lang/acvm_js"),
    import("@noir-lang/noirc_abi"),
  ]);

  // Initialize WASM with explicit URLs for browser bundlers
  await Promise.all([
    acvmModule.default(new URL("@noir-lang/acvm_js/web/acvm_js_bg.wasm", import.meta.url)),
    noircModule.default(new URL("@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm", import.meta.url)),
  ]);

  wasmInitialized = true;
  console.log("[Prover] WASM modules initialized (browser)");
}

/**
 * Initialize WASM modules for Node.js environment
 *
 * In Node.js, the WASM modules auto-initialize when imported.
 */
async function initWasmNode(): Promise<void> {
  if (wasmInitialized) return;

  console.log("[Prover] Initializing WASM modules (Node.js)...");

  // In Node.js, just importing the modules initializes them
  // The WASM files are loaded from node_modules automatically
  await Promise.all([
    import("@noir-lang/acvm_js"),
    import("@noir-lang/noirc_abi"),
  ]);

  wasmInitialized = true;
  console.log("[Prover] WASM modules initialized (Node.js)");
}

/**
 * Initialize WASM - detects environment automatically
 */
async function initWasm(): Promise<void> {
  if (wasmInitialized) return;

  if (isBrowser) {
    await initWasmBrowser();
  } else if (isNode) {
    await initWasmNode();
  } else {
    throw new Error("Unsupported environment for WASM prover");
  }
}

/**
 * Ensure Noir and UltraHonk modules are loaded
 */
async function ensureNoirLoaded(): Promise<void> {
  await initWasm();

  if (!Noir || !UltraHonkBackend) {
    console.log("[Prover] Loading Noir and bb.js modules...");
    const [noirModule, bbModule] = await Promise.all([
      import("@noir-lang/noir_js"),
      import("@aztec/bb.js"),
    ]);
    Noir = noirModule.Noir;
    UltraHonkBackend = bbModule.UltraHonkBackend;
  }
}

/**
 * Load circuit artifact from configured path
 */
async function loadCircuitArtifact(circuitType: CircuitType): Promise<CircuitArtifact> {
  if (circuitCache.has(circuitType)) {
    return circuitCache.get(circuitType)!;
  }

  const circuitName = CIRCUIT_NAMES[circuitType];
  const path = `${circuitBasePath}/${circuitName}`;

  let artifact: CircuitArtifact;

  if (isBrowser) {
    // Browser: use fetch
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(
        `Failed to load circuit artifact: ${circuitType} (${response.status}). ` +
        `Ensure circuit is compiled and placed at ${path}`
      );
    }

    artifact = await response.json() as CircuitArtifact;
  } else {
    // Node.js: use fs
    const fs = await import("fs");
    const nodePath = await import("path");

    const resolvedPath = nodePath.resolve(path);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Circuit artifact not found: ${circuitType}. ` +
        `Expected at: ${resolvedPath}. ` +
        `Run 'bun run copy-circuits' in sdk/ first.`
      );
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    artifact = JSON.parse(content) as CircuitArtifact;
  }

  circuitCache.set(circuitType, artifact);
  return artifact;
}

/**
 * Get or create backend for circuit type
 */
async function getBackend(circuitType: CircuitType) {
  await ensureNoirLoaded();

  if (backendCache.has(circuitType)) {
    return backendCache.get(circuitType)!;
  }

  const circuit = await loadCircuitArtifact(circuitType);
  const backend = new UltraHonkBackend!(circuit.bytecode);
  backendCache.set(circuitType, backend);
  return backend;
}

/**
 * Get or create Noir instance for circuit type
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

type InputMap = Record<string, string | string[] | number[]>;

/**
 * Generate a proof for a circuit with given inputs
 */
async function generateProof(
  circuitType: CircuitType,
  inputs: InputMap
): Promise<ProofData> {
  console.log(`[Prover] Generating ${circuitType} proof...`);
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

  const [noir, backend] = await Promise.all([
    getNoir(circuitType),
    getBackend(circuitType),
  ]);

  console.log(`[Prover] Executing circuit to generate witness...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { witness } = await noir.execute(inputs as any);

  console.log(`[Prover] Generating UltraHonk proof...`);
  const proof = await backend.generateProof(witness);

  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime;
  console.log(`[Prover] Proof generated in ${elapsed.toFixed(0)}ms`);
  console.log(`[Prover] Proof size: ${proof.proof.length} bytes`);

  return {
    proof: proof.proof,
    publicInputs: proof.publicInputs,
  };
}

// ==========================================================================
// Public API - Proof Generation Functions
// ==========================================================================

/**
 * Initialize the prover (preloads WASM modules)
 *
 * Call this early in your app to reduce latency on first proof generation.
 */
export async function initProver(): Promise<void> {
  await ensureNoirLoaded();
  console.log("[Prover] Prover initialized and ready");
}

/**
 * Check if prover is available in current environment
 */
export async function isProverAvailable(): Promise<boolean> {
  try {
    await loadCircuitArtifact("claim");
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim proof inputs
 */
export interface ClaimInputs {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
}

/**
 * Generate a claim proof
 *
 * Proves knowledge of (nullifier, secret) for commitment in Merkle tree.
 */
export async function generateClaimProof(inputs: ClaimInputs): Promise<ProofData> {
  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier_hash = poseidon2([nullifier])
  const nullifierHash = computeNullifierHashLegacy(inputs.nullifier);

  const circuitInputs: InputMap = {
    nullifier: inputs.nullifier.toString(),
    secret: inputs.secret.toString(),
    amount: inputs.amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    amount_pub: inputs.amount.toString(),
  };

  return generateProof("claim", circuitInputs);
}

/**
 * Split proof inputs
 */
export interface SplitInputs {
  inputNullifier: bigint;
  inputSecret: bigint;
  inputAmount: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  output1Nullifier: bigint;
  output1Secret: bigint;
  output1Amount: bigint;
  output2Nullifier: bigint;
  output2Secret: bigint;
  output2Amount: bigint;
}

/**
 * Generate a split proof
 *
 * 1-in-2-out: Spends input commitment, creates two output commitments.
 * Note: Split circuit uses 20-level tree (merkleProof.siblings must have 20 elements)
 */
export async function generateSplitProof(inputs: SplitInputs): Promise<ProofData> {
  if (inputs.inputAmount !== inputs.output1Amount + inputs.output2Amount) {
    throw new Error("Split must conserve amount (input == output1 + output2)");
  }

  // Note: Split circuit source uses 20-level but compiled artifact may use 10
  // Accept either until circuits are recompiled
  if (inputs.merkleProof.siblings.length !== 10 && inputs.merkleProof.siblings.length !== 20) {
    throw new Error(`Split circuit requires 10 or 20-level merkle tree, got ${inputs.merkleProof.siblings.length} siblings`);
  }

  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute required hashes
  const inputNullifierHash = computeNullifierHashLegacy(inputs.inputNullifier);
  const outputCommitment1 = computeCommitmentLegacy(
    inputs.output1Nullifier,
    inputs.output1Secret,
    inputs.output1Amount
  );
  const outputCommitment2 = computeCommitmentLegacy(
    inputs.output2Nullifier,
    inputs.output2Secret,
    inputs.output2Amount
  );

  const circuitInputs: InputMap = {
    input_nullifier: inputs.inputNullifier.toString(),
    input_secret: inputs.inputSecret.toString(),
    input_amount: inputs.inputAmount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    output1_nullifier: inputs.output1Nullifier.toString(),
    output1_secret: inputs.output1Secret.toString(),
    output1_amount: inputs.output1Amount.toString(),
    output2_nullifier: inputs.output2Nullifier.toString(),
    output2_secret: inputs.output2Secret.toString(),
    output2_amount: inputs.output2Amount.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    input_nullifier_hash: inputNullifierHash.toString(),
    output_commitment1: outputCommitment1.toString(),
    output_commitment2: outputCommitment2.toString(),
  };

  return generateProof("split", circuitInputs);
}

/**
 * Transfer proof inputs
 */
export interface TransferInputs {
  inputNullifier: bigint;
  inputSecret: bigint;
  amount: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  outputNullifier: bigint;
  outputSecret: bigint;
}

/**
 * Generate a transfer proof
 *
 * 1-in-1-out: Spends input commitment, creates new output commitment with same amount.
 */
export async function generateTransferProof(inputs: TransferInputs): Promise<ProofData> {
  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier hash and output commitment
  const nullifierHash = computeNullifierHashLegacy(inputs.inputNullifier);
  const outputCommitment = computeCommitmentLegacy(
    inputs.outputNullifier,
    inputs.outputSecret,
    inputs.amount
  );

  const circuitInputs: InputMap = {
    nullifier: inputs.inputNullifier.toString(),
    secret: inputs.inputSecret.toString(),
    amount: inputs.amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    output_nullifier: inputs.outputNullifier.toString(),
    output_secret: inputs.outputSecret.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    output_commitment: outputCommitment.toString(),
  };

  return generateProof("transfer", circuitInputs);
}

/**
 * Withdraw proof inputs
 */
export interface WithdrawInputs {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  withdrawAmount: bigint;
  changeNullifier: bigint;
  changeSecret: bigint;
  changeAmount: bigint;
  recipient: bigint;
}

/**
 * Generate a partial withdraw proof
 *
 * Withdraw any amount with change returned as a new commitment.
 */
export async function generateWithdrawProof(inputs: WithdrawInputs): Promise<ProofData> {
  if (inputs.amount !== inputs.withdrawAmount + inputs.changeAmount) {
    throw new Error("Withdraw must conserve: amount == withdrawAmount + changeAmount");
  }

  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  const circuitInputs: InputMap = {
    nullifier: inputs.nullifier.toString(),
    secret: inputs.secret.toString(),
    amount: inputs.amount.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    change_nullifier: inputs.changeNullifier.toString(),
    change_secret: inputs.changeSecret.toString(),
    change_amount: inputs.changeAmount.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: "0",
    withdraw_amount: inputs.withdrawAmount.toString(),
    change_commitment: "0",
    recipient: inputs.recipient.toString(),
  };

  return generateProof("partial_withdraw", circuitInputs);
}

// ==========================================================================
// Pool Circuit Proof Generation
// ==========================================================================

/**
 * Pool deposit proof inputs
 *
 * Proves ownership of zkBTC note and creates pool position commitment.
 */
export interface PoolDepositInputs {
  // Private inputs - zkBTC note being deposited
  inputNullifier: bigint;
  inputSecret: bigint;
  inputAmount: bigint;
  merkleProof: MerkleProofInput;

  // Public inputs
  merkleRoot: bigint;
  inputNullifierHash: bigint;
  stealthPubX: bigint;
  poolCommitment: bigint;
  depositEpoch: bigint;
}

/**
 * Generate a pool deposit proof
 *
 * Spends zkBTC note and creates stealth pool position commitment.
 */
export async function generatePoolDepositProof(inputs: PoolDepositInputs): Promise<ProofData> {
  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  const circuitInputs: InputMap = {
    // Private inputs
    input_nullifier: inputs.inputNullifier.toString(),
    input_secret: inputs.inputSecret.toString(),
    input_amount: inputs.inputAmount.toString(),
    input_merkle_path: pathElements,
    input_path_indices: pathIndices,

    // Public inputs
    input_merkle_root: inputs.merkleRoot.toString(),
    input_nullifier_hash: inputs.inputNullifierHash.toString(),
    stealth_pub_x: inputs.stealthPubX.toString(),
    pool_commitment: inputs.poolCommitment.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
  };

  return generateProof("pool_deposit", circuitInputs);
}

/**
 * Pool withdraw proof inputs
 *
 * Proves ownership of pool position and calculates yield for withdrawal.
 */
export interface PoolWithdrawInputs {
  // Private inputs
  stealthPriv: bigint;
  principal: bigint;
  depositEpoch: bigint;
  leafIndex: bigint;
  poolMerkleProof: MerkleProofInput;
  outputNullifier: bigint;
  outputSecret: bigint;

  // Public inputs
  poolMerkleRoot: bigint;
  poolNullifierHash: bigint;
  stealthPubX: bigint;
  outputCommitment: bigint;
  currentEpoch: bigint;
  yieldRateBps: bigint;
  poolId: bigint;
}

/**
 * Generate a pool withdraw proof
 *
 * Exits pool position, calculates yield, and creates output zkBTC note.
 */
export async function generatePoolWithdrawProof(inputs: PoolWithdrawInputs): Promise<ProofData> {
  const pathElements = inputs.poolMerkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.poolMerkleProof.indices;

  const circuitInputs: InputMap = {
    // Private inputs
    stealth_priv: inputs.stealthPriv.toString(),
    principal: inputs.principal.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
    leaf_index: inputs.leafIndex.toString(),
    pool_merkle_path: pathElements,
    pool_path_indices: pathIndices,
    output_nullifier: inputs.outputNullifier.toString(),
    output_secret: inputs.outputSecret.toString(),

    // Public inputs
    pool_merkle_root: inputs.poolMerkleRoot.toString(),
    pool_nullifier_hash: inputs.poolNullifierHash.toString(),
    stealth_pub_x: inputs.stealthPubX.toString(),
    output_commitment: inputs.outputCommitment.toString(),
    current_epoch: inputs.currentEpoch.toString(),
    yield_rate_bps: inputs.yieldRateBps.toString(),
    pool_id: inputs.poolId.toString(),
  };

  return generateProof("pool_withdraw", circuitInputs);
}

/**
 * Pool claim yield proof inputs
 *
 * Claims earned yield while keeping principal staked with new stealth key.
 */
export interface PoolClaimYieldInputs {
  // Private inputs - old position
  oldStealthPriv: bigint;
  principal: bigint;
  depositEpoch: bigint;
  leafIndex: bigint;
  poolMerkleProof: MerkleProofInput;
  yieldNullifier: bigint;
  yieldSecret: bigint;

  // Public inputs
  poolMerkleRoot: bigint;
  oldNullifierHash: bigint;
  oldStealthPubX: bigint;
  newStealthPubX: bigint;
  newPoolCommitment: bigint;
  yieldCommitment: bigint;
  currentEpoch: bigint;
  yieldRateBps: bigint;
  poolId: bigint;
}

/**
 * Generate a pool claim yield proof
 *
 * Claims yield as zkBTC note and creates new pool position with new stealth key.
 */
export async function generatePoolClaimYieldProof(inputs: PoolClaimYieldInputs): Promise<ProofData> {
  const pathElements = inputs.poolMerkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.poolMerkleProof.indices;

  const circuitInputs: InputMap = {
    // Private inputs
    old_stealth_priv: inputs.oldStealthPriv.toString(),
    principal: inputs.principal.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
    leaf_index: inputs.leafIndex.toString(),
    pool_merkle_path: pathElements,
    pool_path_indices: pathIndices,
    yield_nullifier: inputs.yieldNullifier.toString(),
    yield_secret: inputs.yieldSecret.toString(),

    // Public inputs
    pool_merkle_root: inputs.poolMerkleRoot.toString(),
    old_nullifier_hash: inputs.oldNullifierHash.toString(),
    old_stealth_pub_x: inputs.oldStealthPubX.toString(),
    new_stealth_pub_x: inputs.newStealthPubX.toString(),
    new_pool_commitment: inputs.newPoolCommitment.toString(),
    yield_commitment: inputs.yieldCommitment.toString(),
    current_epoch: inputs.currentEpoch.toString(),
    yield_rate_bps: inputs.yieldRateBps.toString(),
    pool_id: inputs.poolId.toString(),
  };

  return generateProof("pool_claim_yield", circuitInputs);
}

/**
 * Verify a proof locally using the backend
 */
export async function verifyProof(
  circuitType: CircuitType,
  proof: ProofData
): Promise<boolean> {
  try {
    const backend = await getBackend(circuitType);
    const isValid = await backend.verifyProof({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
    });
    console.log(`[Prover] Proof verification: ${isValid ? "VALID" : "INVALID"}`);
    return isValid;
  } catch (error) {
    console.error("[Prover] Verification failed:", error);
    return false;
  }
}

/**
 * Check if a specific circuit artifact exists
 */
export async function circuitExists(circuitType: CircuitType): Promise<boolean> {
  try {
    await loadCircuitArtifact(circuitType);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert proof to raw bytes for on-chain submission
 */
export function proofToBytes(proof: ProofData): Uint8Array {
  return proof.proof;
}

/**
 * Cleanup all cached resources
 *
 * Call this when done with proof generation to free memory.
 */
export async function cleanup(): Promise<void> {
  for (const backend of backendCache.values()) {
    await backend.destroy();
  }
  backendCache.clear();
  noirCache.clear();
  circuitCache.clear();
  console.log("[Prover] Cleaned up all cached resources");
}
