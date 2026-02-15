#!/usr/bin/env bun
/**
 * Debug bb.js UltraHonk proof format
 * Determine exact structure and if conversion is needed
 */

import { initProver, initPoseidon, setCircuitPath, generateClaimProof, type ClaimInputs } from "@zvault/sdk";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BN254_Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function toBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + hex(bytes));
}

function checkG1_64(data: Uint8Array, offset: number): boolean {
  if (offset + 64 > data.length) return false;
  const x = toBigInt(data.slice(offset, offset + 32));
  const y = toBigInt(data.slice(offset + 32, offset + 64));
  if (x === 0n && y === 0n) return true;
  if (x >= BN254_Fq_MOD || y >= BN254_Fq_MOD) return false;
  return (y * y) % BN254_Fq_MOD === (x * x * x + 3n) % BN254_Fq_MOD;
}

function checkG1_128(data: Uint8Array, offset: number): boolean {
  if (offset + 128 > data.length) return false;
  const x_0 = toBigInt(data.slice(offset, offset + 32));
  const x_1 = toBigInt(data.slice(offset + 32, offset + 64));
  const y_0 = toBigInt(data.slice(offset + 64, offset + 96));
  const y_1 = toBigInt(data.slice(offset + 96, offset + 128));
  const x = (x_1 << 136n) + x_0;
  const y = (y_1 << 136n) + y_0;
  if (x === 0n && y === 0n) return true;
  if (x >= BN254_Fq_MOD || y >= BN254_Fq_MOD) return false;
  return (y * y) % BN254_Fq_MOD === (x * x * x + 3n) % BN254_Fq_MOD;
}

async function main() {
  console.log("Initializing...");
  await initPoseidon();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();

  console.log("\nGenerating proof...");
  const claimInputs: ClaimInputs = {
    privKey: 123n,
    pubKeyX: 456n,
    amount: 10000n,
    leafIndex: 0n,
    merkleRoot: toBigInt(new Uint8Array(32).fill(1)), // Non-zero root
    merkleProof: {
      siblings: Array(20).fill(toBigInt(new Uint8Array(32).fill(1))),
      indices: Array(20).fill(0),
    },
    recipient: 789n,
  };

  let proofData;
  try {
    proofData = await generateClaimProof(claimInputs);
  } catch (e) {
    console.log("Proof generation failed (expected for invalid inputs)");
    console.log("Using dummy proof structure for format analysis...");
    // Create a mock proof structure
    proofData = {
      proof: new Uint8Array(7680),
      publicInputs: Array(4).fill("0"),
    };
  }

  const proof = proofData.proof;
  console.log(`\nProof size: ${proof.length} bytes`);

  console.log("\n=== Checking 64-byte (affine) G1 format ===");
  const affineOffsets = [0, 64, 128, 192, 256, 320, 384, 448, 512, 576, 640, 704];
  let affineValid = 0;
  for (const offset of affineOffsets) {
    const valid = checkG1_64(proof, offset);
    if (valid) affineValid++;
    console.log(`Offset ${offset.toString().padStart(4)}: ${valid ? "✓ Valid" : "✗ Invalid"}`);
  }
  console.log(`Affine format: ${affineValid}/${affineOffsets.length} valid`);

  console.log("\n=== Checking 128-byte (split) G1 format ===");
  const splitOffsets = [0, 128, 256, 384, 512, 640, 768, 896, 1024, 1152, 1280];
  let splitValid = 0;
  for (const offset of splitOffsets) {
    const valid = checkG1_128(proof, offset);
    if (valid) splitValid++;
    console.log(`Offset ${offset.toString().padStart(4)}: ${valid ? "✓ Valid" : "✗ Invalid"}`);
  }
  console.log(`Split format: ${splitValid}/${splitOffsets.length} valid`);

  console.log("\n=== Structure Analysis ===");
  console.log(`First 32 bytes: ${hex(proof.slice(0, 32))}`);
  console.log(`Bytes 32-64:    ${hex(proof.slice(32, 64))}`);
  console.log(`Bytes 64-96:    ${hex(proof.slice(64, 96))}`);
  console.log(`Bytes 96-128:   ${hex(proof.slice(96, 128))}`);

  console.log("\n=== Preamble Analysis ===");
  console.log("Testing preamble sizes:");
  for (const size of [256, 512, 768]) {
    console.log(`\n  If preamble = ${size} bytes:`);
    console.log(`    Next 64 bytes (affine): ${checkG1_64(proof, size) ? "✓ Valid G1" : "✗ Invalid"}`);
    console.log(`    Next 128 bytes (split): ${checkG1_128(proof, size) ? "✓ Valid G1" : "✗ Invalid"}`);
  }

  console.log("\n=== Conclusion ===");
  if (affineValid > splitValid) {
    console.log("✅ Proof appears to be in AFFINE format (64-byte G1)");
    console.log("   No conversion needed!");
  } else if (splitValid > affineValid) {
    console.log("✅ Proof appears to be in SPLIT format (128-byte G1)");
    console.log("   Conversion needed to affine format");
  } else {
    console.log("⚠️  Unable to determine format - may need manual inspection");
  }
}

main().catch(console.error);
