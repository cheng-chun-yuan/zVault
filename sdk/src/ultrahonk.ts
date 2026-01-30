/**
 * UltraHonk Browser Proof Generation
 *
 * Client-side ZK proof generation using bb.js with Solana verification.
 * No backend required - proofs generated entirely in browser via WASM.
 *
 * @example
 * ```typescript
 * import { generateUltraHonkProof, createVerifyInstruction } from "@zvault/sdk";
 *
 * // Generate proof in browser
 * const { proof, publicInputs } = await generateUltraHonkProof(
 *   circuit,
 *   { amount: "1000000", secret: "..." }
 * );
 *
 * // Create Solana verification instruction
 * const ix = createVerifyInstruction(proof, publicInputs, vkHash);
 *
 * // Submit transaction
 * await sendTransaction(new Transaction().add(ix));
 * ```
 */

import { getConfig } from "./config";
import type { Address } from "@solana/kit";

// =============================================================================
// Types
// =============================================================================

export interface UltraHonkProofResult {
  /** Raw proof bytes (hex encoded) */
  proof: string;
  /** Public inputs (hex encoded field elements) */
  publicInputs: string[];
  /** Proof generation time in ms */
  elapsed: number;
}

export interface CircuitArtifacts {
  /** ACIR bytecode (from nargo compile) */
  acir: Uint8Array;
  /** Verification key */
  vk: Uint8Array;
}

export type UltraHonkCircuit =
  | "claim"
  | "spend_split"
  | "spend_partial_public"
  | "pool_deposit"
  | "pool_withdraw"
  | "pool_claim_yield";

// =============================================================================
// Circuit Artifact Loading
// =============================================================================

const circuitCache = new Map<string, CircuitArtifacts>();

/**
 * Load circuit artifacts from CDN
 */
export async function loadCircuitArtifacts(
  circuit: UltraHonkCircuit
): Promise<CircuitArtifacts> {
  const cached = circuitCache.get(circuit);
  if (cached) return cached;

  const config = getConfig();
  const baseUrl = config.circuitCdnUrl;

  // Fetch ACIR and VK in parallel
  const [acirResponse, vkResponse] = await Promise.all([
    fetch(`${baseUrl}/ultrahonk/${circuit}.json`),
    fetch(`${baseUrl}/ultrahonk/${circuit}.vk`),
  ]);

  if (!acirResponse.ok || !vkResponse.ok) {
    throw new Error(`Failed to load circuit artifacts for ${circuit}`);
  }

  const acir = new Uint8Array(await acirResponse.arrayBuffer());
  const vk = new Uint8Array(await vkResponse.arrayBuffer());

  const artifacts = { acir, vk };
  circuitCache.set(circuit, artifacts);

  return artifacts;
}

// =============================================================================
// Browser Proof Generation (bb.js)
// =============================================================================

let bbInitialized = false;
let Noir: any;
let UltraHonkBackend: any;

/**
 * Initialize bb.js WASM modules
 *
 * Call this once before generating proofs. Automatically called by generateUltraHonkProof.
 */
export async function initBbJs(): Promise<void> {
  if (bbInitialized) return;

  try {
    // Dynamic imports for tree-shaking
    // These packages are optional peer dependencies
    const noirJs = await import("@noir-lang/noir_js").catch(() => null);
    const bbJs = await import("@aztec/bb.js").catch(() => null);

    if (!noirJs || !bbJs) {
      throw new Error(
        "UltraHonk requires @noir-lang/noir_js and @aztec/bb.js packages. " +
          "Install them with: bun add @noir-lang/noir_js @aztec/bb.js"
      );
    }

    Noir = noirJs.Noir;
    UltraHonkBackend = bbJs.UltraHonkBackend;

    bbInitialized = true;
    console.log("[UltraHonk] bb.js initialized");
  } catch (error) {
    console.error("[UltraHonk] Failed to initialize bb.js:", error);
    throw error;
  }
}

/**
 * Generate UltraHonk proof in browser
 *
 * @param circuit - Circuit to prove
 * @param inputs - Circuit inputs (will be converted to Prover.toml format)
 * @returns Proof and public inputs
 */
export async function generateUltraHonkProof(
  circuit: UltraHonkCircuit,
  inputs: Record<string, string | string[] | number | number[]>
): Promise<UltraHonkProofResult> {
  const startTime = performance.now();

  // Initialize bb.js if needed
  await initBbJs();

  // Load circuit artifacts
  const artifacts = await loadCircuitArtifacts(circuit);

  // Parse ACIR
  const acirJson = JSON.parse(new TextDecoder().decode(artifacts.acir));

  // Create Noir instance
  const noir = new Noir(acirJson);

  // Execute circuit to generate witness
  const { witness } = await noir.execute(inputs);

  // Create backend and generate proof
  const backend = new UltraHonkBackend(acirJson.bytecode);
  const proof = await backend.generateProof(witness);

  const elapsed = performance.now() - startTime;

  // Extract public inputs from proof
  const publicInputs = extractPublicInputs(proof.proof, acirJson);

  return {
    proof: bytesToHex(proof.proof),
    publicInputs: publicInputs.map(bytesToHex),
    elapsed,
  };
}

/**
 * Verify UltraHonk proof locally (for testing)
 */
export async function verifyUltraHonkProofLocal(
  circuit: UltraHonkCircuit,
  proof: string,
  publicInputs: string[]
): Promise<boolean> {
  await initBbJs();

  const artifacts = await loadCircuitArtifacts(circuit);
  const acirJson = JSON.parse(new TextDecoder().decode(artifacts.acir));

  const backend = new UltraHonkBackend(acirJson.bytecode);
  const proofBytes = hexToBytes(proof);

  return backend.verifyProof({
    proof: proofBytes,
    publicInputs: publicInputs.map(hexToBytes),
  });
}

// =============================================================================
// Solana Instruction Building
// =============================================================================

/**
 * UltraHonk verifier program ID (devnet)
 */
export function getUltraHonkVerifierProgramId(): Address {
  // Deployed to devnet: 2025-01-30
  return "5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd" as Address;
}

/**
 * Build instruction data for UltraHonk verification
 *
 * Format:
 * - discriminator (1 byte): 0 = VERIFY
 * - proof_len (4 bytes, LE)
 * - proof_bytes
 * - public_inputs_count (4 bytes, LE)
 * - public_inputs (N × 32 bytes)
 * - vk_hash (32 bytes)
 */
export function buildVerifyInstructionData(
  proof: string,
  publicInputs: string[],
  vkHash: string
): Uint8Array {
  const proofBytes = hexToBytes(proof);
  const piBytes = publicInputs.flatMap((pi) => Array.from(hexToBytes(pi)));
  const vkHashBytes = hexToBytes(vkHash);

  // Calculate total size
  const totalSize =
    1 + // discriminator
    4 + // proof_len
    proofBytes.length +
    4 + // public_inputs_count
    piBytes.length +
    32; // vk_hash

  const data = new Uint8Array(totalSize);
  let offset = 0;

  // Discriminator (VERIFY = 0)
  data[offset++] = 0;

  // Proof length (little-endian)
  const proofLen = proofBytes.length;
  data[offset++] = proofLen & 0xff;
  data[offset++] = (proofLen >> 8) & 0xff;
  data[offset++] = (proofLen >> 16) & 0xff;
  data[offset++] = (proofLen >> 24) & 0xff;

  // Proof bytes
  data.set(proofBytes, offset);
  offset += proofBytes.length;

  // Public inputs count (little-endian)
  const piCount = publicInputs.length;
  data[offset++] = piCount & 0xff;
  data[offset++] = (piCount >> 8) & 0xff;
  data[offset++] = (piCount >> 16) & 0xff;
  data[offset++] = (piCount >> 24) & 0xff;

  // Public inputs
  data.set(new Uint8Array(piBytes), offset);
  offset += piBytes.length;

  // VK hash
  data.set(vkHashBytes, offset);

  return data;
}

/**
 * Create Solana instruction for UltraHonk proof verification
 */
export function createVerifyInstruction(
  proof: string,
  publicInputs: string[],
  vkHash: string
): {
  programId: Address;
  keys: never[];
  data: Uint8Array;
} {
  return {
    programId: getUltraHonkVerifierProgramId(),
    keys: [], // No accounts needed for standalone verification
    data: buildVerifyInstructionData(proof, publicInputs, vkHash),
  };
}

// =============================================================================
// Utilities
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractPublicInputs(proof: Uint8Array, acir: any): Uint8Array[] {
  // Public inputs are embedded at the start of the proof after header
  const numPublicInputs = acir.abi?.parameters?.filter(
    (p: any) => p.visibility === "public"
  ).length || 0;

  const inputs: Uint8Array[] = [];
  const headerSize = 1; // circuit_size_log

  for (let i = 0; i < numPublicInputs; i++) {
    const start = headerSize + i * 32;
    const end = start + 32;
    if (end <= proof.length) {
      inputs.push(proof.slice(start, end));
    }
  }

  return inputs;
}

// =============================================================================
// High-Level API
// =============================================================================

/**
 * Generate and submit an UltraHonk proof to Solana
 *
 * Complete flow: generate proof → build instruction → return for submission
 */
export async function proveAndBuildTransaction(
  circuit: UltraHonkCircuit,
  inputs: Record<string, string | string[] | number | number[]>,
  vkHash: string
): Promise<{
  proof: UltraHonkProofResult;
  instruction: ReturnType<typeof createVerifyInstruction>;
}> {
  const proof = await generateUltraHonkProof(circuit, inputs);

  const instruction = createVerifyInstruction(
    proof.proof,
    proof.publicInputs,
    vkHash
  );

  return { proof, instruction };
}

/**
 * Check if UltraHonk is available in the current environment
 */
export function isUltraHonkAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiate === "function"
  );
}
