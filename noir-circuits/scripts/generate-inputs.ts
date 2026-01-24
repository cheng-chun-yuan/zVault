/**
 * Generate Valid Circuit Inputs
 *
 * Computes valid inputs for Noir circuits using Poseidon2 hash that matches
 * Noir's native implementation (BN254 curve).
 */

import { poseidon2Hash } from "@zkpassport/poseidon2";
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const circuitsDir = join(__dirname, "..");

type CircuitName = "claim" | "transfer" | "split" | "partial_withdraw";

interface TestInputs {
  [key: string]: string | string[];
}

/**
 * Compute Poseidon2 hash (matches Noir's implementation)
 */
async function poseidon2(inputs: bigint[]): Promise<bigint> {
  return await poseidon2Hash(inputs);
}

/**
 * Compute Merkle root from a leaf with zero siblings
 */
async function computeMerkleRoot(
  leaf: bigint,
  depth: number = 10
): Promise<{ root: bigint; path: bigint[]; indices: number[] }> {
  const path: bigint[] = new Array(depth).fill(0n);
  const indices: number[] = new Array(depth).fill(0);

  let current = leaf;
  for (let i = 0; i < depth; i++) {
    // Position 0 means leaf is on the left
    current = await poseidon2([current, 0n]);
  }

  return { root: current, path, indices };
}

/**
 * Generate claim circuit inputs with proper Poseidon2 hashes
 */
async function generateClaimInputs(): Promise<TestInputs> {
  // Private inputs (known values)
  const nullifier = 12345n;
  const secret = 67890n;
  const amount = 1000000n;

  // Compute note and commitment
  const note = await poseidon2([nullifier, secret]);
  const commitment = await poseidon2([note, amount]);

  // Compute nullifier hash
  const nullifierHash = await poseidon2([nullifier]);

  // Compute Merkle root with commitment as leaf
  const { root, path, indices } = await computeMerkleRoot(commitment);

  return {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    amount: amount.toString(),
    merkle_path: path.map(p => p.toString()),
    path_indices: indices.map(i => i.toString()),
    merkle_root: root.toString(),
    nullifier_hash: nullifierHash.toString(),
    amount_pub: amount.toString()
  };
}

/**
 * Generate transfer circuit inputs with proper Poseidon2 hashes
 */
async function generateTransferInputs(): Promise<TestInputs> {
  const nullifier = 12345n;
  const secret = 67890n;
  const amount = 1000000n;
  const outputNullifier = 11111n;
  const outputSecret = 22222n;

  // Compute input commitment
  const inputNote = await poseidon2([nullifier, secret]);
  const inputCommitment = await poseidon2([inputNote, amount]);

  // Compute nullifier hash
  const nullifierHash = await poseidon2([nullifier]);

  // Compute output commitment
  const outputNote = await poseidon2([outputNullifier, outputSecret]);
  const outputCommitment = await poseidon2([outputNote, amount]);

  // Compute Merkle root
  const { root, path, indices } = await computeMerkleRoot(inputCommitment);

  return {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    amount: amount.toString(),
    merkle_path: path.map(p => p.toString()),
    path_indices: indices.map(i => i.toString()),
    output_nullifier: outputNullifier.toString(),
    output_secret: outputSecret.toString(),
    merkle_root: root.toString(),
    nullifier_hash: nullifierHash.toString(),
    output_commitment: outputCommitment.toString()
  };
}

/**
 * Generate split circuit inputs with proper Poseidon2 hashes
 */
async function generateSplitInputs(): Promise<TestInputs> {
  const inputNullifier = 12345n;
  const inputSecret = 67890n;
  const inputAmount = 100000000n; // 1 BTC in sats

  const output1Nullifier = 11111n;
  const output1Secret = 22222n;
  const output1Amount = 60000000n; // 0.6 BTC

  const output2Nullifier = 33333n;
  const output2Secret = 44444n;
  const output2Amount = 40000000n; // 0.4 BTC

  // Compute input commitment
  const inputNote = await poseidon2([inputNullifier, inputSecret]);
  const inputCommitment = await poseidon2([inputNote, inputAmount]);

  // Compute nullifier hash
  const inputNullifierHash = await poseidon2([inputNullifier]);

  // Compute output commitments
  const output1Note = await poseidon2([output1Nullifier, output1Secret]);
  const outputCommitment1 = await poseidon2([output1Note, output1Amount]);

  const output2Note = await poseidon2([output2Nullifier, output2Secret]);
  const outputCommitment2 = await poseidon2([output2Note, output2Amount]);

  // Compute Merkle root
  const { root, path, indices } = await computeMerkleRoot(inputCommitment);

  return {
    input_nullifier: inputNullifier.toString(),
    input_secret: inputSecret.toString(),
    input_amount: inputAmount.toString(),
    merkle_path: path.map(p => p.toString()),
    path_indices: indices.map(i => i.toString()),
    output1_nullifier: output1Nullifier.toString(),
    output1_secret: output1Secret.toString(),
    output1_amount: output1Amount.toString(),
    output2_nullifier: output2Nullifier.toString(),
    output2_secret: output2Secret.toString(),
    output2_amount: output2Amount.toString(),
    merkle_root: root.toString(),
    input_nullifier_hash: inputNullifierHash.toString(),
    output_commitment1: outputCommitment1.toString(),
    output_commitment2: outputCommitment2.toString()
  };
}

/**
 * Generate partial withdraw circuit inputs
 */
function generatePartialWithdrawInputs(): TestInputs {
  const nullifier = "12345";
  const secret = "67890";
  const amount = "100000000"; // 1 BTC

  const withdrawAmount = "30000000"; // 0.3 BTC
  const changeNullifier = "11111";
  const changeSecret = "22222";
  const changeAmount = "70000000"; // 0.7 BTC

  const recipient = "99999";

  const merklePath = Array(10).fill("0");
  const pathIndices = Array(10).fill("0");

  return {
    nullifier,
    secret,
    amount,
    merkle_path: merklePath,
    path_indices: pathIndices,
    change_nullifier: changeNullifier,
    change_secret: changeSecret,
    change_amount: changeAmount,
    merkle_root: "0",
    nullifier_hash: "0",
    withdraw_amount: withdrawAmount,
    change_commitment: "0",
    recipient
  };
}

/**
 * Convert inputs to Prover.toml format
 */
function toProverToml(inputs: TestInputs): string {
  const lines: string[] = [];

  // Sort keys for consistent output
  const keys = Object.keys(inputs).sort();

  for (const key of keys) {
    const value = inputs[key];
    if (Array.isArray(value)) {
      lines.push(`${key} = [${value.map(v => `"${v}"`).join(", ")}]`);
    } else {
      lines.push(`${key} = "${value}"`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Run nargo execute to compute witness and get public outputs
 */
function runNargoExecute(circuitName: CircuitName): boolean {
  const circuitPath = join(circuitsDir, circuitName);

  try {
    console.log(`  Running nargo execute...`);
    execSync("nargo execute", {
      cwd: circuitPath,
      stdio: "pipe"
    });
    return true;
  } catch (error: any) {
    console.error(`  Error executing circuit: ${error.message}`);
    if (error.stderr) {
      console.error(`  stderr: ${error.stderr.toString()}`);
    }
    return false;
  }
}

/**
 * Run nargo prove to generate a proof
 */
function runNargoProve(circuitName: CircuitName): boolean {
  const circuitPath = join(circuitsDir, circuitName);

  try {
    console.log(`  Running nargo prove...`);
    execSync("nargo prove", {
      cwd: circuitPath,
      stdio: "pipe"
    });
    return true;
  } catch (error: any) {
    console.error(`  Error proving circuit: ${error.message}`);
    if (error.stderr) {
      console.error(`  stderr: ${error.stderr.toString()}`);
    }
    return false;
  }
}

/**
 * Run nargo verify to verify a proof
 */
function runNargoVerify(circuitName: CircuitName): boolean {
  const circuitPath = join(circuitsDir, circuitName);

  try {
    console.log(`  Running nargo verify...`);
    execSync("nargo verify", {
      cwd: circuitPath,
      stdio: "pipe"
    });
    return true;
  } catch (error: any) {
    console.error(`  Error verifying proof: ${error.message}`);
    if (error.stderr) {
      console.error(`  stderr: ${error.stderr.toString()}`);
    }
    return false;
  }
}

/**
 * Generate inputs and write Prover.toml for a circuit
 */
function setupCircuit(circuitName: CircuitName): TestInputs {
  console.log(`\n=== ${circuitName.toUpperCase()} Circuit ===`);

  let inputs: TestInputs;

  switch (circuitName) {
    case "claim":
      inputs = generateClaimInputs();
      break;
    case "transfer":
      inputs = generateTransferInputs();
      break;
    case "split":
      inputs = generateSplitInputs();
      break;
    case "partial_withdraw":
      inputs = generatePartialWithdrawInputs();
      break;
    default:
      throw new Error(`Unknown circuit: ${circuitName}`);
  }

  // Write Prover.toml
  const proverPath = join(circuitsDir, circuitName, "Prover.toml");
  writeFileSync(proverPath, toProverToml(inputs));
  console.log(`✓ Prover.toml written`);

  return inputs;
}

async function main() {
  console.log("zVault Noir Input Generation");
  console.log("============================");

  const circuitArg = process.argv[2];
  const circuits: CircuitName[] = circuitArg && circuitArg !== "all"
    ? [circuitArg as CircuitName]
    : ["claim", "transfer", "split", "partial_withdraw"];

  let allPassed = true;

  for (const circuit of circuits) {
    try {
      setupCircuit(circuit);

      // Execute to compute witness
      const executeOk = runNargoExecute(circuit);
      if (executeOk) {
        console.log(`✓ Witness computed`);

        // Generate proof
        const proveOk = runNargoProve(circuit);
        if (proveOk) {
          console.log(`✓ Proof generated`);

          // Verify proof
          const verifyOk = runNargoVerify(circuit);
          if (verifyOk) {
            console.log(`✓ Proof verified`);
          } else {
            console.log(`✗ Proof verification failed`);
            allPassed = false;
          }
        } else {
          console.log(`✗ Proof generation failed`);
          allPassed = false;
        }
      } else {
        console.log(`✗ Witness generation failed`);
        allPassed = false;
      }
    } catch (error) {
      console.error(`Error processing ${circuit}:`, error);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("\n✅ All circuits processed successfully!");
  } else {
    console.log("\n⚠️ Some circuits failed");
    process.exit(1);
  }
}

main();
