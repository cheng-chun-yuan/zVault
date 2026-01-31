#!/usr/bin/env bun
/**
 * Simple Buffer Mode Test
 *
 * Demonstrates the buffer mode instruction building without
 * requiring ChadBuffer to be deployed.
 *
 * This test:
 * 1. Generates mock proof data
 * 2. Builds claim/split instructions in buffer mode
 * 3. Shows the size savings vs inline mode
 *
 * Usage:
 *   bun run scripts/test-buffer-simple.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  AccountRole,
  getProgramDerivedAddress,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";

import {
  buildClaimInstruction,
  needsBuffer,
  hexToBytes,
} from "../src/instructions";
import { getConfig, setConfig } from "../src/config";
import { deriveNullifierRecordPDA, derivePoolStatePDA, deriveCommitmentTreePDA } from "../src/pda";

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = "https://api.devnet.solana.com";
const WS_URL = "wss://api.devnet.solana.com";

const DEFAULT_KEYPAIR_PATH = path.join(
  process.env.HOME || "~",
  ".config/solana/id.json"
);

// Mock proof size (12KB - typical UltraHonk)
const MOCK_PROOF_SIZE = 12 * 1024;

// =============================================================================
// Utilities
// =============================================================================

function loadKeypair(keypairPath: string): Uint8Array {
  const keyFile = fs.readFileSync(keypairPath, "utf-8");
  return new Uint8Array(JSON.parse(keyFile));
}

function createMockProof(size: number): Uint8Array {
  const proof = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    proof[i] = (i * 17 + 31) % 256;
  }
  return proof;
}

function createMock32Bytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i * 7) % 256;
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

async function deriveATA(owner: Address, mint: Address): Promise<[Address, number]> {
  const ataProgramId = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const tokenProgramId = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

  const result = await getProgramDerivedAddress({
    programAddress: ataProgramId,
    seeds: [
      bs58Decode(owner.toString()),
      bs58Decode(tokenProgramId.toString()),
      bs58Decode(mint.toString()),
    ],
  });
  return [result[0], result[1]];
}

// =============================================================================
// Main Test
// =============================================================================

async function testSimpleBuffer() {
  console.log("=".repeat(60));
  console.log("Simple Buffer Mode Test");
  console.log("=".repeat(60));

  setConfig("devnet");
  const config = getConfig();

  // Load keypair
  const keypairPath = process.env.KEYPAIR_PATH || DEFAULT_KEYPAIR_PATH;
  console.log(`\nLoading keypair from: ${keypairPath}`);

  let payer: KeyPairSigner;
  try {
    const secretKey = loadKeypair(keypairPath);
    payer = await createKeyPairSignerFromBytes(secretKey);
    console.log(`Payer: ${payer.address}`);
  } catch (error) {
    console.error(`Failed to load keypair: ${error}`);
    console.log("\nTo run this test:");
    console.log("  solana-keygen new");
    console.log("  solana airdrop 2 --url devnet");
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

  // Check balance
  const balanceResult = await rpc.getBalance(payer.address).send();
  const balance = Number(balanceResult.value) / 1e9;
  console.log(`Balance: ${balance.toFixed(4)} SOL`);

  if (balance < 0.1) {
    console.log("\nWARNING: Low balance. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // Generate mock proof
  console.log("\n--- Step 1: Generate Mock Proof ---");
  const proofBytes = createMockProof(MOCK_PROOF_SIZE);
  console.log(`Proof size: ${proofBytes.length} bytes (${(proofBytes.length / 1024).toFixed(1)} KB)`);
  console.log(`Needs buffer: ${needsBuffer(proofBytes)}`);

  // Create a simple data account to hold the proof
  // Format: [32-byte authority][proof data]
  console.log("\n--- Step 2: Create Buffer Account ---");
  const bufferKeypair = await generateKeyPairSigner();
  const bufferSize = 32 + proofBytes.length; // authority + proof

  // Build buffer data: authority (payer) + proof
  const bufferData = new Uint8Array(bufferSize);
  bufferData.set(bs58Decode(payer.address.toString()), 0); // authority
  bufferData.set(proofBytes, 32); // proof

  // Get rent exemption
  const rentExemption = await rpc.getMinimumBalanceForRentExemption(BigInt(bufferSize)).send();
  console.log(`Rent exemption: ${Number(rentExemption) / 1e9} SOL`);

  // Create account (owned by System Program - just a data account)
  const createAccountIx = getCreateAccountInstruction({
    payer,
    newAccount: bufferKeypair,
    lamports: rentExemption,
    space: BigInt(bufferSize),
    programAddress: address("11111111111111111111111111111111"), // System Program
  });

  // Get blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transaction
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(createAccountIx as any, msg)
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);

  // Send
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  try {
    await sendAndConfirm(signedTx as any, { commitment: "confirmed" });
    console.log(`Buffer account created: ${bufferKeypair.address}`);
  } catch (error: any) {
    console.error(`Failed to create buffer: ${error?.message || error}`);
    if (error?.context?.logs) {
      console.log("Logs:", error.context.logs);
    }
    process.exit(1);
  }

  // Now we need to write the data to the account
  // Note: System Program accounts are immutable after creation
  // For a real implementation, you'd use ChadBuffer or another program that allows writing

  console.log("\n--- Step 3: Build Claim Instruction (Buffer Mode) ---");

  // Derive PDAs
  const mockNullifier = createMock32Bytes(2);
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(mockNullifier, config.zvaultProgramId);
  const [recipientAta] = await deriveATA(payer.address, config.zbtcMint);

  const claimIx = buildClaimInstruction({
    proofSource: "buffer",
    bufferAddress: bufferKeypair.address,
    root: createMock32Bytes(1),
    nullifierHash: mockNullifier,
    amountSats: 100_000n,
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

  console.log(`Instruction data size: ${claimIx.data.length} bytes`);
  console.log(`Accounts: ${claimIx.accounts.length}`);
  console.log(`  - Pool State: ${poolState}`);
  console.log(`  - Commitment Tree: ${commitmentTree}`);
  console.log(`  - Nullifier Record: ${nullifierRecord}`);
  console.log(`  - Buffer: ${bufferKeypair.address}`);

  console.log("\n--- Summary ---");
  console.log("✓ Buffer account created on devnet");
  console.log("✓ Claim instruction built with buffer reference");
  console.log("✓ Instruction data is compact (no inline proof)");
  console.log(`\nBuffer mode saves: ${proofBytes.length - claimIx.data.length} bytes of tx space`);
  console.log("\nNote: Actual execution requires:");
  console.log("  1. Valid Merkle proof and root");
  console.log("  2. Real UltraHonk proof");
  console.log("  3. ChadBuffer or similar program for writing data");
}

testSimpleBuffer().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
