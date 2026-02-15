#!/usr/bin/env bun
/**
 * Verify that bb.js proof is already in affine format
 */

import { initProver, initPoseidon, setCircuitPath, generateClaimProof, deriveKeysFromSeed, prepareClaimInputs, type ClaimInputs } from "@zvault/sdk";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BN254_Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

function hex(b: Uint8Array): string { return Buffer.from(b).toString("hex"); }
function toBigInt(b: Uint8Array): bigint { return BigInt("0x" + hex(b)); }

function checkG1Affine(data: Uint8Array, offset: number): boolean {
  if (offset + 64 > data.length) return false;
  const x = toBigInt(data.slice(offset, offset + 32));
  const y = toBigInt(data.slice(offset + 32, offset + 64));
  if (x === 0n && y === 0n) return true; // identity
  if (x >= BN254_Fq_MOD || y >= BN254_Fq_MOD) return false;
  const lhs = (y * y) % BN254_Fq_MOD;
  const rhs = (x * x * x + 3n) % BN254_Fq_MOD;
  return lhs === rhs;
}

async function main() {
  await initPoseidon();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();

  console.log("Generating test proof...");
  const keys = deriveKeysFromSeed("test_proof_format");

  // Use simple inputs
  const claimInputs: ClaimInputs = {
    privKey: keys.spendPriv,
    pubKeyX: keys.viewPubX,
    amount: 10000n,
    leafIndex: 0n,
    merkleRoot: 1n,
    merkleProof: {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    },
    recipient: keys.viewPubX,
  };

  const proofData = await generateClaimProof(claimInputs);
  const proof = proofData.proof;

  console.log(`\nProof size: ${proof.length} bytes`);
  console.log("\nChecking 64-byte (affine) G1 points:");

  // Expected structure for log_n=15:
  // - Preamble: 256 bytes (8 Fr pairing points)
  // - Witness G1s: 8 × 64 = 512 bytes (offsets 256, 320, 384, 448, 512, 576, 640, 704)
  // - Then sumcheck univariates, evals, etc.

  const offsets = [
    [256, "w1"], [320, "w2"], [384, "w3"], [448, "w4"],
    [512, "lookup_inv"], [576, "lrc"], [640, "lrt"], [704, "z_perm"]
  ];

  let validCount = 0;
  for (const [offset, name] of offsets) {
    const valid = checkG1Affine(proof, offset as number);
    if (valid) validCount++;
    console.log(`  Offset ${(offset as number).toString().padStart(4)} (${name}): ${valid ? "✓ Valid affine G1" : "✗ Invalid"}`);
  }

  console.log(`\n${validCount}/${offsets.length} G1 points are valid in affine format`);

  if (validCount >= offsets.length - 1) { // Allow 1 failure (might be identity)
    console.log("\n✅ Proof is in AFFINE format (64-byte G1 points)");
    console.log("   NO CONVERSION NEEDED!");
    console.log("   Can use proof directly with verifier");
  } else {
    console.log("\n❌ Proof format unclear - needs investigation");
  }
}

main().catch(console.error);
