/**
 * WASM-based Noir Proof Generator for ZVault
 *
 * Universal prover that works in both Browser and Node.js environments.
 * Uses UltraHonk proofs via @aztec/bb.js with lazy loading.
 *
 * UNIFIED MODEL:
 * - Commitment = Poseidon(pub_key_x, amount)
 * - Nullifier = Poseidon(priv_key, leaf_index)
 * - Nullifier Hash = Poseidon(nullifier)
 */

import {
  hashNullifierSync,
  computeUnifiedCommitmentSync,
  computeNullifierSync,
  computePoolCommitmentSync,
} from "../poseidon";

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
  | "spend_split"
  | "spend_partial_public"
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
  spend_split: "zvault_spend_split.json",
  spend_partial_public: "zvault_spend_partial_public.json",
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

// ==========================================================================
// Unified Model Proof Generation
// ==========================================================================

/**
 * Claim proof inputs (Unified Model)
 *
 * Claims commitment to a public Solana wallet.
 */
export interface ClaimInputs {
  /** Spending private key */
  privKey: bigint;
  /** Public key x-coordinate (derives from privKey) */
  pubKeyX: bigint;
  /** Amount in satoshis */
  amount: bigint;
  /** Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Recipient address (32 bytes as bigint) - bound to proof, cannot be changed */
  recipient: bigint;
}

/**
 * Generate a claim proof (Unified Model)
 *
 * Proves ownership of commitment (pub_key_x, amount) and reveals amount for public claim.
 */
export async function generateClaimProof(inputs: ClaimInputs): Promise<ProofData> {
  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier and nullifier hash
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  const circuitInputs: InputMap = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    amount_pub: inputs.amount.toString(),
    recipient: inputs.recipient.toString(), // Recipient bound to proof
  };

  return generateProof("claim", circuitInputs);
}

/**
 * Spend split proof inputs (Unified Model)
 *
 * Splits one commitment into two commitments.
 */
export interface SpendSplitInputs {
  /** Input: Spending private key */
  privKey: bigint;
  /** Input: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input: Amount in satoshis */
  amount: bigint;
  /** Input: Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Output 1: Recipient's public key x-coordinate */
  output1PubKeyX: bigint;
  /** Output 1: Amount in satoshis */
  output1Amount: bigint;
  /** Output 2: Recipient's public key x-coordinate */
  output2PubKeyX: bigint;
  /** Output 2: Amount in satoshis */
  output2Amount: bigint;
  /**
   * Output 1: Ephemeral pubkey x-coordinate for stealth announcement (circuit public input)
   * This is the x-coordinate of the Grumpkin ephemeral pubkey used for ECDH.
   */
  output1EphemeralPubX: bigint;
  /**
   * Output 1: Packed encrypted amount with y_sign (circuit public input)
   * bits 0-63: XOR encrypted amount, bit 64: y-coordinate sign bit
   */
  output1EncryptedAmountWithSign: bigint;
  /**
   * Output 2: Ephemeral pubkey x-coordinate for stealth announcement (circuit public input)
   */
  output2EphemeralPubX: bigint;
  /**
   * Output 2: Packed encrypted amount with y_sign (circuit public input)
   * bits 0-63: XOR encrypted amount, bit 64: y-coordinate sign bit
   */
  output2EncryptedAmountWithSign: bigint;
}

/**
 * Generate a spend split proof (Unified Model)
 *
 * Commitment -> Commitment + Commitment
 * Amount conservation: input_amount == output1_amount + output2_amount
 */
export async function generateSpendSplitProof(inputs: SpendSplitInputs): Promise<ProofData> {
  if (inputs.amount !== inputs.output1Amount + inputs.output2Amount) {
    throw new Error("Spend split must conserve amount (input == output1 + output2)");
  }

  if (inputs.merkleProof.siblings.length !== 20) {
    throw new Error(`Spend split circuit requires 20-level merkle tree, got ${inputs.merkleProof.siblings.length} siblings`);
  }

  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier hash
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Compute output commitments
  const outputCommitment1 = computeUnifiedCommitmentSync(inputs.output1PubKeyX, inputs.output1Amount);
  const outputCommitment2 = computeUnifiedCommitmentSync(inputs.output2PubKeyX, inputs.output2Amount);

  const circuitInputs: InputMap = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    output1_pub_key_x: inputs.output1PubKeyX.toString(),
    output1_amount: inputs.output1Amount.toString(),
    output2_pub_key_x: inputs.output2PubKeyX.toString(),
    output2_amount: inputs.output2Amount.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    output_commitment1: outputCommitment1.toString(),
    output_commitment2: outputCommitment2.toString(),
    // Stealth output data (circuit public inputs for relayer-safety)
    output1_ephemeral_pub_x: inputs.output1EphemeralPubX.toString(),
    output1_encrypted_amount_with_sign: inputs.output1EncryptedAmountWithSign.toString(),
    output2_ephemeral_pub_x: inputs.output2EphemeralPubX.toString(),
    output2_encrypted_amount_with_sign: inputs.output2EncryptedAmountWithSign.toString(),
  };

  return generateProof("spend_split", circuitInputs);
}

/**
 * Spend partial public proof inputs (Unified Model)
 *
 * Performs partial public claim: Commitment -> Public Amount + Change Commitment
 */
export interface SpendPartialPublicInputs {
  /** Input: Spending private key */
  privKey: bigint;
  /** Input: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input: Amount in satoshis */
  amount: bigint;
  /** Input: Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Public amount to claim (revealed) */
  publicAmount: bigint;
  /** Change: Public key x-coordinate */
  changePubKeyX: bigint;
  /** Change: Amount in satoshis */
  changeAmount: bigint;
  /** Recipient Solana wallet (as bigint from 32 bytes) */
  recipient: bigint;
  /**
   * Change: Ephemeral pubkey x-coordinate for stealth announcement (circuit public input)
   * This is the x-coordinate of the Grumpkin ephemeral pubkey used for ECDH.
   */
  changeEphemeralPubX: bigint;
  /**
   * Change: Packed encrypted amount with y_sign (circuit public input)
   * bits 0-63: XOR encrypted amount, bit 64: y-coordinate sign bit
   */
  changeEncryptedAmountWithSign: bigint;
}

/**
 * Generate a spend partial public proof (Unified Model)
 *
 * Commitment -> Public Amount + Change Commitment
 * Amount conservation: input_amount == public_amount + change_amount
 */
export async function generateSpendPartialPublicProof(inputs: SpendPartialPublicInputs): Promise<ProofData> {
  if (inputs.amount !== inputs.publicAmount + inputs.changeAmount) {
    throw new Error("Spend partial public must conserve amount (input == public + change)");
  }

  if (inputs.merkleProof.siblings.length !== 20) {
    throw new Error(`Spend partial public circuit requires 20-level merkle tree, got ${inputs.merkleProof.siblings.length} siblings`);
  }

  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier hash
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Compute input commitment (what the circuit will compute)
  const inputCommitment = computeUnifiedCommitmentSync(inputs.pubKeyX, inputs.amount);

  // Compute change commitment
  const changeCommitment = computeUnifiedCommitmentSync(inputs.changePubKeyX, inputs.changeAmount);

  // Debug logging - compare circuit's commitment with expected tree leaf
  console.log("[Prover] === SPEND_PARTIAL_PUBLIC DEBUG ===");
  console.log("[Prover] Input pubKeyX:", inputs.pubKeyX.toString(16).padStart(64, "0"));
  console.log("[Prover] Input amount:", inputs.amount.toString());
  console.log("[Prover] Input leafIndex:", inputs.leafIndex.toString());
  console.log("[Prover] Computed input commitment:", inputCommitment.toString(16).padStart(64, "0"));
  console.log("[Prover] Merkle root:", inputs.merkleRoot.toString(16).padStart(64, "0"));
  console.log("[Prover] First sibling:", inputs.merkleProof.siblings[0]?.toString(16).padStart(64, "0"));
  console.log("[Prover] Path indices:", pathIndices.join(", "));
  console.log("[Prover] === END DEBUG ===");

  const circuitInputs: InputMap = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: pathElements,
    path_indices: pathIndices,
    change_pub_key_x: inputs.changePubKeyX.toString(),
    change_amount: inputs.changeAmount.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    public_amount: inputs.publicAmount.toString(),
    change_commitment: changeCommitment.toString(),
    recipient: inputs.recipient.toString(),
    // Stealth output data (circuit public inputs for relayer-safety)
    change_ephemeral_pub_x: inputs.changeEphemeralPubX.toString(),
    change_encrypted_amount_with_sign: inputs.changeEncryptedAmountWithSign.toString(),
  };

  return generateProof("spend_partial_public", circuitInputs);
}

// ==========================================================================
// Pool Circuit Proof Generation (Unified Model)
// ==========================================================================

/**
 * Pool deposit proof inputs (Unified Model)
 *
 * Input:  Unified Commitment = Poseidon(pub_key_x, amount)
 * Output: Pool Position = Poseidon(pool_pub_key_x, principal, deposit_epoch)
 */
export interface PoolDepositInputs {
  /** Input commitment: Spending private key */
  privKey: bigint;
  /** Input commitment: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input commitment: Amount (becomes principal) */
  amount: bigint;
  /** Input commitment: Position in Merkle tree */
  leafIndex: bigint;
  /** Input Merkle tree root */
  merkleRoot: bigint;
  /** Input Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Pool position: Public key x-coordinate (for pool position commitment) */
  poolPubKeyX: bigint;
  /** Current epoch when depositing */
  depositEpoch: bigint;
}

/**
 * Generate a pool deposit proof (Unified Model)
 *
 * Spends unified commitment and creates pool position.
 */
export async function generatePoolDepositProof(inputs: PoolDepositInputs): Promise<ProofData> {
  const pathElements = inputs.merkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.merkleProof.indices;

  // Compute nullifier hash for input
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Compute pool commitment = Poseidon(pool_pub_key_x, principal, deposit_epoch)
  const poolCommitment = computePoolCommitmentSync(inputs.poolPubKeyX, inputs.amount, inputs.depositEpoch);

  const circuitInputs: InputMap = {
    // Private inputs
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    input_merkle_path: pathElements,
    input_path_indices: pathIndices,
    pool_pub_key_x: inputs.poolPubKeyX.toString(),

    // Public inputs
    input_merkle_root: inputs.merkleRoot.toString(),
    input_nullifier_hash: nullifierHash.toString(),
    pool_commitment: poolCommitment.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
  };

  return generateProof("pool_deposit", circuitInputs);
}

/**
 * Pool withdraw proof inputs (Unified Model)
 *
 * Input:  Pool Position = Poseidon(pub_key_x, principal, deposit_epoch)
 * Output: Unified Commitment = Poseidon(output_pub_key_x, principal + yield)
 */
export interface PoolWithdrawInputs {
  /** Pool position: Private key */
  privKey: bigint;
  /** Pool position: Public key x-coordinate */
  pubKeyX: bigint;
  /** Principal amount */
  principal: bigint;
  /** Epoch when deposited */
  depositEpoch: bigint;
  /** Position in pool Merkle tree */
  leafIndex: bigint;
  /** Pool Merkle tree root */
  poolMerkleRoot: bigint;
  /** Pool Merkle proof (20 levels) */
  poolMerkleProof: MerkleProofInput;
  /** Output: Public key x-coordinate for output commitment */
  outputPubKeyX: bigint;
  /** Current epoch */
  currentEpoch: bigint;
  /** Yield rate in basis points */
  yieldRateBps: bigint;
  /** Pool ID */
  poolId: bigint;
}

/**
 * Generate a pool withdraw proof (Unified Model)
 *
 * Exits pool position, calculates yield, and creates output unified commitment.
 */
export async function generatePoolWithdrawProof(inputs: PoolWithdrawInputs): Promise<ProofData> {
  const pathElements = inputs.poolMerkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.poolMerkleProof.indices;

  // Compute nullifier hash for pool position
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Calculate yield: principal * rate * epochs / 10000
  const epochsStaked = inputs.currentEpoch - inputs.depositEpoch;
  const yieldAmount = (inputs.principal * inputs.yieldRateBps * epochsStaked) / 10000n;
  const totalAmount = inputs.principal + yieldAmount;

  // Compute output unified commitment
  const outputCommitment = computeUnifiedCommitmentSync(inputs.outputPubKeyX, totalAmount);

  const circuitInputs: InputMap = {
    // Private inputs
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    principal: inputs.principal.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
    leaf_index: inputs.leafIndex.toString(),
    pool_merkle_path: pathElements,
    pool_path_indices: pathIndices,
    output_pub_key_x: inputs.outputPubKeyX.toString(),

    // Public inputs
    pool_merkle_root: inputs.poolMerkleRoot.toString(),
    pool_nullifier_hash: nullifierHash.toString(),
    output_commitment: outputCommitment.toString(),
    current_epoch: inputs.currentEpoch.toString(),
    yield_rate_bps: inputs.yieldRateBps.toString(),
    pool_id: inputs.poolId.toString(),
  };

  return generateProof("pool_withdraw", circuitInputs);
}

/**
 * Pool claim yield proof inputs (Unified Model)
 *
 * Input:  Pool Position = Poseidon(old_pub_key_x, principal, deposit_epoch)
 * Output: 1. New Pool Position = Poseidon(new_pub_key_x, principal, current_epoch)
 *         2. Yield as Unified Commitment = Poseidon(yield_pub_key_x, yield_amount)
 */
export interface PoolClaimYieldInputs {
  /** Old position: Private key */
  oldPrivKey: bigint;
  /** Old position: Public key x-coordinate */
  oldPubKeyX: bigint;
  /** Principal amount */
  principal: bigint;
  /** Epoch when deposited */
  depositEpoch: bigint;
  /** Position in pool Merkle tree */
  leafIndex: bigint;
  /** Pool Merkle tree root */
  poolMerkleRoot: bigint;
  /** Pool Merkle proof (20 levels) */
  poolMerkleProof: MerkleProofInput;
  /** New position: Public key x-coordinate */
  newPubKeyX: bigint;
  /** Yield output: Public key x-coordinate */
  yieldPubKeyX: bigint;
  /** Current epoch */
  currentEpoch: bigint;
  /** Yield rate in basis points */
  yieldRateBps: bigint;
  /** Pool ID */
  poolId: bigint;
}

/**
 * Generate a pool claim yield proof (Unified Model)
 *
 * Claims yield as unified commitment and creates new pool position.
 */
export async function generatePoolClaimYieldProof(inputs: PoolClaimYieldInputs): Promise<ProofData> {
  const pathElements = inputs.poolMerkleProof.siblings.map((s) => s.toString());
  const pathIndices = inputs.poolMerkleProof.indices;

  // Compute old nullifier hash
  const oldNullifier = computeNullifierSync(inputs.oldPrivKey, inputs.leafIndex);
  const oldNullifierHash = hashNullifierSync(oldNullifier);

  // Calculate yield: principal * rate * epochs / 10000
  const epochsStaked = inputs.currentEpoch - inputs.depositEpoch;
  const yieldAmount = (inputs.principal * inputs.yieldRateBps * epochsStaked) / 10000n;

  // Compute new pool commitment (principal stays, epoch resets to current)
  const newPoolCommitment = computePoolCommitmentSync(inputs.newPubKeyX, inputs.principal, inputs.currentEpoch);

  // Compute yield commitment
  const yieldCommitment = computeUnifiedCommitmentSync(inputs.yieldPubKeyX, yieldAmount);

  const circuitInputs: InputMap = {
    // Private inputs
    old_priv_key: inputs.oldPrivKey.toString(),
    old_pub_key_x: inputs.oldPubKeyX.toString(),
    principal: inputs.principal.toString(),
    deposit_epoch: inputs.depositEpoch.toString(),
    leaf_index: inputs.leafIndex.toString(),
    pool_merkle_path: pathElements,
    pool_path_indices: pathIndices,
    new_pub_key_x: inputs.newPubKeyX.toString(),
    yield_pub_key_x: inputs.yieldPubKeyX.toString(),

    // Public inputs
    pool_merkle_root: inputs.poolMerkleRoot.toString(),
    old_nullifier_hash: oldNullifierHash.toString(),
    new_pool_commitment: newPoolCommitment.toString(),
    yield_commitment: yieldCommitment.toString(),
    current_epoch: inputs.currentEpoch.toString(),
    yield_rate_bps: inputs.yieldRateBps.toString(),
    pool_id: inputs.poolId.toString(),
  };

  return generateProof("pool_claim_yield", circuitInputs);
}

// ==========================================================================
// Verification and Utilities
// ==========================================================================

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
