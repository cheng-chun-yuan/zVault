/**
 * Localnet test for Name Registry
 *
 * Run:
 *   1. Start local validator: solana-test-validator
 *   2. Deploy program: solana program deploy target/deploy/zvault_pinocchio.so
 *   3. Run test: bun run scripts/test-name-registry.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "3Df8Xv9hMtVVLRxagnbCsofvgn18yPzfCqTmbUEnx9KF"
);

// Instruction discriminators (must match lib.rs)
const REGISTER_NAME = 17;
const UPDATE_NAME = 18;
const TRANSFER_NAME = 19;

// Name registry constants
const NAME_REGISTRY_SEED = "zkey";
const NAME_REGISTRY_DISCRIMINATOR = 0x09;

// =============================================================================
// Helper Functions (from SDK)
// =============================================================================

function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim();
  if (normalized.endsWith(".zkey")) {
    normalized = normalized.slice(0, -5);
  }
  return normalized;
}

function hashName(name: string): Uint8Array {
  const normalized = normalizeName(name);
  const encoder = new TextEncoder();
  return sha256(encoder.encode(normalized));
}

function deriveNamePDA(name: string, programId: PublicKey): [PublicKey, number] {
  const nameHash = hashName(name);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(NAME_REGISTRY_SEED), Buffer.from(nameHash)],
    programId
  );
}

function buildRegisterNameData(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array
): Buffer {
  const normalized = normalizeName(name);
  const nameBytes = Buffer.from(normalized);
  const nameHash = hashName(normalized);

  // Layout: discriminator (1) + name_len (1) + name + name_hash (32) + spending (33) + viewing (32)
  const data = Buffer.alloc(1 + 1 + nameBytes.length + 32 + 33 + 32);
  let offset = 0;

  data[offset++] = REGISTER_NAME;
  data[offset++] = nameBytes.length;
  nameBytes.copy(data, offset);
  offset += nameBytes.length;
  Buffer.from(nameHash).copy(data, offset);
  offset += 32;
  Buffer.from(spendingPubKey).copy(data, offset);
  offset += 33;
  Buffer.from(viewingPubKey).copy(data, offset);

  return data;
}

function parseNameRegistry(data: Buffer): {
  discriminator: number;
  bump: number;
  nameHash: Buffer;
  owner: Buffer;
  spendingPubKey: Buffer;
  viewingPubKey: Buffer;
  createdAt: bigint;
  updatedAt: bigint;
} | null {
  if (data.length < 179 || data[0] !== NAME_REGISTRY_DISCRIMINATOR) {
    return null;
  }

  return {
    discriminator: data[0],
    bump: data[1],
    nameHash: data.subarray(2, 34),
    owner: data.subarray(34, 66),
    spendingPubKey: data.subarray(66, 99),
    viewingPubKey: data.subarray(99, 131),
    createdAt: data.readBigInt64LE(131),
    updatedAt: data.readBigInt64LE(139),
  };
}

// =============================================================================
// Test Functions
// =============================================================================

async function loadKeypair(path: string): Promise<Keypair> {
  const secretKey = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function airdropIfNeeded(connection: Connection, pubkey: PublicKey) {
  const balance = await connection.getBalance(pubkey);
  if (balance < LAMPORTS_PER_SOL) {
    console.log("Airdropping 2 SOL...");
    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }
}

async function testRegisterName(
  connection: Connection,
  payer: Keypair,
  name: string
): Promise<boolean> {
  console.log(`\n--- Testing REGISTER_NAME: ${name}.zkey ---`);

  // Generate mock stealth keys
  const spendingPubKey = new Uint8Array(33);
  spendingPubKey[0] = 0x02; // Compressed point prefix
  crypto.getRandomValues(spendingPubKey.subarray(1));

  const viewingPubKey = new Uint8Array(32);
  crypto.getRandomValues(viewingPubKey);

  // Derive PDA
  const [namePDA, bump] = deriveNamePDA(name, PROGRAM_ID);
  console.log(`  PDA: ${namePDA.toBase58()}`);
  console.log(`  Bump: ${bump}`);

  // Build instruction
  const instructionData = buildRegisterNameData(name, spendingPubKey, viewingPubKey);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: namePDA, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });

  try {
    const tx = new Transaction().add(instruction);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    console.log(`  ✓ Registered! TX: ${sig.slice(0, 20)}...`);

    // Verify on-chain
    const accountInfo = await connection.getAccountInfo(namePDA);
    if (!accountInfo) {
      console.log("  ✗ Account not found after registration");
      return false;
    }

    const parsed = parseNameRegistry(Buffer.from(accountInfo.data));
    if (!parsed) {
      console.log("  ✗ Failed to parse account data");
      return false;
    }

    console.log(`  ✓ Verified on-chain:`);
    console.log(`    Owner: ${new PublicKey(parsed.owner).toBase58()}`);
    console.log(`    Spending: ${parsed.spendingPubKey.toString("hex").slice(0, 20)}...`);
    console.log(`    Viewing: ${parsed.viewingPubKey.toString("hex").slice(0, 20)}...`);

    return true;
  } catch (err: any) {
    console.log(`  ✗ Failed: ${err.message}`);
    if (err.logs) {
      console.log("  Logs:", err.logs.slice(-3).join("\n    "));
    }
    return false;
  }
}

async function testLookupName(
  connection: Connection,
  name: string
): Promise<boolean> {
  console.log(`\n--- Testing LOOKUP: ${name}.zkey ---`);

  const [namePDA] = deriveNamePDA(name, PROGRAM_ID);

  try {
    const accountInfo = await connection.getAccountInfo(namePDA);
    if (!accountInfo) {
      console.log("  Name not found (expected for unregistered names)");
      return false;
    }

    const parsed = parseNameRegistry(Buffer.from(accountInfo.data));
    if (!parsed) {
      console.log("  ✗ Invalid account data");
      return false;
    }

    console.log(`  ✓ Found ${name}.zkey`);
    console.log(`    Owner: ${new PublicKey(parsed.owner).toBase58().slice(0, 20)}...`);
    return true;
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
    return false;
  }
}

async function testDuplicateRegistration(
  connection: Connection,
  payer: Keypair,
  name: string
): Promise<boolean> {
  console.log(`\n--- Testing DUPLICATE REGISTRATION: ${name}.zkey ---`);

  const spendingPubKey = new Uint8Array(33);
  spendingPubKey[0] = 0x02;
  crypto.getRandomValues(spendingPubKey.subarray(1));

  const viewingPubKey = new Uint8Array(32);
  crypto.getRandomValues(viewingPubKey);

  const [namePDA] = deriveNamePDA(name, PROGRAM_ID);
  const instructionData = buildRegisterNameData(name, spendingPubKey, viewingPubKey);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: namePDA, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });

  try {
    const tx = new Transaction().add(instruction);
    await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    console.log("  ✗ Should have failed (duplicate registration)");
    return false;
  } catch (err: any) {
    if (err.message.includes("already initialized") || err.message.includes("0x0")) {
      console.log("  ✓ Correctly rejected duplicate registration");
      return true;
    }
    console.log(`  ✓ Rejected with: ${err.message.slice(0, 50)}...`);
    return true;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("============================================================");
  console.log("Name Registry Localnet Test");
  console.log("============================================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);

  const connection = new Connection(RPC_URL, "confirmed");

  // Load or create keypair
  let payer: Keypair;
  const keypairPath = process.env.KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;

  if (fs.existsSync(keypairPath)) {
    payer = await loadKeypair(keypairPath);
    console.log(`Payer: ${payer.publicKey.toBase58()}`);
  } else {
    payer = Keypair.generate();
    console.log(`Generated new payer: ${payer.publicKey.toBase58()}`);
  }

  // Ensure payer has funds
  await airdropIfNeeded(connection, payer.publicKey);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Run tests
  const testName = `test_${Date.now() % 100000}`;

  let passed = 0;
  let failed = 0;

  // Test 1: Register a new name
  if (await testRegisterName(connection, payer, testName)) {
    passed++;
  } else {
    failed++;
  }

  // Test 2: Lookup the registered name
  if (await testLookupName(connection, testName)) {
    passed++;
  } else {
    failed++;
  }

  // Test 3: Try to register duplicate (should fail)
  if (await testDuplicateRegistration(connection, payer, testName)) {
    passed++;
  } else {
    failed++;
  }

  // Test 4: Lookup non-existent name
  console.log("\n--- Testing LOOKUP: nonexistent_name.zkey ---");
  const [nonExistentPDA] = deriveNamePDA("nonexistent_name_xyz", PROGRAM_ID);
  const nonExistentInfo = await connection.getAccountInfo(nonExistentPDA);
  if (!nonExistentInfo) {
    console.log("  ✓ Correctly returned null for non-existent name");
    passed++;
  } else {
    console.log("  ✗ Unexpected: found account for non-existent name");
    failed++;
  }

  // Summary
  console.log("\n============================================================");
  console.log("TEST SUMMARY");
  console.log("============================================================");
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
