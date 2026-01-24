/**
 * Localnet Integration Test
 *
 * Tests SDK against local Solana validator using native web3.js (no Anchor).
 * Requires: solana-test-validator running with programs deployed
 */

import { expect, test, describe, beforeAll } from "bun:test";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import {
  generateNote,
  createClaimLink,
  parseClaimLink,
} from "./index";
import {
  createStealthDeposit,
  generateStealthKeys,
  scanAnnouncements,
  solanaKeyToX25519,
} from "./stealth";
import { bigintToBytes } from "./crypto";

// Program IDs (from Anchor.toml)
const ZVAULT_PROGRAM_ID = new PublicKey("3Df8Xv9hMtVVLRxagnbCsofvgn18yPzfCqTmbUEnx9KF");

// Connection to localnet
const connection = new Connection("http://127.0.0.1:8899", "confirmed");

// Test wallet (loaded from file or generated)
let payer: Keypair;
let sbbtcMint: PublicKey;
let poolStatePda: PublicKey;
let poolStateBump: number;
let commitmentTreePda: PublicKey;
let commitmentTreeBump: number;

// PDA derivation helpers
function derivePoolStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state")],
    ZVAULT_PROGRAM_ID
  );
}

function deriveCommitmentTreePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commitment_tree")],
    ZVAULT_PROGRAM_ID
  );
}

function deriveStealthAnnouncementPDA(commitment: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stealth"), commitment],
    ZVAULT_PROGRAM_ID
  );
}

function deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    ZVAULT_PROGRAM_ID
  );
}

// Instruction builders for Pinocchio contract
function buildInitializeInstruction(
  poolState: PublicKey,
  sbbtcMint: PublicKey,
  poolVault: PublicKey,
  frostVault: PublicKey,
  privacyCashPool: PublicKey,
  authority: PublicKey,
  bump: number
): TransactionInstruction {
  // Instruction discriminator for initialize = 0
  const data = Buffer.alloc(1 + 1);
  data.writeUInt8(0, 0); // discriminator
  data.writeUInt8(bump, 1); // bump

  return new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: sbbtcMint, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: false },
      { pubkey: frostVault, isSigner: false, isWritable: false },
      { pubkey: privacyCashPool, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildInitCommitmentTreeInstruction(
  poolState: PublicKey,
  commitmentTree: PublicKey,
  authority: PublicKey,
  bump: number
): TransactionInstruction {
  // Instruction discriminator for init_commitment_tree = 1
  const data = Buffer.alloc(1 + 1);
  data.writeUInt8(1, 0); // discriminator
  data.writeUInt8(bump, 1); // bump

  return new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: false },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildAddDemoCommitmentInstruction(
  poolState: PublicKey,
  commitmentTree: PublicKey,
  authority: PublicKey,
  commitment: Uint8Array,
  amount: bigint
): TransactionInstruction {
  // Instruction discriminator for add_demo_commitment = 2
  const data = Buffer.alloc(1 + 32 + 8);
  data.writeUInt8(2, 0); // discriminator
  Buffer.from(commitment).copy(data, 1);
  data.writeBigUInt64LE(amount, 33);

  return new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function buildAnnounceStealthInstruction(
  stealthAnnouncement: PublicKey,
  payer: PublicKey,
  ephemeralPubKey: Uint8Array,
  commitment: Uint8Array,
  recipientHint: Uint8Array,
  encryptedAmount: Uint8Array,
  leafIndex: bigint
): TransactionInstruction {
  // Instruction discriminator for announce_stealth = 12
  const data = Buffer.alloc(1 + 32 + 32 + 4 + 8 + 8);
  let offset = 0;
  data.writeUInt8(12, offset); offset += 1;
  Buffer.from(ephemeralPubKey).copy(data, offset); offset += 32;
  Buffer.from(commitment).copy(data, offset); offset += 32;
  Buffer.from(recipientHint).copy(data, offset); offset += 4;
  Buffer.from(encryptedAmount).copy(data, offset); offset += 8;
  data.writeBigUInt64LE(leafIndex, offset);

  return new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

describe("Localnet Integration Tests", () => {

  beforeAll(async () => {
    console.log("\n=== Setting up Localnet Tests ===");

    // Check connection
    try {
      const version = await connection.getVersion();
      console.log("Connected to Solana:", version);
    } catch (e) {
      console.error("Failed to connect to localnet. Is solana-test-validator running?");
      throw e;
    }

    // Load or create payer
    try {
      const fs = await import("fs");
      const path = await import("path");
      const home = process.env.HOME || "";
      const keyPath = path.join(home, ".config/solana/id.json");

      if (fs.existsSync(keyPath)) {
        const keyData = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
        payer = Keypair.fromSecretKey(new Uint8Array(keyData));
        console.log("Loaded payer:", payer.publicKey.toString());
      } else {
        payer = Keypair.generate();
        console.log("Generated new payer:", payer.publicKey.toString());
      }
    } catch {
      payer = Keypair.generate();
      console.log("Generated new payer:", payer.publicKey.toString());
    }

    // Airdrop if needed
    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 10 * LAMPORTS_PER_SOL) {
      console.log("Requesting airdrop...");
      const sig = await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      console.log("Airdrop complete");
    }
    console.log("Balance:", (await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL, "SOL");

    // Derive PDAs
    [poolStatePda, poolStateBump] = derivePoolStatePDA();
    [commitmentTreePda, commitmentTreeBump] = deriveCommitmentTreePDA();

    console.log("Pool PDA:", poolStatePda.toString());
    console.log("Tree PDA:", commitmentTreePda.toString());
    console.log("=================================\n");
  });

  test("1. SDK Note Generation (off-chain)", () => {
    const note = generateNote(100_000n);

    expect(note.amount).toBe(100_000n);
    expect(note.nullifier).toBeGreaterThan(0n);
    expect(note.secret).toBeGreaterThan(0n);

    const link = createClaimLink(note);
    const parsed = parseClaimLink(link);

    expect(parsed?.amount).toBe(note.amount);
    console.log("Note generated:", note.amount.toString(), "sats");
  });

  test("2. SDK Stealth Address (off-chain)", () => {
    const receiver = generateStealthKeys();
    const amount = 50_000n;

    const deposit = createStealthDeposit(receiver.viewPubKey, amount);

    expect(deposit.amount).toBe(amount);
    expect(deposit.ephemeralPubKey.length).toBe(32);

    // Scan and recover
    const found = scanAnnouncements(
      receiver.viewPrivKey,
      receiver.viewPubKey,
      [{ ephemeralPubKey: deposit.ephemeralPubKey, encryptedAmount: deposit.encryptedAmount }]
    );

    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    console.log("Stealth deposit created and recovered:", amount.toString(), "sats");
  });

  test("3. Check Program Deployed", async () => {
    const accountInfo = await connection.getAccountInfo(ZVAULT_PROGRAM_ID);

    expect(accountInfo).not.toBeNull();
    expect(accountInfo?.executable).toBe(true);
    console.log("Program deployed:", ZVAULT_PROGRAM_ID.toString());
  });

  test("4. Check Pool State PDA", async () => {
    const accountInfo = await connection.getAccountInfo(poolStatePda);

    if (accountInfo) {
      console.log("Pool already initialized, size:", accountInfo.data.length);
    } else {
      console.log("Pool not initialized yet");
    }

    // Just verify PDA derivation works
    expect(poolStatePda).toBeDefined();
  });

  test("5. Stealth Flow with Solana Keypair", () => {
    // Receiver has a Solana keypair
    const receiverSolana = Keypair.generate();

    // Convert to X25519 for stealth
    const receiverStealth = solanaKeyToX25519(receiverSolana.secretKey);

    // Sender creates deposit
    const amount = 75_000n;
    const deposit = createStealthDeposit(receiverStealth.viewPubKey, amount);

    // Simulate on-chain announcement data
    const announcementData = {
      ephemeralPubKey: deposit.ephemeralPubKey,
      encryptedAmount: deposit.encryptedAmount,
      recipientHint: deposit.recipientHint,
    };

    // Receiver scans
    const found = scanAnnouncements(
      receiverStealth.viewPrivKey,
      receiverStealth.viewPubKey,
      [announcementData]
    );

    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].secret).toBe(deposit.secret);

    console.log("Solana keypair stealth flow works!");
    console.log("  Receiver:", receiverSolana.publicKey.toString().slice(0, 16) + "...");
    console.log("  Amount:", amount.toString(), "sats");
  });

  test("6. Multiple Stealth Deposits Scan", () => {
    const receiver = generateStealthKeys();
    const amounts = [10_000n, 20_000n, 30_000n, 40_000n, 50_000n];

    const deposits = amounts.map(amount =>
      createStealthDeposit(receiver.viewPubKey, amount)
    );

    const announcements = deposits.map(d => ({
      ephemeralPubKey: d.ephemeralPubKey,
      encryptedAmount: d.encryptedAmount,
    }));

    const found = scanAnnouncements(
      receiver.viewPrivKey,
      receiver.viewPubKey,
      announcements
    );

    expect(found.length).toBe(5);

    // Verify all amounts recovered
    const foundAmounts = found.map(f => f.amount).sort((a, b) => Number(a - b));
    expect(foundAmounts).toEqual(amounts);

    console.log("Scanned", found.length, "deposits successfully");
  });

  test("7. Claim Link Round-Trip", () => {
    const originalNote = generateNote(123_456n);
    const link = createClaimLink(originalNote);

    // Simulate sharing link and parsing on another device
    const recoveredNote = parseClaimLink(link);

    expect(recoveredNote).not.toBeNull();
    expect(recoveredNote?.amount).toBe(originalNote.amount);
    expect(recoveredNote?.nullifier).toBe(originalNote.nullifier);
    expect(recoveredNote?.secret).toBe(originalNote.secret);

    console.log("Claim link round-trip successful");
    console.log("  Amount:", originalNote.amount.toString(), "sats");
  });

  test("8. PDA Derivation Consistency", () => {
    // Test that PDA derivation is deterministic
    const [pda1] = derivePoolStatePDA();
    const [pda2] = derivePoolStatePDA();

    expect(pda1.toString()).toBe(pda2.toString());

    // Test stealth announcement PDA
    const commitment = new Uint8Array(32).fill(0xab);
    const [stealthPda1] = deriveStealthAnnouncementPDA(commitment);
    const [stealthPda2] = deriveStealthAnnouncementPDA(commitment);

    expect(stealthPda1.toString()).toBe(stealthPda2.toString());

    console.log("PDA derivation is deterministic");
  });
});
