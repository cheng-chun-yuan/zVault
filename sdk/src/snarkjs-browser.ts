/**
 * Browser-based Groth16 Proof Generation using snarkjs
 *
 * Client-side ZK proof generation using snarkjs WASM with Solana verification
 * via the groth16-solana crate.
 *
 * This approach uses Circom circuits (not Noir) for browser compatibility
 * with existing Solana Groth16 verifiers.
 *
 * @example
 * ```typescript
 * import { generateGroth16ProofBrowser, buildSolanaProofData } from "@zvault/sdk";
 *
 * // Generate proof in browser
 * const { proof, publicSignals } = await generateGroth16ProofBrowser(
 *   "/circuits/claim.wasm",
 *   "/circuits/claim_final.zkey",
 *   { secret: "123", nullifier: "456", ... }
 * );
 *
 * // Convert for Solana (negates proof.A.y)
 * const solanaProof = buildSolanaProofData(proof, publicSignals);
 *
 * // Submit to Solana program using groth16-solana verifier
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export interface Groth16Proof {
  pi_a: [string, string, string]; // G1 point (projective)
  pi_b: [[string, string], [string, string], [string, string]]; // G2 point
  pi_c: [string, string, string]; // G1 point (projective)
  protocol: string;
  curve: string;
}

export interface SnarkjsProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
}

export interface SolanaGroth16Proof {
  /** Proof A (G1) - 64 bytes, y-coordinate NEGATED */
  proofA: Uint8Array;
  /** Proof B (G2) - 128 bytes */
  proofB: Uint8Array;
  /** Proof C (G1) - 64 bytes */
  proofC: Uint8Array;
  /** Public inputs - array of 32-byte field elements */
  publicInputs: Uint8Array[];
}

// =============================================================================
// BN254 Constants
// =============================================================================

/** BN254 base field prime p */
const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088696311157297823662689037894645226208583"
);

// =============================================================================
// Browser Proof Generation
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let snarkjs: any = null;

/**
 * Initialize snarkjs (lazy load)
 *
 * snarkjs is an optional peer dependency - install with: bun add snarkjs
 */
async function initSnarkjs(): Promise<void> {
  if (snarkjs) return;

  try {
    // Dynamic import - snarkjs is optional peer dependency
    // @ts-ignore - snarkjs types may not be installed
    snarkjs = await import("snarkjs").catch(() => null);
    if (!snarkjs) {
      throw new Error("Module not found");
    }
    console.log("[snarkjs] Initialized");
  } catch {
    throw new Error(
      "snarkjs not found. Install with: bun add snarkjs"
    );
  }
}

/**
 * Generate Groth16 proof in browser using snarkjs
 *
 * @param wasmPath - Path to circuit.wasm file
 * @param zkeyPath - Path to circuit_final.zkey file
 * @param inputs - Circuit inputs
 * @returns Proof and public signals
 */
export async function generateGroth16ProofBrowser(
  wasmPath: string,
  zkeyPath: string,
  inputs: Record<string, string | string[] | bigint | bigint[]>
): Promise<SnarkjsProofResult> {
  await initSnarkjs();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    wasmPath,
    zkeyPath
  );

  return { proof, publicSignals };
}

/**
 * Verify Groth16 proof locally (for testing)
 */
export async function verifyGroth16ProofLocal(
  vkeyPath: string,
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  await initSnarkjs();

  const vkey = await fetch(vkeyPath).then((r) => r.json());
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// =============================================================================
// Solana Proof Conversion
// =============================================================================

/**
 * Convert snarkjs proof to Solana format
 *
 * IMPORTANT: This negates proof.A's y-coordinate as required by groth16-solana.
 * The Groth16 verification equation uses -A, and groth16-solana expects this
 * negation to be pre-applied.
 *
 * @param proof - snarkjs Groth16 proof
 * @param publicSignals - Public signals from proof generation
 * @returns Proof formatted for Solana's groth16-solana verifier
 */
export function buildSolanaProofData(
  proof: Groth16Proof,
  publicSignals: string[]
): SolanaGroth16Proof {
  // Convert proof.A (G1) - NEGATE y-coordinate
  const proofA = new Uint8Array(64);
  const aX = BigInt(proof.pi_a[0]);
  const aY = BigInt(proof.pi_a[1]);
  const negAY = FIELD_PRIME - aY; // Negate y-coordinate

  writeBigIntBE(proofA, aX, 0, 32);
  writeBigIntBE(proofA, negAY, 32, 32);

  // Convert proof.B (G2) - Note: snarkjs uses (c1, c0) order
  const proofB = new Uint8Array(128);
  // x coordinate (Fq2: c0 + c1*u)
  writeBigIntBE(proofB, BigInt(proof.pi_b[0][1]), 0, 32);  // x.c0
  writeBigIntBE(proofB, BigInt(proof.pi_b[0][0]), 32, 32); // x.c1
  // y coordinate (Fq2: c0 + c1*u)
  writeBigIntBE(proofB, BigInt(proof.pi_b[1][1]), 64, 32);  // y.c0
  writeBigIntBE(proofB, BigInt(proof.pi_b[1][0]), 96, 32);  // y.c1

  // Convert proof.C (G1)
  const proofC = new Uint8Array(64);
  writeBigIntBE(proofC, BigInt(proof.pi_c[0]), 0, 32);
  writeBigIntBE(proofC, BigInt(proof.pi_c[1]), 32, 32);

  // Convert public inputs
  const publicInputs = publicSignals.map((signal) => {
    const bytes = new Uint8Array(32);
    writeBigIntBE(bytes, BigInt(signal), 0, 32);
    return bytes;
  });

  return { proofA, proofB, proofC, publicInputs };
}

/**
 * Build complete proof bytes for Solana instruction
 *
 * Format: proofA (64) || proofB (128) || proofC (64) = 256 bytes
 */
export function buildSolanaProofBytes(solanaProof: SolanaGroth16Proof): Uint8Array {
  const proofBytes = new Uint8Array(256);
  proofBytes.set(solanaProof.proofA, 0);
  proofBytes.set(solanaProof.proofB, 64);
  proofBytes.set(solanaProof.proofC, 192);
  return proofBytes;
}

/**
 * Build public inputs bytes for Solana instruction
 *
 * Format: N × 32 bytes (big-endian field elements)
 */
export function buildSolanaPublicInputsBytes(
  publicInputs: Uint8Array[]
): Uint8Array {
  const result = new Uint8Array(publicInputs.length * 32);
  for (let i = 0; i < publicInputs.length; i++) {
    result.set(publicInputs[i], i * 32);
  }
  return result;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Write BigInt to byte array in big-endian format
 */
function writeBigIntBE(
  arr: Uint8Array,
  value: bigint,
  offset: number,
  length: number
): void {
  for (let i = length - 1; i >= 0; i--) {
    arr[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

/**
 * Check if snarkjs is available
 */
export function isSnarkjsAvailable(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

// =============================================================================
// High-Level API
// =============================================================================

/**
 * Complete flow: generate proof in browser and prepare for Solana
 */
export async function proveAndPrepareSolana(
  wasmPath: string,
  zkeyPath: string,
  inputs: Record<string, string | string[] | bigint | bigint[]>
): Promise<{
  proof: Groth16Proof;
  publicSignals: string[];
  solanaProof: SolanaGroth16Proof;
  proofBytes: Uint8Array;
  publicInputsBytes: Uint8Array;
}> {
  const { proof, publicSignals } = await generateGroth16ProofBrowser(
    wasmPath,
    zkeyPath,
    inputs
  );

  const solanaProof = buildSolanaProofData(proof, publicSignals);
  const proofBytes = buildSolanaProofBytes(solanaProof);
  const publicInputsBytes = buildSolanaPublicInputsBytes(solanaProof.publicInputs);

  return {
    proof,
    publicSignals,
    solanaProof,
    proofBytes,
    publicInputsBytes,
  };
}
