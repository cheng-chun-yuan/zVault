/**
 * Compile All Circuits Script
 *
 * Compiles all zVault Noir circuits using the workspace.
 */

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const circuitsDir = join(__dirname, "..");

const circuits = [
  "zvault_claim",
  "zvault_spend_split",
  "zvault_spend_partial_public",
  "zvault_pool_deposit",
  "zvault_pool_withdraw",
  "zvault_pool_claim_yield",
  "zvault_proof_of_innocence",
];

async function main() {
  console.log("zVault Noir Circuit Compilation");
  console.log("================================");
  console.log(`Working directory: ${circuitsDir}`);
  console.log();

  const compileArg = process.argv[2];

  try {
    if (!compileArg || compileArg === "all") {
      // Compile all circuits using workspace
      console.log("Compiling all circuits...");
      execSync("nargo compile --workspace", {
        cwd: circuitsDir,
        stdio: "inherit",
      });
      console.log("\nAll circuits compiled successfully!");
    } else if (circuits.includes(compileArg) || circuits.includes(`zvault_${compileArg}`)) {
      // Compile specific circuit
      const circuitName = compileArg.startsWith("zvault_") ? compileArg : `zvault_${compileArg}`;
      console.log(`Compiling ${circuitName}...`);
      execSync(`nargo compile -p ${circuitName}`, {
        cwd: circuitsDir,
        stdio: "inherit",
      });
      console.log(`\n${circuitName} compiled successfully!`);
    } else {
      console.error(`Unknown circuit: ${compileArg}`);
      console.log("\nAvailable circuits:");
      circuits.forEach((c) => console.log(`  - ${c.replace("zvault_", "")}`));
      console.log("\nUsage: bun run scripts/compile-all.ts [circuit|all]");
      process.exit(1);
    }
  } catch (error: any) {
    console.error("\nCompilation failed:", error.message);
    process.exit(1);
  }
}

main();
