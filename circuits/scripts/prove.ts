/**
 * Noir Proof Generation Script
 *
 * Generates and verifies proofs for zVault circuits using nargo + bb CLI
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const circuitsDir = join(__dirname, "..");
const bbPath = join(circuitsDir, "node_modules", ".bin", "bb");

type CircuitName =
  | "claim"
  | "spend_split"
  | "spend_partial_public"
  | "pool_deposit"
  | "pool_withdraw"
  | "pool_claim_yield"
  | "proof_of_innocence";

const circuitNames: CircuitName[] = [
  "claim",
  "spend_split",
  "spend_partial_public",
  "pool_deposit",
  "pool_withdraw",
  "pool_claim_yield",
  "proof_of_innocence",
];

/**
 * Execute a circuit with nargo to generate witness
 */
function executeCircuit(name: CircuitName): boolean {
  const circuitPath = join(circuitsDir, name);

  try {
    console.log("  Executing circuit with nargo...");
    execSync("nargo execute", {
      cwd: circuitPath,
      stdio: "pipe",
    });
    return true;
  } catch (error: any) {
    console.error(`  Error executing circuit: ${error.message}`);
    return false;
  }
}

/**
 * Generate proof using bb CLI
 */
function generateProof(name: CircuitName): boolean {
  const packageName = `zvault_${name}`;
  const bytecode = join(circuitsDir, "target", `${packageName}.json`);
  const witness = join(circuitsDir, "target", `${packageName}.gz`);
  const proofsDir = join(circuitsDir, name, "proofs");
  const proofPath = join(proofsDir, "proof");

  // Create proofs directory if needed
  if (!existsSync(proofsDir)) {
    mkdirSync(proofsDir, { recursive: true });
  }

  try {
    console.log("  Generating proof...");
    // Use the new bb prove command with --write_vk to also generate verification key
    execSync(
      `"${bbPath}" prove -b "${bytecode}" -w "${witness}" -o "${proofPath}" --write_vk --verify`,
      {
        cwd: circuitsDir,
        stdio: "pipe",
      }
    );
    return true;
  } catch (error: any) {
    console.error(`  Error generating proof: ${error.message}`);
    if (error.stderr) {
      console.error(`  stderr: ${error.stderr.toString()}`);
    }
    return false;
  }
}

/**
 * Full prove and verify flow for a circuit
 */
async function proveCircuit(name: CircuitName) {
  console.log(`\n=== ${name.toUpperCase()} Circuit ===`);

  const packageName = `zvault_${name}`;
  const bytecode = join(circuitsDir, "target", `${packageName}.json`);

  if (!existsSync(bytecode)) {
    console.error(
      `  Circuit not compiled. Run 'nargo compile -p ${packageName}' first`
    );
    return false;
  }
  console.log("  Circuit artifact found");

  // Execute to generate witness
  const circuitPath = join(circuitsDir, name);
  const proverToml = join(circuitPath, "Prover.toml");
  if (!existsSync(proverToml)) {
    console.error(`  Prover.toml not found at ${proverToml}`);
    console.log("  Create a Prover.toml with circuit inputs to generate proofs");
    return false;
  }

  if (!executeCircuit(name)) {
    return false;
  }
  console.log("  Witness generated");

  // Generate proof (with --verify flag to also verify)
  if (!generateProof(name)) {
    return false;
  }
  console.log("  Proof generated and verified!");

  // Get proof size
  const proofsDir = join(circuitsDir, name, "proofs", "proof");
  const proofFile = join(proofsDir, "proof");
  if (existsSync(proofFile)) {
    const proofData = readFileSync(proofFile);
    console.log(`  Proof size: ${proofData.length} bytes`);
  }

  return true;
}

async function main() {
  console.log("zVault Noir Proof Generation");
  console.log("============================");
  console.log("Using nargo + bb CLI");

  const circuitArg = process.argv[2] as CircuitName | "all" | undefined;

  let allPassed = true;

  try {
    if (!circuitArg || circuitArg === "all") {
      for (const circuit of circuitNames) {
        const passed = await proveCircuit(circuit);
        if (!passed) allPassed = false;
      }
    } else if (circuitNames.includes(circuitArg as CircuitName)) {
      allPassed = await proveCircuit(circuitArg as CircuitName);
    } else {
      console.error(`Unknown circuit: ${circuitArg}`);
      console.log("\nAvailable circuits:");
      circuitNames.forEach((c) => console.log(`  - ${c}`));
      console.log(
        "\nUsage: bun run prove [claim|spend_split|spend_partial_public|pool_deposit|pool_withdraw|pool_claim_yield|proof_of_innocence|all]"
      );
      process.exit(1);
    }

    if (allPassed) {
      console.log("\nAll proofs generated and verified successfully!");
    } else {
      console.log("\nSome proofs failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
