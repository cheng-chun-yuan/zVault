/**
 * ZK Proof Generation Service
 *
 * Uses mopro (NoirReactNative) for native Noir proof generation on mobile devices.
 * Achieves ~2-3 second proof times on modern iPhones.
 *
 * @module lib/proof
 */

import * as FileSystem from "expo-file-system/legacy";

// ============================================================================
// Types
// ============================================================================

export interface ProofInputs {
  [key: string]: string | string[];
}

export interface ProofResult {
  success: boolean;
  proof?: string;
  publicInputs?: string[];
  duration?: number;
  error?: string;
}

export interface MerkleProof {
  pathElements: string[];
  pathIndices: string[];
}

export interface ClaimProofInput {
  nullifier: string;
  secret: string;
  amount: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
}

export interface PartialWithdrawProofInput {
  inputNullifier: string;
  inputSecret: string;
  inputAmount: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
  withdrawAmount: string;
  changeNullifier: string;
  changeSecret: string;
  changeAmount: string;
  recipient: string;
}

// ============================================================================
// Constants
// ============================================================================

export const CIRCUITS = {
  CLAIM: "zvault_claim",
  SPLIT: "zvault_split",
  TRANSFER: "zvault_transfer",
  PARTIAL_WITHDRAW: "zvault_partial_withdraw",
} as const;

export type CircuitName = (typeof CIRCUITS)[keyof typeof CIRCUITS];

// ============================================================================
// File Paths
// ============================================================================

function getCircuitAssetsDir(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error("Document directory not available");
  }
  return FileSystem.documentDirectory + "circuits/";
}

function getCircuitPath(circuitName: string): string {
  return getCircuitAssetsDir() + `${circuitName}.json`;
}

function getSrsPath(): string {
  return getCircuitAssetsDir() + "srs/bn254_g1.dat";
}

// ============================================================================
// Noir Availability Check
// ============================================================================

let _noirModule: typeof import("noir-react-native") | null = null;

/**
 * Check if native Noir prover is available
 */
export async function isNoirAvailable(): Promise<boolean> {
  try {
    if (!_noirModule) {
      _noirModule = await import("noir-react-native");
    }
    return !!_noirModule.generateNoirProof;
  } catch {
    return false;
  }
}

/**
 * Get the Noir module (lazy loaded)
 */
async function getNoirModule(): Promise<typeof import("noir-react-native")> {
  if (!_noirModule) {
    _noirModule = await import("noir-react-native");
  }
  return _noirModule;
}

// ============================================================================
// Circuit Initialization
// ============================================================================

/**
 * Check if circuit files are available
 */
export async function areCircuitsAvailable(): Promise<boolean> {
  const claimPath = getCircuitPath(CIRCUITS.CLAIM);
  const srsPath = getSrsPath();

  const [claimInfo, srsInfo] = await Promise.all([
    FileSystem.getInfoAsync(claimPath),
    FileSystem.getInfoAsync(srsPath),
  ]);

  return claimInfo.exists && srsInfo.exists;
}

/**
 * Initialize circuit assets directory
 */
export async function initializeCircuits(): Promise<void> {
  const circuitDir = getCircuitAssetsDir();
  const srsDir = circuitDir + "srs/";

  // Create directories if they don't exist
  const dirInfo = await FileSystem.getInfoAsync(circuitDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(circuitDir, { intermediates: true });
  }

  const srsDirInfo = await FileSystem.getInfoAsync(srsDir);
  if (!srsDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(srsDir, { intermediates: true });
  }

  console.log("[Proof] Circuit directories initialized");
}

// ============================================================================
// Verification Key Cache
// ============================================================================

const verificationKeyCache = new Map<string, string>();

/**
 * Get or generate verification key for a circuit
 */
async function getVerificationKey(
  circuitName: string,
  onChain: boolean = true
): Promise<string> {
  const cacheKey = `${circuitName}_${onChain}`;

  if (verificationKeyCache.has(cacheKey)) {
    return verificationKeyCache.get(cacheKey)!;
  }

  const noir = await getNoirModule();
  const circuitPath = getCircuitPath(circuitName).replace("file://", "");
  const srsPath = getSrsPath().replace("file://", "");

  console.log(`[Proof] Generating verification key for ${circuitName}...`);

  const vk = await noir.getNoirVerificationKey(
    circuitPath,
    srsPath,
    onChain,
    false // lowMemoryMode
  );

  verificationKeyCache.set(cacheKey, vk);
  return vk;
}

// ============================================================================
// Core Proof Generation
// ============================================================================

/**
 * Generate a Noir ZK proof
 *
 * @param circuitName - Name of the circuit
 * @param inputs - Circuit inputs
 * @param onChain - Whether to use Keccak256 for on-chain compatibility
 * @returns Proof result with proof bytes and public inputs
 */
export async function generateProof(
  circuitName: string,
  inputs: ProofInputs,
  onChain: boolean = true
): Promise<ProofResult> {
  const startTime = Date.now();

  // Check if Noir is available
  const available = await isNoirAvailable();
  if (!available) {
    return {
      success: false,
      error: "Native Noir prover not available",
    };
  }

  const circuitPath = getCircuitPath(circuitName);
  const srsPath = getSrsPath();

  // Check circuit file exists
  const circuitInfo = await FileSystem.getInfoAsync(circuitPath);
  if (!circuitInfo.exists) {
    return {
      success: false,
      error: `Circuit file not found: ${circuitName}`,
    };
  }

  try {
    const noir = await getNoirModule();

    // Get verification key (cached)
    const verificationKey = await getVerificationKey(circuitName, onChain);

    // Generate proof
    console.log(`[Proof] Generating ${circuitName} proof...`);

    const result = await noir.generateNoirProof(
      circuitPath.replace("file://", ""),
      srsPath.replace("file://", ""),
      JSON.stringify(inputs),
      onChain,
      verificationKey,
      false // lowMemoryMode
    );

    const duration = Date.now() - startTime;
    console.log(`[Proof] Generated in ${duration}ms`);

    return {
      success: true,
      proof: result.proof,
      publicInputs: result.publicInputs || [],
      duration,
    };
  } catch (error) {
    console.error("[Proof] Generation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Proof generation failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Verify a Noir proof locally
 */
export async function verifyProof(
  circuitName: string,
  proof: string,
  onChain: boolean = true
): Promise<boolean> {
  const available = await isNoirAvailable();
  if (!available) return false;

  const circuitPath = getCircuitPath(circuitName);
  const verificationKey = verificationKeyCache.get(`${circuitName}_${onChain}`);

  if (!verificationKey) {
    console.error("[Proof] Verification key not found - generate proof first");
    return false;
  }

  try {
    const noir = await getNoirModule();
    return await noir.verifyNoirProof(
      circuitPath.replace("file://", ""),
      proof,
      onChain,
      verificationKey,
      false
    );
  } catch (error) {
    console.error("[Proof] Verification failed:", error);
    return false;
  }
}

// ============================================================================
// Specific Proof Generators
// ============================================================================

/**
 * Generate a claim proof
 *
 * Proves knowledge of (nullifier, secret) for a commitment in the Merkle tree.
 */
export async function generateClaimProof(
  input: ClaimProofInput
): Promise<ProofResult> {
  return generateProof(CIRCUITS.CLAIM, {
    nullifier: input.nullifier,
    secret: input.secret,
    amount: input.amount,
    merkle_root: input.merkleRoot,
    merkle_path: input.merkleProof.pathElements,
    path_indices: input.merkleProof.pathIndices,
  });
}

/**
 * Generate a partial withdraw proof
 *
 * Proves:
 * 1. Input note exists in tree (Merkle proof)
 * 2. Withdraw amount <= input amount
 * 3. Change commitment is correctly computed
 * 4. Amount conservation: input = withdraw + change
 */
export async function generatePartialWithdrawProof(
  input: PartialWithdrawProofInput
): Promise<ProofResult> {
  return generateProof(CIRCUITS.PARTIAL_WITHDRAW, {
    input_nullifier: input.inputNullifier,
    input_secret: input.inputSecret,
    input_amount: input.inputAmount,
    merkle_root: input.merkleRoot,
    merkle_path: input.merkleProof.pathElements,
    path_indices: input.merkleProof.pathIndices,
    withdraw_amount: input.withdrawAmount,
    change_nullifier: input.changeNullifier,
    change_secret: input.changeSecret,
    change_amount: input.changeAmount,
    recipient: input.recipient,
  });
}

// ============================================================================
// Backend Fallback
// ============================================================================

const DEFAULT_BACKEND_URL = "https://api.zvault.io";

/**
 * Request proof generation from backend (fallback when native unavailable)
 */
export async function requestBackendProof(
  circuitName: string,
  inputs: ProofInputs,
  backendUrl: string = DEFAULT_BACKEND_URL
): Promise<ProofResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${backendUrl}/api/proof/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ circuit: circuitName, inputs }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Backend error: ${response.statusText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      proof: result.proof,
      publicInputs: result.publicInputs,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Backend request failed",
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert bigint to hex string (for circuit inputs)
 */
export function bigintToHex(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

/**
 * Convert number to string (for circuit inputs)
 */
export function numberToString(value: number | bigint): string {
  return value.toString();
}

/**
 * Create empty merkle proof (for initial claims)
 */
export function createEmptyMerkleProof(depth: number = 10): MerkleProof {
  return {
    pathElements: Array(depth).fill("0"),
    pathIndices: Array(depth).fill("0"),
  };
}
