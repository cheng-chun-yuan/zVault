/**
 * Noir Integration Test Script
 *
 * Tests the end-to-end flow of Noir proof generation and contract interaction.
 *
 * Flow:
 * 1. Generate a note with random secrets
 * 2. Compute valid inputs using Noir helper circuit
 * 3. Generate a Noir UltraHonk proof
 * 4. Submit to contract for format validation
 *
 * Note: Solana doesn't have native UltraHonk verification.
 * The contract validates proof format and public inputs.
 * Full cryptographic verification is done off-chain.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const NOIR_CIRCUITS_DIR = join(__dirname, "../noir-circuits");

// Circuit types
type CircuitType = "claim" | "transfer" | "split" | "partial_withdraw";

interface NoirProof {
  proof: Uint8Array;
  publicInputs: string[];
  verificationKey: Uint8Array;
  vkHash: Uint8Array;
}

// Test values matching the helpers circuit
const TEST_VALUES = {
  nullifier: "12345",
  secret: "67890",
  amount: "1000000",
};

/**
 * Execute nargo to compile and run witness generation
 */
function executeCircuit(circuitType: CircuitType): boolean {
  const circuitPath = join(NOIR_CIRCUITS_DIR, circuitType);
  try {
    console.log(`  Executing ${circuitType} circuit with nargo...`);
    execSync("nargo execute", { cwd: circuitPath, stdio: "pipe" });
    return true;
  } catch (error: any) {
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

/**
 * Generate proof using bb CLI (with inline verification)
 */
function generateProof(circuitType: CircuitType): NoirProof | null {
  const circuitPath = join(NOIR_CIRCUITS_DIR, circuitType);
  const bbPath = join(NOIR_CIRCUITS_DIR, "node_modules/.bin/bb");
  const bytecode = join(circuitPath, "target", `zvault_${circuitType}.json`);
  const witness = join(circuitPath, "target", `zvault_${circuitType}.gz`);
  const proofsDir = join(circuitPath, "proofs", "proof");

  try {
    console.log(`  Generating and verifying proof...`);
    // Use --verify flag to verify inline (this is how prove.ts does it)
    execSync(
      `"${bbPath}" prove -b "${bytecode}" -w "${witness}" -o "${proofsDir}" --write_vk --verify`,
      { cwd: circuitPath, stdio: "pipe" }
    );

    // Read proof files
    const proof = readFileSync(join(proofsDir, "proof"));
    const publicInputsBinary = readFileSync(join(proofsDir, "public_inputs"));

    // Parse binary public inputs (each is 32 bytes)
    const publicInputs: string[] = [];
    for (let i = 0; i < publicInputsBinary.length; i += 32) {
      const fieldBytes = publicInputsBinary.slice(i, i + 32);
      const hex = "0x" + Array.from(fieldBytes).map(b => b.toString(16).padStart(2, "0")).join("");
      publicInputs.push(hex);
    }

    const verificationKey = readFileSync(join(proofsDir, "vk"));
    const vkHash = readFileSync(join(proofsDir, "vk_hash"));

    return {
      proof: new Uint8Array(proof),
      publicInputs,
      verificationKey: new Uint8Array(verificationKey),
      vkHash: new Uint8Array(vkHash),
    };
  } catch (error: any) {
    console.error(`  Error generating proof: ${error.message}`);
    return null;
  }
}

/**
 * Validate proof format matches contract expectations
 */
function validateProofFormat(proof: NoirProof, circuitType: CircuitType): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check proof size (UltraHonk proofs are ~16KB)
  if (proof.proof.length < 1000 || proof.proof.length > 50000) {
    errors.push(
      `Invalid proof size: ${proof.proof.length} bytes (expected 1000-50000)`
    );
  }

  // Check VK hash (32 bytes)
  if (proof.vkHash.length !== 32) {
    errors.push(`Invalid VK hash length: ${proof.vkHash.length} (expected 32)`);
  }

  // Check public inputs count based on circuit type
  const expectedPublicInputs: Record<CircuitType, number> = {
    claim: 3, // merkle_root, nullifier_hash, amount
    transfer: 3, // merkle_root, nullifier_hash, output_commitment
    split: 4, // merkle_root, input_nullifier_hash, output1, output2
    partial_withdraw: 5, // merkle_root, nullifier_hash, amount, change, recipient
  };

  if (proof.publicInputs.length < expectedPublicInputs[circuitType]) {
    errors.push(
      `Insufficient public inputs: ${proof.publicInputs.length} (expected >= ${expectedPublicInputs[circuitType]})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Convert proof to contract format
 */
function proofToContractFormat(proof: NoirProof): {
  proofBytes: number[];
  publicInputs: number[][];
  vkHash: number[];
} {
  return {
    proofBytes: Array.from(proof.proof),
    publicInputs: proof.publicInputs.map((pi) => {
      // Convert hex string to 32-byte array
      const cleanHex = pi.startsWith("0x") ? pi.slice(2) : pi;
      const bytes = new Uint8Array(32);
      const hexPadded = cleanHex.padStart(64, "0");
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hexPadded.substr(i * 2, 2), 16);
      }
      return Array.from(bytes);
    }),
    vkHash: Array.from(proof.vkHash),
  };
}

async function main() {
  console.log("==============================================");
  console.log("      Noir Integration Test");
  console.log("==============================================\n");

  const circuits: CircuitType[] = ["claim", "transfer", "split", "partial_withdraw"];
  const results: { circuit: CircuitType; success: boolean; proof?: NoirProof }[] = [];

  for (const circuit of circuits) {
    console.log(`\n--- Testing ${circuit.toUpperCase()} Circuit ---`);

    // Check if circuit is compiled
    const bytecodeFile = join(
      NOIR_CIRCUITS_DIR,
      circuit,
      "target",
      `zvault_${circuit}.json`
    );
    if (!existsSync(bytecodeFile)) {
      console.log(`  ⚠️ Circuit not compiled. Run: cd noir-circuits/${circuit} && nargo compile`);
      results.push({ circuit, success: false });
      continue;
    }
    console.log("  ✓ Circuit compiled");

    // Execute circuit (generate witness)
    if (!executeCircuit(circuit)) {
      results.push({ circuit, success: false });
      continue;
    }
    console.log("  ✓ Witness generated");

    // Generate and verify proof (verification is inline with --verify flag)
    const proof = generateProof(circuit);
    if (!proof) {
      results.push({ circuit, success: false });
      continue;
    }
    console.log(`  ✓ Proof generated and verified (${proof.proof.length} bytes)`);

    // Validate format for contract
    const formatCheck = validateProofFormat(proof, circuit);
    if (!formatCheck.valid) {
      console.log("  ✗ Proof format invalid:");
      formatCheck.errors.forEach((e) => console.log(`    - ${e}`));
      results.push({ circuit, success: false });
      continue;
    }
    console.log("  ✓ Proof format valid for contract");

    // Show public inputs
    console.log(`  Public inputs (${proof.publicInputs.length}):`);
    proof.publicInputs.forEach((pi, i) => {
      const shortened = pi.length > 20 ? pi.slice(0, 10) + "..." + pi.slice(-8) : pi;
      console.log(`    [${i}]: ${shortened}`);
    });

    // Convert to contract format
    const contractFormat = proofToContractFormat(proof);
    console.log(`  Contract format: ${contractFormat.proofBytes.length} proof bytes, ${contractFormat.publicInputs.length} public inputs`);

    results.push({ circuit, success: true, proof });
  }

  // Summary
  console.log("\n==============================================");
  console.log("                 SUMMARY");
  console.log("==============================================");

  const successful = results.filter((r) => r.success).length;
  console.log(`\n  Total: ${results.length} circuits`);
  console.log(`  Passed: ${successful}`);
  console.log(`  Failed: ${results.length - successful}`);

  results.forEach((r) => {
    const status = r.success ? "✓" : "✗";
    const proofSize = r.proof ? ` (${r.proof.proof.length} bytes)` : "";
    console.log(`  ${status} ${r.circuit}${proofSize}`);
  });

  if (successful === results.length) {
    console.log("\n✅ All Noir circuits tested successfully!");
    console.log("\nNext steps:");
    console.log("  1. Run localnet: solana-test-validator");
    console.log("  2. Deploy contract: anchor deploy");
    console.log("  3. Run integration test: anchor test");
  } else {
    console.log("\n⚠️ Some circuits failed. Check errors above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
