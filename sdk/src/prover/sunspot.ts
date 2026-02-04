/**
 * Sunspot Groth16 Proof Generator for ZVault
 *
 * Uses Sunspot CLI for Groth16 proof generation from Noir circuits.
 * Proofs are ~388 bytes (vs 16KB for UltraHonk).
 *
 * Node.js: Calls nargo + Sunspot CLI
 * Browser: Not yet supported (requires gnark WASM)
 */

import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface SunspotProofResult {
  proof: Uint8Array;
  publicWitness: Uint8Array;
  publicInputs: string[];
}

export interface SunspotConfig {
  sunspotPath: string;
  circuitsBasePath: string; // Base path to circuits directory (contains claim/, spend_split/, etc.)
}

// Environment detection
const isBrowser = typeof window !== "undefined";

// Default paths
const DEFAULT_SUNSPOT_PATH = path.join(os.homedir(), "sunspot", "go", "sunspot");

let config: SunspotConfig = {
  sunspotPath: DEFAULT_SUNSPOT_PATH,
  circuitsBasePath: path.resolve(__dirname, "../../../circuits"),
};

/**
 * Configure Sunspot prover
 */
export function configureSunspot(newConfig: Partial<SunspotConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get current config
 */
export function getSunspotConfig(): SunspotConfig {
  return { ...config };
}

/**
 * Check if Sunspot is available
 */
export async function isSunspotAvailable(): Promise<boolean> {
  if (isBrowser) return false;
  try {
    execSync(`${config.sunspotPath} --help`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command and return stdout
 */
function runCommand(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", cmd], { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command failed (${code}): ${stderr}`));
    });

    child.on("error", reject);
  });
}

export type CircuitType =
  | "claim"
  | "spend_split"
  | "spend_partial_public"
  | "pool_deposit"
  | "pool_withdraw"
  | "pool_claim_yield";

const CIRCUIT_DIRS: Record<CircuitType, string> = {
  claim: "claim",
  spend_split: "spend_split",
  spend_partial_public: "spend_partial_public",
  pool_deposit: "pool_deposit",
  pool_withdraw: "pool_withdraw",
  pool_claim_yield: "pool_claim_yield",
};

const CIRCUIT_NAMES: Record<CircuitType, string> = {
  claim: "zvault_claim",
  spend_split: "zvault_spend_split",
  spend_partial_public: "zvault_spend_partial_public",
  pool_deposit: "zvault_pool_deposit",
  pool_withdraw: "zvault_pool_withdraw",
  pool_claim_yield: "zvault_pool_claim_yield",
};

/**
 * Generate a Groth16 proof using Sunspot
 */
export async function generateGroth16Proof(
  circuitType: CircuitType,
  inputs: Record<string, string | string[]>
): Promise<SunspotProofResult> {
  if (isBrowser) {
    throw new Error("Sunspot browser proving not supported. Use server-side proving.");
  }

  console.log(`[Sunspot] Generating Groth16 proof for ${circuitType}...`);
  const startTime = Date.now();

  const circuitDir = CIRCUIT_DIRS[circuitType];
  const circuitName = CIRCUIT_NAMES[circuitType];
  const circuitPath = path.join(config.circuitsBasePath, circuitDir);
  const targetPath = path.join(config.circuitsBasePath, "target");

  // Check circuit directory exists
  if (!fs.existsSync(circuitPath)) {
    throw new Error(`Circuit directory not found: ${circuitPath}`);
  }

  // Check Sunspot artifacts exist
  const ccsPath = path.join(targetPath, `${circuitName}.ccs`);
  const pkPath = path.join(targetPath, `${circuitName}.pk`);
  const acirPath = path.join(targetPath, `${circuitName}.json`);

  if (!fs.existsSync(ccsPath) || !fs.existsSync(pkPath)) {
    throw new Error(
      `Sunspot artifacts not found. Run:\n` +
      `  cd ${config.circuitsBasePath} && nargo compile\n` +
      `  ${config.sunspotPath} compile target/${circuitName}.json\n` +
      `  ${config.sunspotPath} setup target/${circuitName}.ccs`
    );
  }

  // Step 1: Write inputs to Prover.toml
  const proverTomlPath = path.join(circuitPath, "Prover.toml");
  let tomlContent = "";
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      tomlContent += `${key} = [${value.map((v) => `"${v}"`).join(", ")}]\n`;
    } else {
      tomlContent += `${key} = "${value}"\n`;
    }
  }
  fs.writeFileSync(proverTomlPath, tomlContent);

  // Step 2: Run nargo execute to generate witness
  console.log(`[Sunspot] Executing circuit with nargo...`);
  await runCommand(`nargo execute witness`, circuitPath);

  const witnessPath = path.join(targetPath, "witness.gz");
  if (!fs.existsSync(witnessPath)) {
    throw new Error(`Witness not generated at ${witnessPath}`);
  }

  // Step 3: Run sunspot prove
  console.log(`[Sunspot] Generating Groth16 proof...`);
  await runCommand(
    `${config.sunspotPath} prove ${acirPath} ${witnessPath} ${ccsPath} ${pkPath}`,
    targetPath
  );

  // Read outputs
  const proofPath = path.join(targetPath, `${circuitName}.proof`);
  const pwPath = path.join(targetPath, `${circuitName}.pw`);

  if (!fs.existsSync(proofPath) || !fs.existsSync(pwPath)) {
    throw new Error("Sunspot proof generation failed");
  }

  const proof = fs.readFileSync(proofPath);
  const publicWitness = fs.readFileSync(pwPath);

  // Extract public inputs (32-byte field elements)
  const publicInputs: string[] = [];
  for (let i = 0; i < publicWitness.length; i += 32) {
    const chunk = publicWitness.slice(i, i + 32);
    publicInputs.push("0x" + chunk.toString("hex"));
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Sunspot] Proof generated in ${elapsed}ms`);
  console.log(`[Sunspot] Proof size: ${proof.length} bytes (vs 16KB for UltraHonk)`);

  return {
    proof: new Uint8Array(proof),
    publicWitness: new Uint8Array(publicWitness),
    publicInputs,
  };
}

/**
 * Load verification key for a circuit
 */
export function getVerificationKey(circuitType: CircuitType): Uint8Array {
  const circuitName = CIRCUIT_NAMES[circuitType];
  const vkPath = path.join(config.circuitsBasePath, "target", `${circuitName}.vk`);

  if (!fs.existsSync(vkPath)) {
    throw new Error(`VK not found: ${vkPath}. Run 'sunspot setup' first.`);
  }

  return new Uint8Array(fs.readFileSync(vkPath));
}

/**
 * Compute VK hash (keccak256)
 */
export async function getVkHash(circuitType: CircuitType): Promise<Uint8Array> {
  const vk = getVerificationKey(circuitType);
  const { keccak_256 } = await import("@noble/hashes/sha3");
  return new Uint8Array(keccak_256(vk));
}

/**
 * Verify a Groth16 proof locally
 */
export async function verifyGroth16Proof(
  circuitType: CircuitType,
  proof: Uint8Array,
  publicWitness: Uint8Array
): Promise<boolean> {
  if (isBrowser) {
    throw new Error("Sunspot browser verification not supported.");
  }

  const circuitName = CIRCUIT_NAMES[circuitType];
  const targetPath = path.join(config.circuitsBasePath, "target");
  const vkPath = path.join(targetPath, `${circuitName}.vk`);

  // Write temp files
  const tmpDir = os.tmpdir();
  const proofPath = path.join(tmpDir, `${circuitName}_verify.proof`);
  const pwPath = path.join(tmpDir, `${circuitName}_verify.pw`);

  fs.writeFileSync(proofPath, Buffer.from(proof));
  fs.writeFileSync(pwPath, Buffer.from(publicWitness));

  try {
    await runCommand(`${config.sunspotPath} verify ${vkPath} ${proofPath} ${pwPath}`);
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(proofPath);
      fs.unlinkSync(pwPath);
    } catch {}
  }
}

/**
 * Groth16 proof size (constant)
 */
export const GROTH16_PROOF_SIZE = 388;

/**
 * Check if proof can fit inline (without buffer)
 */
export function canFitInline(): boolean {
  return true; // 388 bytes easily fits in a TX
}

/**
 * Get deployed Sunspot verifier program ID
 */
export function getSunspotVerifierProgramId(): string {
  return process.env.SUNSPOT_VERIFIER_PROGRAM_ID || "3Sd1FJPA64zrUrbNQPFcsP7BXp2nu4ow3D1qaeZiwS1Y";
}

// ==========================================================================
// High-Level Proof Generation API (matches UltraHonk interface)
// ==========================================================================

import {
  computeNullifierSync,
  hashNullifierSync,
} from "../poseidon";

export interface MerkleProofInput {
  siblings: bigint[];
  indices: number[];
}

export interface ClaimInputs {
  privKey: bigint;
  pubKeyX: bigint;
  amount: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  recipient: bigint;
}

/**
 * Generate a Groth16 claim proof
 */
export async function generateClaimProofGroth16(inputs: ClaimInputs): Promise<SunspotProofResult> {
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  const circuitInputs: Record<string, string | string[]> = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: inputs.merkleProof.siblings.map((s) => s.toString()),
    path_indices: inputs.merkleProof.indices.map((i) => i.toString()),
    merkle_root: "0x" + inputs.merkleRoot.toString(16),
    nullifier_hash: "0x" + nullifierHash.toString(16),
    amount_pub: inputs.amount.toString(),
    recipient: "0x" + inputs.recipient.toString(16),
  };

  return generateGroth16Proof("claim", circuitInputs);
}

export interface SpendSplitInputs {
  privKey: bigint;
  pubKeyX: bigint;
  amount: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  output1PubKeyX: bigint;
  output1Amount: bigint;
  output2PubKeyX: bigint;
  output2Amount: bigint;
}

/**
 * Generate a Groth16 spend_split proof
 */
export async function generateSplitProofGroth16(inputs: SpendSplitInputs): Promise<SunspotProofResult> {
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  const circuitInputs: Record<string, string | string[]> = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: inputs.merkleProof.siblings.map((s) => s.toString()),
    path_indices: inputs.merkleProof.indices.map((i) => i.toString()),
    merkle_root: "0x" + inputs.merkleRoot.toString(16),
    nullifier_hash: "0x" + nullifierHash.toString(16),
    output1_pub_key_x: inputs.output1PubKeyX.toString(),
    output1_amount: inputs.output1Amount.toString(),
    output2_pub_key_x: inputs.output2PubKeyX.toString(),
    output2_amount: inputs.output2Amount.toString(),
  };

  return generateGroth16Proof("spend_split", circuitInputs);
}

export interface SpendPartialPublicInputs {
  privKey: bigint;
  pubKeyX: bigint;
  amount: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  merkleProof: MerkleProofInput;
  publicAmount: bigint;
  changePubKeyX: bigint;
  changeAmount: bigint;
  recipient: bigint;
}

/**
 * Generate a Groth16 spend_partial_public proof
 */
export async function generatePartialPublicProofGroth16(
  inputs: SpendPartialPublicInputs
): Promise<SunspotProofResult> {
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  const circuitInputs: Record<string, string | string[]> = {
    priv_key: inputs.privKey.toString(),
    pub_key_x: inputs.pubKeyX.toString(),
    amount: inputs.amount.toString(),
    leaf_index: inputs.leafIndex.toString(),
    merkle_path: inputs.merkleProof.siblings.map((s) => s.toString()),
    path_indices: inputs.merkleProof.indices.map((i) => i.toString()),
    merkle_root: "0x" + inputs.merkleRoot.toString(16),
    nullifier_hash: "0x" + nullifierHash.toString(16),
    public_amount: inputs.publicAmount.toString(),
    change_pub_key_x: inputs.changePubKeyX.toString(),
    change_amount: inputs.changeAmount.toString(),
    recipient: "0x" + inputs.recipient.toString(16),
  };

  return generateGroth16Proof("spend_partial_public", circuitInputs);
}
