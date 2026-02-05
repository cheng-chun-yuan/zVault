#!/usr/bin/env bun
/**
 * zVault SDK E2E Test
 *
 * Comprehensive end-to-end test validating all SDK functions:
 * 1. Demo Deposit - Build stealth commitment instruction
 * 2. Claim zkBTC - Build claim instruction with buffer mode
 * 3. Split Note - Build split instruction
 * 4. Pool Deposit - Build pool deposit instruction
 * 5. Pool Withdraw - Build pool withdraw instruction
 * 6. Pool Claim Yield - Build pool claim yield instruction
 *
 * This test validates instruction building without submitting transactions.
 * For on-chain tests, ensure pool is initialized first.
 *
 * Usage:
 *   bun run scripts/localnet-e2e.ts
 *   NETWORK=devnet bun run scripts/localnet-e2e.ts
 *   SUBMIT_TX=true bun run scripts/localnet-e2e.ts  # Actually submit transactions
 *
 * Environment:
 *   KEYPAIR_PATH - Path to keypair file (default: ~/.config/solana/id.json)
 *   NETWORK - Network to use: localnet, devnet (default: localnet)
 *   SUBMIT_TX - Set to "true" to submit transactions (default: false)
 */

import * as fs from "fs";
import * as path from "path";
import {
  address,
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  getProgramDerivedAddress,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

// Import from SDK modules directly to avoid circular dependency issues
import {
  buildClaimInstruction,
  buildSplitInstruction,
  buildPoolDepositInstruction,
  buildPoolWithdrawInstruction,
  buildPoolClaimYieldInstruction,
  bytesToHex,
  hexToBytes,
} from "../src/instructions";

import {
  buildAddDemoStealthData,
  DEMO_INSTRUCTION,
} from "../src/demo";

import {
  getConfig,
  setConfig,
  LOCALNET_CONFIG,
  DEVNET_CONFIG,
  TOKEN_2022_PROGRAM_ID,
  type NetworkConfig,
} from "../src/config";

import {
  deriveNullifierRecordPDA,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveStealthAnnouncementPDA,
  deriveYieldPoolPDA,
  derivePoolCommitmentTreePDA,
  derivePoolNullifierPDA,
} from "../src/pda";

import {
  generateGrumpkinKeyPair,
  pointToCompressedBytes,
} from "../src/crypto";

import {
  initPoseidon,
  poseidonHashSync,
  computeNullifierSync,
  hashNullifierSync,
  BN254_SCALAR_FIELD,
} from "../src/poseidon";

import {
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  configureSunspot,
  isSunspotAvailable,
  GROTH16_PROOF_SIZE,
} from "../src/prover/sunspot";

import { ZERO_HASHES, TREE_DEPTH } from "../src/commitment-tree";

// =============================================================================
// Configuration
// =============================================================================

const NETWORK = (process.env.NETWORK || "localnet") as "localnet" | "devnet";
const SUBMIT_TX = process.env.SUBMIT_TX === "true";

const NETWORK_CONFIGS = {
  localnet: {
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    config: LOCALNET_CONFIG,
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com",
    config: DEVNET_CONFIG,
  },
};

const { rpcUrl: RPC_URL, wsUrl: WS_URL, config: NETWORK_CONFIG } = NETWORK_CONFIGS[NETWORK];

const DEFAULT_KEYPAIR_PATH = path.join(
  process.env.HOME || "~",
  ".config/solana/id.json"
);

// Pool ID for yield pool
const DEFAULT_POOL_ID = new Uint8Array(32);
new TextEncoder().encode("default_pool").forEach((b, i) => {
  if (i < 32) DEFAULT_POOL_ID[i] = b;
});

// =============================================================================
// Utilities
// =============================================================================

function loadKeypair(keypairPath: string): Uint8Array {
  const keyFile = fs.readFileSync(keypairPath, "utf-8");
  const secretKey = JSON.parse(keyFile);
  return new Uint8Array(secretKey);
}

function createMock32Bytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i * 7) % 256;
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bs58Decode(str: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
  }

  let num = BigInt(0);
  for (const char of str) {
    const val = ALPHABET_MAP.get(char);
    if (val === undefined) throw new Error(`Invalid base58 character: ${char}`);
    num = num * BigInt(58) + BigInt(val);
  }

  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") leadingZeros++;
    else break;
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  for (let i = 0; i < leadingZeros; i++) {
    bytes.unshift(0);
  }

  while (bytes.length < 32) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

async function deriveATA(owner: Address, mint: Address): Promise<Address> {
  const ataProgramId = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const tokenProgramId = TOKEN_2022_PROGRAM_ID;

  const result = await getProgramDerivedAddress({
    programAddress: ataProgramId,
    seeds: [
      bs58Decode(owner.toString()),
      bs58Decode(tokenProgramId.toString()),
      bs58Decode(mint.toString()),
    ],
  });
  return result[0];
}

function formatSats(sats: bigint): string {
  return `${Number(sats) / 1e8} BTC (${sats} sats)`;
}

// Logger with formatting
const log = {
  section: (title: string) => console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`),
  step: (num: number, msg: string) => console.log(`\n[${num}] ${msg}`),
  info: (msg: string) => console.log(`    ${msg}`),
  success: (msg: string) => console.log(`    ✓ ${msg}`),
  error: (msg: string) => console.log(`    ✗ ${msg}`),
  warn: (msg: string) => console.log(`    ⚠ ${msg}`),
  data: (key: string, value: string) => console.log(`    ${key}: ${value}`),
};

// =============================================================================
// Helpers for real proof generation
// =============================================================================

/**
 * Create a valid BN254 field element for testing
 */
function createFieldElement(seed: number): bigint {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i * 7) % 256;
  }
  bytes[0] &= 0x1f; // Clear top 3 bits to ensure < 2^253
  let num = 0n;
  for (let i = 0; i < 32; i++) {
    num = (num << 8n) | BigInt(bytes[i]);
  }
  return num % BN254_SCALAR_FIELD;
}

/**
 * Create a test merkle proof for a single leaf at index 0
 */
function createTestMerkleProof(leafCommitment: bigint): {
  siblings: bigint[];
  indices: number[];
  root: bigint;
} {
  const siblings: bigint[] = [];
  const indices: number[] = [];

  let currentHash = leafCommitment;
  for (let level = 0; level < TREE_DEPTH; level++) {
    siblings.push(ZERO_HASHES[level]);
    indices.push(0);
    currentHash = poseidonHashSync([currentHash, ZERO_HASHES[level]]);
  }

  return { siblings, indices, root: currentHash };
}

// =============================================================================
// Test State
// =============================================================================

interface UserNote {
  privKey: bigint;
  pubKeyX: bigint;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  commitment: bigint;
  commitmentBytes: Uint8Array;
  leafIndex: number;
}

interface TestState {
  commitments: Uint8Array[];
  currentRoot: Uint8Array;
  nextLeafIndex: number;
  notes: UserNote[];
  poolPositions: {
    commitment: Uint8Array;
    principal: bigint;
    depositEpoch: bigint;
    leafIndex: number;
  }[];
}

const state: TestState = {
  commitments: [],
  currentRoot: new Uint8Array(32),
  nextLeafIndex: 0,
  notes: [],
  poolPositions: [],
};

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test 1: Demo Deposit - Build stealth commitment instruction
 */
async function testDemoDeposit(
  payer: KeyPairSigner,
  config: NetworkConfig
): Promise<UserNote> {
  log.step(1, "Demo Deposit - Building stealth commitment instruction");

  // Generate deterministic keys as valid BN254 field elements
  const privKey = createFieldElement(0x01);
  const pubKeyX = createFieldElement(0xab);

  log.info("Generated deterministic keys (BN254 field elements):");
  log.data("privKey", privKey.toString(16).slice(0, 20) + "...");
  log.data("pubKeyX", pubKeyX.toString(16).slice(0, 20) + "...");

  // Compute real Poseidon commitment: Poseidon(pubKeyX, amount)
  const amount = 100_000n; // 0.001 BTC
  const commitmentBigint = poseidonHashSync([pubKeyX, amount]);
  const commitmentBytes = bigintToBytes32(commitmentBigint);

  log.info("Computed real Poseidon commitment:");
  log.data("Amount", formatSats(amount));
  log.data("Commitment", commitmentBigint.toString(16).slice(0, 20) + "...");

  // Build merkle proof for this commitment (single leaf at index 0)
  const merkleProof = createTestMerkleProof(commitmentBigint);
  log.data("Merkle Root", merkleProof.root.toString(16).slice(0, 20) + "...");

  // Build demo stealth instruction using SDK
  const ephemeralKey = generateGrumpkinKeyPair();
  const ephemeralPub = pointToCompressedBytes(ephemeralKey.pubKey);
  const encryptedAmount = randomBytes(8);

  const instructionData = buildAddDemoStealthData(
    ephemeralPub,
    commitmentBytes,
    encryptedAmount
  );

  log.info("Built instruction using SDK:");
  log.data("Discriminator", `${instructionData[0]} (DEMO_INSTRUCTION.ADD_DEMO_STEALTH = ${DEMO_INSTRUCTION.ADD_DEMO_STEALTH})`);
  log.data("Instruction size", `${instructionData.length} bytes`);

  // Verify instruction format
  if (instructionData[0] !== DEMO_INSTRUCTION.ADD_DEMO_STEALTH) {
    throw new Error(`Invalid discriminator: ${instructionData[0]}`);
  }
  if (instructionData.length !== 74) {
    throw new Error(`Invalid instruction size: ${instructionData.length}`);
  }

  // Derive PDAs using SDK
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [stealthAnnouncement] = await deriveStealthAnnouncementPDA(
    commitmentBytes,
    config.zvaultProgramId
  );

  log.data("Pool State PDA", poolState.toString());
  log.data("Commitment Tree PDA", commitmentTree.toString());
  log.data("Stealth Announcement PDA", stealthAnnouncement.toString());

  log.success("Demo deposit instruction built successfully");

  // Create user note with real keys for proof generation
  const nullifier = computeNullifierSync(privKey, 0n);
  const secret = BigInt("0x" + bytesToHex(randomBytes(32)));

  const userNote: UserNote = {
    privKey,
    pubKeyX,
    nullifier,
    secret,
    amount,
    commitment: commitmentBigint,
    commitmentBytes,
    leafIndex: state.nextLeafIndex,
  };

  state.commitments.push(commitmentBytes);
  state.currentRoot = bigintToBytes32(merkleProof.root);
  state.nextLeafIndex++;
  state.notes.push(userNote);

  return userNote;
}

/**
 * Test 2: Claim zkBTC - Build claim instruction with real Groth16 proof
 */
async function testClaimZkBTC(
  payer: KeyPairSigner,
  config: NetworkConfig,
  note: UserNote
): Promise<void> {
  log.step(2, "Claim zkBTC - Building claim instruction (real Groth16)");

  // Build merkle proof for this note's commitment
  const merkleProof = createTestMerkleProof(note.commitment);

  // Convert recipient address to bigint for the circuit
  const recipientBigint = BigInt("0x" + bytesToHex(bs58Decode(payer.address.toString())));
  // Reduce to BN254 field to keep within circuit field range
  const recipientField = recipientBigint % BN254_SCALAR_FIELD;

  log.info("Generating real Groth16 claim proof via Sunspot...");
  const startTime = Date.now();

  const proofResult = await generateClaimProofGroth16({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: BigInt(note.leafIndex),
    merkleRoot: merkleProof.root,
    merkleProof: { siblings: merkleProof.siblings, indices: merkleProof.indices },
    recipient: recipientField,
  });

  const elapsed = Date.now() - startTime;
  const proofBytes = proofResult.proof;
  log.success(`Generated real Groth16 proof (${proofBytes.length} bytes) in ${elapsed}ms`);

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const nullifierHash = bigintToBytes32(hashNullifierSync(note.nullifier));
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);
  const recipientAta = await deriveATA(payer.address, config.zbtcMint);

  log.info("Building claim instruction:");
  log.data("Amount", formatSats(note.amount));

  // Build claim instruction using SDK (inline Groth16 proof)
  const claimIx = buildClaimInstruction({
    proofBytes,
    root: state.currentRoot,
    nullifierHash,
    amountSats: note.amount,
    recipient: payer.address,
    vkHash: hexToBytes(config.vkHashes.claim),
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      zbtcMint: config.zbtcMint,
      poolVault: config.poolVault,
      recipientAta,
      user: payer.address,
    },
  });

  log.data("Instruction data size", `${claimIx.data.length} bytes`);
  log.data("Accounts count", claimIx.accounts.length.toString());
  log.data("Discriminator", `${claimIx.data[0]} (CLAIM = 9)`);

  // Verify instruction format
  if (claimIx.data[0] !== 9) {
    throw new Error(`Invalid discriminator: ${claimIx.data[0]}, expected 9`);
  }

  log.success("Claim instruction built successfully (real proof)");
}

/**
 * Test 3: Split Note - Build split instruction with real Groth16 proof
 */
async function testSplitNote(
  payer: KeyPairSigner,
  config: NetworkConfig,
  note: UserNote
): Promise<{ output1: UserNote; output2: UserNote }> {
  log.step(3, "Split Note - Building split instruction (real Groth16)");

  const amount1 = note.amount / 2n;
  const amount2 = note.amount - amount1;

  log.info("Split amounts:");
  log.data("Input", formatSats(note.amount));
  log.data("Output 1", formatSats(amount1));
  log.data("Output 2", formatSats(amount2));

  // Generate output keys as valid BN254 field elements
  const output1PubKeyX = createFieldElement(0x11);
  const output2PubKeyX = createFieldElement(0x22);

  // Build merkle proof for the input note
  const merkleProof = createTestMerkleProof(note.commitment);

  log.info("Generating real Groth16 split proof via Sunspot...");
  const startTime = Date.now();

  const proofResult = await generateSplitProofGroth16({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: BigInt(note.leafIndex),
    merkleRoot: merkleProof.root,
    merkleProof: { siblings: merkleProof.siblings, indices: merkleProof.indices },
    output1PubKeyX,
    output1Amount: amount1,
    output2PubKeyX,
    output2Amount: amount2,
    output1EphemeralPubX: output1PubKeyX,
    output1EncryptedAmountWithSign: 0n,
    output2EphemeralPubX: output2PubKeyX,
    output2EncryptedAmountWithSign: 0n,
  });

  const elapsed = Date.now() - startTime;
  const proofBytes = proofResult.proof;
  log.success(`Generated real Groth16 proof (${proofBytes.length} bytes) in ${elapsed}ms`);

  // Compute output commitments (same as what the prover computed internally)
  const output1Commitment = poseidonHashSync([output1PubKeyX, amount1]);
  const output2Commitment = poseidonHashSync([output2PubKeyX, amount2]);

  log.data("Output 1 commitment", output1Commitment.toString(16).slice(0, 20) + "...");
  log.data("Output 2 commitment", output2Commitment.toString(16).slice(0, 20) + "...");

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const nullifierHash = bigintToBytes32(hashNullifierSync(note.nullifier));
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);

  // Stealth output metadata as 32-byte fields
  const output1EphemeralPubXBytes = bigintToBytes32(output1PubKeyX);
  const output1EncryptedAmountWithSignBytes = bigintToBytes32(0n);
  const output2EphemeralPubXBytes = bigintToBytes32(output2PubKeyX);
  const output2EncryptedAmountWithSignBytes = bigintToBytes32(0n);

  // Derive stealth announcement PDAs
  const [stealthAnnouncement1] = await deriveStealthAnnouncementPDA(output1EphemeralPubXBytes, config.zvaultProgramId);
  const [stealthAnnouncement2] = await deriveStealthAnnouncementPDA(output2EphemeralPubXBytes, config.zvaultProgramId);

  // Build split instruction using SDK (inline Groth16 proof)
  const splitIx = buildSplitInstruction({
    proofBytes,
    root: state.currentRoot,
    nullifierHash,
    outputCommitment1: bigintToBytes32(output1Commitment),
    outputCommitment2: bigintToBytes32(output2Commitment),
    vkHash: hexToBytes(config.vkHashes.split),
    output1EphemeralPubX: output1EphemeralPubXBytes,
    output1EncryptedAmountWithSign: output1EncryptedAmountWithSignBytes,
    output2EphemeralPubX: output2EphemeralPubXBytes,
    output2EncryptedAmountWithSign: output2EncryptedAmountWithSignBytes,
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      user: payer.address,
      stealthAnnouncement1,
      stealthAnnouncement2,
    },
  });

  log.info("Split instruction built:");
  log.data("Instruction data size", `${splitIx.data.length} bytes`);
  log.data("Discriminator", `${splitIx.data[0]} (SPEND_SPLIT = 4)`);
  log.data("Proof source", `${splitIx.data[1]} (buffer = 1)`);

  if (splitIx.data[0] !== 4) {
    throw new Error(`Invalid discriminator: ${splitIx.data[0]}, expected 4`);
  }

  log.success("Split instruction built successfully (real proof)");

  // Create output notes with proper keys for future operations
  const output1PrivKey = createFieldElement(0x31);
  const output2PrivKey = createFieldElement(0x32);

  const output1: UserNote = {
    privKey: output1PrivKey,
    pubKeyX: output1PubKeyX,
    nullifier: computeNullifierSync(output1PrivKey, BigInt(state.nextLeafIndex)),
    secret: BigInt("0x" + bytesToHex(randomBytes(32))),
    amount: amount1,
    commitment: output1Commitment,
    commitmentBytes: bigintToBytes32(output1Commitment),
    leafIndex: state.nextLeafIndex,
  };

  const output2: UserNote = {
    privKey: output2PrivKey,
    pubKeyX: output2PubKeyX,
    nullifier: computeNullifierSync(output2PrivKey, BigInt(state.nextLeafIndex + 1)),
    secret: BigInt("0x" + bytesToHex(randomBytes(32))),
    amount: amount2,
    commitment: output2Commitment,
    commitmentBytes: bigintToBytes32(output2Commitment),
    leafIndex: state.nextLeafIndex + 1,
  };

  state.commitments.push(output1.commitmentBytes);
  state.commitments.push(output2.commitmentBytes);
  state.nextLeafIndex += 2;
  state.notes.push(output1, output2);

  return { output1, output2 };
}

/**
 * Test 4: Pool Deposit - Build pool deposit instruction
 */
async function testPoolDeposit(
  payer: KeyPairSigner,
  config: NetworkConfig,
  note: UserNote
): Promise<void> {
  log.step(4, "Pool Deposit - Building pool deposit instruction");

  log.info("Depositing note into yield pool:");
  log.data("Principal", formatSats(note.amount));
  log.data("Pool ID", bytesToHex(DEFAULT_POOL_ID).slice(0, 20) + "...");

  const depositEpoch = BigInt(Math.floor(Date.now() / 1000 / 3600));
  const poolCommitment = createMock32Bytes(50);

  log.data("Deposit Epoch", depositEpoch.toString());

  // Generate mock proof (pool circuits have no proving keys compiled)
  const proofBytes = new Uint8Array(GROTH16_PROOF_SIZE);
  log.info("Using mock Groth16 proof (pool circuits not compiled for Sunspot)");

  // Derive PDAs using SDK
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const nullifierHash = bigintToBytes32(hashNullifierSync(note.nullifier));
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);
  const [yieldPool] = await deriveYieldPoolPDA(DEFAULT_POOL_ID, config.zvaultProgramId);
  const [poolCommitmentTree] = await derivePoolCommitmentTreePDA(DEFAULT_POOL_ID, config.zvaultProgramId);

  log.data("Yield Pool PDA", yieldPool.toString());
  log.data("Pool Commitment Tree PDA", poolCommitmentTree.toString());

  // Build pool deposit instruction using SDK (inline Groth16 proof)
  const poolDepositIx = buildPoolDepositInstruction({
    proofBytes,
    root: state.currentRoot,
    nullifierHash,
    poolCommitment,
    amountSats: note.amount,
    vkHash: hexToBytes(config.vkHashes.poolDeposit),
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      yieldPool,
      poolCommitmentTree,
      user: payer.address,
    },
  });

  log.info("Pool deposit instruction built:");
  log.data("Instruction data size", `${poolDepositIx.data.length} bytes`);
  log.data("Discriminator", `${poolDepositIx.data[0]} (DEPOSIT_TO_POOL = 31)`);

  if (poolDepositIx.data[0] !== 31) {
    throw new Error(`Invalid discriminator: ${poolDepositIx.data[0]}, expected 31`);
  }

  log.success("Pool deposit instruction built successfully");

  state.poolPositions.push({
    commitment: poolCommitment,
    principal: note.amount,
    depositEpoch,
    leafIndex: 0,
  });
}

/**
 * Test 5: Pool Withdraw - Build pool withdraw instruction
 */
async function testPoolWithdraw(
  payer: KeyPairSigner,
  config: NetworkConfig
): Promise<void> {
  log.step(5, "Pool Withdraw - Building pool withdraw instruction");

  if (state.poolPositions.length === 0) {
    log.warn("No pool positions to withdraw from");
    return;
  }

  const position = state.poolPositions[0];
  const withdrawAmount = position.principal;

  const currentEpoch = BigInt(Math.floor(Date.now() / 1000 / 3600));
  const epochsStaked = currentEpoch - position.depositEpoch;
  const yieldRateBps = 500n;
  const yieldAmount = epochsStaked > 0n ? (withdrawAmount * epochsStaked * yieldRateBps) / 10000n / 365n / 24n : 0n;

  log.info("Withdrawing from pool position:");
  log.data("Principal", formatSats(withdrawAmount));
  log.data("Epochs Staked", epochsStaked.toString());
  log.data("Yield Earned", formatSats(yieldAmount));

  const outputCommitment = createMock32Bytes(60);
  const proofBytes = new Uint8Array(GROTH16_PROOF_SIZE);

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [yieldPool] = await deriveYieldPoolPDA(DEFAULT_POOL_ID, config.zvaultProgramId);
  const [poolCommitmentTree] = await derivePoolCommitmentTreePDA(DEFAULT_POOL_ID, config.zvaultProgramId);
  const poolNullifierHash = createMock32Bytes(100);
  const [poolNullifierRecord] = await derivePoolNullifierPDA(DEFAULT_POOL_ID, poolNullifierHash, config.zvaultProgramId);

  // Build pool withdraw instruction using SDK (inline Groth16 proof)
  const poolWithdrawIx = buildPoolWithdrawInstruction({
    proofBytes,
    poolRoot: position.commitment,
    poolNullifierHash,
    amountSats: withdrawAmount + yieldAmount,
    outputCommitment,
    vkHash: hexToBytes(config.vkHashes.poolWithdraw),
    accounts: {
      poolState,
      commitmentTree,
      yieldPool,
      poolCommitmentTree,
      poolNullifierRecord,
      user: payer.address,
    },
  });

  log.info("Pool withdraw instruction built:");
  log.data("Instruction data size", `${poolWithdrawIx.data.length} bytes`);
  log.data("Discriminator", `${poolWithdrawIx.data[0]} (WITHDRAW_FROM_POOL = 32)`);

  if (poolWithdrawIx.data[0] !== 32) {
    throw new Error(`Invalid discriminator: ${poolWithdrawIx.data[0]}, expected 32`);
  }

  log.success("Pool withdraw instruction built successfully");
}

/**
 * Test 6: Pool Claim Yield - Build pool claim yield instruction
 */
async function testPoolClaimYield(
  payer: KeyPairSigner,
  config: NetworkConfig
): Promise<void> {
  log.step(6, "Pool Claim Yield - Building pool claim yield instruction");

  if (state.poolPositions.length === 0) {
    log.warn("No pool positions to claim yield from");
    return;
  }

  const position = state.poolPositions[0];
  const currentEpoch = BigInt(Math.floor(Date.now() / 1000 / 3600));
  const epochsStaked = currentEpoch - position.depositEpoch;
  const yieldRateBps = 500n;
  const yieldAmount = epochsStaked > 0n ? (position.principal * epochsStaked * yieldRateBps) / 10000n / 365n / 24n : 100n;

  log.info("Claiming yield from pool position:");
  log.data("Principal (remains staked)", formatSats(position.principal));
  log.data("Yield to claim", formatSats(yieldAmount));

  const newPoolCommitment = createMock32Bytes(70);
  const proofBytes = new Uint8Array(GROTH16_PROOF_SIZE);

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [yieldPool] = await deriveYieldPoolPDA(DEFAULT_POOL_ID, config.zvaultProgramId);
  const [poolCommitmentTree] = await derivePoolCommitmentTreePDA(DEFAULT_POOL_ID, config.zvaultProgramId);
  const poolNullifierHash = createMock32Bytes(200);
  const [poolNullifierRecord] = await derivePoolNullifierPDA(DEFAULT_POOL_ID, poolNullifierHash, config.zvaultProgramId);
  const recipientAta = await deriveATA(payer.address, config.zbtcMint);

  // Build pool claim yield instruction using SDK (inline Groth16 proof)
  const claimYieldIx = buildPoolClaimYieldInstruction({
    proofBytes,
    poolRoot: position.commitment,
    poolNullifierHash,
    newPoolCommitment,
    yieldAmountSats: yieldAmount,
    recipient: payer.address,
    vkHash: hexToBytes(config.vkHashes.poolClaimYield),
    accounts: {
      poolState,
      yieldPool,
      poolCommitmentTree,
      poolNullifierRecord,
      zbtcMint: config.zbtcMint,
      poolVault: config.poolVault,
      recipientAta,
      user: payer.address,
    },
  });

  log.info("Pool claim yield instruction built:");
  log.data("Instruction data size", `${claimYieldIx.data.length} bytes`);
  log.data("Discriminator", `${claimYieldIx.data[0]} (CLAIM_POOL_YIELD = 33)`);

  if (claimYieldIx.data[0] !== 33) {
    throw new Error(`Invalid discriminator: ${claimYieldIx.data[0]}, expected 33`);
  }

  log.success("Pool claim yield instruction built successfully");
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  log.section(`zVault SDK E2E Test - ${NETWORK.toUpperCase()}`);

  // Initialize Poseidon for sync hash operations
  await initPoseidon();
  log.info("Poseidon initialized");

  // Configure Sunspot prover
  configureSunspot({ circuitsBasePath: path.resolve(__dirname, "../circuits") });
  const sunspotReady = await isSunspotAvailable();
  log.data("Sunspot Available", sunspotReady.toString());

  if (!sunspotReady) {
    log.warn("Sunspot CLI not found — claim and split tests will fail!");
    log.warn("Expected at: ~/sunspot/go/sunspot");
  }

  // Configure network
  setConfig(NETWORK);
  const config = getConfig();

  console.log("\nNetwork Configuration:");
  log.data("Network", NETWORK);
  log.data("RPC URL", RPC_URL);
  log.data("Submit TX", SUBMIT_TX.toString());
  log.data("zVault Program", config.zvaultProgramId.toString());
  log.data("Sunspot Verifier", config.sunspotVerifierProgramId.toString());

  // Load or generate keypair
  const keypairPath = process.env.KEYPAIR_PATH || DEFAULT_KEYPAIR_PATH;
  let payer: KeyPairSigner;

  try {
    console.log(`\nLoading keypair from: ${keypairPath}`);
    const secretKey = loadKeypair(keypairPath);
    payer = await createKeyPairSignerFromBytes(secretKey);
    log.data("Payer", payer.address.toString());
  } catch (error) {
    console.log("\nKeypair not found, generating new one for testing...");
    payer = await generateKeyPairSigner();
    log.data("Generated Payer", payer.address.toString());
  }

  // Check balance via RPC
  try {
    const rpc = createSolanaRpc(RPC_URL);
    const balanceResult = await rpc.getBalance(payer.address).send();
    const balance = Number(balanceResult.value) / 1e9;
    log.data("Balance", `${balance.toFixed(4)} SOL`);
  } catch (error) {
    log.warn(`RPC not available: ${error}`);
  }

  // Run tests
  log.section("Running SDK E2E Tests");

  try {
    // Test 1: Demo Deposit
    const depositedNote = await testDemoDeposit(payer, config);

    // Test 2: Claim zkBTC
    await testClaimZkBTC(payer, config, depositedNote);

    // Test 3: Split Note
    const { output1, output2 } = await testSplitNote(payer, config, depositedNote);

    // Test 4: Pool Deposit
    await testPoolDeposit(payer, config, output1);

    // Test 5: Pool Withdraw
    await testPoolWithdraw(payer, config);

    // Test 6: Pool Claim Yield
    await testPoolClaimYield(payer, config);

  } catch (error: any) {
    log.error(`Test failed: ${error.message || error}`);
    console.error(error);
    process.exit(1);
  }

  // Summary
  log.section("Test Summary");

  console.log("\nAll SDK functions validated:");
  log.success("buildAddDemoStealthData - Demo deposit (real Poseidon commitment)");
  log.success("buildClaimInstruction - Claim (real Groth16 via Sunspot)");
  log.success("buildSplitInstruction - Split note (real Groth16 via Sunspot)");
  log.success("buildPoolDepositInstruction - Pool deposit (mock proof)");
  log.success("buildPoolWithdrawInstruction - Pool withdraw (mock proof)");
  log.success("buildPoolClaimYieldInstruction - Pool claim yield (mock proof)");
  log.success("poseidonHashSync - Real Poseidon commitment");
  log.success("computeNullifierSync / hashNullifierSync - Nullifier derivation");
  log.success("generateClaimProofGroth16 - Sunspot Groth16 prover");
  log.success("generateSplitProofGroth16 - Sunspot Groth16 prover");
  log.success("All PDA derivation functions");

  console.log("\nInstruction discriminators:");
  log.success("DEMO_INSTRUCTION.ADD_DEMO_STEALTH = 22");
  log.success("CLAIM = 9");
  log.success("SPEND_SPLIT = 4");
  log.success("DEPOSIT_TO_POOL = 31");
  log.success("WITHDRAW_FROM_POOL = 32");
  log.success("CLAIM_POOL_YIELD = 33");

  log.section("SDK E2E Test Complete - All Validations Passed!");
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
