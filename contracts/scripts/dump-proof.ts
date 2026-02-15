#!/usr/bin/env bun
/**
 * Comprehensive proof format analysis — scan for G1 points, scalars, patterns
 */
import * as path from "path";
import {
  initProver, setCircuitPath, generateClaimProof, cleanupProver,
  initPoseidon, poseidonHashSync, deriveKeysFromSeed,
  createStealthDeposit, createStealthMetaAddress, prepareClaimInputs,
  scanAnnouncements, bytesToBigint,
  type ClaimInputs, type ZVaultKeys, type StealthMetaAddress,
} from "@zvault/sdk";
import { getVerificationKey, type CircuitType } from "../../sdk/dist/prover/web.js";

const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
const TREE_DEPTH = 20;
const DEMO_AMOUNT = 10_000n;

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt("0x" + Buffer.from(bytes).toString("hex")) % BN254_MODULUS;
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToBigintBE(b: Uint8Array): bigint {
  let hex = "0x";
  for (const byte of b) hex += byte.toString(16).padStart(2, "0");
  return BigInt(hex);
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

// G1 on-curve check using split format (to_affine)
function checkG1Split(data: Uint8Array, offset: number): boolean {
  if (offset + 128 > data.length) return false;
  const x_0 = data.slice(offset, offset + 32);
  const x_1 = data.slice(offset + 32, offset + 64);
  const y_0 = data.slice(offset + 64, offset + 96);
  const y_1 = data.slice(offset + 96, offset + 128);

  if (x_0.every(b => b === 0) && x_1.every(b => b === 0) &&
      y_0.every(b => b === 0) && y_1.every(b => b === 0)) return true; // identity

  // Check split format invariant: leading bytes should be zero
  const x0_hi_ok = x_0.slice(0, 15).every(b => b === 0);
  const x1_hi_ok = x_1.slice(0, 17).every(b => b === 0);
  const y0_hi_ok = y_0.slice(0, 15).every(b => b === 0);
  const y1_hi_ok = y_1.slice(0, 17).every(b => b === 0);
  if (!x0_hi_ok || !x1_hi_ok || !y0_hi_ok || !y1_hi_ok) return false;

  // Reassemble
  const affine = new Uint8Array(64);
  affine.set(x_1.slice(17, 32), 0);
  affine.set(x_0.slice(15, 32), 15);
  affine.set(y_1.slice(17, 32), 32);
  affine.set(y_0.slice(15, 32), 47);

  const x = bytesToBigintBE(affine.slice(0, 32));
  const y = bytesToBigintBE(affine.slice(32, 64));
  if (x >= Fq_MOD || y >= Fq_MOD) return false;
  const x3 = x * x % Fq_MOD * x % Fq_MOD;
  return y * y % Fq_MOD === (x3 + 3n) % Fq_MOD;
}

// G1 on-curve check using affine format
function checkG1Affine(data: Uint8Array, offset: number): boolean {
  if (offset + 64 > data.length) return false;
  const x = bytesToBigintBE(data.slice(offset, offset + 32));
  const y = bytesToBigintBE(data.slice(offset + 32, offset + 64));
  if (x === 0n && y === 0n) return true;
  if (x >= Fq_MOD || y >= Fq_MOD) return false;
  const x3 = x * x % Fq_MOD * x % Fq_MOD;
  return y * y % Fq_MOD === (x3 + 3n) % Fq_MOD;
}

async function main() {
  const circuitPath = path.resolve(process.cwd(), "../sdk/circuits");
  setCircuitPath(circuitPath);
  await initPoseidon();
  await initProver();

  const zeroHashes = computeZeroHashes();
  const keys: ZVaultKeys = await deriveKeysFromSeed(bigintToBytes32(randomFieldElement()));
  const sma: StealthMetaAddress = createStealthMetaAddress(keys);
  const dep = await createStealthDeposit(sma, DEMO_AMOUNT);
  const commitment = bytesToBigint(dep.commitment);
  const leafIndex = 0;
  const frontier = new Array(TREE_DEPTH).fill(0n);
  const { siblings, indices, root } = computeMerkleProof(commitment, leafIndex, frontier, zeroHashes);

  const announcements = [{ ephemeralPub: dep.ephemeralPub, encryptedAmount: dep.encryptedAmount, commitment: dep.commitment, leafIndex }];
  const scannedNotes = await scanAnnouncements(keys, announcements);
  const scannedNote = scannedNotes[0];
  const claimPrepInputs = await prepareClaimInputs(keys, scannedNote, { root, pathElements: siblings, pathIndices: indices });

  const claimInputs: ClaimInputs = {
    privKey: claimPrepInputs.stealthPrivKey, pubKeyX: scannedNote.stealthPub.x,
    amount: DEMO_AMOUNT, leafIndex: 0n, merkleRoot: root,
    merkleProof: { siblings, indices }, recipient: 0x1234n,
  };

  const proofData = await generateClaimProof(claimInputs);
  const pb = proofData.proof;
  console.log(`Proof: ${pb.length} bytes = ${pb.length / 32} Fr`);
  console.log(`PI: ${proofData.publicInputs.length} values`);
  for (let i = 0; i < proofData.publicInputs.length; i++) {
    console.log(`  PI[${i}]: ${proofData.publicInputs[i]}`);
  }

  const vkBytes = await getVerificationKey("claim" as CircuitType);
  console.log(`VK: ${vkBytes.length} bytes`);

  // Scan for G1 split points (128-byte stride)
  console.log("\n=== G1 SPLIT scan (128-byte stride) ===");
  let splitCount = 0;
  for (let off = 0; off + 128 <= pb.length; off += 128) {
    const ok = checkG1Split(pb, off);
    if (ok) splitCount++;
    if (off < 2048 || off > pb.length - 512 || ok) {
      const label = ok ? "✓ G1" : "  --";
      console.log(`  ${label} at ${off.toString().padStart(5)} (Fr idx ${(off/32).toString().padStart(3)})`);
    }
  }
  console.log(`  Total split G1 on curve: ${splitCount}`);

  // Scan for G1 affine points (64-byte stride)
  console.log("\n=== G1 AFFINE scan (64-byte stride) ===");
  let affineCount = 0;
  for (let off = 0; off + 64 <= pb.length; off += 64) {
    const ok = checkG1Affine(pb, off);
    if (ok) affineCount++;
    if (off < 640 || off > pb.length - 256 || ok) {
      console.log(`  ${ok ? "✓ G1" : "  --"} at ${off.toString().padStart(5)} (Fr idx ${(off/32).toString().padStart(3)})`);
    }
  }
  console.log(`  Total affine G1 on curve: ${affineCount}`);

  // Check leading zeros of each Fr element (identifies limb encoding)
  console.log("\n=== Fr element analysis (first 32 elements) ===");
  for (let i = 0; i < Math.min(32, pb.length / 32); i++) {
    const el = pb.slice(i * 32, (i + 1) * 32);
    let lz = 0;
    for (const b of el) { if (b === 0) lz++; else break; }
    const val = bytesToBigintBE(el);
    const bits = val === 0n ? 0 : val.toString(2).length;
    console.log(`  [${i.toString().padStart(3)}] lz=${lz.toString().padStart(2)} bits=${bits.toString().padStart(3)} ${val < (1n << 136n) ? "LIMB" : "FULL"} 0x${val.toString(16).slice(0, 24)}${val.toString(16).length > 24 ? "..." : ""}`);
  }

  // Find where continuous G1 split blocks start and end
  console.log("\n=== G1 split block detection ===");
  let inG1 = false;
  let g1Start = 0;
  let g1Blocks: {start: number, count: number}[] = [];
  for (let off = 0; off + 128 <= pb.length; off += 128) {
    const ok = checkG1Split(pb, off);
    if (ok && !inG1) { inG1 = true; g1Start = off; }
    if (!ok && inG1) { g1Blocks.push({ start: g1Start, count: (off - g1Start) / 128 }); inG1 = false; }
  }
  if (inG1) g1Blocks.push({ start: g1Start, count: (pb.length - g1Start) / 128 });
  for (const b of g1Blocks) {
    console.log(`  G1 block: offset ${b.start} → ${b.count} points (Fr ${b.start / 32}..${(b.start + b.count * 128) / 32 - 1})`);
  }

  // Compute expected layout
  console.log("\n=== Expected layout (log_n=15, BRLP=8, E=40, no PI, gemini_evals=14) ===");
  const log_n = 15;
  const BRLP = 8;
  const E = 40;
  const g1s = 0;
  const univ = g1s + 8 * 128;
  const evals = univ + log_n * BRLP * 32;
  const folds = evals + E * 32;
  const gEvals = folds + (log_n - 1) * 128;
  const sQ = gEvals + (log_n - 1) * 32;
  const kzg = sQ + 128;
  console.log(`  G1 comms:     ${g1s}-${univ - 1} (${(univ - g1s) / 128} pts)`);
  console.log(`  Univariates:  ${univ}-${evals - 1} (${(evals - univ) / 32} Fr)`);
  console.log(`  Evals:        ${evals}-${folds - 1} (${(folds - evals) / 32} Fr)`);
  console.log(`  Fold comms:   ${folds}-${gEvals - 1} (${(gEvals - folds) / 128} pts)`);
  console.log(`  Gemini evals: ${gEvals}-${sQ - 1} (${(sQ - gEvals) / 32} Fr)`);
  console.log(`  shplonk_Q:    ${sQ}-${kzg - 1}`);
  console.log(`  kzg_quotient: ${kzg}-${kzg + 127}`);
  console.log(`  Total:        ${kzg + 128} bytes = ${(kzg + 128) / 32} Fr`);

  await cleanupProver();
}

main().catch(console.error);
