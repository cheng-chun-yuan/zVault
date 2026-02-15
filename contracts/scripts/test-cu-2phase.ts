#!/usr/bin/env bun
/**
 * 5-Phase Verification CU Test
 *
 * Tests VERIFY_PHASE1 + VERIFY_PHASE2 + VERIFY_PHASE3 + VERIFY_PHASE4 + VERIFY_PHASE5.
 * Phase 3: batch inverse. Phase 4: fold computation. Phase 5: MSM + pairing.
 *
 * Run: NETWORK=localnet bun run scripts/test-cu-2phase.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
// TOKEN_2022_PROGRAM_ID no longer needed for local-only test
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { keccak_256 } from "@noble/hashes/sha3.js";

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
  convertBBJSProofToSolana,
  type ClaimInputs,
  type ZVaultKeys,
  type StealthMetaAddress,
} from "@zvault/sdk";

import {
  getVerificationKey,
  type CircuitType,
} from "../../sdk/dist/prover/web.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NETWORK = process.env.NETWORK || "localnet";
const RPC_URL = "http://127.0.0.1:8899";
const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_DEPTH = 20;
const DEMO_AMOUNT = 10_000n;
const BBJS_VK_SIZE = 3680;
const AUTHORITY_SIZE = 32;
const CHADBUFFER_DATA_OFFSET = 32;
const MAX_DATA_PER_WRITE = 950;

// Instruction discriminators
const CHADBUFFER_IX = { CREATE: 0, WRITE: 2, CLOSE: 3 };

function log(msg: string) { console.log(`  ${msg}`); }
function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

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

function bytes32ToBigint(bytes: Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

async function loadKeypair(keyPath: string): Promise<Keypair> {
  const absolutePath = keyPath.replace("~", process.env.HOME || "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(absolutePath, "utf-8"))));
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

function parseCommitmentTree(data: Buffer) {
  const bump = data[1];
  const currentRoot = bytes32ToBigint(data.subarray(8, 40));
  const nextIndex = data.readBigUInt64LE(40);
  const frontier: bigint[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) frontier.push(bytes32ToBigint(data.subarray(48 + i * 32, 80 + i * 32)));
  return { bump, currentRoot, nextIndex, frontier };
}

async function computeVkHash(vkBytes: Uint8Array): Promise<Uint8Array> {
  // MIN_SIZE = 1888 bytes (affine format VK), BBJS_VK_SIZE = 3680 (split format)
  const MIN_VK_SIZE = 1888;
  const hashLen = vkBytes.length >= BBJS_VK_SIZE ? BBJS_VK_SIZE : Math.min(vkBytes.length, MIN_VK_SIZE);
  return new Uint8Array(keccak_256(vkBytes.slice(0, hashLen)));
}

// ChadBuffer helpers
function createChadBufferCreateIx(pid: PublicKey, buf: Keypair, payer: PublicKey, data: Uint8Array) {
  const d = Buffer.alloc(1 + data.length); d[0] = CHADBUFFER_IX.CREATE; d.set(data, 1);
  return new TransactionInstruction({ programId: pid, keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: buf.publicKey, isSigner: true, isWritable: true },
  ], data: d });
}

function createChadBufferWriteIx(pid: PublicKey, buf: PublicKey, payer: PublicKey, offset: number, data: Uint8Array) {
  const d = Buffer.alloc(4 + data.length);
  d[0] = CHADBUFFER_IX.WRITE; d[1] = offset & 0xff; d[2] = (offset >> 8) & 0xff; d[3] = (offset >> 16) & 0xff;
  d.set(data, 4);
  return new TransactionInstruction({ programId: pid, keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: buf, isSigner: false, isWritable: true },
  ], data: d });
}

function createChadBufferCloseIx(pid: PublicKey, buf: PublicKey, payer: PublicKey) {
  return new TransactionInstruction({ programId: pid, keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: buf, isSigner: false, isWritable: true },
  ], data: Buffer.from([CHADBUFFER_IX.CLOSE]) });
}

async function uploadProofToBuffer(conn: Connection, cbPid: PublicKey, payer: Keypair, proof: Uint8Array): Promise<PublicKey> {
  const bufKp = Keypair.generate();
  const bufSize = AUTHORITY_SIZE + proof.length;
  const rent = await conn.getMinimumBalanceForRentExemption(bufSize);
  const firstChunkSize = Math.min(800, proof.length);

  // Add priority fee (tip) for faster processing - ChadBuffer writes use low CU
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }); // 0.05 lamports per CU

  // Create buffer with first chunk
  const createTx = new Transaction();
  createTx.add(priorityFeeIx);
  createTx.add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: bufKp.publicKey, lamports: rent, space: bufSize, programId: cbPid }),
    createChadBufferCreateIx(cbPid, bufKp, payer.publicKey, proof.slice(0, firstChunkSize))
  );

  // Send create transaction (don't wait for confirmation)
  const createSig = await conn.sendTransaction(createTx, [payer, bufKp], { skipPreflight: true });
  log(`✓ Buffer create TX sent: ${createSig.slice(0, 8)}...`);

  // Send all write transactions without waiting (fire and forget)
  const signatures: string[] = [createSig];
  let offset = firstChunkSize;
  let txCount = 0;

  while (offset < proof.length) {
    const sz = Math.min(MAX_DATA_PER_WRITE, proof.length - offset);
    const ix = createChadBufferWriteIx(cbPid, bufKp.publicKey, payer.publicKey, offset, proof.slice(offset, offset + sz));
    const tx = new Transaction();
    tx.add(priorityFeeIx);
    tx.add(ix);

    const sig = await conn.sendTransaction(tx, [payer], { skipPreflight: true });
    signatures.push(sig);
    txCount++;

    offset += sz;
    if (txCount % 5 === 0) {
      log(`  Sent ${txCount} write TXs (${offset}/${proof.length} bytes)...`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  log(`✓ Sent ${signatures.length} transactions total`);
  log(`  Waiting 3s for processing...`);
  await new Promise(r => setTimeout(r, 3000));

  // Verify buffer was created
  const bufInfo = await conn.getAccountInfo(bufKp.publicKey);
  if (!bufInfo) {
    throw new Error("Buffer account not found after upload!");
  }

  log(`✓ Upload complete (buffer size: ${bufInfo.data.length} bytes)`);
  return bufKp.publicKey;
}

// =============================================================================
// Main
// =============================================================================
async function main() {
  console.log("============================================================");
  console.log("5-Phase Verification CU Test");
  console.log("============================================================");

  // Load config
  const configPath = path.join(__dirname, "..", ".localnet-config.json");
  if (!fs.existsSync(configPath)) { console.error("❌ Run deploy-localnet.ts first"); process.exit(1); }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const mainConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));

  const conn = new Connection(RPC_URL, "confirmed");
  const authority = await loadKeypair(mainConfig.wallet?.path || "~/.config/solana/id.json");
  const ultrahonkId = new PublicKey(config.programs.ultrahonkVerifier);
  const cbPid = new PublicKey(config.programs.chadbuffer);
  const vkAccountPubkey = config.accounts?.ultrahonkVkAccount
    ? new PublicKey(config.accounts.ultrahonkVkAccount)
    : null;

  logSection("Setup");
  log(`Authority: ${authority.publicKey.toBase58()}`);
  log(`Verifier: ${ultrahonkId.toBase58()}`);

  await initPoseidon();
  const zeroHashes = computeZeroHashes();
  const circuitPath = path.resolve(__dirname, "../../sdk/circuits");
  setCircuitPath(circuitPath);
  await initProver();
  log("✓ Prover ready");

  // ---- Generate keys & compute locally (no on-chain deposit needed) ----
  logSection("Step 1: Local Key Generation + Merkle Tree");
  const keys: ZVaultKeys = await deriveKeysFromSeed(bigintToBytes32(randomFieldElement()));
  const sma: StealthMetaAddress = createStealthMetaAddress(keys);
  const dep = await createStealthDeposit(sma, DEMO_AMOUNT);
  const commitment = bytesToBigint(dep.commitment);
  log(`✓ Commitment: 0x${commitment.toString(16).slice(0, 16)}...`);

  // Compute Merkle tree locally (commitment at index 0, empty tree)
  const leafIndex = 0;
  const frontier = new Array(TREE_DEPTH).fill(0n); // empty tree
  const { siblings, indices, root } = computeMerkleProof(commitment, leafIndex, frontier, zeroHashes);
  log(`✓ Merkle root: 0x${root.toString(16).slice(0, 16)}...`);

  // ---- Scan deposit & derive stealth key (matching E2E pattern) ----
  logSection("Step 2: Generate Proof");

  const announcements = [{
    ephemeralPub: dep.ephemeralPub,
    encryptedAmount: dep.encryptedAmount,
    commitment: dep.commitment,
    leafIndex,
  }];
  const scannedNotes = await scanAnnouncements(keys, announcements);
  if (scannedNotes.length === 0) throw new Error("Failed to scan deposit");
  const scannedNote = scannedNotes[0];
  log(`✓ Scanned: amount=${scannedNote.amount}`);

  // Prepare claim inputs via SDK (derives stealth priv key correctly)
  const claimPrepInputs = await prepareClaimInputs(keys, scannedNote, {
    root,
    pathElements: siblings,
    pathIndices: indices,
  });

  const stealthPrivKey = claimPrepInputs.stealthPrivKey;
  const pubKeyX = scannedNote.stealthPub.x;
  const recipientBigint = bytes32ToBigint(authority.publicKey.toBytes());

  const claimInputs: ClaimInputs = {
    privKey: stealthPrivKey,
    pubKeyX,
    amount: DEMO_AMOUNT,
    leafIndex: BigInt(leafIndex),
    merkleRoot: root,
    merkleProof: { siblings, indices },
    recipient: recipientBigint,
  };

  log("Generating proof...");
  const t0 = Date.now();
  const proofData = await generateClaimProof(claimInputs);
  log(`✓ Proof: ${proofData.proof.length} bytes, ${proofData.publicInputs.length} public inputs`);

  // ---- DIAGNOSTIC: Analyze proof byte layout ----
  logSection("Diagnostic: Proof Format Analysis");
  const pb = proofData.proof;
  log(`Proof size: ${pb.length} bytes = ${pb.length / 32} Fr elements`);

  // BN254 Fq modulus for curve check
  const Fq_MOD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

  function bytesToBigintBE(b: Uint8Array): bigint {
    let hex = "0x";
    for (const byte of b) hex += byte.toString(16).padStart(2, "0");
    return BigInt(hex);
  }

  function checkG1OnCurve(data: Uint8Array, offset: number): boolean {
    const x_0 = bytesToBigintBE(data.slice(offset, offset + 32));
    const x_1 = bytesToBigintBE(data.slice(offset + 32, offset + 64));
    const y_0 = bytesToBigintBE(data.slice(offset + 64, offset + 96));
    const y_1 = bytesToBigintBE(data.slice(offset + 96, offset + 128));
    const x = (x_1 << 136n) + x_0;
    const y = (y_1 << 136n) + y_0;
    if (x === 0n && y === 0n) return true; // identity
    if (x >= Fq_MOD || y >= Fq_MOD) return false;
    const x2 = x * x % Fq_MOD;
    const x3 = x2 * x % Fq_MOD;
    const rhs = (x3 + 3n) % Fq_MOD;
    const lhs = y * y % Fq_MOD;
    return lhs === rhs;
  }

  // Check G1 points at various offsets
  for (const off of [0, 128, 256, 384, 512, 640, 768, 896]) {
    if (off + 128 <= pb.length) {
      const ok = checkG1OnCurve(pb, off);
      log(`  Offset ${off.toString().padStart(4)}: G1 on curve = ${ok ? "YES ✓" : "NO  ✗"}`);
    }
  }

  // Check last 2 G1 points (shplonk_q, kzg_quotient)
  const lastOff = pb.length - 128;
  const secondLastOff = pb.length - 256;
  log(`  Offset ${secondLastOff} (shplonk_q):    G1 on curve = ${checkG1OnCurve(pb, secondLastOff) ? "YES ✓" : "NO  ✗"}`);
  log(`  Offset ${lastOff} (kzg_quotient): G1 on curve = ${checkG1OnCurve(pb, lastOff) ? "YES ✓" : "NO  ✗"}`);

  // Compare first bytes with public inputs
  log(`\nPublic inputs (${proofData.publicInputs.length}):`);
  for (let i = 0; i < proofData.publicInputs.length; i++) {
    const piVal = BigInt(proofData.publicInputs[i]);
    log(`  PI[${i}]: 0x${piVal.toString(16).slice(0, 32)}...`);
  }
  log(`\nFirst 4 proof Fr elements (hex):`);
  for (let i = 0; i < 4 && i * 32 + 32 <= pb.length; i++) {
    log(`  [${i}]: ${Buffer.from(pb.slice(i * 32, i * 32 + 32)).toString("hex")}`);
  }

  // Verify: reconstruct PI values from 4-limb split
  log(`\nPI reconstruction from proof limbs (68-bit limbs):`);
  for (let pi = 0; pi < proofData.publicInputs.length; pi++) {
    const base = pi * 4 * 32;
    const limb0 = bytesToBigintBE(pb.slice(base, base + 32));
    const limb1 = bytesToBigintBE(pb.slice(base + 32, base + 64));
    const limb2 = bytesToBigintBE(pb.slice(base + 64, base + 96));
    const limb3 = bytesToBigintBE(pb.slice(base + 96, base + 128));
    const reconstructed = limb0 + (limb1 << 68n) + (limb2 << 136n) + (limb3 << 204n);
    const expected = BigInt(proofData.publicInputs[pi]);
    log(`  PI[${pi}]: match=${reconstructed === expected} (reconstructed=0x${reconstructed.toString(16).slice(0,20)}..., expected=0x${expected.toString(16).slice(0,20)}...)`);
  }

  // Extended G1 scan: check every 128 bytes from 512 onwards
  log(`\nExtended G1 scan (from offset 512):`);
  let g1Count = 0;
  for (let off = 512; off + 128 <= pb.length; off += 128) {
    const ok = checkG1OnCurve(pb, off);
    if (ok) {
      g1Count++;
    } else {
      log(`  G1 region ends at offset ${off} (${g1Count} consecutive G1 points from 512)`);
      // Check if this is the start of scalars
      log(`  Next 4 Fr elements (scalar candidates):`);
      for (let s = 0; s < 4 && off + s * 32 + 32 <= pb.length; s++) {
        log(`    [${(off - 512) / 32 + s}]: ${Buffer.from(pb.slice(off + s * 32, off + s * 32 + 32)).toString("hex")}`);
      }
      break;
    }
  }
  log(`  Total G1 points after PI: ${g1Count}`);

  // Diagnostic: to_affine() style conversion check
  // This mirrors the Rust to_affine() which takes x_0[15..32] || x_1[17..32]
  log(`\nto_affine() conversion check (mirrors Rust):`);
  function toAffineCheck(data: Uint8Array, offset: number): { onCurve: boolean; x: bigint; y: bigint } {
    const x_0 = data.slice(offset, offset + 32);
    const x_1 = data.slice(offset + 32, offset + 64);
    const y_0 = data.slice(offset + 64, offset + 96);
    const y_1 = data.slice(offset + 96, offset + 128);

    // Check if identity
    if (x_0.every(b => b === 0) && x_1.every(b => b === 0) &&
        y_0.every(b => b === 0) && y_1.every(b => b === 0)) {
      return { onCurve: true, x: 0n, y: 0n };
    }

    // Check leading bytes that Rust DROPS
    const x0_dropped = x_0.slice(0, 15);
    const x1_dropped = x_1.slice(0, 17);
    const y0_dropped = y_0.slice(0, 15);
    const y1_dropped = y_1.slice(0, 17);
    const hasDroppedBytes = !x0_dropped.every(b => b === 0) || !x1_dropped.every(b => b === 0) ||
                            !y0_dropped.every(b => b === 0) || !y1_dropped.every(b => b === 0);

    // Rust-style: point[0..15] = x_1[17..32], point[15..32] = x_0[15..32]
    const affine = new Uint8Array(64);
    affine.set(x_1.slice(17, 32), 0);    // high 15 bytes
    affine.set(x_0.slice(15, 32), 15);   // low 17 bytes
    affine.set(y_1.slice(17, 32), 32);
    affine.set(y_0.slice(15, 32), 47);

    const x = bytesToBigintBE(affine.slice(0, 32));
    const y = bytesToBigintBE(affine.slice(32, 64));
    if (x >= Fq_MOD || y >= Fq_MOD) return { onCurve: false, x, y };
    const x3 = x * x % Fq_MOD * x % Fq_MOD;
    const rhs = (x3 + 3n) % Fq_MOD;
    const lhs = y * y % Fq_MOD;
    if (hasDroppedBytes) {
      log(`    WARNING: non-zero bytes in dropped region!`);
      log(`      x_0[0..15]=${Buffer.from(x0_dropped).toString("hex")}`);
      log(`      x_1[0..17]=${Buffer.from(x1_dropped).toString("hex")}`);
    }
    return { onCurve: lhs === rhs, x, y };
  }

  const PI_PREAMBLE = proofData.publicInputs.length * 4 * 32; // 512
  for (let g1_idx = 0; g1_idx < 9; g1_idx++) {
    const off = PI_PREAMBLE + g1_idx * 128;
    if (off + 128 <= pb.length) {
      const res = toAffineCheck(pb, off);
      const msmIdx = 27 + g1_idx; // VK_NUM_COMMITMENTS + g1_idx
      log(`  g1[${g1_idx}] (MSM idx ${msmIdx}): to_affine on curve = ${res.onCurve ? "YES ✓" : "NO ✗"}`);
      if (!res.onCurve) {
        log(`    x = 0x${res.x.toString(16).padStart(64, "0")}`);
        log(`    y = 0x${res.y.toString(16).padStart(64, "0")}`);
      }
    }
  }

  // ---- Verify proof layout with CONST_PROOF_SIZE_LOG_N=32, 8 initial G1 ----
  log(`\nLayout verification (CONST_PROOF_SIZE_LOG_N=32, 8 G1):`);
  const CONST_PROOF_SIZE_LOG_N = 32;
  const NUM_INITIAL_G1 = 8;
  const G1_SIZE = 128;
  const FR_SZ = 32;
  const NUM_ENTITIES = 40;
  const BRLP = 8;

  const g1Start = PI_PREAMBLE;
  const sumcheckUnivStart = g1Start + NUM_INITIAL_G1 * G1_SIZE;
  const sumcheckEvalStart = sumcheckUnivStart + CONST_PROOF_SIZE_LOG_N * BRLP * FR_SZ;
  const geminiCommsStart = sumcheckEvalStart + NUM_ENTITIES * FR_SZ;
  const geminiEvalsStart = geminiCommsStart + (CONST_PROOF_SIZE_LOG_N - 1) * G1_SIZE;
  const geminiEvalsEnd = geminiEvalsStart + CONST_PROOF_SIZE_LOG_N * FR_SZ;
  const shplonkQStart = pb.length - 2 * G1_SIZE;
  const kzgStart = pb.length - G1_SIZE;

  log(`  g1Start=${g1Start} sumcheckUniv=${sumcheckUnivStart} sumcheckEval=${sumcheckEvalStart}`);
  log(`  geminiComms=${geminiCommsStart} geminiEvals=${geminiEvalsStart} geminiEvalsEnd=${geminiEvalsEnd}`);
  log(`  shplonkQ=${shplonkQStart} kzgQuotient=${kzgStart}`);
  log(`  Forward/backward alignment: geminiEvalsEnd=${geminiEvalsEnd} == shplonkQ=${shplonkQStart} ? ${geminiEvalsEnd === shplonkQStart ? "YES ✓" : "NO ✗"}`);

  // Check ALL 31 gemini fold comm slots with full byte detail
  log(`\nGemini fold comm analysis (ALL 31 slots at offset ${geminiCommsStart}):`);
  let validCount = 0;
  let identityCount = 0;
  let invalidCount = 0;
  for (let i = 0; i < CONST_PROOF_SIZE_LOG_N - 1; i++) {
    const off = geminiCommsStart + i * G1_SIZE;
    if (off + G1_SIZE > pb.length) break;

    // Check if identity (all zeros)
    const block = pb.slice(off, off + G1_SIZE);
    const isZero = block.every((b: number) => b === 0);

    // Check leading bytes of x_0 and x_1 (split format invariant)
    const x0_hi = pb.slice(off, off + 15);  // should be zero for valid 136-bit x_0
    const x1_hi = pb.slice(off + 32, off + 32 + 17);  // should be zero for valid 118-bit x_1
    const x0_hi_ok = x0_hi.every((b: number) => b === 0);
    const x1_hi_ok = x1_hi.every((b: number) => b === 0);

    const res = toAffineCheck(pb, off);

    if (isZero) {
      identityCount++;
      if (i < 16 || i >= 29) log(`  fold[${i}] (${off}): IDENTITY (all zeros)`);
    } else if (res.onCurve) {
      validCount++;
      log(`  fold[${i}] (${off}): VALID G1 ✓ x=0x${res.x.toString(16).slice(0,16)}... hi_ok=${x0_hi_ok}/${x1_hi_ok}`);
    } else {
      invalidCount++;
      log(`  fold[${i}] (${off}): INVALID ✗ x=0x${res.x.toString(16).slice(0,16)}... x0_hi_ok=${x0_hi_ok} x1_hi_ok=${x1_hi_ok}`);
      if (i < 20) {
        // Full byte dump for first invalid entries
        log(`    x_0 full: ${Buffer.from(pb.slice(off, off + 32)).toString("hex")}`);
        log(`    x_1 full: ${Buffer.from(pb.slice(off + 32, off + 64)).toString("hex")}`);
        log(`    y_0 full: ${Buffer.from(pb.slice(off + 64, off + 96)).toString("hex")}`);
        log(`    y_1 full: ${Buffer.from(pb.slice(off + 96, off + 128)).toString("hex")}`);
      }
    }
  }
  log(`  Summary: ${validCount} valid, ${identityCount} identity, ${invalidCount} invalid (total ${validCount+identityCount+invalidCount})`);

  // Also check: what's at the end of sumcheck evals?
  log(`\nSumcheck evals boundary check:`);
  log(`  Last sumcheck eval (idx 39) at ${sumcheckEvalStart + 39*FR_SZ}: ${Buffer.from(pb.slice(sumcheckEvalStart + 39*32, sumcheckEvalStart + 40*32)).toString("hex")}`);
  log(`  First 4 bytes after evals at ${geminiCommsStart}: ${Buffer.from(pb.slice(geminiCommsStart, geminiCommsStart + 32)).toString("hex")}`);

  // Check gemini evals region
  log(`\nGemini evals check (offset ${geminiEvalsStart}):`);
  let nonzeroEvals = 0;
  for (let i = 0; i < CONST_PROOF_SIZE_LOG_N; i++) {
    const off = geminiEvalsStart + i * FR_SZ;
    const val = pb.slice(off, off + 32);
    const isNonZero = !val.every((b: number) => b === 0);
    if (isNonZero) nonzeroEvals++;
    if (i < 3 || i >= 29) {
      log(`  eval[${i}] at ${off}: ${Buffer.from(val).toString("hex")}${isNonZero ? "" : " (ZERO)"}`);
    }
  }
  log(`  Non-zero evals: ${nonzeroEvals} / ${CONST_PROOF_SIZE_LOG_N}`);

  // ---- Upload proof to ChadBuffer ----
  logSection("Step 3: Upload Proof");

  // bb.js proof is used directly — the first 16 Fr are pairing point accumulators
  // (fixed per circuit, NOT PI values). PIs are passed separately in instruction data.
  const solanaProof = proofData.proof;
  log(`Using bb.js proof directly: ${solanaProof.length} bytes`);

  // Retry upload if it fails (up to 2 total attempts)
  let proofBuffer: PublicKey | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      log(attempt > 1 ? `\n  Retry attempt ${attempt}/2...` : "");
      proofBuffer = await uploadProofToBuffer(conn, cbPid, authority, solanaProof);
      break; // Success!
    } catch (e: any) {
      if (attempt === 2) {
        log(`\n❌ Upload failed after ${attempt} attempts: ${e.message}`);
        throw e;
      }
      log(`\n⚠️  Upload attempt ${attempt} failed, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!proofBuffer) {
    throw new Error("Failed to upload proof");
  }

  log(`Proof buffer: ${proofBuffer.toBase58()}`);

  // Verify: read buffer back and compare with uploaded proof
  const bufInfo = await conn.getAccountInfo(proofBuffer);
  if (bufInfo) {
    const bufData = bufInfo.data;
    const proofInBuf = bufData.slice(CHADBUFFER_DATA_OFFSET); // skip 32-byte authority
    const uploadedProof = solanaProof; // Compare against converted proof
    let mismatch = false;
    for (let i = 0; i < uploadedProof.length && i < proofInBuf.length; i++) {
      if (uploadedProof[i] !== proofInBuf[i]) {
        if (!mismatch) {
          log(`  ❌ BUFFER MISMATCH starting at offset ${i}:`);
          const ctx = 3;
          for (let j = Math.max(0, i - ctx); j < Math.min(uploadedProof.length, i + ctx + 1); j++) {
            const marker = j === i ? " <<< FIRST DIFF" : "";
            log(`    [${j}]: orig=0x${uploadedProof[j].toString(16).padStart(2,"0")} buf=0x${proofInBuf[j].toString(16).padStart(2,"0")}${marker}`);
          }
          // Count total mismatches
          let total = 0;
          for (let j = i; j < uploadedProof.length && j < proofInBuf.length; j++) {
            if (uploadedProof[j] !== proofInBuf[j]) total++;
          }
          log(`    Total mismatched bytes: ${total} / ${uploadedProof.length}`);
          // Check if it's an offset shift
          if (i + 1 < proofInBuf.length && uploadedProof[i] === proofInBuf[i + 1]) {
            log(`    → Looks like 1-byte insertion at offset ${i}`);
          } else if (i > 0 && uploadedProof[i] === proofInBuf[i - 1]) {
            log(`    → Looks like 1-byte deletion before offset ${i}`);
          }
        }
        mismatch = true;
        break;
      }
    }
    if (!mismatch) log(`  ✓ Buffer data verified (${Math.min(uploadedProof.length, proofInBuf.length)} bytes match)`);
    // Also check G1 at offset 256 in buffer (after conversion, G1s start at 256 not 512)
    const g1Off = 256;
    log(`  Buffer g1[0] at ${g1Off}: ${Buffer.from(proofInBuf.slice(g1Off, g1Off + 64)).toString("hex").slice(0, 32)}...`);
    log(`  Uploaded g1[0] at ${g1Off}: ${Buffer.from(uploadedProof.slice(g1Off, g1Off + 64)).toString("hex").slice(0, 32)}...`);
  }

  // ---- Upload fresh VK account (ensures keccak mode VK) ----
  logSection("Step 3b: Upload VK");
  const vkBytes = await getVerificationKey("claim" as CircuitType);
  const vkHash = await computeVkHash(vkBytes);
  log(`VK size: ${vkBytes.length} bytes`);
  log(`VK hash: 0x${Buffer.from(vkHash).toString("hex").slice(0, 32)}...`);

  // Check if existing VK matches
  let vkAccountPubkeyFinal: PublicKey | null = vkAccountPubkey;
  const existingVk = vkAccountPubkey ? await conn.getAccountInfo(vkAccountPubkey) : null;
  const existingVkHash = existingVk ? await computeVkHash(new Uint8Array(existingVk.data)) : null;
  const vkMatches = existingVkHash && Buffer.from(existingVkHash).equals(Buffer.from(vkHash));

  if (vkMatches) {
    log(`✓ Existing VK matches keccak mode`);
  } else {
    log(`VK mismatch — uploading fresh VK account...`);
    const vkKp = Keypair.generate();
    const vkRent = await conn.getMinimumBalanceForRentExemption(vkBytes.length);
    const createVkIx = SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: vkKp.publicKey,
      lamports: vkRent,
      space: vkBytes.length,
      programId: ultrahonkId,
    });

    // Write first chunk
    const VK_FIRST_CHUNK = Math.min(800, vkBytes.length);
    const vkWriteData1 = new Uint8Array(1 + 4 + VK_FIRST_CHUNK);
    vkWriteData1[0] = 4; // WRITE_VK_CHUNK discriminator
    vkWriteData1[1] = 0; vkWriteData1[2] = 0; vkWriteData1[3] = 0; vkWriteData1[4] = 0;
    vkWriteData1.set(vkBytes.slice(0, VK_FIRST_CHUNK), 5);
    const vkWriteIx1 = new TransactionInstruction({
      programId: ultrahonkId,
      keys: [
        { pubkey: vkKp.publicKey, isWritable: true, isSigner: false },
        { pubkey: authority.publicKey, isWritable: true, isSigner: true },
      ],
      data: Buffer.from(vkWriteData1),
    });

    const createVkTx = new Transaction().add(createVkIx, vkWriteIx1);
    await sendAndConfirmTransaction(conn, createVkTx, [authority, vkKp], { commitment: "confirmed" });
    log(`  ✓ VK account created + ${VK_FIRST_CHUNK} bytes`);

    // Write remaining chunks
    let vkOff = VK_FIRST_CHUNK;
    while (vkOff < vkBytes.length) {
      const chunkSize = Math.min(950, vkBytes.length - vkOff);
      const writeData = new Uint8Array(1 + 4 + chunkSize);
      writeData[0] = 4;
      new DataView(writeData.buffer).setUint32(1, vkOff, true);
      writeData.set(vkBytes.slice(vkOff, vkOff + chunkSize), 5);
      const writeIx = new TransactionInstruction({
        programId: ultrahonkId,
        keys: [
          { pubkey: vkKp.publicKey, isWritable: true, isSigner: false },
          { pubkey: authority.publicKey, isWritable: true, isSigner: true },
        ],
        data: Buffer.from(writeData),
      });
      const writeTx = new Transaction().add(writeIx);
      await sendAndConfirmTransaction(conn, writeTx, [authority], { commitment: "confirmed" });
      vkOff += chunkSize;
    }
    log(`  ✓ VK upload complete (${vkBytes.length} bytes): ${vkKp.publicKey.toBase58()}`);
    vkAccountPubkeyFinal = vkKp.publicKey;
  }

  // ---- Build public inputs ----
  const publicInputArrays: Uint8Array[] = proofData.publicInputs.map((pi: string) => bigintToBytes32(BigInt(pi)));

  // ===========================================================================
  // PHASE 1: transcript + sumcheck rounds 0-7
  // ===========================================================================
  logSection("Step 4: VERIFY_PHASE1");

  // Create state account owned by verifier
  const stateKp = Keypair.generate();
  // VerificationState: header(232) + all_sumcheck_u(15*32) + remaining_gate_challenges(7*32) = 936
  // Phase 3 scalars: (VK_NUM_COMMITMENTS=27 + 8 + log_n-1=14 + 2) * 32 = 51 * 32 = 1632
  const LOG_N = 15;
  const VK_NUM_COMMITMENTS = 27;
  const PHASE1_ROUNDS = 5;
  const baseStateSize = 232 + LOG_N * 32 + (LOG_N - PHASE1_ROUNDS) * 32; // = 1032
  // ShpleminiChallenges: unshifted(1) + shifted(1) + pos_inv(logN) + neg_inv(logN) + fold_recon(logN)
  const challengesSize = (2 + 3 * LOG_N) * 32; // = 1504
  const stateSize = baseStateSize + challengesSize; // = 1032 + 1504 = 2536
  const stateRent = await conn.getMinimumBalanceForRentExemption(stateSize);

  const createStateIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: stateKp.publicKey,
    lamports: stateRent,
    space: stateSize,
    programId: ultrahonkId,
  });

  // VERIFY_PHASE1 data: disc(1) + pi_count(4 LE) + public_inputs(N×32) + vk_hash(32)
  const piCount = publicInputArrays.length;
  const phase1Data = new Uint8Array(1 + 4 + piCount * 32 + 32);
  phase1Data[0] = 6; // VERIFY_PHASE1
  new DataView(phase1Data.buffer).setUint32(1, piCount, true);
  let off = 5;
  for (const pi of publicInputArrays) { phase1Data.set(pi, off); off += 32; }
  phase1Data.set(vkHash, off);

  const phase1Ix = new TransactionInstruction({
    programId: ultrahonkId,
    keys: [
      { pubkey: proofBuffer, isWritable: false, isSigner: false },      // proof_buffer
      { pubkey: vkAccountPubkeyFinal, isWritable: false, isSigner: false },  // vk_account
      { pubkey: stateKp.publicKey, isWritable: true, isSigner: false }, // state_account
      { pubkey: authority.publicKey, isWritable: true, isSigner: true },// authority
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }, // system_program
    ],
    data: Buffer.from(phase1Data),
  });

  const cuLimit1 = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const tx1 = new Transaction();
  tx1.add(cuLimit1, createStateIx, phase1Ix);

  log("Simulating VERIFY_PHASE1...");
  const { value: sim1 } = await conn.simulateTransaction(tx1, [authority, stateKp]);

  if (sim1.err) {
    log(`❌ Phase 1 failed: ${JSON.stringify(sim1.err)}`);
  } else {
    log(`✅ Phase 1 passed! CU: ${sim1.unitsConsumed}`);
  }
  if (sim1.logs) {
    log("--- Phase 1 Logs ---");
    for (const l of sim1.logs) {
      if (l.includes("Program log:") || l.includes("consumption:") || l.includes("consumed")) {
        console.log(`    ${l}`);
      }
    }
  }

  // Actually send the tx so phase 2 can use the state
  if (!sim1.err) {
    try {
      const sig1 = await sendAndConfirmTransaction(conn, tx1, [authority, stateKp], { commitment: "confirmed" });
      log(`✓ Phase 1 confirmed: ${sig1.slice(0, 20)}...`);
    } catch (e: any) {
      log(`❌ Phase 1 send failed: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`    ${l}`));
      await cleanupProver();
      return;
    }
  } else {
    await cleanupProver();
    return;
  }

  // ===========================================================================
  // PHASE 2: sumcheck rounds 8-14 (no shplemini)
  // ===========================================================================
  logSection("Step 5: VERIFY_PHASE2");

  // VERIFY_PHASE2 data: disc(1) + vk_hash(32)
  const phase2Data = new Uint8Array(1 + 32);
  phase2Data[0] = 7; // VERIFY_PHASE2
  phase2Data.set(vkHash, 1);

  const phase2Ix = new TransactionInstruction({
    programId: ultrahonkId,
    keys: [
      { pubkey: proofBuffer, isWritable: false, isSigner: false },      // proof_buffer
      { pubkey: vkAccountPubkeyFinal, isWritable: false, isSigner: false },  // vk_account
      { pubkey: stateKp.publicKey, isWritable: true, isSigner: false }, // state_account
    ],
    data: Buffer.from(phase2Data),
  });

  const cuLimit2 = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const tx2 = new Transaction();
  tx2.add(cuLimit2, phase2Ix);

  log("Simulating VERIFY_PHASE2...");
  const { value: sim2 } = await conn.simulateTransaction(tx2, [authority]);

  if (sim2.err) {
    log(`❌ Phase 2 failed: ${JSON.stringify(sim2.err)}`);
  } else {
    log(`✅ Phase 2 passed! CU: ${sim2.unitsConsumed}`);
  }
  if (sim2.logs) {
    log("--- Phase 2 Logs ---");
    for (const l of sim2.logs) {
      if (l.includes("Program log:") || l.includes("consumption:") || l.includes("consumed")) {
        console.log(`    ${l}`);
      }
    }
  }

  // Actually send phase 2 so phase 3 can use the state
  if (!sim2.err) {
    try {
      const sig2 = await sendAndConfirmTransaction(conn, tx2, [authority], { commitment: "confirmed" });
      log(`✓ Phase 2 confirmed: ${sig2.slice(0, 20)}...`);
    } catch (e: any) {
      log(`❌ Phase 2 send failed: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`    ${l}`));
      await cleanupProver();
      return;
    }
  } else {
    await cleanupProver();
    return;
  }

  // ===========================================================================
  // PHASE 3: shplemini scalar pre-computation (combined batch inverse)
  // ===========================================================================
  logSection("Step 6: VERIFY_PHASE3");

  // VERIFY_PHASE3 data: disc(1) + vk_hash(32)
  // Phase 3 does NOT need VK account — only proof_buffer + state_account
  const phase3Data = new Uint8Array(1 + 32);
  phase3Data[0] = 8; // VERIFY_PHASE3
  phase3Data.set(vkHash, 1);

  const phase3Ix = new TransactionInstruction({
    programId: ultrahonkId,
    keys: [
      { pubkey: proofBuffer, isWritable: false, isSigner: false },      // proof_buffer
      { pubkey: stateKp.publicKey, isWritable: true, isSigner: false }, // state_account
    ],
    data: Buffer.from(phase3Data),
  });

  const cuLimit3 = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const tx3 = new Transaction();
  tx3.add(cuLimit3, phase3Ix);

  log("Simulating VERIFY_PHASE3...");
  const { value: sim3 } = await conn.simulateTransaction(tx3, [authority]);

  if (sim3.err) {
    log(`❌ Phase 3 failed: ${JSON.stringify(sim3.err)}`);
  } else {
    log(`✅ Phase 3 passed! CU: ${sim3.unitsConsumed}`);
  }
  if (sim3.logs) {
    log("--- Phase 3 Logs ---");
    for (const l of sim3.logs) {
      if (l.includes("Program log:") || l.includes("consumption:") || l.includes("consumed")) {
        console.log(`    ${l}`);
      }
    }
  }

  // Actually send phase 3 so phase 4 can use the scalars
  if (!sim3.err) {
    try {
      const sig3 = await sendAndConfirmTransaction(conn, tx3, [authority], { commitment: "confirmed" });
      log(`✓ Phase 3 confirmed: ${sig3.slice(0, 20)}...`);
    } catch (e: any) {
      log(`❌ Phase 3 send failed: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`    ${l}`));
      await cleanupProver();
      return;
    }
  } else {
    await cleanupProver();
    return;
  }

  // ===========================================================================
  // PHASE 4: fold computation (no VK needed)
  // ===========================================================================
  logSection("Step 7: VERIFY_PHASE4 (fold)");

  // VERIFY_PHASE4 data: disc(1) + vk_hash(32)
  const phase4Data = new Uint8Array(1 + 32);
  phase4Data[0] = 9; // VERIFY_PHASE4
  phase4Data.set(vkHash, 1);

  const phase4Ix = new TransactionInstruction({
    programId: ultrahonkId,
    keys: [
      { pubkey: proofBuffer, isWritable: false, isSigner: false },      // proof_buffer
      { pubkey: stateKp.publicKey, isWritable: true, isSigner: false }, // state_account
    ],
    data: Buffer.from(phase4Data),
  });

  const cuLimit4 = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const tx4 = new Transaction();
  tx4.add(cuLimit4, phase4Ix);

  log("Simulating VERIFY_PHASE4...");
  const { value: sim4 } = await conn.simulateTransaction(tx4, [authority]);

  if (sim4.err) {
    log(`❌ Phase 4 failed: ${JSON.stringify(sim4.err)}`);
  } else {
    log(`✅ Phase 4 passed! CU: ${sim4.unitsConsumed}`);
  }
  if (sim4.logs) {
    log("--- Phase 4 Logs ---");
    for (const l of sim4.logs) {
      if (l.includes("Program log:") || l.includes("consumption:") || l.includes("consumed")) {
        console.log(`    ${l}`);
      }
    }
  }

  // Actually send phase 4 so phase 5 can use the fold results
  if (!sim4.err) {
    try {
      const sig4 = await sendAndConfirmTransaction(conn, tx4, [authority], { commitment: "confirmed" });
      log(`✓ Phase 4 confirmed: ${sig4.slice(0, 20)}...`);
    } catch (e: any) {
      log(`❌ Phase 4 send failed: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`    ${l}`));
      await cleanupProver();
      return;
    }
  } else {
    await cleanupProver();
    return;
  }

  // ===========================================================================
  // PHASE 5: MSM + pairing → verified
  // ===========================================================================
  logSection("Step 8: VERIFY_PHASE5 (MSM + pairing)");

  // VERIFY_PHASE5 data: disc(1) + vk_hash(32)
  const phase5Data = new Uint8Array(1 + 32);
  phase5Data[0] = 10; // VERIFY_PHASE5
  phase5Data.set(vkHash, 1);

  const phase5Ix = new TransactionInstruction({
    programId: ultrahonkId,
    keys: [
      { pubkey: proofBuffer, isWritable: false, isSigner: false },             // proof_buffer
      { pubkey: vkAccountPubkeyFinal, isWritable: false, isSigner: false },    // vk_account
      { pubkey: stateKp.publicKey, isWritable: true, isSigner: false },        // state_account
    ],
    data: Buffer.from(phase5Data),
  });

  const cuLimit5 = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const heapRequest5 = ComputeBudgetProgram.requestHeapFrame({ bytes: 64 * 1024 });
  const tx5 = new Transaction();
  tx5.add(cuLimit5, heapRequest5, phase5Ix);

  log("Simulating VERIFY_PHASE5...");
  const { value: sim5 } = await conn.simulateTransaction(tx5, [authority]);

  if (sim5.err) {
    log(`❌ Phase 5 failed: ${JSON.stringify(sim5.err)}`);
  } else {
    log(`✅ Phase 5 passed! CU: ${sim5.unitsConsumed}`);
  }
  if (sim5.logs) {
    log("--- Phase 5 Logs ---");
    for (const l of sim5.logs) {
      if (l.includes("Program log:") || l.includes("consumption:") || l.includes("consumed")) {
        console.log(`    ${l}`);
      }
    }
  }

  // Cleanup
  logSection("Cleanup");
  try {
    const closeTx = new Transaction();
    closeTx.add(createChadBufferCloseIx(cbPid, proofBuffer, authority.publicKey));
    await sendAndConfirmTransaction(conn, closeTx, [authority], { commitment: "confirmed" });
    log("✓ Buffer closed");
  } catch { log("⚠ Buffer close failed"); }

  await cleanupProver();
  log("✓ Done");

  // Summary
  logSection("CU Summary");
  log(`Phase 1 CU: ${sim1.unitsConsumed ?? "N/A"}`);
  log(`Phase 2 CU: ${sim2.unitsConsumed ?? "N/A"}`);
  log(`Phase 3 CU: ${sim3.unitsConsumed ?? "N/A"}`);
  log(`Phase 4 CU: ${sim4.unitsConsumed ?? "N/A"}`);
  log(`Phase 5 CU: ${sim5.unitsConsumed ?? "N/A"}`);
  const allCU = [sim1.unitsConsumed, sim2.unitsConsumed, sim3.unitsConsumed, sim4.unitsConsumed, sim5.unitsConsumed];
  if (allCU.every(c => c != null)) {
    log(`Total CU:   ${allCU.reduce((a, b) => a! + b!, 0)}`);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
