#!/usr/bin/env bun
/**
 * Diagnostic: Analyze bb.js proof layout in detail
 * No on-chain interaction needed - just proof generation and byte analysis
 */
import * as path from "path";
import { fileURLToPath } from "url";

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
import { getVerificationKey, type CircuitType } from "../../sdk/dist/prover/web.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
const TREE_DEPTH = 20;
const DEMO_AMOUNT = 10_000n;

function log(msg: string) { console.log(msg); }

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

// to_affine conversion (mirrors Rust: x_1_hi[15 bytes] || x_0_lo[17 bytes])
function toAffine(data: Uint8Array, offset: number): { x: bigint; y: bigint; onCurve: boolean; isIdentity: boolean } {
  const x_0 = data.slice(offset, offset + 32);
  const x_1 = data.slice(offset + 32, offset + 64);
  const y_0 = data.slice(offset + 64, offset + 96);
  const y_1 = data.slice(offset + 96, offset + 128);

  // Identity check (all zeros)
  const isIdentity = x_0.every(b => b === 0) && x_1.every(b => b === 0) &&
                     y_0.every(b => b === 0) && y_1.every(b => b === 0);
  if (isIdentity) return { x: 0n, y: 0n, onCurve: true, isIdentity: true };

  // Reconstruct affine: point[0..15] = x_1[17..32], point[15..32] = x_0[15..32]
  const affine = new Uint8Array(64);
  affine.set(x_1.slice(17, 32), 0);    // high 15 bytes
  affine.set(x_0.slice(15, 32), 15);   // low 17 bytes
  affine.set(y_1.slice(17, 32), 32);
  affine.set(y_0.slice(15, 32), 47);

  const x = bytesToBigintBE(affine.slice(0, 32));
  const y = bytesToBigintBE(affine.slice(32, 64));
  if (x >= Fq_MOD || y >= Fq_MOD) return { x, y, onCurve: false, isIdentity: false };
  const x3 = x * x % Fq_MOD * x % Fq_MOD;
  const rhs = (x3 + 3n) % Fq_MOD;
  const lhs = y * y % Fq_MOD;
  return { x, y, onCurve: lhs === rhs, isIdentity: false };
}

async function main() {
  log("=== Proof Layout Diagnostic ===\n");

  await initPoseidon();
  const zeroHashes = computeZeroHashes();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();
  log("Prover ready\n");

  // Generate keys and mock deposit
  const keys: ZVaultKeys = await deriveKeysFromSeed(bigintToBytes32(randomFieldElement()));
  const sma: StealthMetaAddress = createStealthMetaAddress(keys);
  const dep = await createStealthDeposit(sma, DEMO_AMOUNT);
  const commitment = bytesToBigint(dep.commitment);

  // Mock tree state: single leaf
  const frontier: bigint[] = new Array(TREE_DEPTH).fill(0n);
  frontier[0] = commitment;
  const leafIndex = 0;
  const { siblings, indices, root } = computeMerkleProof(commitment, leafIndex, frontier, zeroHashes);

  // Scan and prepare
  const announcements = [{
    ephemeralPub: dep.ephemeralPub,
    encryptedAmount: dep.encryptedAmount,
    commitment: dep.commitment,
    leafIndex: leafIndex,
  }];
  const found = await scanAnnouncements(keys, announcements);
  if (found.length === 0) throw new Error("Failed to scan deposit");
  const scannedNote = found[0];

  const claimPrepInputs = await prepareClaimInputs(keys, scannedNote, {
    root,
    pathElements: siblings,
    pathIndices: indices,
  });

  const claimInputs: ClaimInputs = {
    privKey: claimPrepInputs.stealthPrivKey,
    pubKeyX: scannedNote.stealthPub.x,
    amount: DEMO_AMOUNT,
    leafIndex: BigInt(leafIndex),
    merkleRoot: root,
    merkleProof: { siblings, indices },
    recipient: randomFieldElement(), // random — only affects PI values, not proof structure
  };

  // === PARSE VK TO GET ACTUAL LOG_N ===
  const vkBytes = await getVerificationKey("claim" as CircuitType);
  log(`VK size: ${vkBytes.length} bytes`);
  // VK header: 3 × 32-byte fields
  const vkLogN = vkBytes[31]; // circuit_size_log in byte 31
  const vkNumPI = (vkBytes[60] << 24) | (vkBytes[61] << 16) | (vkBytes[62] << 8) | vkBytes[63];
  const vkPubInputsOffset = Number(BigInt(`0x${Buffer.from(vkBytes.slice(88, 96)).toString("hex")}`));
  log(`VK: circuit_size_log=${vkLogN}, num_public_inputs=${vkNumPI}, pub_inputs_offset=${vkPubInputsOffset}`);
  log(`VK: Expected fold comms = ${vkLogN - 1} (real) + ${32 - vkLogN} (padded) = ${31} total\n`);

  log("Generating proof...");
  const proofData = await generateClaimProof(claimInputs);
  const pb = proofData.proof;
  log(`Proof: ${pb.length} bytes = ${pb.length / 32} Fr elements, ${proofData.publicInputs.length} PIs\n`);

  // === LAYOUT CONSTANTS ===
  const N = 32;   // CONST_PROOF_SIZE_LOG_N
  const G1 = 128; // G1 split point size
  const FR = 32;  // Fr element size
  const BRLP = 8; // batched relation partial length
  const NUM_ENTITIES = 40;
  const NUM_PI = proofData.publicInputs.length;
  const NUM_G1 = 8;

  const piEnd = NUM_PI * 4 * FR;
  const g1End = piEnd + NUM_G1 * G1;
  const sumcheckUnivEnd = g1End + N * BRLP * FR;
  const sumcheckEvalEnd = sumcheckUnivEnd + NUM_ENTITIES * FR;
  const geminiCommsEnd = sumcheckEvalEnd + (N - 1) * G1;
  const geminiEvalsEnd = geminiCommsEnd + N * FR;
  const shplonkQEnd = geminiEvalsEnd + G1;
  const kzgEnd = shplonkQEnd + G1;

  log(`Layout (N=${N}, ${NUM_G1} G1, ${NUM_ENTITIES} entities):`);
  log(`  PI preamble:     0 - ${piEnd} (${piEnd} bytes)`);
  log(`  G1 commitments:  ${piEnd} - ${g1End} (${g1End - piEnd} bytes = ${NUM_G1} G1)`);
  log(`  Sumcheck univ:   ${g1End} - ${sumcheckUnivEnd} (${sumcheckUnivEnd - g1End} bytes = ${N}×${BRLP} Fr)`);
  log(`  Sumcheck evals:  ${sumcheckUnivEnd} - ${sumcheckEvalEnd} (${sumcheckEvalEnd - sumcheckUnivEnd} bytes = ${NUM_ENTITIES} Fr)`);
  log(`  Gemini fold comms: ${sumcheckEvalEnd} - ${geminiCommsEnd} (${geminiCommsEnd - sumcheckEvalEnd} bytes = ${N-1} G1)`);
  log(`  Gemini evals:    ${geminiCommsEnd} - ${geminiEvalsEnd} (${geminiEvalsEnd - geminiCommsEnd} bytes = ${N} Fr)`);
  log(`  Shplonk Q:       ${geminiEvalsEnd} - ${shplonkQEnd} (${shplonkQEnd - geminiEvalsEnd} bytes)`);
  log(`  KZG quotient:    ${shplonkQEnd} - ${kzgEnd} (${kzgEnd - shplonkQEnd} bytes)`);
  log(`  Total: ${kzgEnd} bytes (proof=${pb.length}) ${kzgEnd === pb.length ? "✓ MATCH" : "✗ MISMATCH"}\n`);

  // === CHECK INITIAL G1 POINTS ===
  log(`Initial G1 points (${piEnd} to ${g1End}):`);
  for (let i = 0; i < NUM_G1; i++) {
    const off = piEnd + i * G1;
    const res = toAffine(pb, off);
    log(`  g1[${i}] at ${off}: ${res.onCurve ? "✓" : "✗"} ${res.isIdentity ? "(identity)" : `x=0x${res.x.toString(16).slice(0,16)}...`}`);
  }

  // === CHECK LAST 2 G1 POINTS (shplonk_q, kzg_quotient) ===
  log(`\nFinal G1 points:`);
  const sqOff = geminiEvalsEnd;
  const kqOff = shplonkQEnd;
  const sqRes = toAffine(pb, sqOff);
  const kqRes = toAffine(pb, kqOff);
  log(`  shplonk_q at ${sqOff}: ${sqRes.onCurve ? "✓" : "✗"} x=0x${sqRes.x.toString(16).slice(0,16)}...`);
  log(`  kzg_quot  at ${kqOff}: ${kqRes.onCurve ? "✓" : "✗"} x=0x${kqRes.x.toString(16).slice(0,16)}...`);

  // === TEST BOTH ORDERINGS on fold comms ===
  // Standard: [x_lo, x_hi, y_lo, y_hi] — same as initial G1
  // Reversed: [x_hi, x_lo, y_hi, y_lo] — hypothetical alternative
  function toAffineReversed(data: Uint8Array, offset: number): { x: bigint; y: bigint; onCurve: boolean; isIdentity: boolean } {
    // Swap: first 32 bytes = x_hi, second 32 = x_lo
    const x_hi = data.slice(offset, offset + 32);
    const x_lo = data.slice(offset + 32, offset + 64);
    const y_hi = data.slice(offset + 64, offset + 96);
    const y_lo = data.slice(offset + 96, offset + 128);
    const isIdentity = x_hi.every(b => b === 0) && x_lo.every(b => b === 0) &&
                       y_hi.every(b => b === 0) && y_lo.every(b => b === 0);
    if (isIdentity) return { x: 0n, y: 0n, onCurve: true, isIdentity: true };
    const affine = new Uint8Array(64);
    affine.set(x_hi.slice(17, 32), 0);
    affine.set(x_lo.slice(15, 32), 15);
    affine.set(y_hi.slice(17, 32), 32);
    affine.set(y_lo.slice(15, 32), 47);
    const x = bytesToBigintBE(affine.slice(0, 32));
    const y = bytesToBigintBE(affine.slice(32, 64));
    if (x >= Fq_MOD || y >= Fq_MOD) return { x, y, onCurve: false, isIdentity: false };
    const x3 = x * x % Fq_MOD * x % Fq_MOD;
    const rhs = (x3 + 3n) % Fq_MOD;
    const lhs = y * y % Fq_MOD;
    return { x, y, onCurve: lhs === rhs, isIdentity: false };
  }

  log(`\nFold comm ordering test (first 5 invalid slots):`);
  for (let i = 0; i < Math.min(5, N - 1); i++) {
    const off = sumcheckEvalEnd + i * G1;
    const block = pb.slice(off, off + G1);
    const isZero = block.every((b: number) => b === 0);
    if (isZero) { log(`  fold[${i}] at ${off}: IDENTITY`); continue; }
    const std = toAffine(pb, off);
    const rev = toAffineReversed(pb, off);
    log(`  fold[${i}] at ${off}: standard=${std.onCurve ? "✓" : "✗"} reversed=${rev.onCurve ? "✓" : "✗"}`);
    if (rev.onCurve && !std.onCurve) {
      log(`    → REVERSED works! x=0x${rev.x.toString(16).slice(0,16)}...`);
    }
  }

  // Also test reversed on initial G1 to see if they also work reversed
  log(`\nInitial G1 ordering test:`);
  for (let i = 0; i < NUM_G1; i++) {
    const off = piEnd + i * G1;
    const std = toAffine(pb, off);
    const rev = toAffineReversed(pb, off);
    log(`  g1[${i}] at ${off}: standard=${std.onCurve ? "✓" : "✗"} reversed=${rev.onCurve ? "✓" : "✗"}`);
  }

  // === CHECK ALL 31 GEMINI FOLD COMMS ===
  log(`\nGemini fold commitments (${N-1} slots at ${sumcheckEvalEnd}):`);
  let valid = 0, identity = 0, invalid = 0;
  for (let i = 0; i < N - 1; i++) {
    const off = sumcheckEvalEnd + i * G1;
    const block = pb.slice(off, off + G1);
    const isZero = block.every((b: number) => b === 0);
    const res = toAffine(pb, off);

    // Check split-format invariants: x_0[0..15] must be zero, x_1[0..17] must be zero
    const x0_padOk = pb.slice(off, off + 15).every((b: number) => b === 0);
    const x1_padOk = pb.slice(off + 32, off + 32 + 17).every((b: number) => b === 0);
    const y0_padOk = pb.slice(off + 64, off + 64 + 15).every((b: number) => b === 0);
    const y1_padOk = pb.slice(off + 96, off + 96 + 17).every((b: number) => b === 0);
    const splitOk = x0_padOk && x1_padOk && y0_padOk && y1_padOk;

    if (isZero) {
      identity++;
      log(`  fold[${i.toString().padStart(2)}] at ${off}: IDENTITY (128 zero bytes)`);
    } else if (res.onCurve && splitOk) {
      valid++;
      log(`  fold[${i.toString().padStart(2)}] at ${off}: VALID G1 ✓ x=0x${res.x.toString(16).slice(0,16)}...`);
    } else {
      invalid++;
      const tag = splitOk ? "split OK but NOT on curve" : `split VIOLATED (x0_pad=${x0_padOk} x1_pad=${x1_padOk} y0_pad=${y0_padOk} y1_pad=${y1_padOk})`;
      log(`  fold[${i.toString().padStart(2)}] at ${off}: INVALID ✗ ${tag}`);
      if (invalid <= 5) {
        log(`    x_0: ${Buffer.from(pb.slice(off, off + 32)).toString("hex")}`);
        log(`    x_1: ${Buffer.from(pb.slice(off + 32, off + 64)).toString("hex")}`);
        log(`    y_0: ${Buffer.from(pb.slice(off + 64, off + 96)).toString("hex")}`);
        log(`    y_1: ${Buffer.from(pb.slice(off + 96, off + 128)).toString("hex")}`);
        if (res.onCurve) {
          log(`    → ON CURVE despite split violation! x=0x${res.x.toString(16).slice(0,16)}...`);
        } else {
          log(`    → assembled x=0x${res.x.toString(16).slice(0,16)}... ${res.x >= Fq_MOD ? "(> Fq)" : "(< Fq, not on curve)"}`);
        }
      }
    }
  }
  log(`  Summary: ${valid} valid, ${identity} identity, ${invalid} invalid\n`);

  // === CHECK GEMINI EVALS ===
  log(`Gemini evaluations (${N} slots at ${geminiCommsEnd}):`);
  let nonzeroEvals = 0;
  for (let i = 0; i < N; i++) {
    const off = geminiCommsEnd + i * FR;
    const val = bytesToBigintBE(pb.slice(off, off + 32));
    if (val > 0n) nonzeroEvals++;
    if (i < 3 || i >= N - 3 || val === 0n) {
      log(`  eval[${i.toString().padStart(2)}] at ${off}: ${val === 0n ? "ZERO" : `0x${val.toString(16).slice(0,16)}... ${val >= BN254_MODULUS ? "(> Fr!)" : ""}`}`);
    }
  }
  log(`  Non-zero: ${nonzeroEvals} / ${N}\n`);

  // === ALTERNATIVE LAYOUT: scan for actual G1 boundaries ===
  log(`Alternative analysis: scan for valid split-format G1 in fold comm region:`);
  for (let off = sumcheckEvalEnd; off + G1 <= geminiCommsEnd; off += G1) {
    const x0_padOk = pb.slice(off, off + 15).every((b: number) => b === 0);
    const x1_padOk = pb.slice(off + 32, off + 32 + 17).every((b: number) => b === 0);
    if (!x0_padOk || !x1_padOk) {
      log(`  Split invariant first broken at offset ${off} (fold index ${(off - sumcheckEvalEnd) / G1})`);
      log(`  This suggests the gemini fold comms might NOT start at ${sumcheckEvalEnd}`);

      // Try alternative: maybe there are extra scalars between sumcheck evals and fold comms
      log(`\n  Scanning forward from sumcheck evals end for first valid split-format G1:`);
      for (let probe = sumcheckEvalEnd; probe + G1 <= pb.length - 256; probe += FR) {
        const px0ok = pb.slice(probe, probe + 15).every((b: number) => b === 0);
        const px1ok = pb.slice(probe + 32, probe + 32 + 17).every((b: number) => b === 0);
        if (px0ok && px1ok) {
          const res = toAffine(pb, probe);
          if (res.onCurve || res.isIdentity) {
            log(`    Found valid G1 at offset ${probe} (${probe - sumcheckEvalEnd} bytes = ${(probe - sumcheckEvalEnd)/32} Fr after evals end)`);
            log(`    x=0x${res.x.toString(16).slice(0,16)}...`);

            // Check if this starts a contiguous region of G1 points
            let count = 0;
            for (let check = probe; check + G1 <= pb.length; check += G1) {
              const cr = toAffine(pb, check);
              const block = pb.slice(check, check + G1);
              const isZero = block.every((b: number) => b === 0);
              if (cr.onCurve || cr.isIdentity || isZero) count++;
              else break;
            }
            log(`    Contiguous valid G1 from this offset: ${count}`);
            break;
          }
        }
      }
      break;
    }
  }

  // === VERIFY PREAMBLE = PIs IN 4-LIMB FORMAT ===
  log(`\nVerifying preamble = PIs in 4-limb 68-bit split:`);
  for (let pi = 0; pi < NUM_PI; pi++) {
    // Decode 4 limbs into a single Fr
    const limbs: bigint[] = [];
    for (let l = 0; l < 4; l++) {
      const off = (pi * 4 + l) * 32;
      limbs.push(bytesToBigintBE(pb.slice(off, off + 32)));
    }
    const reconstructed = limbs[0] + (limbs[1] << 68n) + (limbs[2] << 136n) + (limbs[3] << 204n);
    const piHex = proofData.publicInputs[pi];
    const piVal = typeof piHex === 'string' ? BigInt(piHex) : BigInt(piHex);
    const match = reconstructed === piVal;
    log(`  PI[${pi}]: limbs=[${limbs.map(l => l.toString(16).length*4 + 'bit').join(', ')}]`);
    log(`  PI[${pi}]: reconstructed=0x${reconstructed.toString(16).slice(0,16)}... expected=0x${piVal.toString(16).slice(0,16)}... ${match ? "✓ MATCH" : "✗ MISMATCH"}`);
  }

  // === CHECK BYTES 512-1024 (could be pairing points?) ===
  log(`\nBytes 512-1024 analysis (possible pairing points or G1 comms):`);
  const section512 = pb.slice(512, 1024);
  const section512AllZero = section512.every((b: number) => b === 0);
  log(`  All zeros (512-1024): ${section512AllZero}`);
  if (!section512AllZero) {
    // Check as 4 G1 split-format points
    for (let i = 0; i < 4; i++) {
      const off = 512 + i * 128;
      const res = toAffine(pb, off);
      const isId = pb.slice(off, off + 128).every((b: number) => b === 0);
      log(`  G1[${i}] at ${off}: ${isId ? "IDENTITY" : res.onCurve ? `✓ ON CURVE x=0x${res.x.toString(16).slice(0,12)}...` : "✗ NOT on curve"}`);
    }
    // Check as 16 Fr scalars in 4-limb format (2 pairing points × 2 coords × 4 limbs)
    log(`  As 4-limb pairing point coords:`);
    for (let c = 0; c < 4; c++) {
      const limbs: bigint[] = [];
      for (let l = 0; l < 4; l++) limbs.push(bytesToBigintBE(pb.slice(512 + (c * 4 + l) * 32, 512 + (c * 4 + l + 1) * 32)));
      const val = limbs[0] + (limbs[1] << 68n) + (limbs[2] << 136n) + (limbs[3] << 204n);
      log(`    coord[${c}]: ${limbs.map(l => l.toString(16).length*4 + 'bit').join(', ')} → ${val.toString(16).slice(0,16)}... (${val < Fq_MOD ? '< Fq' : '>= Fq'})`);
    }
  }

  // === CHECK PREAMBLE (first 512 bytes) ===
  log(`\nPreamble analysis (bytes 0-512):`);
  const preambleZeros = pb.slice(0, 512).every((b: number) => b === 0);
  log(`  All zeros: ${preambleZeros}`);
  if (!preambleZeros) {
    // Check each 32-byte Fr element
    let nonZeroCount = 0;
    for (let i = 0; i < 16; i++) {
      const val = bytesToBigintBE(pb.slice(i * 32, (i + 1) * 32));
      if (val !== 0n) {
        nonZeroCount++;
        log(`  Fr[${i}] at ${i*32}: 0x${val.toString(16).slice(0,20)}... (${val.toString(16).length * 4} bits)`);
      }
    }
    log(`  Non-zero Fr elements in preamble: ${nonZeroCount} / 16`);
  }

  // === INTERPRET fold[0]-fold[3] AS 64-BYTE AFFINE G1 PAIRS ===
  log(`\nTesting fold[0]-fold[3] as 64-byte affine G1 point pairs:`);
  function checkAffine64(data: Uint8Array, offset: number, label: string): boolean {
    const x = bytesToBigintBE(data.slice(offset, offset + 32));
    const y = bytesToBigintBE(data.slice(offset + 32, offset + 64));
    if (x === 0n && y === 0n) {
      log(`  ${label}: IDENTITY`);
      return true;
    }
    if (x >= Fq_MOD || y >= Fq_MOD) {
      log(`  ${label}: x or y >= Fq (${x >= Fq_MOD ? "x" : "y"} too large)`);
      return false;
    }
    const x3 = x * x % Fq_MOD * x % Fq_MOD;
    const rhs = (x3 + 3n) % Fq_MOD;
    const lhs = y * y % Fq_MOD;
    const onCurve = lhs === rhs;
    log(`  ${label}: ${onCurve ? "✓ ON CURVE" : "✗ not on curve"} x=0x${x.toString(16).slice(0,16)}... y=0x${y.toString(16).slice(0,16)}...`);
    return onCurve;
  }

  for (let i = 0; i < 4; i++) {
    const base = sumcheckEvalEnd + i * G1;
    log(` Block fold[${i}] at ${base}:`);
    // Interpret as two 64-byte affine points
    checkAffine64(pb, base, `  point_A (bytes 0-63)`);
    checkAffine64(pb, base + 64, `  point_B (bytes 64-127)`);
    // Also interpret each 32-byte word as a standalone scalar
    for (let w = 0; w < 4; w++) {
      const val = bytesToBigintBE(pb.slice(base + w * 32, base + (w + 1) * 32));
      const bits = val.toString(16).length * 4;
      const isFr = val < BN254_MODULUS;
      log(`  word[${w}]: ${bits}-bit, ${isFr ? "< Fr" : ">= Fr"}, ${val < Fq_MOD ? "< Fq" : ">= Fq"}`);
    }
  }

  // === CHECK IF fold[1]-fold[3] USE A DIFFERENT RECONSTRUCTION ===
  log(`\nTesting alternative reconstruction: x = x_1 || x_0 (reversed limb assembly):`);
  for (let i = 1; i < 4; i++) {
    const off = sumcheckEvalEnd + i * G1;
    // Standard: x = x_1[17..32](15 bytes) || x_0[15..32](17 bytes)
    // Alternative: x = x_0[16..32](16 bytes) || x_1[16..32](16 bytes) = 256 bits total, take mod Fq
    const x_0 = bytesToBigintBE(pb.slice(off, off + 32));
    const x_1 = bytesToBigintBE(pb.slice(off + 32, off + 64));
    const y_0 = bytesToBigintBE(pb.slice(off + 64, off + 96));
    const y_1 = bytesToBigintBE(pb.slice(off + 96, off + 128));

    // Try: x = x_0 + x_1 * 2^136 (standard but with full values)
    const x_try1 = (x_1 * (1n << 136n) + x_0) % Fq_MOD;
    const y_try1 = (y_1 * (1n << 136n) + y_0) % Fq_MOD;
    const x3_1 = x_try1 * x_try1 % Fq_MOD * x_try1 % Fq_MOD;
    const ok1 = (y_try1 * y_try1 % Fq_MOD) === ((x3_1 + 3n) % Fq_MOD);

    // Try: x = x_1 + x_0 * 2^136 (reversed)
    const x_try2 = (x_0 * (1n << 136n) + x_1) % Fq_MOD;
    const y_try2 = (y_0 * (1n << 136n) + y_1) % Fq_MOD;
    const x3_2 = x_try2 * x_try2 % Fq_MOD * x_try2 % Fq_MOD;
    const ok2 = (y_try2 * y_try2 % Fq_MOD) === ((x3_2 + 3n) % Fq_MOD);

    // Try: x = x_0 + x_1 * 2^128 (128-bit split)
    const x_try3 = (x_1 * (1n << 128n) + x_0) % Fq_MOD;
    const y_try3 = (y_1 * (1n << 128n) + y_0) % Fq_MOD;
    const x3_3 = x_try3 * x_try3 % Fq_MOD * x_try3 % Fq_MOD;
    const ok3 = (y_try3 * y_try3 % Fq_MOD) === ((x3_3 + 3n) % Fq_MOD);

    log(`  fold[${i}]: 136-split=${ok1 ? "✓" : "✗"} 136-rev=${ok2 ? "✓" : "✗"} 128-split=${ok3 ? "✓" : "✗"}`);
    if (ok1) log(`    → 136-split WORKS! x=0x${x_try1.toString(16).slice(0,16)}...`);
    if (ok2) log(`    → 136-rev WORKS! x=0x${x_try2.toString(16).slice(0,16)}...`);
    if (ok3) log(`    → 128-split WORKS! x=0x${x_try3.toString(16).slice(0,16)}...`);
  }

  // === VERIFY INITIAL G1 RECONSTRUCTION MATH ===
  log(`\nVerifying initial G1 reconstruction math:`);
  for (let i = 0; i < 2; i++) {
    const off = 512 + i * G1; // piEnd + i*G1
    const x_0 = bytesToBigintBE(pb.slice(off, off + 32));
    const x_1 = bytesToBigintBE(pb.slice(off + 32, off + 64));
    const y_0 = bytesToBigintBE(pb.slice(off + 64, off + 96));
    const y_1 = bytesToBigintBE(pb.slice(off + 96, off + 128));
    const x = x_1 * (1n << 136n) + x_0;
    const y = y_1 * (1n << 136n) + y_0;
    log(`  g1[${i}]: x_0=${x_0.toString(16).length*4}bit x_1=${x_1.toString(16).length*4}bit`);
    log(`  g1[${i}]: x=${x < Fq_MOD ? "< Fq" : ">= Fq"} (${x.toString(16).length*4}bit) y=${y < Fq_MOD ? "< Fq" : ">= Fq"}`);
    const x3 = x * x % Fq_MOD * x % Fq_MOD;
    log(`  g1[${i}]: on_curve=${(y * y % Fq_MOD) === ((x3 + 3n) % Fq_MOD) ? "✓" : "✗"}`);
  }

  // === CHECK fold[1] with FULL 136-bit split (no truncation) ===
  log(`\nFold[1] detailed reconstruction:`);
  {
    const off = sumcheckEvalEnd + 1 * G1;
    const x_0_raw = bytesToBigintBE(pb.slice(off, off + 32));
    const x_1_raw = bytesToBigintBE(pb.slice(off + 32, off + 64));
    log(`  x_0_raw = 0x${x_0_raw.toString(16)} (${x_0_raw.toString(16).length * 4} bits)`);
    log(`  x_1_raw = 0x${x_1_raw.toString(16)} (${x_1_raw.toString(16).length * 4} bits)`);
    log(`  x_0_raw fits 136 bits: ${x_0_raw < (1n << 136n)}`);
    log(`  x_1_raw fits 118 bits: ${x_1_raw < (1n << 118n)}`);
    log(`  x_1_raw fits 136 bits: ${x_1_raw < (1n << 136n)}`);
    // Full reconstruction with no truncation
    const x_full = x_1_raw * (1n << 136n) + x_0_raw;
    log(`  x_full = x_1*2^136 + x_0 = ${x_full.toString(16).length * 4}-bit value`);
    log(`  x_full < Fq: ${x_full < Fq_MOD}`);
    log(`  x_full mod Fq < Fq: ${(x_full % Fq_MOD) < Fq_MOD}`);
  }

  // === CHECK IF PROOF IS ZK (Libra) ===
  // ZK proofs have BRLP=9, non-ZK have BRLP=8
  // If BRLP=8: sumcheck_univ = 32*8*32 = 8192, starts at 1536, ends at 9728
  // If BRLP=9: sumcheck_univ = 32*9*32 = 9216, starts at 1536, ends at 10752
  log(`\nBRLP detection (ZK vs non-ZK):`);
  // The sumcheck round evaluations should be valid Fr elements.
  // Check if bytes at 9728 (BRLP=8 evals start) vs 10752 (BRLP=9 evals start)
  // look like valid sumcheck evaluations
  const evalAt9728 = bytesToBigintBE(pb.slice(9728, 9760));
  const evalAt10752 = bytesToBigintBE(pb.slice(10752, 10784));
  log(`  Value at 9728 (BRLP=8 eval start): 0x${evalAt9728.toString(16).slice(0,16)}... ${evalAt9728 < BN254_MODULUS ? "< Fr ✓" : ">= Fr ✗"}`);
  log(`  Value at 10752 (BRLP=9 eval start): 0x${evalAt10752.toString(16).slice(0,16)}... ${evalAt10752 < BN254_MODULUS ? "< Fr ✓" : ">= Fr ✗"}`);
  // Also check the first univariate at round 0
  log(`  First sumcheck univ values:`);
  for (let u = 0; u < 10; u++) {
    const val = bytesToBigintBE(pb.slice(g1End + u * 32, g1End + (u + 1) * 32));
    log(`    univ[${u}] at ${g1End + u * 32}: ${val < BN254_MODULUS ? "✓" : "✗"} ${val.toString(16).slice(0,16)}...`);
  }

  await cleanupProver();
  log("\nDone.");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
