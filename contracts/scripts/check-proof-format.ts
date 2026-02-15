#!/usr/bin/env bun
/**
 * Quick diagnostic to check bb.js proof format
 */

import { initProver, initPoseidon, setCircuitPath, generateClaimProof, deriveKeysFromSeed, prepareClaimInputs, type ClaimInputs } from "@zvault/sdk";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BN254_Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

function bytesToBigintBE(b: Uint8Array): bigint {
  let hex = "0x";
  for (const byte of b) hex += byte.toString(16).padStart(2, "0");
  return BigInt(hex);
}

function checkG1OnCurve64(data: Uint8Array, offset: number): boolean {
  if (offset + 64 > data.length) return false;
  const x = bytesToBigintBE(data.slice(offset, offset + 32));
  const y = bytesToBigintBE(data.slice(offset + 32, offset + 64));
  if (x === 0n && y === 0n) return true; // identity
  if (x >= BN254_Fq_MOD || y >= BN254_Fq_MOD) return false;
  const lhs = y * y % BN254_Fq_MOD;
  const rhs = (x * x * x + 3n) % BN254_Fq_MOD;
  return lhs === rhs;
}

async function main() {
  await initPoseidon();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();

  // Generate dummy proof
  const claimInputs: ClaimInputs = {
    privKey: 1n,
    pubKeyX: 1n,
    amount: 10000n,
    leafIndex: 0n,
    merkleRoot: 1n,
    merkleProof: {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    },
    recipient: 1n,
  };

  const proofData = await generateClaimProof(claimInputs);
  const proof = proofData.proof;

  console.log(`\nProof size: ${proof.length} bytes`);
  console.log(`\nChecking affine format (64-byte G1 points):`);

  // Check if G1 points at various offsets are valid in affine format
  for (const offset of [0, 64, 128, 192, 256, 320, 384, 448, 512]) {
    const valid = checkG1OnCurve64(proof, offset);
    console.log(`  Offset ${offset.toString().padStart(4)}: ${valid ? "✓ Valid affine G1" : "✗ Invalid"}`);
  }

  console.log(`\nFirst 512 bytes (hex):`);
  console.log(Buffer.from(proof.slice(0, Math.min(512, proof.length))).toString("hex"));

  console.log(`\nBytes at offset 256-320 (first potential G1 witness):`);
  console.log(Buffer.from(proof.slice(256, 320)).toString("hex"));
}

main();
