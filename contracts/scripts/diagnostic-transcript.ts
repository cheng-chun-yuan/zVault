#!/usr/bin/env bun
/**
 * Diagnostic: Compare Solidity transcript vs our Rust transcript
 *
 * Generates a proof, verifies with bb.js, then computes step-by-step
 * challenge values for both the Solidity protocol and our Rust verifier
 * to pinpoint the divergence causing the pairing check failure.
 *
 * Run: bun run scripts/diagnostic-transcript.ts
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SDK imports
import {
  initProver,
  setCircuitPath,
  generateClaimProof,
  cleanupProver,
  initPoseidon,
  poseidonHashSync,
  deriveKeysFromSeed,
  createStealthDeposit,
  createStealthMetaAddress,
  prepareClaimInputs,
  scanAnnouncements,
  bytesToBigint,
  type ClaimInputs,
  type ZVaultKeys,
  type StealthMetaAddress,
} from "@zvault/sdk";

import {
  getVerificationKey,
  type CircuitType,
} from "../../sdk/dist/prover/web.js";

const BN254_FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_DEPTH = 20;
const DEMO_AMOUNT = 10_000n;

// ============================================================================
// Utility functions
// ============================================================================

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt("0x" + Buffer.from(bytes).toString("hex")) % BN254_FR_MODULUS;
}

function computeZeroHashes(): bigint[] {
  const z: bigint[] = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) z.push(poseidonHashSync([z[i - 1], z[i - 1]]));
  return z;
}

function computeMerkleProof(commitment: bigint, leafIndex: number, frontier: bigint[], zeroHashes: bigint[]) {
  const siblings: bigint[] = [], indices: number[] = [];
  let current = commitment, idx = leafIndex;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const isRight = (idx & 1) === 1;
    indices.push(isRight ? 1 : 0);
    const sibling = isRight ? frontier[level] : zeroHashes[level];
    siblings.push(sibling);
    current = isRight ? poseidonHashSync([sibling, current]) : poseidonHashSync([current, sibling]);
    idx = idx >> 1;
  }
  return { siblings, indices, root: current };
}

// ============================================================================
// Transcript implementation (matches Solidity Transcript.sol)
// ============================================================================

class SolidityTranscript {
  private previousChallenge: Uint8Array | null = null;
  private buffer: Uint8Array[] = [];
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  absorb(data: Uint8Array) {
    this.buffer.push(new Uint8Array(data));
  }

  squeeze(): { raw: Uint8Array; reduced: bigint } {
    // Concatenate all absorbed data
    const totalLen = this.buffer.reduce((s, b) => s + b.length, 0);
    let input: Uint8Array;

    if (this.previousChallenge) {
      // Subsequent: hash(prevChallenge || buffer)
      input = new Uint8Array(32 + totalLen);
      input.set(this.previousChallenge, 0);
      let off = 32;
      for (const b of this.buffer) { input.set(b, off); off += b.length; }
    } else {
      // First: hash(buffer)
      input = new Uint8Array(totalLen);
      let off = 0;
      for (const b of this.buffer) { input.set(b, off); off += b.length; }
    }

    this.buffer = [];

    const hash = new Uint8Array(keccak_256(input));

    // Reduce mod Fr
    const hashBigint = bytes32ToBigint(hash);
    const reduced = hashBigint % BN254_FR_MODULUS;
    const reducedBytes = bigintToBytes32(reduced);

    // Store reduced as state for next squeeze
    this.previousChallenge = reducedBytes;

    return { raw: hash, reduced };
  }

  getBufferSize(): number {
    return this.buffer.reduce((s, b) => s + b.length, 0);
  }
}

function splitChallenge(value: bigint): { lo: bigint; hi: bigint } {
  const MASK_127 = (1n << 127n) - 1n;
  return {
    lo: value & MASK_127,
    hi: value >> 127n,
  };
}

// ============================================================================
// VK hash computation (Solidity style: from affine coordinates)
// ============================================================================

function convertSplitG1ToAffine(data: Uint8Array, offset: number): Uint8Array {
  const x_0 = data.slice(offset, offset + 32);
  const x_1 = data.slice(offset + 32, offset + 64);
  const y_0 = data.slice(offset + 64, offset + 96);
  const y_1 = data.slice(offset + 96, offset + 128);

  // Check identity
  if ([...x_0, ...x_1, ...y_0, ...y_1].every(b => b === 0)) {
    return new Uint8Array(64);
  }

  const affine = new Uint8Array(64);
  // x: high 15 bytes from x_1, low 17 bytes from x_0
  affine.set(x_1.slice(17, 32), 0);
  affine.set(x_0.slice(15, 32), 15);
  // y: high 15 bytes from y_1, low 17 bytes from y_0
  affine.set(y_1.slice(17, 32), 32);
  affine.set(y_0.slice(15, 32), 47);

  return affine;
}

function computeVkHashSolidity(vkBytes: Uint8Array): { hash: Uint8Array; affineVk: Uint8Array } {
  // Build the 1888-byte affine VK: 3 metadata fields + 28 affine G1 points
  const affineVk = new Uint8Array(96 + 28 * 64); // = 1888 bytes

  // Copy 3 metadata fields (96 bytes)
  affineVk.set(vkBytes.slice(0, 96), 0);

  // Convert 28 split G1 points to affine
  for (let i = 0; i < 28; i++) {
    const splitOffset = 96 + i * 128;
    const affineG1 = convertSplitG1ToAffine(vkBytes, splitOffset);
    affineVk.set(affineG1, 96 + i * 64);
  }

  const hash = new Uint8Array(keccak_256(affineVk));
  return { hash, affineVk };
}

function computeVkHashRaw(vkBytes: Uint8Array): Uint8Array {
  // Our current (wrong?) approach: hash raw VK bytes
  const hashLen = vkBytes.length >= 3680 ? 3680 : Math.min(vkBytes.length, 1888);
  return new Uint8Array(keccak_256(vkBytes.slice(0, hashLen)));
}

// ============================================================================
// Main diagnostic
// ============================================================================

async function main() {
  console.log("=".repeat(70));
  console.log("DIAGNOSTIC: Transcript Challenge Comparison");
  console.log("Compares Solidity protocol vs our Rust verifier step by step");
  console.log("=".repeat(70));

  // ---- Setup ----
  await initPoseidon();
  const zeroHashes = computeZeroHashes();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();

  // ---- Generate keys and proof ----
  console.log("\n--- Generating proof ---");
  const keys: ZVaultKeys = await deriveKeysFromSeed(bigintToBytes32(randomFieldElement()));
  const sma: StealthMetaAddress = createStealthMetaAddress(keys);
  const dep = await createStealthDeposit(sma, DEMO_AMOUNT);
  const commitment = bytesToBigint(dep.commitment);

  const leafIndex = 0;
  const frontier = new Array(TREE_DEPTH).fill(0n);
  const { siblings, indices, root } = computeMerkleProof(commitment, leafIndex, frontier, zeroHashes);

  const announcements = [{
    ephemeralPub: dep.ephemeralPub,
    encryptedAmount: dep.encryptedAmount,
    commitment: dep.commitment,
    leafIndex,
  }];
  const scannedNotes = await scanAnnouncements(keys, announcements);
  const scannedNote = scannedNotes[0];

  const claimPrepInputs = await prepareClaimInputs(keys, scannedNote, {
    root,
    pathElements: siblings,
    pathIndices: indices,
  });

  const recipientBigint = randomFieldElement();

  const claimInputs: ClaimInputs = {
    privKey: claimPrepInputs.stealthPrivKey,
    pubKeyX: scannedNote.stealthPub.x,
    amount: DEMO_AMOUNT,
    leafIndex: BigInt(leafIndex),
    merkleRoot: root,
    merkleProof: { siblings, indices },
    recipient: recipientBigint,
  };

  const proofData = await generateClaimProof(claimInputs);
  console.log(`Proof: ${proofData.proof.length} bytes, ${proofData.publicInputs.length} PIs`);

  // ---- Verify with bb.js ----
  console.log("\n--- Verifying with bb.js (keccak mode) ---");
  try {
    const bbModule = await import("@aztec/bb.js");
    const circuit = JSON.parse(
      fs.readFileSync(path.resolve(circuitPath, "zvault_claim.json"), "utf-8")
    );
    const backend = new bbModule.UltraHonkBackend(circuit.bytecode);
    const verified = await backend.verifyProof(
      { proof: proofData.proof, publicInputs: proofData.publicInputs },
      { keccak: true }
    );
    console.log(`bb.js verification: ${verified ? "✅ VALID" : "❌ INVALID"}`);
    if (!verified) {
      console.log("⚠️  Proof is invalid even for bb.js! Check proof generation.");
      await cleanupProver();
      return;
    }
  } catch (e: any) {
    console.log(`bb.js verification error: ${e.message}`);
    console.log("Continuing with transcript analysis anyway...");
  }

  // ---- Analyze proof format ----
  const pb = proofData.proof;
  const piStrings = proofData.publicInputs;
  const numPIs = piStrings.length;

  console.log("\n--- Proof Format Analysis ---");
  console.log(`Proof size: ${pb.length} bytes`);
  console.log(`Public inputs: ${numPIs}`);

  // Check: are the first 512 bytes PI limbs or pairing accumulators?
  console.log("\nFirst 16 Fr elements (preamble, FULL hex):");
  for (let i = 0; i < 16 && i * 32 + 32 <= pb.length; i++) {
    const val = bytes32ToBigint(pb.slice(i * 32, i * 32 + 32));
    const isZero = val === 0n;
    console.log(`  [${i.toString().padStart(2)}]: 0x${val.toString(16).padStart(64, "0")} ${isZero ? "(ZERO)" : ""}`);
  }

  // Check if first N Fr match user PI values directly
  console.log("\nDo preamble elements match PI values directly?");
  for (let i = 0; i < numPIs; i++) {
    const preambleVal = bytes32ToBigint(pb.slice(i * 32, i * 32 + 32));
    const piVal = BigInt(piStrings[i]);
    console.log(`  preamble[${i}]==PI[${i}]? ${preambleVal === piVal ? "✅ YES" : "❌ NO"} (preamble=0x${preambleVal.toString(16).slice(0,16)}... pi=0x${piVal.toString(16).slice(0,16)}...)`);
  }

  // Check: are elements [4..15] all zeros?
  let preambleTailZero = true;
  for (let i = numPIs; i < 16; i++) {
    const val = bytes32ToBigint(pb.slice(i * 32, i * 32 + 32));
    if (val !== 0n) { preambleTailZero = false; break; }
  }
  console.log(`  preamble[${numPIs}..15] all zero? ${preambleTailZero ? "YES" : "NO"}`);

  // Check 2-limb split (128-bit) reconstruction
  console.log("\nPI reconstruction from 2-limb split (128-bit):");
  for (let pi = 0; pi < numPIs; pi++) {
    const base = pi * 2 * 32;
    if (base + 64 > 512) break;
    const lo = bytes32ToBigint(pb.slice(base, base + 32));
    const hi = bytes32ToBigint(pb.slice(base + 32, base + 64));
    const reconstructed128 = lo + (hi << 128n);
    const expected = BigInt(piStrings[pi]);
    console.log(`  PI[${pi}] 2-limb: ${reconstructed128 === expected ? "✅" : "❌"} (lo=0x${lo.toString(16).slice(0,12)}... hi=0x${hi.toString(16).slice(0,12)}...)`);
  }

  // Reconstruct PIs from 68-bit limbs
  console.log("\nPI reconstruction from 68-bit limbs:");
  for (let pi = 0; pi < numPIs; pi++) {
    const base = pi * 4 * 32;
    const limb0 = bytes32ToBigint(pb.slice(base, base + 32));
    const limb1 = bytes32ToBigint(pb.slice(base + 32, base + 64));
    const limb2 = bytes32ToBigint(pb.slice(base + 64, base + 96));
    const limb3 = bytes32ToBigint(pb.slice(base + 96, base + 128));
    const reconstructed = limb0 + (limb1 << 68n) + (limb2 << 136n) + (limb3 << 204n);
    const expected = BigInt(piStrings[pi]);
    const match = reconstructed === expected;
    console.log(`  PI[${pi}]: ${match ? "✅" : "❌"} reconstructed=0x${reconstructed.toString(16).slice(0, 16)}... expected=0x${expected.toString(16).slice(0, 16)}...`);
  }

  // ---- VK Hash comparison ----
  console.log("\n--- VK Hash Comparison ---");
  const vkBytes = await getVerificationKey("claim" as CircuitType);
  console.log(`VK size: ${vkBytes.length} bytes`);

  const vkHashRaw = computeVkHashRaw(vkBytes);
  const { hash: vkHashSolidity, affineVk } = computeVkHashSolidity(vkBytes);

  console.log(`VK hash (raw split, our current):   0x${bytesToHex(vkHashRaw).slice(0, 32)}...`);
  console.log(`VK hash (affine, Solidity style):    0x${bytesToHex(vkHashSolidity).slice(0, 32)}...`);
  console.log(`VK hashes match: ${bytesToHex(vkHashRaw) === bytesToHex(vkHashSolidity) ? "✅" : "❌ MISMATCH"}`);

  // Parse VK metadata
  const logN = vkBytes[31];
  const numPublicInputs = (vkBytes[60] << 24) | (vkBytes[61] << 16) | (vkBytes[62] << 8) | vkBytes[63];
  const pubInputsOffset = Number(BigInt(
    `0x${bytesToHex(vkBytes.slice(88, 96))}`
  ));
  console.log(`VK: logN=${logN}, numPublicInputs=${numPublicInputs}, pubInputsOffset=${pubInputsOffset}`);

  // ---- Parse proof in both formats ----
  console.log("\n" + "=".repeat(70));
  console.log("TRANSCRIPT COMPARISON: Solidity vs Our Verifier");
  console.log("=".repeat(70));

  // G1 affine points from proof (after preamble)
  // Our format: preamble starts at 0, 16 Fr = 512 bytes; G1s start at 512
  const OUR_PREAMBLE = 16 * 32; // 512
  // Solidity format: preamble is 8 Fr = 256 bytes; G1s start at 256
  // But bb.js proof has 512 bytes of PI limbs, not 256 bytes of pairing accum
  // So the G1s always start at offset 512 in the raw bb.js proof

  const G1_START = 512; // G1s start at 512 in the raw bb.js proof

  // Extract G1 witness commitments (64 bytes each, affine)
  function getG1(index: number): Uint8Array {
    const start = G1_START + index * 64;
    return pb.slice(start, start + 64);
  }

  // Verify G1 points are valid
  console.log("\nWitness G1 points (sanity check):");
  const g1Names = ["w1", "w2", "w3", "lrc", "lrt", "w4", "li", "zperm"];
  for (let i = 0; i < 8; i++) {
    const g1 = getG1(i);
    const x = bytes32ToBigint(g1.slice(0, 32));
    const y = bytes32ToBigint(g1.slice(32, 64));
    const isIdentity = x === 0n && y === 0n;
    console.log(`  ${g1Names[i].padEnd(6)}: x=0x${x.toString(16).slice(0, 16)}... y=0x${y.toString(16).slice(0, 16)}... ${isIdentity ? "(identity)" : ""}`);
  }

  // Public input values
  const piValues: Uint8Array[] = piStrings.map(pi => bigintToBytes32(BigInt(pi)));

  // ========================================================================
  // Protocol A: Solidity verifier transcript
  // Absorb: vkHash + userPIs + pairingPoints[8 zeros] + w1,w2,w3
  // ========================================================================
  console.log("\n--- Protocol A: Solidity style (PAIRING_POINTS_SIZE=8) ---");

  const tSol = new SolidityTranscript("Solidity");

  // Round 0 (eta): vkHash + userPIs + pairingPoints[8] + w1,w2,w3
  tSol.absorb(vkHashSolidity); // Solidity uses affine VK hash
  for (const pi of piValues) tSol.absorb(pi);
  // Pairing points: 8 × 32 zeros (non-recursive)
  for (let i = 0; i < 8; i++) tSol.absorb(new Uint8Array(32));
  // w1, w2, w3
  for (let i = 0; i < 3; i++) {
    tSol.absorb(getG1(i).slice(0, 32));  // x
    tSol.absorb(getG1(i).slice(32, 64)); // y
  }

  console.log(`  Eta buffer: ${tSol.getBufferSize()} bytes`);
  const etaSol = tSol.squeeze();
  const etaSplitSol = splitChallenge(etaSol.reduced);
  console.log(`  eta challenge (full): 0x${etaSol.reduced.toString(16).padStart(64, "0")}`);
  console.log(`  eta (lo=eta):         0x${etaSplitSol.lo.toString(16).padStart(64, "0")}`);

  // Round 1 (beta/gamma): prevChallenge + lrc, lrt, w4
  for (let i = 3; i <= 5; i++) { // lrc=3, lrt=4, w4=5
    tSol.absorb(getG1(i).slice(0, 32));
    tSol.absorb(getG1(i).slice(32, 64));
  }
  const bgSol = tSol.squeeze();
  const bgSplitSol = splitChallenge(bgSol.reduced);
  console.log(`  beta:                 0x${bgSplitSol.lo.toString(16).padStart(64, "0")}`);
  console.log(`  gamma:                0x${bgSplitSol.hi.toString(16).padStart(64, "0")}`);

  // Round 2 (alpha): li=6, zperm=7
  for (let i = 6; i <= 7; i++) {
    tSol.absorb(getG1(i).slice(0, 32));
    tSol.absorb(getG1(i).slice(32, 64));
  }
  const alphaSol = tSol.squeeze();
  const alphaSplitSol = splitChallenge(alphaSol.reduced);
  console.log(`  alpha:                0x${alphaSplitSol.lo.toString(16).padStart(64, "0")}`);

  // Gate challenges
  const gcSol = tSol.squeeze();
  const gcSplitSol = splitChallenge(gcSol.reduced);
  console.log(`  gate_challenge[0]:    0x${gcSplitSol.lo.toString(16).padStart(64, "0")}`);

  // Sumcheck round 0 (just first round for comparison)
  const sumcheckStart = G1_START + 8 * 64; // after 8 G1 witness commitments
  for (let j = 0; j < 8; j++) {
    const off = sumcheckStart + j * 32;
    tSol.absorb(pb.slice(off, off + 32));
  }
  const sc0Sol = tSol.squeeze();
  const sc0SplitSol = splitChallenge(sc0Sol.reduced);
  console.log(`  sumcheck_u[0]:        0x${sc0SplitSol.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol B: Our Rust verifier transcript
  // Absorb: vkHash(raw) + userPIs + preamble[16 PI limbs] + w1,w2,w3
  // ========================================================================
  console.log("\n--- Protocol B: Our Rust verifier (PAIRING_POINTS_SIZE=16) ---");

  const tRust = new SolidityTranscript("Rust");

  // Round 0 (eta): vkHash + userPIs + preamble[16] + w1,w2,w3
  tRust.absorb(vkHashRaw); // Our verifier uses raw VK hash
  for (const pi of piValues) tRust.absorb(pi);
  // Preamble: 16 Fr from proof (these are PI limbs, not pairing points!)
  for (let i = 0; i < 16; i++) {
    tRust.absorb(pb.slice(i * 32, i * 32 + 32));
  }
  // w1, w2, w3
  for (let i = 0; i < 3; i++) {
    tRust.absorb(getG1(i).slice(0, 32));  // x
    tRust.absorb(getG1(i).slice(32, 64)); // y
  }

  console.log(`  Eta buffer: ${tRust.getBufferSize()} bytes`);
  const etaRust = tRust.squeeze();
  const etaSplitRust = splitChallenge(etaRust.reduced);
  console.log(`  eta challenge (full): 0x${etaRust.reduced.toString(16).padStart(64, "0")}`);
  console.log(`  eta (lo=eta):         0x${etaSplitRust.lo.toString(16).padStart(64, "0")}`);

  // Round 1
  for (let i = 3; i <= 5; i++) {
    tRust.absorb(getG1(i).slice(0, 32));
    tRust.absorb(getG1(i).slice(32, 64));
  }
  const bgRust = tRust.squeeze();
  const bgSplitRust = splitChallenge(bgRust.reduced);
  console.log(`  beta:                 0x${bgSplitRust.lo.toString(16).padStart(64, "0")}`);
  console.log(`  gamma:                0x${bgSplitRust.hi.toString(16).padStart(64, "0")}`);

  // Round 2
  for (let i = 6; i <= 7; i++) {
    tRust.absorb(getG1(i).slice(0, 32));
    tRust.absorb(getG1(i).slice(32, 64));
  }
  const alphaRust = tRust.squeeze();
  const alphaSplitRust = splitChallenge(alphaRust.reduced);
  console.log(`  alpha:                0x${alphaSplitRust.lo.toString(16).padStart(64, "0")}`);

  // Gate challenges
  const gcRust = tRust.squeeze();
  const gcSplitRust = splitChallenge(gcRust.reduced);
  console.log(`  gate_challenge[0]:    0x${gcSplitRust.lo.toString(16).padStart(64, "0")}`);

  // Sumcheck round 0
  for (let j = 0; j < 8; j++) {
    const off = sumcheckStart + j * 32;
    tRust.absorb(pb.slice(off, off + 32));
  }
  const sc0Rust = tRust.squeeze();
  const sc0SplitRust = splitChallenge(sc0Rust.reduced);
  console.log(`  sumcheck_u[0]:        0x${sc0SplitRust.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol C: Reduced VK hash + PAIRING_POINTS_SIZE=16 with zeros
  // vkHash = keccak256(1888-byte affine VK) reduced mod Fr
  // ========================================================================
  console.log("\n--- Protocol C: Reduced VK hash (mod Fr) + 16 zeros ---");

  // Compute reduced VK hash: keccak256(affine VK) mod BN254_FR_MODULUS
  const vkHashReduced = bigintToBytes32(bytes32ToBigint(computeVkHashRaw(vkBytes)) % BN254_FR_MODULUS);
  console.log(`  VK hash (reduced):    0x${bytesToHex(vkHashReduced).slice(0, 32)}...`);

  const tC = new SolidityTranscript("ReducedVK");
  tC.absorb(vkHashReduced);
  for (const pi of piValues) tC.absorb(pi);
  for (let i = 0; i < 16; i++) tC.absorb(pb.slice(i * 32, i * 32 + 32)); // actual preamble (zeros)
  for (let i = 0; i < 3; i++) {
    tC.absorb(getG1(i).slice(0, 32));
    tC.absorb(getG1(i).slice(32, 64));
  }

  console.log(`  Eta buffer: ${tC.getBufferSize()} bytes`);
  const etaC = tC.squeeze();
  const etaSplitC = splitChallenge(etaC.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitC.lo.toString(16).padStart(64, "0")}`);

  // Continue full transcript for Protocol C
  for (let i = 3; i <= 5; i++) {
    tC.absorb(getG1(i).slice(0, 32));
    tC.absorb(getG1(i).slice(32, 64));
  }
  const bgC = tC.squeeze();
  const bgSplitC = splitChallenge(bgC.reduced);
  console.log(`  beta:                 0x${bgSplitC.lo.toString(16).padStart(64, "0")}`);
  console.log(`  gamma:                0x${bgSplitC.hi.toString(16).padStart(64, "0")}`);

  for (let i = 6; i <= 7; i++) {
    tC.absorb(getG1(i).slice(0, 32));
    tC.absorb(getG1(i).slice(32, 64));
  }
  const alphaC = tC.squeeze();
  const alphaSplitC = splitChallenge(alphaC.reduced);
  console.log(`  alpha:                0x${alphaSplitC.lo.toString(16).padStart(64, "0")}`);

  const gcC = tC.squeeze();
  const gcSplitC = splitChallenge(gcC.reduced);
  console.log(`  gate_challenge[0]:    0x${gcSplitC.lo.toString(16).padStart(64, "0")}`);

  for (let j = 0; j < 8; j++) {
    const off = sumcheckStart + j * 32;
    tC.absorb(pb.slice(off, off + 32));
  }
  const sc0C = tC.squeeze();
  const sc0SplitC = splitChallenge(sc0C.reduced);
  console.log(`  sumcheck_u[0]:        0x${sc0SplitC.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol D: NO vkHash - absorb VK fields individually (C++ style)
  // absorb: circuitSize + numPI + offset + 28 commitments + userPIs + preamble + witnesses
  // ========================================================================
  console.log("\n--- Protocol D: Individual VK fields (no vkHash) + 16 zeros ---");

  const tD = new SolidityTranscript("IndividualVK");
  // Absorb VK metadata
  tD.absorb(vkBytes.slice(0, 32));  // circuit_size
  tD.absorb(vkBytes.slice(32, 64)); // num_public_inputs
  tD.absorb(vkBytes.slice(64, 96)); // pub_inputs_offset
  // Absorb 28 affine G1 commitments
  for (let i = 0; i < 28; i++) {
    const g1Off = 96 + i * 64;
    tD.absorb(vkBytes.slice(g1Off, g1Off + 32)); // x
    tD.absorb(vkBytes.slice(g1Off + 32, g1Off + 64)); // y
  }
  // user PIs
  for (const pi of piValues) tD.absorb(pi);
  // preamble (16 × 32 zeros)
  for (let i = 0; i < 16; i++) tD.absorb(pb.slice(i * 32, i * 32 + 32));
  // w1, w2, w3
  for (let i = 0; i < 3; i++) {
    tD.absorb(getG1(i).slice(0, 32));
    tD.absorb(getG1(i).slice(32, 64));
  }

  console.log(`  Eta buffer: ${tD.getBufferSize()} bytes`);
  const etaD = tD.squeeze();
  const etaSplitD = splitChallenge(etaD.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitD.lo.toString(16).padStart(64, "0")}`);

  // Continue full transcript for Protocol D
  for (let i = 3; i <= 5; i++) {
    tD.absorb(getG1(i).slice(0, 32));
    tD.absorb(getG1(i).slice(32, 64));
  }
  const bgD = tD.squeeze();
  const bgSplitD = splitChallenge(bgD.reduced);
  console.log(`  beta:                 0x${bgSplitD.lo.toString(16).padStart(64, "0")}`);
  console.log(`  gamma:                0x${bgSplitD.hi.toString(16).padStart(64, "0")}`);

  for (let i = 6; i <= 7; i++) {
    tD.absorb(getG1(i).slice(0, 32));
    tD.absorb(getG1(i).slice(32, 64));
  }
  const alphaD = tD.squeeze();
  const alphaSplitD = splitChallenge(alphaD.reduced);
  console.log(`  alpha:                0x${alphaSplitD.lo.toString(16).padStart(64, "0")}`);

  const gcD = tD.squeeze();
  const gcSplitD = splitChallenge(gcD.reduced);
  console.log(`  gate_challenge[0]:    0x${gcSplitD.lo.toString(16).padStart(64, "0")}`);

  for (let j = 0; j < 8; j++) {
    const off = sumcheckStart + j * 32;
    tD.absorb(pb.slice(off, off + 32));
  }
  const sc0D = tD.squeeze();
  const sc0SplitD = splitChallenge(sc0D.reduced);
  console.log(`  sumcheck_u[0]:        0x${sc0SplitD.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol E: Reduced VK hash + 4 user PI values + 12 zeros in preamble
  // (What if preamble = user PIs as Fr + padding zeros, not PI limbs?)
  // ========================================================================
  console.log("\n--- Protocol E: Reduced VK hash + PIs-as-preamble + 12 zeros ---");

  const tE = new SolidityTranscript("PIAsPreamble");
  tE.absorb(vkHashReduced);
  // User PIs
  for (const pi of piValues) tE.absorb(pi);
  // Preamble: 4 PI values + 12 zeros (to fill 16 Fr)
  for (const pi of piValues) tE.absorb(pi);
  for (let i = 0; i < 12; i++) tE.absorb(new Uint8Array(32));
  // w1, w2, w3
  for (let i = 0; i < 3; i++) {
    tE.absorb(getG1(i).slice(0, 32));
    tE.absorb(getG1(i).slice(32, 64));
  }
  const etaE = tE.squeeze();
  const etaSplitE = splitChallenge(etaE.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitE.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol F: Raw VK hash (NOT reduced) + 16 preamble from proof
  // (What if VK hash should NOT be reduced mod Fr?)
  // ========================================================================
  console.log("\n--- Protocol F: Raw VK hash (unreduced) + 16 preamble from proof ---");

  const tF = new SolidityTranscript("RawVKHash");
  tF.absorb(vkHashRaw); // NOT reduced
  for (const pi of piValues) tF.absorb(pi);
  for (let i = 0; i < 16; i++) tF.absorb(pb.slice(i * 32, i * 32 + 32));
  for (let i = 0; i < 3; i++) {
    tF.absorb(getG1(i).slice(0, 32));
    tF.absorb(getG1(i).slice(32, 64));
  }
  const etaF = tF.squeeze();
  const etaSplitF = splitChallenge(etaF.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitF.lo.toString(16).padStart(64, "0")}`);

  // Wait, Protocol F = Protocol B! Let me check...
  console.log(`  (Same as Protocol B?  ${etaSplitF.lo === etaSplitRust.lo ? "YES" : "NO"})`);

  // ========================================================================
  // Protocol G: NO user PIs, just vkHash + preamble + witnesses
  // (What if user PIs are NOT absorbed separately - they're already in preamble?)
  // ========================================================================
  console.log("\n--- Protocol G: Reduced VK hash + NO user PIs + 16 preamble ---");

  const tG = new SolidityTranscript("NoPIs");
  tG.absorb(vkHashReduced);
  // NO user PIs
  // 16 preamble elements from proof
  for (let i = 0; i < 16; i++) tG.absorb(pb.slice(i * 32, i * 32 + 32));
  for (let i = 0; i < 3; i++) {
    tG.absorb(getG1(i).slice(0, 32));
    tG.absorb(getG1(i).slice(32, 64));
  }
  const etaG = tG.squeeze();
  const etaSplitG = splitChallenge(etaG.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitG.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Protocol H: Reduced VK hash + 20 PIs total (4 user + 16 preamble)
  // Absorbed in order: vkHash, PI[0..19], w1, w2, w3
  // where PI[0..3] = user PIs, PI[4..19] = preamble values
  // ========================================================================
  console.log("\n--- Protocol H: Reduced VK hash + 20 PIs contiguously ---");

  const tH = new SolidityTranscript("20PIs");
  tH.absorb(vkHashReduced);
  // All 20 PIs: 4 user PIs + 16 from preamble
  for (const pi of piValues) tH.absorb(pi);
  for (let i = 0; i < 16; i++) tH.absorb(pb.slice(i * 32, i * 32 + 32));
  for (let i = 0; i < 3; i++) {
    tH.absorb(getG1(i).slice(0, 32));
    tH.absorb(getG1(i).slice(32, 64));
  }
  console.log(`  Eta buffer: ${tH.getBufferSize()} bytes`);
  const etaH = tH.squeeze();
  const etaSplitH = splitChallenge(etaH.reduced);
  console.log(`  eta (lo=eta):         0x${etaSplitH.lo.toString(16).padStart(64, "0")}`);

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY: Which protocol matches bb.js?");
  console.log("=".repeat(70));

  console.log(`\nProtocol A (Solidity: 8 zeros + affine VK hash):`);
  console.log(`  eta = 0x${etaSplitSol.lo.toString(16).padStart(64, "0")}`);

  console.log(`\nProtocol B (Our Rust: 16 PI-limbs + raw VK hash):`);
  console.log(`  eta = 0x${etaSplitRust.lo.toString(16).padStart(64, "0")}`);

  console.log(`\nProtocol C (Reduced VK hash + 16 zeros):`);
  console.log(`  eta = 0x${etaSplitC.lo.toString(16).padStart(64, "0")}`);

  console.log(`\nProtocol D (Individual VK fields + 16 zeros):`);
  console.log(`  eta = 0x${etaSplitD.lo.toString(16).padStart(64, "0")}`);

  console.log(`\nVK hash variants:`);
  console.log(`  Raw keccak256(1888):       0x${bytesToHex(vkHashRaw).slice(0, 32)}...`);
  console.log(`  Reduced (raw mod Fr):      0x${bytesToHex(vkHashReduced).slice(0, 32)}...`);
  console.log(`  Match raw==reduced?        ${bytesToHex(vkHashRaw) === bytesToHex(vkHashReduced) ? "YES (hash < Fr)" : "NO (hash >= Fr, needs reduction)"}`);

  console.log(`\nPreamble analysis:`);
  console.log(`  First 512 bytes all zero?  ${pb.slice(0, 512).every(b => b === 0) ? "YES" : "NO"}`);
  console.log(`  numPublicInputs from VK:   ${numPublicInputs}`);
  console.log(`  userPIs provided:          ${numPIs}`);
  console.log(`  Implied pairing size:      ${numPublicInputs - numPIs} (= ${numPublicInputs} - ${numPIs})`);

  console.log(`\nTo determine which protocol matches bb.js, we need to compare`);
  console.log(`against the actual on-chain Rust verifier output.`);
  console.log(`Add msg! logging to the Rust verifier Phase 1 to print the eta challenge,`);
  console.log(`then compare with the values above.`);

  console.log(`\nMost likely correct protocol:`);
  console.log(`  Since preamble is all zeros and VK says numPI=20 (=4+16),`);
  console.log(`  PAIRING_POINTS_SIZE=16 is correct.`);
  console.log(`  The fix is likely ONLY the VK hash computation.`);
  console.log(`  Try Protocol C (reduced VK hash + 16 actual preamble values).`);

  await cleanupProver();
}

main().catch(console.error);
