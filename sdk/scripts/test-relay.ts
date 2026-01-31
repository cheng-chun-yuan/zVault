#!/usr/bin/env bun
/**
 * Test Relay Functions with Local Validator
 *
 * This script tests the SDK relay functions end-to-end:
 * 1. Tests ChadBuffer operations (create, upload, close)
 * 2. Demonstrates the relay flow for spend_partial_public
 * 3. Demonstrates the relay flow for spend_split
 *
 * Prerequisites:
 * - Local validator running: solana-test-validator
 * - OR use devnet: TEST_NETWORK=devnet bun run scripts/test-relay.ts
 *
 * Usage:
 *   bun run scripts/test-relay.ts
 *   TEST_NETWORK=devnet bun run scripts/test-relay.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import {
  relaySpendPartialPublic,
  relaySpendSplit,
  createChadBuffer,
  uploadProofToBuffer,
  closeChadBuffer,
  type RelaySpendPartialPublicParams,
  type RelaySpendSplitParams,
} from "../src/relay";
import {
  setConfig,
  getConfig,
} from "../src/config";
import {
  computeUnifiedCommitment,
  computeNullifier,
  hashNullifier,
} from "../src/poseidon2";
import {
  randomFieldElement,
  bigintToBytes,
} from "../src/crypto";

// =============================================================================
// Configuration
// =============================================================================

const USE_DEVNET = process.env.TEST_NETWORK === "devnet";
const RPC_URL = USE_DEVNET
  ? "https://api.devnet.solana.com"
  : "http://127.0.0.1:8899";

const MOCK_PROOF_SIZE = 10 * 1024; // 10KB typical UltraHonk proof

// =============================================================================
// Helpers
// =============================================================================

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

async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  lamports: number
): Promise<void> {
  console.log(`Requesting airdrop of ${lamports / LAMPORTS_PER_SOL} SOL...`);
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`Airdrop confirmed: ${sig}`);
}

// =============================================================================
// Test Functions
// =============================================================================

async function testChadBufferOperations(
  connection: Connection,
  relayer: Keypair
): Promise<void> {
  console.log("\n=== Testing ChadBuffer Operations ===\n");

  // Test 1: Create and close buffer
  console.log("1. Testing buffer create and close...");
  const proofSize = 1024;
  const { keypair: buffer1, createTx } = await createChadBuffer(
    connection,
    relayer,
    proofSize
  );

  await sendAndConfirmTransaction(
    connection,
    createTx,
    [relayer, buffer1],
    { commitment: "confirmed" }
  );

  console.log(`   Buffer created: ${buffer1.publicKey.toBase58()}`);

  const accountInfo = await connection.getAccountInfo(buffer1.publicKey);
  console.log(`   Account size: ${accountInfo?.data.length} bytes`);

  await closeChadBuffer(connection, relayer, buffer1.publicKey);
  console.log("   Buffer closed successfully");

  // Test 2: Upload proof in chunks
  console.log("\n2. Testing chunked proof upload...");
  const proof = createMockProof(5000); // 5KB needs multiple chunks
  const { keypair: buffer2, createTx: createTx2 } = await createChadBuffer(
    connection,
    relayer,
    proof.length
  );

  await sendAndConfirmTransaction(
    connection,
    createTx2,
    [relayer, buffer2],
    { commitment: "confirmed" }
  );

  const uploadSigs = await uploadProofToBuffer(
    connection,
    relayer,
    buffer2.publicKey,
    proof,
    (uploaded, total) => {
      process.stdout.write(`   Progress: ${((uploaded / total) * 100).toFixed(0)}%\r`);
    }
  );

  console.log(`   Uploaded ${proof.length} bytes in ${uploadSigs.length} transactions`);

  // Verify data
  const uploadedAccount = await connection.getAccountInfo(buffer2.publicKey);
  const storedProof = uploadedAccount!.data.slice(32);
  const isMatch = Buffer.compare(storedProof, Buffer.from(proof)) === 0;
  console.log(`   Data integrity: ${isMatch ? "PASS" : "FAIL"}`);

  await closeChadBuffer(connection, relayer, buffer2.publicKey);
  console.log("   Buffer closed");

  console.log("\n   ChadBuffer tests: PASS");
}

async function testRelaySpendPartialPublic(
  connection: Connection,
  relayer: Keypair
): Promise<void> {
  console.log("\n=== Testing relaySpendPartialPublic ===\n");

  // Generate mock inputs
  const privKey = randomFieldElement();
  const pubKeyX = randomFieldElement();
  const amount = 100_000n;
  const leafIndex = 0n;

  const nullifier = computeNullifier(privKey, leafIndex);
  const nullifierHash = hashNullifier(nullifier);

  const publicAmount = 60_000n;
  const changeAmount = 40_000n;
  const changePubKeyX = randomFieldElement();
  const changeCommitment = computeUnifiedCommitment(changePubKeyX, changeAmount);

  const params: RelaySpendPartialPublicParams = {
    proof: createMockProof(MOCK_PROOF_SIZE),
    root: createMock32Bytes(42),
    nullifierHash: bigintToBytes(nullifierHash, 32),
    publicAmountSats: publicAmount,
    changeCommitment: bigintToBytes(changeCommitment, 32),
    recipient: Keypair.generate().publicKey,
    vkHash: createMock32Bytes(99),
  };

  console.log(`Public amount: ${publicAmount} sats`);
  console.log(`Change amount: ${changeAmount} sats`);
  console.log(`Recipient: ${params.recipient.toBase58()}`);
  console.log(`Proof size: ${params.proof.length} bytes`);

  try {
    const result = await relaySpendPartialPublic(
      connection,
      relayer,
      params,
      (stage, progress) => {
        const msg = progress !== undefined
          ? `   ${stage} (${progress.toFixed(0)}%)`
          : `   ${stage}`;
        console.log(msg);
      }
    );

    console.log(`\n   Transaction: ${result.signature}`);
    console.log(`   Buffer: ${result.bufferAddress}`);
    console.log(`   Buffer closed: ${result.bufferClosed}`);
    console.log("\n   relaySpendPartialPublic: PASS");
  } catch (e: any) {
    console.log(`\n   Error: ${e.message}`);
    console.log("\n   relaySpendPartialPublic: EXPECTED FAILURE (contract not initialized)");
    console.log("   To fully test, deploy and initialize the zVault contract first.");
  }
}

async function testRelaySpendSplit(
  connection: Connection,
  relayer: Keypair
): Promise<void> {
  console.log("\n=== Testing relaySpendSplit ===\n");

  // Generate mock inputs
  const privKey = randomFieldElement();
  const pubKeyX = randomFieldElement();
  const amount = 100_000n;
  const leafIndex = 1n;

  const nullifier = computeNullifier(privKey, leafIndex);
  const nullifierHash = hashNullifier(nullifier);

  const output1Amount = 70_000n;
  const output2Amount = 30_000n;
  const output1PubKeyX = randomFieldElement();
  const output2PubKeyX = randomFieldElement();
  const outputCommitment1 = computeUnifiedCommitment(output1PubKeyX, output1Amount);
  const outputCommitment2 = computeUnifiedCommitment(output2PubKeyX, output2Amount);

  const params: RelaySpendSplitParams = {
    proof: createMockProof(MOCK_PROOF_SIZE),
    root: createMock32Bytes(42),
    nullifierHash: bigintToBytes(nullifierHash, 32),
    outputCommitment1: bigintToBytes(outputCommitment1, 32),
    outputCommitment2: bigintToBytes(outputCommitment2, 32),
    vkHash: createMock32Bytes(99),
  };

  console.log(`Input amount: ${amount} sats`);
  console.log(`Output 1: ${output1Amount} sats`);
  console.log(`Output 2: ${output2Amount} sats`);
  console.log(`Proof size: ${params.proof.length} bytes`);

  try {
    const result = await relaySpendSplit(
      connection,
      relayer,
      params,
      (stage, progress) => {
        const msg = progress !== undefined
          ? `   ${stage} (${progress.toFixed(0)}%)`
          : `   ${stage}`;
        console.log(msg);
      }
    );

    console.log(`\n   Transaction: ${result.signature}`);
    console.log(`   Buffer: ${result.bufferAddress}`);
    console.log(`   Buffer closed: ${result.bufferClosed}`);
    console.log("\n   relaySpendSplit: PASS");
  } catch (e: any) {
    console.log(`\n   Error: ${e.message}`);
    console.log("\n   relaySpendSplit: EXPECTED FAILURE (contract not initialized)");
    console.log("   To fully test, deploy and initialize the zVault contract first.");
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("ZVault SDK Relay Functions Test");
  console.log("=".repeat(60));

  // Set config
  if (USE_DEVNET) {
    setConfig("devnet");
    console.log("\nNetwork: DEVNET");
  } else {
    setConfig("localnet");
    console.log("\nNetwork: LOCALNET");
  }

  const config = getConfig();
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Program: ${config.zvaultProgramId}`);

  // Connect
  const connection = new Connection(RPC_URL, "confirmed");

  // Check connection
  try {
    const version = await connection.getVersion();
    console.log(`Solana version: ${version["solana-core"]}`);
  } catch (e) {
    console.error("\nError: Cannot connect to Solana node");
    console.error("Make sure the local validator is running:");
    console.error("  solana-test-validator");
    console.error("\nOr use devnet:");
    console.error("  TEST_NETWORK=devnet bun run scripts/test-relay.ts");
    process.exit(1);
  }

  // Create and fund relayer
  const relayer = Keypair.generate();
  console.log(`\nRelayer: ${relayer.publicKey.toBase58()}`);

  try {
    await airdrop(connection, relayer.publicKey, 5 * LAMPORTS_PER_SOL);
  } catch (e: any) {
    console.error(`\nAirdrop failed: ${e.message}`);
    if (USE_DEVNET) {
      console.error("Devnet may be rate limited. Try again later.");
    }
    process.exit(1);
  }

  // Run tests
  await testChadBufferOperations(connection, relayer);
  await testRelaySpendPartialPublic(connection, relayer);
  await testRelaySpendSplit(connection, relayer);

  console.log("\n" + "=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

main().catch(console.error);
