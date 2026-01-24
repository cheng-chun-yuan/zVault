/**
 * ZK Proof Generation using NoirReactNative (Mopro)
 *
 * Provides native Noir proof generation on mobile devices.
 * Achieves ~2-3 second proof times on modern iPhones.
 */

import * as FileSystem from 'expo-file-system/legacy';

// Types for proof generation
export interface ProofInputs {
  [key: string]: string | string[];
}

export interface ProofResult {
  proof: string;
  publicInputs: string[];
}

export interface CircuitInfo {
  name: string;
  circuitPath: string;
  srsPath: string;
}

// Circuit paths (relative to assets)
export const CIRCUITS = {
  CLAIM: 'claim',
  SPLIT: 'split',
  TRANSFER: 'transfer',
  WITHDRAW: 'partial_withdraw',
} as const;

// Base directory for circuit assets
const getCircuitAssetsDir = (): string => {
  if (!FileSystem.documentDirectory) throw new Error('Document directory not available');
  return FileSystem.documentDirectory + 'circuits/';
};

const getSrsPath = (): string => getCircuitAssetsDir() + 'srs/bn254_g1.dat';

// Cache for verification keys
const verificationKeyCache: Map<string, string> = new Map();

/**
 * Check if NoirReactNative is available
 */
export async function isNoirAvailable(): Promise<boolean> {
  try {
    // Dynamic import to handle cases where native module isn't built
    const noir = await import('noir-react-native');
    return !!noir.generateNoirProof;
  } catch {
    return false;
  }
}

/**
 * Initialize circuit assets (download if needed)
 */
export async function initializeCircuits(): Promise<void> {
  const circuitDir = getCircuitAssetsDir();
  const srsPath = getSrsPath();

  // Ensure circuits directory exists
  const dirInfo = await FileSystem.getInfoAsync(circuitDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(circuitDir, { intermediates: true });
  }

  // Check if SRS file exists
  const srsInfo = await FileSystem.getInfoAsync(srsPath);
  if (!srsInfo.exists) {
    console.log('SRS file not found - needs to be bundled or downloaded');
    // In production: download SRS from CDN
  }
}

/**
 * Get the path to a circuit file
 */
export function getCircuitPath(circuitName: string): string {
  return getCircuitAssetsDir() + `${circuitName}.json`;
}

/**
 * Generate a Noir proof
 *
 * @param circuitName - Name of the circuit (claim, split, transfer, withdraw)
 * @param inputs - Circuit inputs as key-value pairs
 * @param onChain - Whether to use Keccak256 for Solana/EVM compatibility
 * @returns Proof and public inputs
 */
export async function generateProof(
  circuitName: string,
  inputs: ProofInputs,
  onChain: boolean = true
): Promise<ProofResult> {
  const circuitPath = getCircuitPath(circuitName);
  const srsPath = getSrsPath();

  // Check if circuit file exists
  const circuitInfo = await FileSystem.getInfoAsync(circuitPath);
  if (!circuitInfo.exists) {
    throw new Error(`Circuit file not found: ${circuitPath}`);
  }

  try {
    // Dynamic import NoirReactNative
    const { generateNoirProof, getNoirVerificationKey } = await import('noir-react-native');

    // Get or generate verification key (cached)
    let verificationKey = verificationKeyCache.get(circuitName);
    if (!verificationKey) {
      console.log(`Generating verification key for ${circuitName}...`);
      verificationKey = await getNoirVerificationKey(
        circuitPath.replace('file://', ''),
        srsPath.replace('file://', ''),
        onChain,
        false // lowMemoryMode
      );
      verificationKeyCache.set(circuitName, verificationKey);
    }

    // Generate proof
    console.log(`Generating proof for ${circuitName}...`);
    const startTime = Date.now();

    const proofResult = await generateNoirProof(
      circuitPath.replace('file://', ''),
      srsPath.replace('file://', ''),
      JSON.stringify(inputs),
      onChain,
      verificationKey,
      false // lowMemoryMode
    );

    const duration = Date.now() - startTime;
    console.log(`Proof generated in ${duration}ms`);

    return {
      proof: proofResult.proof,
      publicInputs: proofResult.publicInputs || [],
    };
  } catch (error) {
    console.error('Proof generation failed:', error);
    throw new Error(`Failed to generate proof: ${error}`);
  }
}

/**
 * Verify a Noir proof locally
 *
 * @param circuitName - Name of the circuit
 * @param proof - The proof to verify
 * @param onChain - Whether the proof was generated with onChain=true
 * @returns Whether the proof is valid
 */
export async function verifyProof(
  circuitName: string,
  proof: string,
  onChain: boolean = true
): Promise<boolean> {
  const circuitPath = getCircuitPath(circuitName);

  try {
    const { verifyNoirProof } = await import('noir-react-native');

    // Get verification key from cache
    const verificationKey = verificationKeyCache.get(circuitName);
    if (!verificationKey) {
      throw new Error('Verification key not found - generate proof first');
    }

    const isValid = await verifyNoirProof(
      circuitPath.replace('file://', ''),
      proof,
      onChain,
      verificationKey,
      false // lowMemoryMode
    );

    return isValid;
  } catch (error) {
    console.error('Proof verification failed:', error);
    return false;
  }
}

/**
 * Generate a claim proof
 */
export async function generateClaimProof(params: {
  nullifier: string;
  secret: string;
  amount: string;
  merkleRoot: string;
  merklePath: string[];
  pathIndices: string[];
}): Promise<ProofResult> {
  return generateProof(CIRCUITS.CLAIM, {
    nullifier: params.nullifier,
    secret: params.secret,
    amount: params.amount,
    merkle_root: params.merkleRoot,
    merkle_path: params.merklePath,
    path_indices: params.pathIndices,
  });
}

/**
 * Generate a split proof (split 1 note into 2)
 */
export async function generateSplitProof(params: {
  inputNullifier: string;
  inputSecret: string;
  inputAmount: string;
  outputAmount1: string;
  outputAmount2: string;
  outputSecret1: string;
  outputSecret2: string;
  merkleRoot: string;
  merklePath: string[];
  pathIndices: string[];
}): Promise<ProofResult> {
  return generateProof(CIRCUITS.SPLIT, {
    input_nullifier: params.inputNullifier,
    input_secret: params.inputSecret,
    input_amount: params.inputAmount,
    output_amount_1: params.outputAmount1,
    output_amount_2: params.outputAmount2,
    output_secret_1: params.outputSecret1,
    output_secret_2: params.outputSecret2,
    merkle_root: params.merkleRoot,
    merkle_path: params.merklePath,
    path_indices: params.pathIndices,
  });
}

/**
 * Generate a withdrawal proof
 */
export async function generateWithdrawProof(params: {
  nullifier: string;
  secret: string;
  amount: string;
  recipientAddress: string;
  merkleRoot: string;
  merklePath: string[];
  pathIndices: string[];
}): Promise<ProofResult> {
  return generateProof(CIRCUITS.WITHDRAW, {
    nullifier: params.nullifier,
    secret: params.secret,
    amount: params.amount,
    recipient: params.recipientAddress,
    merkle_root: params.merkleRoot,
    merkle_path: params.merklePath,
    path_indices: params.pathIndices,
  });
}

/**
 * Fallback: Request proof generation from backend
 * Used when native proving is unavailable or for complex proofs
 */
export async function requestBackendProof(
  circuitName: string,
  inputs: ProofInputs,
  backendUrl: string = 'https://api.zvault.io'
): Promise<ProofResult> {
  const response = await fetch(`${backendUrl}/api/proof/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      circuit: circuitName,
      inputs,
    }),
  });

  if (!response.ok) {
    throw new Error(`Backend proof generation failed: ${response.statusText}`);
  }

  return response.json();
}
