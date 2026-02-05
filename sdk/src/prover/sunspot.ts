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
import { computeUnifiedCommitmentSync } from "../poseidon";

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

// Default paths (guarded for browser where path/os are empty objects)
const DEFAULT_SUNSPOT_PATH = isBrowser ? "" : path.join(os.homedir(), "sunspot", "go", "sunspot");

let config: SunspotConfig = {
  sunspotPath: DEFAULT_SUNSPOT_PATH,
  circuitsBasePath: isBrowser ? "" : path.resolve(__dirname, "../../../circuits"),
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

  // Witness is generated in the target directory
  let witnessPath = path.join(targetPath, "witness.gz");

  // If circuitPath is a symlink, nargo writes to the resolved path's parent target
  // Always copy fresh witness to ensure we have the latest
  const realCircuitPath = fs.realpathSync(circuitPath);
  const realParentTarget = path.join(path.dirname(realCircuitPath), "target");
  const altWitnessPath = path.join(realParentTarget, "witness.gz");
  if (fs.existsSync(altWitnessPath)) {
    // Always copy fresh witness to SDK target directory
    fs.copyFileSync(altWitnessPath, witnessPath);
  }

  if (!fs.existsSync(witnessPath)) {
    throw new Error(`Witness not generated at ${witnessPath}`);
  }

  // Step 3: Run sunspot prove (use absolute paths)
  console.log(`[Sunspot] Generating Groth16 proof...`);
  const absAcirPath = path.resolve(acirPath);
  const absWitnessPath = path.resolve(witnessPath);
  const absCcsPath = path.resolve(ccsPath);
  const absPkPath = path.resolve(pkPath);

  await runCommand(
    `${config.sunspotPath} prove "${absAcirPath}" "${absWitnessPath}" "${absCcsPath}" "${absPkPath}"`,
    targetPath
  );

  // Read outputs
  const proofPath = path.join(targetPath, `${circuitName}.proof`);
  const pwPath = path.join(targetPath, `${circuitName}.pw`);

  if (!fs.existsSync(proofPath) || !fs.existsSync(pwPath)) {
    throw new Error("Sunspot proof generation failed");
  }

  // Read raw proof (gnark format: A(64) + B(128) + C(64) + nb_commitments(4,BE) + commitments(N×64) + commitment_pok(64))
  // Pass through unchanged — the on-chain verifier expects the full gnark proof format
  const proof = fs.readFileSync(proofPath);
  const publicWitness = fs.readFileSync(pwPath);

  // Extract public inputs from the public witness file
  // gnark witness format: header(12 bytes) + NR_INPUTS × 32-byte field elements (big-endian)
  // Header: nbPublic(u32 BE) + nbSecret(u32 BE) + vectorLen(u32 BE)
  const PW_HEADER_SIZE = 12;
  const publicInputs: string[] = [];
  if (publicWitness.length > PW_HEADER_SIZE) {
    for (let i = PW_HEADER_SIZE; i < publicWitness.length; i += 32) {
      const chunk = publicWitness.slice(i, i + 32);
      publicInputs.push("0x" + chunk.toString("hex"));
    }
  }
  console.log(`[Sunspot] Proof: ${proof.length} bytes, Public inputs: ${publicInputs.length}`);

  const elapsed = Date.now() - startTime;
  console.log(`[Sunspot] Proof generated in ${elapsed}ms`);
  console.log(`[Sunspot] Proof size: ${proof.length} bytes`);

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
// High-Level Proof Generation API
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
  // Stealth output metadata (for on-chain announcement)
  output1EphemeralPubX?: bigint;
  output1EncryptedAmountWithSign?: bigint;
  output2EphemeralPubX?: bigint;
  output2EncryptedAmountWithSign?: bigint;
}

/**
 * Generate a Groth16 spend_split proof
 */
export async function generateSplitProofGroth16(inputs: SpendSplitInputs): Promise<SunspotProofResult> {
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Compute output commitments: Poseidon(pubKeyX, amount)
  const outputCommitment1 = computeUnifiedCommitmentSync(inputs.output1PubKeyX, inputs.output1Amount);
  const outputCommitment2 = computeUnifiedCommitmentSync(inputs.output2PubKeyX, inputs.output2Amount);

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
    // Public inputs: output commitments
    output_commitment1: "0x" + outputCommitment1.toString(16),
    output_commitment2: "0x" + outputCommitment2.toString(16),
    // Stealth metadata (public inputs for on-chain announcement)
    output1_ephemeral_pub_x: (inputs.output1EphemeralPubX ?? 0n).toString(),
    output1_encrypted_amount_with_sign: (inputs.output1EncryptedAmountWithSign ?? 0n).toString(),
    output2_ephemeral_pub_x: (inputs.output2EphemeralPubX ?? 0n).toString(),
    output2_encrypted_amount_with_sign: (inputs.output2EncryptedAmountWithSign ?? 0n).toString(),
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
  // Stealth output metadata (for on-chain announcement)
  changeEphemeralPubX?: bigint;
  changeEncryptedAmountWithSign?: bigint;
}

/**
 * Generate a Groth16 spend_partial_public proof
 */
export async function generatePartialPublicProofGroth16(
  inputs: SpendPartialPublicInputs
): Promise<SunspotProofResult> {
  const nullifier = computeNullifierSync(inputs.privKey, inputs.leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);

  // Compute change commitment: Poseidon(changePubKeyX, changeAmount)
  const changeCommitment = computeUnifiedCommitmentSync(inputs.changePubKeyX, inputs.changeAmount);

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
    // Public inputs
    change_commitment: "0x" + changeCommitment.toString(16),
    recipient: "0x" + inputs.recipient.toString(16),
    // Stealth metadata (public inputs for on-chain announcement)
    change_ephemeral_pub_x: (inputs.changeEphemeralPubX ?? 0n).toString(),
    change_encrypted_amount_with_sign: (inputs.changeEncryptedAmountWithSign ?? 0n).toString(),
  };

  return generateGroth16Proof("spend_partial_public", circuitInputs);
}
