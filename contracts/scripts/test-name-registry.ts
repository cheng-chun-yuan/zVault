/**
 * Comprehensive Name Registry Test
 *
 * Tests all name registry instructions:
 * - REGISTER_NAME (17): Register a new .zkey name
 * - UPDATE_NAME (18): Update keys for existing name
 * - TRANSFER_NAME (19): Transfer ownership to new wallet
 *
 * Run:
 *   1. Start local validator: solana-test-validator --reset
 *   2. Deploy program: bun run deploy:localnet
 *   3. Run test: PROGRAM_ID=<deployed_id> bun run test:name
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

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "3Df8Xv9hMtVVLRxagnbCsofvgn18yPzfCqTmbUEnx9KF"
);

// Instruction discriminators (must match lib.rs)
const Instruction = {
  REGISTER_NAME: 17,
  UPDATE_NAME: 18,
  TRANSFER_NAME: 19,
} as const;

// Name registry constants
const NAME_REGISTRY_SEED = "zkey";
const NAME_REGISTRY_DISCRIMINATOR = 0x09;
const NAME_REGISTRY_SIZE = 179;

// =============================================================================
// Types
// =============================================================================

interface NameRegistryData {
  discriminator: number;
  bump: number;
  nameHash: Buffer;
  owner: PublicKey;
  spendingPubKey: Buffer;
  viewingPubKey: Buffer;
  createdAt: bigint;
  updatedAt: bigint;
}

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

// =============================================================================
// Helper Functions
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
  return sha256(new TextEncoder().encode(normalized));
}

function deriveNamePDA(name: string): [PublicKey, number] {
  const nameHash = hashName(name);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(NAME_REGISTRY_SEED), Buffer.from(nameHash)],
    PROGRAM_ID
  );
}

function generateMockKeys(): { spending: Uint8Array; viewing: Uint8Array } {
  const spending = new Uint8Array(33);
  spending[0] = 0x02; // Compressed point prefix
  crypto.getRandomValues(spending.subarray(1));

  const viewing = new Uint8Array(32);
  crypto.getRandomValues(viewing);

  return { spending, viewing };
}

function parseNameRegistry(data: Buffer): NameRegistryData | null {
  if (data.length < NAME_REGISTRY_SIZE || data[0] !== NAME_REGISTRY_DISCRIMINATOR) {
    return null;
  }

  return {
    discriminator: data[0],
    bump: data[1],
    nameHash: data.subarray(2, 34),
    owner: new PublicKey(data.subarray(34, 66)),
    spendingPubKey: data.subarray(66, 99),
    viewingPubKey: data.subarray(99, 131),
    createdAt: data.readBigInt64LE(131),
    updatedAt: data.readBigInt64LE(139),
  };
}

// =============================================================================
// Instruction Builders
// =============================================================================

function buildRegisterNameIx(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  payer: PublicKey
): TransactionInstruction {
  const normalized = normalizeName(name);
  const nameBytes = Buffer.from(normalized);
  const nameHash = hashName(normalized);
  const [namePDA] = deriveNamePDA(name);

  // Layout: discriminator (1) + name_len (1) + name + name_hash (32) + spending (33) + viewing (32)
  const data = Buffer.alloc(1 + 1 + nameBytes.length + 32 + 33 + 32);
  let offset = 0;

  data[offset++] = Instruction.REGISTER_NAME;
  data[offset++] = nameBytes.length;
  nameBytes.copy(data, offset);
  offset += nameBytes.length;
  Buffer.from(nameHash).copy(data, offset);
  offset += 32;
  Buffer.from(spendingPubKey).copy(data, offset);
  offset += 33;
  Buffer.from(viewingPubKey).copy(data, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: namePDA, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function buildUpdateNameIx(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  owner: PublicKey
): TransactionInstruction {
  const nameHash = hashName(name);
  const [namePDA] = deriveNamePDA(name);

  // Layout: discriminator (1) + name_hash (32) + spending (33) + viewing (32)
  const data = Buffer.alloc(1 + 32 + 33 + 32);
  let offset = 0;

  data[offset++] = Instruction.UPDATE_NAME;
  Buffer.from(nameHash).copy(data, offset);
  offset += 32;
  Buffer.from(spendingPubKey).copy(data, offset);
  offset += 33;
  Buffer.from(viewingPubKey).copy(data, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: namePDA, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function buildTransferNameIx(
  name: string,
  currentOwner: PublicKey,
  newOwner: PublicKey
): TransactionInstruction {
  const nameHash = hashName(name);
  const [namePDA] = deriveNamePDA(name);

  // Layout: discriminator (1) + name_hash (32)
  const data = Buffer.alloc(1 + 32);
  data[0] = Instruction.TRANSFER_NAME;
  Buffer.from(nameHash).copy(data, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: namePDA, isSigner: false, isWritable: true },
      { pubkey: currentOwner, isSigner: true, isWritable: false },
      { pubkey: newOwner, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// =============================================================================
// Test Utilities
// =============================================================================

async function loadKeypair(path: string): Promise<Keypair> {
  const secretKey = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function ensureFunded(connection: Connection, pubkey: PublicKey, minBalance = LAMPORTS_PER_SOL) {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }
}

async function sendTx(
  connection: Connection,
  instruction: TransactionInstruction,
  signers: Keypair[]
): Promise<string> {
  const tx = new Transaction().add(instruction);
  return await sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
}

async function getNameRegistry(connection: Connection, name: string): Promise<NameRegistryData | null> {
  const [pda] = deriveNamePDA(name);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseNameRegistry(Buffer.from(info.data));
}

// =============================================================================
// Test Cases
// =============================================================================

async function testRegisterName(
  connection: Connection,
  payer: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `REGISTER_NAME: ${name}.zkey`;

  try {
    const keys = generateMockKeys();
    const ix = buildRegisterNameIx(name, keys.spending, keys.viewing, payer.publicKey);
    const sig = await sendTx(connection, ix, [payer]);

    // Verify on-chain
    const registry = await getNameRegistry(connection, name);
    if (!registry) {
      return { name: testName, passed: false, message: "Account not found after registration" };
    }

    if (!registry.owner.equals(payer.publicKey)) {
      return { name: testName, passed: false, message: "Owner mismatch" };
    }

    if (!Buffer.from(keys.spending).equals(registry.spendingPubKey)) {
      return { name: testName, passed: false, message: "Spending key mismatch" };
    }

    return { name: testName, passed: true, message: `TX: ${sig.slice(0, 16)}...` };
  } catch (err: any) {
    return { name: testName, passed: false, message: err.message.slice(0, 60) };
  }
}

async function testRegisterDuplicate(
  connection: Connection,
  payer: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `REGISTER_NAME duplicate: ${name}.zkey`;

  try {
    const keys = generateMockKeys();
    const ix = buildRegisterNameIx(name, keys.spending, keys.viewing, payer.publicKey);
    await sendTx(connection, ix, [payer]);

    return { name: testName, passed: false, message: "Should have rejected duplicate" };
  } catch (err: any) {
    return { name: testName, passed: true, message: "Correctly rejected" };
  }
}

async function testUpdateName(
  connection: Connection,
  owner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `UPDATE_NAME: ${name}.zkey`;

  try {
    const newKeys = generateMockKeys();
    const ix = buildUpdateNameIx(name, newKeys.spending, newKeys.viewing, owner.publicKey);
    const sig = await sendTx(connection, ix, [owner]);

    // Verify update
    const registry = await getNameRegistry(connection, name);
    if (!registry) {
      return { name: testName, passed: false, message: "Account not found" };
    }

    if (!Buffer.from(newKeys.spending).equals(registry.spendingPubKey)) {
      return { name: testName, passed: false, message: "Spending key not updated" };
    }

    if (!Buffer.from(newKeys.viewing).equals(registry.viewingPubKey)) {
      return { name: testName, passed: false, message: "Viewing key not updated" };
    }

    return { name: testName, passed: true, message: `TX: ${sig.slice(0, 16)}...` };
  } catch (err: any) {
    return { name: testName, passed: false, message: err.message.slice(0, 60) };
  }
}

async function testUpdateNameUnauthorized(
  connection: Connection,
  notOwner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `UPDATE_NAME unauthorized: ${name}.zkey`;

  try {
    const newKeys = generateMockKeys();
    const ix = buildUpdateNameIx(name, newKeys.spending, newKeys.viewing, notOwner.publicKey);
    await sendTx(connection, ix, [notOwner]);

    return { name: testName, passed: false, message: "Should have rejected unauthorized update" };
  } catch (err: any) {
    return { name: testName, passed: true, message: "Correctly rejected" };
  }
}

async function testTransferName(
  connection: Connection,
  currentOwner: Keypair,
  newOwner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `TRANSFER_NAME: ${name}.zkey`;

  try {
    const ix = buildTransferNameIx(name, currentOwner.publicKey, newOwner.publicKey);
    const sig = await sendTx(connection, ix, [currentOwner]);

    // Verify transfer
    const registry = await getNameRegistry(connection, name);
    if (!registry) {
      return { name: testName, passed: false, message: "Account not found" };
    }

    if (!registry.owner.equals(newOwner.publicKey)) {
      return { name: testName, passed: false, message: "Owner not transferred" };
    }

    return { name: testName, passed: true, message: `TX: ${sig.slice(0, 16)}...` };
  } catch (err: any) {
    return { name: testName, passed: false, message: err.message.slice(0, 60) };
  }
}

async function testTransferNameUnauthorized(
  connection: Connection,
  notOwner: Keypair,
  targetOwner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `TRANSFER_NAME unauthorized: ${name}.zkey`;

  try {
    const ix = buildTransferNameIx(name, notOwner.publicKey, targetOwner.publicKey);
    await sendTx(connection, ix, [notOwner]);

    return { name: testName, passed: false, message: "Should have rejected unauthorized transfer" };
  } catch (err: any) {
    return { name: testName, passed: true, message: "Correctly rejected" };
  }
}

async function testLookupNonExistent(connection: Connection): Promise<TestResult> {
  const testName = "LOOKUP non-existent name";
  const registry = await getNameRegistry(connection, "nonexistent_xyz_123");

  if (registry === null) {
    return { name: testName, passed: true, message: "Correctly returned null" };
  }
  return { name: testName, passed: false, message: "Should not find non-existent name" };
}

async function testNewOwnerCanUpdate(
  connection: Connection,
  newOwner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `UPDATE_NAME by new owner: ${name}.zkey`;

  try {
    const keys = generateMockKeys();
    const ix = buildUpdateNameIx(name, keys.spending, keys.viewing, newOwner.publicKey);
    const sig = await sendTx(connection, ix, [newOwner]);

    return { name: testName, passed: true, message: `TX: ${sig.slice(0, 16)}...` };
  } catch (err: any) {
    return { name: testName, passed: false, message: err.message.slice(0, 60) };
  }
}

async function testOldOwnerCannotUpdate(
  connection: Connection,
  oldOwner: Keypair,
  name: string
): Promise<TestResult> {
  const testName = `UPDATE_NAME by old owner: ${name}.zkey`;

  try {
    const keys = generateMockKeys();
    const ix = buildUpdateNameIx(name, keys.spending, keys.viewing, oldOwner.publicKey);
    await sendTx(connection, ix, [oldOwner]);

    return { name: testName, passed: false, message: "Should have rejected old owner" };
  } catch (err: any) {
    return { name: testName, passed: true, message: "Correctly rejected" };
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function main() {
  console.log("============================================================");
  console.log("Name Registry Comprehensive Test");
  console.log("============================================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);

  const connection = new Connection(RPC_URL, "confirmed");

  // Load or create keypairs
  const keypairPath = process.env.KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  const payer = fs.existsSync(keypairPath)
    ? await loadKeypair(keypairPath)
    : Keypair.generate();

  const alice = Keypair.generate();
  const bob = Keypair.generate();

  console.log(`\nAccounts:`);
  console.log(`  Payer: ${payer.publicKey.toBase58().slice(0, 20)}...`);
  console.log(`  Alice: ${alice.publicKey.toBase58().slice(0, 20)}...`);
  console.log(`  Bob:   ${bob.publicKey.toBase58().slice(0, 20)}...`);

  // Fund accounts
  console.log(`\nFunding accounts...`);
  await ensureFunded(connection, payer.publicKey);
  await ensureFunded(connection, alice.publicKey);
  await ensureFunded(connection, bob.publicKey);

  // Generate unique test name
  const testName = `test_${Date.now() % 100000}`;
  console.log(`\nTest name: ${testName}.zkey`);

  // Run all tests
  const results: TestResult[] = [];

  console.log(`\n------------------------------------------------------------`);
  console.log(`Running Tests...`);
  console.log(`------------------------------------------------------------`);

  // 1. Register a new name
  results.push(await testRegisterName(connection, payer, testName));

  // 2. Try to register duplicate (should fail)
  results.push(await testRegisterDuplicate(connection, payer, testName));

  // 3. Update keys (owner)
  results.push(await testUpdateName(connection, payer, testName));

  // 4. Try to update (non-owner, should fail)
  results.push(await testUpdateNameUnauthorized(connection, alice, testName));

  // 5. Transfer to Alice
  results.push(await testTransferName(connection, payer, alice, testName));

  // 6. Try to transfer (old owner, should fail)
  results.push(await testTransferNameUnauthorized(connection, payer, bob, testName));

  // 7. New owner (Alice) can update
  results.push(await testNewOwnerCanUpdate(connection, alice, testName));

  // 8. Old owner (payer) cannot update
  results.push(await testOldOwnerCannotUpdate(connection, payer, testName));

  // 9. Transfer to Bob
  results.push(await testTransferName(connection, alice, bob, testName));

  // 10. Lookup non-existent name
  results.push(await testLookupNonExistent(connection));

  // Print results
  console.log(`\n============================================================`);
  console.log(`TEST RESULTS`);
  console.log(`============================================================`);

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? "✓" : "✗";
    const color = result.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}${status}\x1b[0m ${result.name}`);
    console.log(`    ${result.message}`);

    if (result.passed) passed++;
    else failed++;
  }

  console.log(`\n------------------------------------------------------------`);
  console.log(`Summary: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`------------------------------------------------------------`);

  // Final state check
  const finalRegistry = await getNameRegistry(connection, testName);
  if (finalRegistry) {
    console.log(`\nFinal state of ${testName}.zkey:`);
    console.log(`  Owner: ${finalRegistry.owner.toBase58().slice(0, 20)}... (Bob)`);
    console.log(`  Created: ${new Date(Number(finalRegistry.createdAt) * 1000).toISOString()}`);
    console.log(`  Updated: ${new Date(Number(finalRegistry.updatedAt) * 1000).toISOString()}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
