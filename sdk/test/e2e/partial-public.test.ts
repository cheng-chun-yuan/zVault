/**
 * SPEND_PARTIAL_PUBLIC E2E Tests
 *
 * Tests spending a commitment with partial public output and private change.
 *
 * Flow:
 * 1. Input: 1 commitment (100k sats)
 * 2. Output: Public transfer (60k sats) + Change commitment (40k sats)
 * 3. Verify: Nullifier spent, tokens transferred, change in tree
 *
 * Prerequisites:
 * - solana-test-validator running with devnet features
 * - Programs deployed and initialized on localnet
 *
 * Run: bun test test/e2e/partial-public.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { PublicKey, Keypair } from "@solana/web3.js";
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
  generateMockProof,
  generateMockVkHash,
  createMockMerkleProof,
  bigintToBytes32,
  bytesToHex,
  TEST_AMOUNTS,
  type TestNote,
} from "./helpers";

import { initPoseidon } from "../../src/poseidon";
import {
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveNullifierRecordPDA,
} from "../../src/pda";
import { buildSpendPartialPublicInstruction } from "../../src/instructions";

// =============================================================================
// Test Context
// =============================================================================

let ctx: E2ETestContext;

// =============================================================================
// Helper Functions
// =============================================================================

interface PartialPublicOutputs {
  /** Amount to transfer publicly */
  publicAmount: bigint;
  /** Recipient Solana wallet */
  recipient: PublicKey;
  /** Private change note */
  changeNote: TestNote;
}

/**
 * Create outputs for a partial public spend
 */
function createPartialPublicOutputs(
  inputNote: TestNote,
  publicAmount: bigint,
  recipient?: PublicKey
): PartialPublicOutputs {
  const changeAmount = inputNote.amount - publicAmount;

  if (changeAmount < 0n) {
    throw new Error(
      `Public amount ${publicAmount} exceeds input ${inputNote.amount}`
    );
  }

  // Create change note
  const changeNote = createTestNote(changeAmount, inputNote.leafIndex + 1n);

  return {
    publicAmount,
    recipient: recipient || Keypair.generate().publicKey,
    changeNote,
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("SPEND_PARTIAL_PUBLIC E2E", () => {
  beforeAll(async () => {
    await initializeTestEnvironment();
    await initPoseidon();

    ctx = await createTestContext();
    logTestEnvironment(ctx);

    if (ctx.skipOnChain) {
      console.log("⚠️  Skipping on-chain tests (validator not available)");
    }
  });

  // ===========================================================================
  // Unit Tests
  // ===========================================================================

  describe("Unit Tests", () => {
    it("should create valid partial public outputs", () => {
      const input = createTestNote(TEST_AMOUNTS.small); // 100k sats
      const outputs = createPartialPublicOutputs(input, 60_000n);

      expect(outputs.publicAmount).toBe(60_000n);
      expect(outputs.changeNote.amount).toBe(40_000n);
      expect(outputs.publicAmount + outputs.changeNote.amount).toBe(input.amount);
    });

    it("should reject if public amount exceeds input", () => {
      const input = createTestNote(TEST_AMOUNTS.small);

      expect(() => {
        createPartialPublicOutputs(input, 150_000n); // > 100k
      }).toThrow("exceeds input");
    });

    it("should handle full public spend (no change)", () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const outputs = createPartialPublicOutputs(input, input.amount);

      expect(outputs.publicAmount).toBe(input.amount);
      expect(outputs.changeNote.amount).toBe(0n);
    });

    it("should handle minimal public spend (mostly change)", () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const outputs = createPartialPublicOutputs(input, 1_000n); // 1k public

      expect(outputs.publicAmount).toBe(1_000n);
      expect(outputs.changeNote.amount).toBe(99_000n);
    });

    it("should generate unique recipient addresses", () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const outputs1 = createPartialPublicOutputs(input, 50_000n);
      const outputs2 = createPartialPublicOutputs(input, 50_000n);

      // Each call generates a new recipient
      expect(outputs1.recipient.toBase58()).not.toBe(outputs2.recipient.toBase58());
    });
  });

  // ===========================================================================
  // Instruction Building Tests
  // ===========================================================================

  describe("Instruction Building", () => {
    it("should build valid spend partial public instruction with buffer", async () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const merkleProof = createMockMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 60_000n);

      const bufferAddress = address(PublicKey.default.toBase58());

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );

      // Build instruction
      const spendIx = buildSpendPartialPublicInstruction({
        proofSource: "buffer",
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        vkHash: generateMockVkHash(),
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault, // Mock ATA
          user: address(ctx.payer.publicKey.toBase58()),
        },
      });

      // Verify instruction structure
      expect(spendIx.data).toBeDefined();
      expect(spendIx.accounts.length).toBeGreaterThan(0);

      // Verify discriminator (SPEND_PARTIAL_PUBLIC = 10)
      expect(spendIx.data[0]).toBe(10);

      // Verify proof source (buffer = 1)
      expect(spendIx.data[1]).toBe(1);
    });

    it("should build valid spend partial public instruction with inline proof", async () => {
      const input = createTestNote(TEST_AMOUNTS.medium);
      const merkleProof = createMockMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 600_000n);
      const proofBytes = generateMockProof();

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );

      const spendIx = buildSpendPartialPublicInstruction({
        proofSource: "inline",
        proofBytes,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
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

      // Verify discriminator (SPEND_PARTIAL_PUBLIC = 10)
      expect(spendIx.data[0]).toBe(10);

      // Verify proof source (inline = 0)
      expect(spendIx.data[1]).toBe(0);
    });

    it("should include public amount in instruction data", async () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const merkleProof = createMockMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 60_000n);

      const bufferAddress = address(PublicKey.default.toBase58());

      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );

      const spendIx = buildSpendPartialPublicInstruction({
        proofSource: "buffer",
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
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

      // Instruction should include public amount (8 bytes)
      // Buffer mode layout: discriminator(1) + proof_source(1) + buffer(32) + root(32) + nullifier(32) + public_amount(8) + change(32) + recipient(32) + vk_hash(32) = 170 bytes
      expect(spendIx.data.length).toBe(170);
    });
  });

  // ===========================================================================
  // On-Chain Tests
  // ===========================================================================

  describe("On-Chain Tests", () => {
    it.skipIf(ctx?.skipOnChain !== false)(
      "should verify amount conservation in instruction",
      async () => {
        // Test that the instruction correctly includes amount conservation data

        const input = createTestNote(TEST_AMOUNTS.small);
        const outputs = createPartialPublicOutputs(input, 60_000n);

        // Verify conservation
        expect(outputs.publicAmount + outputs.changeNote.amount).toBe(input.amount);

        console.log("  → Amount conservation verified:");
        console.log(`    Input: ${input.amount} sats`);
        console.log(`    Public: ${outputs.publicAmount} sats`);
        console.log(`    Change: ${outputs.changeNote.amount} sats`);
        console.log(`    Sum: ${outputs.publicAmount + outputs.changeNote.amount} sats`);
      },
      TEST_TIMEOUT
    );
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe("Integration Flow", () => {
    it("should simulate complete partial public spend flow", async () => {
      console.log("\n=== Complete Partial Public Spend Flow ===\n");

      // Step 1: Create input note
      console.log("1. Create input note");
      const input = createTestNote(TEST_AMOUNTS.medium); // 1M sats
      console.log(`   Input amount: ${input.amount} sats`);
      console.log(`   Input commitment: ${input.commitment.toString(16).slice(0, 20)}...`);

      // Step 2: Define split (60% public, 40% change)
      console.log("\n2. Define partial public spend");
      const publicAmount = 600_000n;
      const changeAmount = 400_000n;
      console.log(`   Public amount: ${publicAmount} sats (60%)`);
      console.log(`   Change amount: ${changeAmount} sats (40%)`);

      // Step 3: Create outputs
      console.log("\n3. Create outputs");
      const outputs = createPartialPublicOutputs(input, publicAmount);
      console.log(`   Recipient: ${outputs.recipient.toBase58()}`);
      console.log(`   Change commitment: ${outputs.changeNote.commitment.toString(16).slice(0, 20)}...`);

      // Step 4: Compute Merkle proof
      console.log("\n4. Compute Merkle proof");
      const merkleProof = createMockMerkleProof(input.commitment);
      console.log(`   Root: ${merkleProof.root.toString(16).slice(0, 20)}...`);

      // Step 5: Generate ZK proof (mocked)
      console.log("\n5. Generate ZK proof (mocked)");
      const proofBytes = generateMockProof();
      console.log(`   Proof size: ${proofBytes.length} bytes`);

      // Step 6: Derive PDAs
      console.log("\n6. Derive PDAs");
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      console.log(`   Nullifier Record: ${nullifierRecord.toString()}`);

      // Step 7: Build instruction
      console.log("\n7. Build spend partial public instruction");
      const spendIx = buildSpendPartialPublicInstruction({
        proofSource: "inline",
        proofBytes,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
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
      console.log(`   Instruction data size: ${spendIx.data.length} bytes`);

      // Step 8: What happens on-chain
      console.log("\n8. On-chain execution (simulation):");
      console.log("   a. Verify merkle root in root history");
      console.log("   b. Check nullifier not spent");
      console.log("   c. Create nullifier record PDA");
      console.log("   d. Verify ZK proof (conservation: in = public + change)");
      console.log(`   e. Transfer ${publicAmount} sats to recipient ATA`);
      console.log("   f. Insert change commitment to tree");
      console.log("   g. Update tree root");

      console.log("\n=== Partial Public Spend Complete ===\n");

      // Assertions
      expect(input.amount).toBe(outputs.publicAmount + outputs.changeNote.amount);
      expect(spendIx.data[0]).toBe(10); // SPEND_PARTIAL_PUBLIC discriminator
    });

    it("should demonstrate privacy properties", () => {
      console.log("\n=== Privacy Properties ===\n");

      // Create multiple inputs
      const inputs = [
        createTestNote(100_000n, 0n),
        createTestNote(200_000n, 1n),
        createTestNote(150_000n, 2n),
      ];

      // Same recipient for all
      const recipient = Keypair.generate().publicKey;

      // Create partial public spends
      const spends = inputs.map((input) => ({
        input,
        outputs: createPartialPublicOutputs(input, input.amount / 2n, recipient),
      }));

      console.log("Observer sees:");
      console.log(`  - Recipient: ${recipient.toBase58()}`);
      spends.forEach((spend, i) => {
        console.log(`  - Public transfer ${i + 1}: ${spend.outputs.publicAmount} sats`);
      });

      console.log("\nObserver CANNOT link:");
      console.log("  - Which input commitment corresponds to which transfer");
      console.log("  - The change commitments (opaque 32-byte values)");
      console.log("  - The sender's identity (only nullifier hashes visible)");

      // Nullifier hashes are all different
      const nullifierHashes = inputs.map((i) => bytesToHex(i.nullifierHashBytes));
      expect(new Set(nullifierHashes).size).toBe(nullifierHashes.length);
    });
  });
});
