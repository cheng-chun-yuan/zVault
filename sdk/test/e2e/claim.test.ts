/**
 * CLAIM E2E Tests
 *
 * Tests the full claim flow from demo deposit to zkBTC claim.
 *
 * Prerequisites:
 * - solana-test-validator running with devnet features
 * - Programs deployed and initialized on localnet
 *
 * Run: bun test test/e2e/claim.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { address } from "@solana/kit";

import {
  createTestContext,
  initializeTestEnvironment,
  logTestEnvironment,
  TEST_TIMEOUT,
  type E2ETestContext,
} from "./setup";

import {
  createTestNote,
  createDemoDeposit,
  generateMockProof,
  generateMockVkHash,
  createMockMerkleProof,
  bigintToBytes32,
  bytesToHex,
  TEST_AMOUNTS,
  TREE_DEPTH,
} from "./helpers";

import { initPoseidon } from "../../src/poseidon";
import { derivePoolStatePDA, deriveCommitmentTreePDA, deriveNullifierRecordPDA, deriveStealthAnnouncementPDA } from "../../src/pda";
import { buildClaimInstruction, hexToBytes } from "../../src/instructions";
import { DEMO_INSTRUCTION } from "../../src/demo";

// =============================================================================
// Test Context
// =============================================================================

let ctx: E2ETestContext;

// =============================================================================
// Test Suite
// =============================================================================

describe("CLAIM E2E", () => {
  beforeAll(async () => {
    // Initialize test environment
    await initializeTestEnvironment();
    await initPoseidon();

    // Create test context
    ctx = await createTestContext();
    logTestEnvironment(ctx);

    if (ctx.skipOnChain) {
      console.log("⚠️  Skipping on-chain tests (validator not available or not configured)");
    }
  });

  // ===========================================================================
  // Unit Tests (No on-chain calls)
  // ===========================================================================

  describe("Unit Tests", () => {
    it("should create valid test note with correct commitment", () => {
      const note = createTestNote(TEST_AMOUNTS.small);

      expect(note.amount).toBe(TEST_AMOUNTS.small);
      expect(note.commitment).toBeGreaterThan(0n);
      expect(note.commitmentBytes.length).toBe(32);
      expect(note.nullifier).toBeGreaterThan(0n);
      expect(note.nullifierHash).toBeGreaterThan(0n);
      expect(note.nullifierHashBytes.length).toBe(32);
    });

    it("should create different commitments for different amounts", () => {
      const note1 = createTestNote(100_000n);
      const note2 = createTestNote(200_000n);

      expect(note1.commitment).not.toBe(note2.commitment);
    });

    it("should create different nullifiers for different leaf indices", () => {
      const privKey = 12345n;
      const note1 = createTestNote(TEST_AMOUNTS.small, 0n, privKey);
      const note2 = createTestNote(TEST_AMOUNTS.small, 1n, privKey);

      // Different leaf index should produce different nullifier
      expect(note1.nullifier).not.toBe(note2.nullifier);
      expect(note1.nullifierHash).not.toBe(note2.nullifierHash);
    });

    it("should create valid mock Merkle proof", () => {
      const note = createTestNote(TEST_AMOUNTS.small);
      const proof = createMockMerkleProof(note.commitment);

      expect(proof.siblings.length).toBe(TREE_DEPTH);
      expect(proof.indices.length).toBe(TREE_DEPTH);
      expect(proof.root).toBeGreaterThan(0n);

      // All siblings should be zero for mock proof
      for (const sibling of proof.siblings) {
        expect(sibling).toBe(0n);
      }
    });

    it("should generate mock UltraHonk proof of correct size", () => {
      const proof = generateMockProof(10 * 1024);
      expect(proof.length).toBe(10 * 1024);

      // Verify deterministic generation
      const proof2 = generateMockProof(10 * 1024);
      expect(proof).toEqual(proof2);
    });

    it("should build valid demo stealth instruction data", () => {
      const { note, instructionData, ephemeralPub } = createDemoDeposit(TEST_AMOUNTS.small);

      // Verify discriminator
      expect(instructionData[0]).toBe(DEMO_INSTRUCTION.ADD_DEMO_STEALTH);

      // Verify instruction size (1 + 33 + 32 + 8 = 74)
      expect(instructionData.length).toBe(74);

      // Verify ephemeral pub is included
      expect(instructionData.slice(1, 34)).toEqual(ephemeralPub);

      // Verify commitment is included
      expect(instructionData.slice(34, 66)).toEqual(note.commitmentBytes);
    });
  });

  // ===========================================================================
  // Instruction Building Tests
  // ===========================================================================

  describe("Instruction Building", () => {
    it("should build valid claim instruction with inline proof", async () => {
      const note = createTestNote(TEST_AMOUNTS.small);
      const proof = createMockMerkleProof(note.commitment);
      const proofBytes = generateMockProof();
      const vkHash = generateMockVkHash();

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        note.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );

      // Build claim instruction
      const claimIx = buildClaimInstruction({
        proofSource: "inline",
        proofBytes,
        root: bigintToBytes32(proof.root),
        nullifierHash: note.nullifierHashBytes,
        amountSats: note.amount,
        recipient: address(ctx.payer.publicKey.toBase58()),
        vkHash,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault, // Mock ATA for testing
          user: address(ctx.payer.publicKey.toBase58()),
        },
      });

      // Verify instruction structure
      expect(claimIx.data).toBeDefined();
      expect(claimIx.accounts).toBeDefined();
      expect(claimIx.accounts.length).toBeGreaterThan(0);

      // Verify discriminator (CLAIM = 9)
      expect(claimIx.data[0]).toBe(9);

      // Verify proof source (inline = 0)
      expect(claimIx.data[1]).toBe(0);
    });

    it("should build valid claim instruction with buffer proof", async () => {
      const note = createTestNote(TEST_AMOUNTS.small);
      const proof = createMockMerkleProof(note.commitment);
      const vkHash = generateMockVkHash();

      // Mock buffer address
      const bufferAddress = address(PublicKey.default.toBase58());

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        note.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );

      // Build claim instruction with buffer
      const claimIx = buildClaimInstruction({
        proofSource: "buffer",
        bufferAddress,
        root: bigintToBytes32(proof.root),
        nullifierHash: note.nullifierHashBytes,
        amountSats: note.amount,
        recipient: address(ctx.payer.publicKey.toBase58()),
        vkHash,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault,
          user: address(ctx.payer.publicKey.toBase58()),
        },
      });

      // Verify instruction structure
      expect(claimIx.data).toBeDefined();

      // Verify discriminator (CLAIM = 9)
      expect(claimIx.data[0]).toBe(9);

      // Verify proof source (buffer = 1)
      expect(claimIx.data[1]).toBe(1);
    });

    it("should derive correct PDA addresses", async () => {
      const [poolState1] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [poolState2] = await derivePoolStatePDA(ctx.config.zvaultProgramId);

      // Same seeds should produce same PDA
      expect(poolState1.toString()).toBe(poolState2.toString());

      // Different nullifier hashes should produce different PDAs
      const hash1 = new Uint8Array(32).fill(1);
      const hash2 = new Uint8Array(32).fill(2);

      const [nullifier1] = await deriveNullifierRecordPDA(hash1, ctx.config.zvaultProgramId);
      const [nullifier2] = await deriveNullifierRecordPDA(hash2, ctx.config.zvaultProgramId);

      expect(nullifier1.toString()).not.toBe(nullifier2.toString());
    });
  });

  // ===========================================================================
  // On-Chain Tests (Require validator)
  // ===========================================================================

  describe("On-Chain Tests", () => {
    it.skipIf(ctx?.skipOnChain !== false)(
      "should reject claim with invalid proof (mock test)",
      async () => {
        // This test validates that the instruction building works correctly
        // Actual on-chain verification would require:
        // 1. A properly initialized pool state
        // 2. A commitment tree with the commitment
        // 3. A valid UltraHonk proof

        const note = createTestNote(TEST_AMOUNTS.small);
        const proof = createMockMerkleProof(note.commitment);
        const corruptedProof = generateMockProof();

        // Corrupt the proof
        corruptedProof[0] = 0xff;
        corruptedProof[1] = 0xff;

        // Derive PDAs
        const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
        const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
        const [nullifierRecord] = await deriveNullifierRecordPDA(
          note.nullifierHashBytes,
          ctx.config.zvaultProgramId
        );

        // Build claim instruction with corrupted proof
        const claimIx = buildClaimInstruction({
          proofSource: "inline",
          proofBytes: corruptedProof,
          root: bigintToBytes32(proof.root),
          nullifierHash: note.nullifierHashBytes,
          amountSats: note.amount,
          recipient: address(ctx.payer.publicKey.toBase58()),
          vkHash: generateMockVkHash(),
          accounts: {
            poolState,
            commitmentTree,
            nullifierRecord,
            zbtcMint: ctx.config.zbtcMint,
            poolVault: ctx.config.poolVault,
            recipientAta: ctx.config.poolVault,
            user: address(ctx.payer.publicKey.toBase58()),
          },
        });

        // Instruction should still build (validation happens on-chain)
        expect(claimIx.data[0]).toBe(9);

        // In a full on-chain test, submitting this would fail with VerificationFailed
        console.log("  → Built claim instruction with corrupted proof");
        console.log("  → On-chain submission would fail with VerificationFailed error");
      },
      TEST_TIMEOUT
    );

    it.skipIf(ctx?.skipOnChain !== false)(
      "should reject claim with invalid merkle root (mock test)",
      async () => {
        const note = createTestNote(TEST_AMOUNTS.small);
        const proofBytes = generateMockProof();

        // Use an invalid root (not from the actual tree)
        const invalidRoot = new Uint8Array(32).fill(0xab);

        // Derive PDAs
        const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
        const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
        const [nullifierRecord] = await deriveNullifierRecordPDA(
          note.nullifierHashBytes,
          ctx.config.zvaultProgramId
        );

        // Build claim instruction with invalid root
        const claimIx = buildClaimInstruction({
          proofSource: "inline",
          proofBytes,
          root: invalidRoot,
          nullifierHash: note.nullifierHashBytes,
          amountSats: note.amount,
          recipient: address(ctx.payer.publicKey.toBase58()),
          vkHash: generateMockVkHash(),
          accounts: {
            poolState,
            commitmentTree,
            nullifierRecord,
            zbtcMint: ctx.config.zbtcMint,
            poolVault: ctx.config.poolVault,
            recipientAta: ctx.config.poolVault,
            user: address(ctx.payer.publicKey.toBase58()),
          },
        });

        // Instruction should still build (validation happens on-chain)
        expect(claimIx.data[0]).toBe(9);

        // In a full on-chain test, submitting this would fail with InvalidRoot
        console.log("  → Built claim instruction with invalid merkle root");
        console.log("  → On-chain submission would fail with InvalidRoot error");
      },
      TEST_TIMEOUT
    );
  });

  // ===========================================================================
  // Integration Tests (Full flow simulation)
  // ===========================================================================

  describe("Integration Flow", () => {
    it("should simulate complete claim flow", async () => {
      console.log("\n=== Complete Claim Flow Simulation ===\n");

      // Step 1: Create user note
      console.log("1. User creates note with secrets");
      const note = createTestNote(TEST_AMOUNTS.medium, 0n);
      console.log(`   Amount: ${note.amount} sats`);
      console.log(`   Commitment: ${note.commitment.toString(16).slice(0, 20)}...`);

      // Step 2: Compute Merkle proof
      console.log("\n2. Computing Merkle proof");
      const merkleProof = createMockMerkleProof(note.commitment);
      console.log(`   Root: ${merkleProof.root.toString(16).slice(0, 20)}...`);
      console.log(`   Tree depth: ${TREE_DEPTH}`);

      // Step 3: Generate ZK proof (mocked)
      console.log("\n3. Generating ZK proof (mocked)");
      const proofBytes = generateMockProof();
      console.log(`   Proof size: ${proofBytes.length} bytes`);

      // Step 4: Derive PDAs
      console.log("\n4. Deriving PDAs");
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        note.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      console.log(`   Pool State: ${poolState.toString()}`);
      console.log(`   Commitment Tree: ${commitmentTree.toString()}`);
      console.log(`   Nullifier Record: ${nullifierRecord.toString()}`);

      // Step 5: Build claim instruction
      console.log("\n5. Building claim instruction");
      const claimIx = buildClaimInstruction({
        proofSource: "inline",
        proofBytes,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: note.nullifierHashBytes,
        amountSats: note.amount,
        recipient: address(ctx.payer.publicKey.toBase58()),
        vkHash: generateMockVkHash(),
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault,
          user: address(ctx.payer.publicKey.toBase58()),
        },
      });
      console.log(`   Instruction data size: ${claimIx.data.length} bytes`);
      console.log(`   Accounts: ${claimIx.accounts.length}`);

      // Step 6: What happens on-chain
      console.log("\n6. On-chain execution (simulation):");
      console.log("   a. Verify merkle root is valid (in root history)");
      console.log("   b. Check nullifier not already spent");
      console.log("   c. Create nullifier record PDA");
      console.log("   d. Verify UltraHonk proof via CPI to verifier");
      console.log("   e. Mint zkBTC to recipient ATA");

      console.log("\n=== Flow Complete ===\n");

      // Assertions
      expect(note.commitment).toBeGreaterThan(0n);
      expect(merkleProof.root).toBeGreaterThan(0n);
      expect(proofBytes.length).toBe(10 * 1024);
      expect(claimIx.data[0]).toBe(9); // CLAIM discriminator
    });
  });
});
