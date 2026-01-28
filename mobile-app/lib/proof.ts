/**
 * ZK Proof Generation Service
 *
 * Downloads circuits from circuits.amidoggy.xyz and uses mopro for native proving.
 *
 * @module lib/proof
 */

import * as FileSystem from "expo-file-system/legacy";
import {
  proofToNoirFormat,
  type MerkleProof as SDKMerkleProof,
  type Note,
} from '@zvault/sdk';

// Type declarations for noir-react-native
type NoirModule = {
  uniffiInitAsync?: () => Promise<void>;
  generateNoirProof: (
    circuitPath: string,
    srsPath: string,
    inputs: string,
    onChain: boolean,
    verificationKey: string,
    lowMemoryMode: boolean
  ) => Promise<{ proof: string; publicInputs?: string[] }>;
  verifyNoirProof: (
    circuitPath: string,
    proof: string,
    onChain: boolean,
    verificationKey: string,
    lowMemoryMode: boolean
  ) => Promise<boolean>;
  getNoirVerificationKey: (
    circuitPath: string,
    srsPath: string,
    onChain: boolean,
    lowMemoryMode: boolean
  ) => Promise<string>;
};

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

export interface SplitProofInput {
  inputNullifier: string;
  inputSecret: string;
  inputAmount: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
  output1Nullifier: string;
  output1Secret: string;
  output1Amount: string;
  output2Nullifier: string;
  output2Secret: string;
  output2Amount: string;
}

export interface TransferProofInput {
  inputNullifier: string;
  inputSecret: string;
  inputAmount: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
  outputNullifier: string;
  outputSecret: string;
  recipient: string;
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

export interface StealthTransferProofInput {
  inputNullifier: string;
  inputSecret: string;
  inputAmount: string;
  merkleRoot: string;
  merkleProof: MerkleProof;
  outputNullifier: string;
  outputSecret: string;
  outputAmount: string;
  stealthPubkey: string;
  ephemeralPubkey: string;
}

export interface InitProgress {
  stage: 'checking' | 'downloading' | 'ready' | 'error';
  progress?: number;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const CIRCUITS_BASE_URL = "https://circuits.amidoggy.xyz";

export const CIRCUITS = {
  CLAIM: "zvault_claim",
  SPLIT: "zvault_split",
  TRANSFER: "zvault_transfer",
  PARTIAL_WITHDRAW: "zvault_partial_withdraw",
  STEALTH_TRANSFER: "zvault_stealth_transfer",
} as const;

export type CircuitName = (typeof CIRCUITS)[keyof typeof CIRCUITS];

const ALL_CIRCUITS: CircuitName[] = [
  CIRCUITS.CLAIM,
  CIRCUITS.SPLIT,
  CIRCUITS.TRANSFER,
  CIRCUITS.PARTIAL_WITHDRAW,
  CIRCUITS.STEALTH_TRANSFER,
];

// ============================================================================
// File Paths
// ============================================================================

function getCircuitDir(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error("Document directory not available");
  }
  return docDir + "circuits/";
}

function getCircuitPath(circuitName: string): string {
  return getCircuitDir() + `${circuitName}.json`;
}

function getSrsPath(): string {
  return getCircuitDir() + "bn254_srs.dat";
}

// ============================================================================
// Noir Module Management
// ============================================================================

let _noirModule: NoirModule | null = null;
let _isInitialized = false;
const _verificationKeys = new Map<string, string>();

/**
 * Check if native Noir prover is available
 */
export async function isNoirAvailable(): Promise<boolean> {
  try {
    if (!_noirModule) {
      const module = await import("noir-react-native") as unknown as NoirModule;
      if (module.uniffiInitAsync) {
        await module.uniffiInitAsync();
      }
      _noirModule = module;
    }
    return !!_noirModule.generateNoirProof;
  } catch (error) {
    console.warn("[Proof] Noir not available:", error);
    return false;
  }
}

async function getNoirModule(): Promise<NoirModule> {
  if (!_noirModule) {
    const module = await import("noir-react-native") as unknown as NoirModule;
    if (module.uniffiInitAsync) {
      await module.uniffiInitAsync();
    }
    _noirModule = module;
  }
  return _noirModule;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the proof system
 * Downloads all circuits and SRS from circuits.amidoggy.xyz
 */
export async function initializeProofSystem(
  onProgress?: (progress: InitProgress) => void
): Promise<boolean> {
  if (_isInitialized) {
    onProgress?.({ stage: 'ready', message: 'Proof system ready' });
    return true;
  }

  try {
    onProgress?.({ stage: 'checking', message: 'Checking proof system...' });

    // Create circuits directory
    const circuitDir = getCircuitDir();
    const dirInfo = await FileSystem.getInfoAsync(circuitDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(circuitDir, { intermediates: true });
    }

    // Download SRS first (largest file)
    const srsPath = getSrsPath();
    const srsInfo = await FileSystem.getInfoAsync(srsPath);
    if (!srsInfo.exists) {
      onProgress?.({ stage: 'downloading', progress: 0, message: 'Downloading SRS...' });
      await downloadFile(`${CIRCUITS_BASE_URL}/bn254_srs.dat`, srsPath, (p) => {
        onProgress?.({ stage: 'downloading', progress: p * 0.5, message: 'Downloading SRS...' });
      });
    }

    // Download all circuits
    const circuitProgress = 0.5;
    const progressPerCircuit = 0.5 / ALL_CIRCUITS.length;

    for (let i = 0; i < ALL_CIRCUITS.length; i++) {
      const circuitName = ALL_CIRCUITS[i];
      const circuitPath = getCircuitPath(circuitName);
      const circuitInfo = await FileSystem.getInfoAsync(circuitPath);

      if (!circuitInfo.exists) {
        const baseProgress = circuitProgress + i * progressPerCircuit;
        onProgress?.({
          stage: 'downloading',
          progress: baseProgress,
          message: `Downloading ${circuitName}...`
        });

        await downloadFile(
          `${CIRCUITS_BASE_URL}/${circuitName}.json`,
          circuitPath,
          (p) => {
            onProgress?.({
              stage: 'downloading',
              progress: baseProgress + p * progressPerCircuit,
              message: `Downloading ${circuitName}...`
            });
          }
        );
      }
    }

    // Verify Noir is available
    const noirAvailable = await isNoirAvailable();
    if (!noirAvailable) {
      throw new Error("Native Noir prover not available");
    }

    _isInitialized = true;
    onProgress?.({ stage: 'ready', message: 'Proof system ready' });
    console.log("[Proof] System initialized successfully");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Initialization failed';
    onProgress?.({ stage: 'error', message });
    console.error("[Proof] Initialization failed:", error);
    return false;
  }
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`[Proof] Downloading: ${url}`);

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    destPath,
    {},
    (downloadProgress) => {
      if (downloadProgress.totalBytesExpectedToWrite > 0) {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        onProgress?.(progress);
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Download failed: ${url}`);
  }

  console.log(`[Proof] Downloaded: ${destPath}`);
}

/**
 * Check if proof system is ready
 */
export async function isProofSystemReady(): Promise<boolean> {
  if (_isInitialized) return true;

  const srsPath = getSrsPath();
  const srsInfo = await FileSystem.getInfoAsync(srsPath);
  if (!srsInfo.exists) return false;

  for (const circuitName of ALL_CIRCUITS) {
    const circuitPath = getCircuitPath(circuitName);
    const circuitInfo = await FileSystem.getInfoAsync(circuitPath);
    if (!circuitInfo.exists) return false;
  }

  return true;
}

// ============================================================================
// Verification Key Management
// ============================================================================

async function getVerificationKey(circuitName: CircuitName): Promise<string> {
  if (_verificationKeys.has(circuitName)) {
    return _verificationKeys.get(circuitName)!;
  }

  const noir = await getNoirModule();
  const circuitPath = getCircuitPath(circuitName);
  const srsPath = getSrsPath();

  console.log(`[Proof] Generating verification key for ${circuitName}...`);

  const vk = await noir.getNoirVerificationKey(
    circuitPath,
    srsPath,
    true, // onChain
    false // lowMemoryMode
  );

  _verificationKeys.set(circuitName, vk);
  return vk;
}

// ============================================================================
// Core Proof Generation
// ============================================================================

async function generateProof(
  circuitName: CircuitName,
  inputs: ProofInputs
): Promise<ProofResult> {
  const startTime = Date.now();

  if (!_isInitialized) {
    const ready = await initializeProofSystem();
    if (!ready) {
      return { success: false, error: "Proof system not initialized" };
    }
  }

  const circuitPath = getCircuitPath(circuitName);
  const srsPath = getSrsPath();

  try {
    const noir = await getNoirModule();
    const verificationKey = await getVerificationKey(circuitName);

    console.log(`[Proof] Generating ${circuitName} proof...`);

    const result = await noir.generateNoirProof(
      circuitPath,
      srsPath,
      JSON.stringify(inputs),
      true, // onChain
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

async function verifyProof(circuitName: CircuitName, proof: string): Promise<boolean> {
  if (!_isInitialized) return false;

  const vk = _verificationKeys.get(circuitName);
  if (!vk) return false;

  try {
    const noir = await getNoirModule();
    return await noir.verifyNoirProof(
      getCircuitPath(circuitName),
      proof,
      true,
      vk,
      false
    );
  } catch (error) {
    console.error("[Proof] Verification failed:", error);
    return false;
  }
}

// ============================================================================
// Proof Generators
// ============================================================================

/**
 * Generate a claim proof - claim deposited BTC
 */
export async function generateClaimProof(input: ClaimProofInput): Promise<ProofResult> {
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
 * Generate a split proof - split one note into two
 */
export async function generateSplitProof(input: SplitProofInput): Promise<ProofResult> {
  return generateProof(CIRCUITS.SPLIT, {
    input_nullifier: input.inputNullifier,
    input_secret: input.inputSecret,
    input_amount: input.inputAmount,
    merkle_root: input.merkleRoot,
    merkle_path: input.merkleProof.pathElements,
    path_indices: input.merkleProof.pathIndices,
    output1_nullifier: input.output1Nullifier,
    output1_secret: input.output1Secret,
    output1_amount: input.output1Amount,
    output2_nullifier: input.output2Nullifier,
    output2_secret: input.output2Secret,
    output2_amount: input.output2Amount,
  });
}

/**
 * Generate a transfer proof - transfer to another address
 */
export async function generateTransferProof(input: TransferProofInput): Promise<ProofResult> {
  return generateProof(CIRCUITS.TRANSFER, {
    input_nullifier: input.inputNullifier,
    input_secret: input.inputSecret,
    input_amount: input.inputAmount,
    merkle_root: input.merkleRoot,
    merkle_path: input.merkleProof.pathElements,
    path_indices: input.merkleProof.pathIndices,
    output_nullifier: input.outputNullifier,
    output_secret: input.outputSecret,
    recipient: input.recipient,
  });
}

/**
 * Generate a partial withdraw proof - withdraw part of a note
 */
export async function generatePartialWithdrawProof(input: PartialWithdrawProofInput): Promise<ProofResult> {
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

/**
 * Generate a stealth transfer proof - private transfer via stealth address
 */
export async function generateStealthTransferProof(input: StealthTransferProofInput): Promise<ProofResult> {
  return generateProof(CIRCUITS.STEALTH_TRANSFER, {
    input_nullifier: input.inputNullifier,
    input_secret: input.inputSecret,
    input_amount: input.inputAmount,
    merkle_root: input.merkleRoot,
    merkle_path: input.merkleProof.pathElements,
    path_indices: input.merkleProof.pathIndices,
    output_nullifier: input.outputNullifier,
    output_secret: input.outputSecret,
    output_amount: input.outputAmount,
    stealth_pubkey: input.stealthPubkey,
    ephemeral_pubkey: input.ephemeralPubkey,
  });
}

// ============================================================================
// Proof Verifiers
// ============================================================================

export async function verifyClaimProof(proof: string): Promise<boolean> {
  return verifyProof(CIRCUITS.CLAIM, proof);
}

export async function verifySplitProof(proof: string): Promise<boolean> {
  return verifyProof(CIRCUITS.SPLIT, proof);
}

export async function verifyTransferProof(proof: string): Promise<boolean> {
  return verifyProof(CIRCUITS.TRANSFER, proof);
}

export async function verifyPartialWithdrawProof(proof: string): Promise<boolean> {
  return verifyProof(CIRCUITS.PARTIAL_WITHDRAW, proof);
}

export async function verifyStealthTransferProof(proof: string): Promise<boolean> {
  return verifyProof(CIRCUITS.STEALTH_TRANSFER, proof);
}

// ============================================================================
// Utility Functions
// ============================================================================

export function createEmptyMerkleProof(depth: number = 10): MerkleProof {
  return {
    pathElements: Array(depth).fill("0"),
    pathIndices: Array(depth).fill("0"),
  };
}

export function prepareClaimInputsFromNote(
  note: Note,
  merkleRoot: bigint,
  merkleProof: SDKMerkleProof
): ClaimProofInput {
  const noirProof = proofToNoirFormat(merkleProof);

  return {
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    amount: note.amount.toString(),
    merkleRoot: merkleRoot.toString(),
    merkleProof: {
      pathElements: noirProof.merkle_path,
      pathIndices: noirProof.path_indices,
    },
  };
}

export function formatProofForOnChain(
  proof: string,
  publicInputs: string[]
): { proof: Uint8Array; publicInputs: bigint[] } {
  const proofBytes = hexToBytes(proof);
  const inputs = publicInputs.map((s) => BigInt(s));

  return {
    proof: proofBytes,
    publicInputs: inputs,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}
