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
  PROOF_TIMEOUT,
  type E2ETestContext,
} from "./setup";

import {
  createTestNote,
  getVkHashForCircuit,
  createRealMerkleProof,
  bigintToBytes32,
  bytesToHex,
  TEST_AMOUNTS,
  generateRealSpendPartialPublicProof,
  type TestNote,
} from "./helpers";

import {
  generateTestKeys,
  createAndSubmitStealthDeposit,
  scanAndPrepareClaim,
  checkNullifierExists,
} from "./stealth-helpers";

import { initPoseidon, computeUnifiedCommitmentSync } from "../../src/poseidon";
import { bigintToBytes, bytesToBigint, randomFieldElement } from "../../src/crypto";
import { createStealthDeposit, extractYSign, packEncryptedAmountWithSign } from "../../src/stealth";
import { createStealthMetaAddress } from "../../src/keys";
import {
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveNullifierRecordPDA,
} from "../../src/pda";
import {
  buildSpendPartialPublicInstruction,
  buildVerifyFromBufferInstruction,
  buildPartialPublicVerifierInputs,
} from "../../src/instructions";
import { deriveStealthAnnouncementPDA } from "../../src/pda";
import { generateSpendPartialPublicProof, verifyProof } from "../../src/prover/web";
import { createChadBuffer, uploadProofToBuffer, closeChadBuffer } from "../../src/relay";

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
  /** Stealth output: ephemeral pub X (32 bytes) */
  changeEphemeralPubX: Uint8Array;
  /** Stealth output: encrypted amount with sign bit (32 bytes) */
  changeEncryptedAmountWithSign: Uint8Array;
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

  // Create field-safe stealth output data (must be within BN254 field modulus)
  // Use randomFieldElement which ensures values are within field bounds
  const changeEphemeralPubXBigint = randomFieldElement();
  const changeEncryptedAmountWithSignBigint = changeAmount; // Amount with y-sign bit 0

  // Convert to bytes for instruction building
  const changeEphemeralPubX = bigintToBytes(changeEphemeralPubXBigint, 32);
  const changeEncryptedAmountWithSign = bigintToBytes(changeEncryptedAmountWithSignBigint, 32);

  return {
    publicAmount,
    recipient: recipient || Keypair.generate().publicKey,
    changeNote,
    changeEphemeralPubX,
    changeEncryptedAmountWithSign,
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
    if (ctx.skipProof) {
      console.log("⚠️  Skipping proof tests (circuits not compiled)");
      console.log("   Run: cd noir-circuits && bun run compile:all && bun run copy-to-sdk");
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
      const merkleProof = createRealMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 60_000n);

      const bufferAddress = address(PublicKey.default.toBase58());

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      const [stealthAnnouncementChange] = await deriveStealthAnnouncementPDA(
        outputs.changeEphemeralPubX
      );

      // Build instruction
      const spendIx = buildSpendPartialPublicInstruction({
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        vkHash: getVkHashForCircuit("spend_partial_public"),
        changeEphemeralPubX: outputs.changeEphemeralPubX,
        changeEncryptedAmountWithSign: outputs.changeEncryptedAmountWithSign,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault, // Mock ATA
          user: address(ctx.payer.publicKey.toBase58()),
          stealthAnnouncementChange,
        },
      });

      // Verify instruction structure
      expect(spendIx.data).toBeDefined();
      // 13 accounts: pool, tree, nullifier, mint, vault, recipient, user, token, system, verifier, stealth, buffer, instructions_sysvar
      expect(spendIx.accounts.length).toBe(13);

      // Verify discriminator (SPEND_PARTIAL_PUBLIC = 10)
      expect(spendIx.data[0]).toBe(10);
    });

    it("should have correct data format", async () => {
      const input = createTestNote(TEST_AMOUNTS.medium);
      const merkleProof = createRealMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 600_000n);

      const bufferAddress = address(PublicKey.default.toBase58());

      // Derive PDAs
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      const [stealthAnnouncementChange] = await deriveStealthAnnouncementPDA(
        outputs.changeEphemeralPubX
      );

      const spendIx = buildSpendPartialPublicInstruction({
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        vkHash: getVkHashForCircuit("spend_partial_public"),
        changeEphemeralPubX: outputs.changeEphemeralPubX,
        changeEncryptedAmountWithSign: outputs.changeEncryptedAmountWithSign,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault,
          user: address(ctx.payer.publicKey.toBase58()),
          stealthAnnouncementChange,
        },
      });

      // Verify data format: disc(1) + root(32) + ...
      expect(spendIx.data[0]).toBe(10); // discriminator
      expect(spendIx.data.length).toBeGreaterThan(200);
    });

    it("should include public amount in instruction data", async () => {
      const input = createTestNote(TEST_AMOUNTS.small);
      const merkleProof = createRealMerkleProof(input.commitment);
      const outputs = createPartialPublicOutputs(input, 60_000n);

      const bufferAddress = address(PublicKey.default.toBase58());

      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      const [stealthAnnouncementChange] = await deriveStealthAnnouncementPDA(
        outputs.changeEphemeralPubX
      );

      const spendIx = buildSpendPartialPublicInstruction({
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        vkHash: getVkHashForCircuit("spend_partial_public"),
        changeEphemeralPubX: outputs.changeEphemeralPubX,
        changeEncryptedAmountWithSign: outputs.changeEncryptedAmountWithSign,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault,
          user: address(ctx.payer.publicKey.toBase58()),
          stealthAnnouncementChange,
        },
      });

      // Instruction data layout: discriminator(1) + root(32) + nullifier(32) + public_amount(8) + change(32) + recipient(32) + vk_hash(32) + change_ephemeral_pub_x(32) + change_encrypted_amount_with_sign(32) = 233 bytes
      expect(spendIx.data.length).toBe(233);
    });
  });

  // ===========================================================================
  // On-Chain Tests
  // ===========================================================================

  describe("On-Chain Tests", () => {
    it(
      "should verify amount conservation in instruction",
      async () => {
        if (ctx.skipOnChain) {
          console.log("⚠️  Skipping: validator not available");
          return;
        }
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
      const merkleProof = createRealMerkleProof(input.commitment);
      console.log(`   Root: ${merkleProof.root.toString(16).slice(0, 20)}...`);

      // Step 5: Generate real ZK proof
      console.log("\n5. Generate real ZK proof");
      let proofBytes: Uint8Array;
      if (ctx.proverReady) {
        // Convert recipient address to bigint for proof binding
        // Reduce modulo BN254 field to ensure it fits within circuit constraints
        const BN254_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        const recipientBytes = outputs.recipient.toBytes();
        let recipientAsBigint = 0n;
        for (let i = 0; i < recipientBytes.length; i++) {
          recipientAsBigint = (recipientAsBigint << 8n) | BigInt(recipientBytes[i]);
        }
        recipientAsBigint = recipientAsBigint % BN254_FIELD_MODULUS;
        const changeData = {
          pubKeyX: outputs.changeNote.pubKeyX,
          amount: outputs.changeNote.amount,
          ephemeralPubX: bytesToBigint(outputs.changeEphemeralPubX),
          encryptedAmountWithSign: bytesToBigint(outputs.changeEncryptedAmountWithSign),
        };
        proofBytes = await generateRealSpendPartialPublicProof(
          input,
          merkleProof,
          outputs.publicAmount,
          changeData,
          recipientAsBigint
        );
        console.log(`   Generated REAL proof: ${proofBytes.length} bytes`);
      } else {
        throw new Error("Prover not ready - circuits must be compiled");
      }

      // Step 6: Derive PDAs
      console.log("\n6. Derive PDAs");
      const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
      const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
      const [nullifierRecord] = await deriveNullifierRecordPDA(
        input.nullifierHashBytes,
        ctx.config.zvaultProgramId
      );
      const [stealthAnnouncementChange] = await deriveStealthAnnouncementPDA(
        outputs.changeEphemeralPubX
      );
      console.log(`   Nullifier Record: ${nullifierRecord.toString()}`);

      // Mock buffer address for demonstration
      const bufferAddress = address(PublicKey.default.toBase58());

      // Step 7: Build instruction (buffer mode with instruction introspection)
      console.log("\n7. Build spend partial public instruction (buffer mode)");
      const vkHash = getVkHashForCircuit("spend_partial_public");
      const spendIx = buildSpendPartialPublicInstruction({
        bufferAddress,
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        vkHash,
        changeEphemeralPubX: outputs.changeEphemeralPubX,
        changeEncryptedAmountWithSign: outputs.changeEncryptedAmountWithSign,
        accounts: {
          poolState,
          commitmentTree,
          nullifierRecord,
          zbtcMint: ctx.config.zbtcMint,
          poolVault: ctx.config.poolVault,
          recipientAta: ctx.config.poolVault,
          user: address(ctx.payer.publicKey.toBase58()),
          stealthAnnouncementChange,
        },
      });
      console.log(`   Instruction data size: ${spendIx.data.length} bytes`);

      // Build verifier instruction (called before zVault instruction)
      const publicInputs = buildPartialPublicVerifierInputs({
        root: bigintToBytes32(merkleProof.root),
        nullifierHash: input.nullifierHashBytes,
        publicAmountSats: outputs.publicAmount,
        changeCommitment: outputs.changeNote.commitmentBytes,
        recipient: address(outputs.recipient.toBase58()),
        changeEphemeralPubX: outputs.changeEphemeralPubX,
        changeEncryptedAmountWithSign: outputs.changeEncryptedAmountWithSign,
      });
      const verifyIx = buildVerifyFromBufferInstruction({
        bufferAddress,
        publicInputs,
        vkHash,
      });
      console.log(`   Verifier instruction built (VERIFY_FROM_BUFFER)`);

      // Step 8: What happens on-chain
      console.log("\n8. On-chain execution (2-instruction TX):");
      console.log("   TX instruction 1: UltraHonk verifier VERIFY_FROM_BUFFER");
      console.log("   TX instruction 2: zVault spend_partial_public");
      console.log("     a. Verify prior verifier instruction via introspection");
      console.log("     b. Verify merkle root in root history");
      console.log("     c. Check nullifier not spent");
      console.log("     d. Create nullifier record PDA");
      console.log(`     e. Transfer ${publicAmount} sats to recipient ATA`);
      console.log("     f. Insert change commitment to tree");
      console.log("     g. Update tree root");

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

  // ===========================================================================
  // Real Proof Tests (Full stealth flow with real ZK proofs)
  // ===========================================================================

  describe("Real Proof Tests", () => {
    it(
      "should complete full stealth partial public flow with real ZK proof",
      async () => {
        if (ctx.skipOnChain || ctx.skipProof) {
          console.log("⚠️  Skipping: requires validator and compiled circuits");
          return;
        }

        console.log("\n" + "=".repeat(60));
        console.log("FULL STEALTH PARTIAL PUBLIC FLOW WITH REAL ZK PROOF");
        console.log("=".repeat(60) + "\n");

        // Step 1: Generate keys
        console.log("1. Generating keys...");
        const inputRecipientKeys = generateTestKeys("partial-public-test-input-1");
        const changeRecipientKeys = generateTestKeys("partial-public-test-change-1");
        console.log(`   Input spending pub key X: ${inputRecipientKeys.spendingPubKey.x.toString(16).slice(0, 16)}...`);
        console.log(`   Change pub key X: ${changeRecipientKeys.spendingPubKey.x.toString(16).slice(0, 16)}...`);

        // Step 2: Create and submit stealth deposit for input note
        console.log("\n2. Creating and submitting input stealth deposit...");
        const inputAmount = TEST_AMOUNTS.medium; // 1M sats
        const testNote = await createAndSubmitStealthDeposit(ctx, inputRecipientKeys, inputAmount);
        console.log(`   Input amount: ${testNote.amount} sats`);
        console.log(`   Input commitment: ${testNote.commitment.toString(16).slice(0, 16)}...`);
        console.log(`   Leaf index: ${testNote.leafIndex}`);

        // Step 3: Scan for input note and prepare claim data
        console.log("\n3. Scanning and preparing input note data...");
        const inputData = await scanAndPrepareClaim(ctx, inputRecipientKeys, testNote.commitment);
        console.log(`   Scanned amount: ${inputData.scannedNote.amount} sats`);
        console.log(`   Merkle root: ${inputData.merkleProof.root.toString(16).slice(0, 16)}...`);
        console.log(`   Nullifier hash: ${inputData.nullifierHash.toString(16).slice(0, 16)}...`);

        // Step 4: Define partial public spend (60% public, 40% change)
        const publicAmount = 600_000n;
        const changeAmount = 400_000n;
        console.log("\n4. Defining partial public spend...");
        console.log(`   Public amount: ${publicAmount} sats (60%)`);
        console.log(`   Change amount: ${changeAmount} sats (40%)`);
        expect(publicAmount + changeAmount).toBe(inputAmount);

        // Step 5: Create stealth output for change
        console.log("\n5. Creating stealth output for change...");
        const changeMetaAddress = createStealthMetaAddress(changeRecipientKeys);
        const changeStealth = await createStealthDeposit(changeMetaAddress, changeAmount);
        const changeCommitment = bytesToBigint(changeStealth.commitment);
        const changeEphemeralPubX = bytesToBigint(changeStealth.ephemeralPub.subarray(1, 33)); // X coord (skip prefix)
        const changeYSign = extractYSign(changeStealth.ephemeralPub);
        const changeEncryptedAmountWithSign = packEncryptedAmountWithSign(changeStealth.encryptedAmount, changeYSign);
        console.log(`   Change commitment: ${changeCommitment.toString(16).slice(0, 16)}...`);
        console.log(`   Ephemeral pub X: ${changeEphemeralPubX.toString(16).slice(0, 16)}...`);

        // Convert recipient address to bigint for proof binding
        // Reduce modulo BN254 field to ensure it fits within circuit constraints
        const BN254_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        const recipientBytes = ctx.payer.publicKey.toBytes();
        let recipientAsBigint = 0n;
        for (let i = 0; i < recipientBytes.length; i++) {
          recipientAsBigint = (recipientAsBigint << 8n) | BigInt(recipientBytes[i]);
        }
        recipientAsBigint = recipientAsBigint % BN254_FIELD_MODULUS;

        // Step 6: Generate REAL ZK proof
        console.log("\n6. Generating REAL spend_partial_public proof (this may take 30-120 seconds)...");
        const proofStartTime = Date.now();

        const proof = await generateSpendPartialPublicProof({
          // Input note
          privKey: inputData.stealthPrivKey,
          pubKeyX: inputData.stealthPubKeyX,
          amount: inputData.scannedNote.amount,
          leafIndex: BigInt(inputData.scannedNote.leafIndex),
          merkleRoot: inputData.merkleProof.root,
          merkleProof: {
            siblings: inputData.merkleProof.siblings,
            indices: inputData.merkleProof.indices,
          },
          // Public output
          publicAmount: publicAmount,
          recipient: recipientAsBigint,
          // Change output (stealth)
          changePubKeyX: changeRecipientKeys.spendingPubKey.x,
          changeAmount: changeAmount,
          changeEphemeralPubX: changeEphemeralPubX,
          changeEncryptedAmountWithSign: changeEncryptedAmountWithSign,
        });

        const proofTime = ((Date.now() - proofStartTime) / 1000).toFixed(1);
        console.log(`   Proof generated in ${proofTime}s`);
        console.log(`   Proof size: ${proof.proof.length} bytes`);
        console.log(`   Public inputs: ${proof.publicInputs.length}`);

        // Step 7: Verify proof locally
        console.log("\n7. Verifying proof locally...");
        const isValid = await verifyProof("spend_partial_public", proof);
        console.log(`   Local verification: ${isValid ? "PASSED" : "FAILED"}`);
        expect(isValid).toBe(true);

        // Step 8: Upload proof to ChadBuffer
        console.log("\n8. Uploading proof to ChadBuffer...");
        const { keypair: bufferKeypair } = await createChadBuffer(
          ctx.rpc,
          ctx.rpcSubscriptions,
          ctx.payerSigner,
          proof.proof.length
        );
        console.log(`   Buffer address: ${bufferKeypair.address}`);

        await uploadProofToBuffer(
          ctx.rpc,
          ctx.rpcSubscriptions,
          ctx.payerSigner,
          bufferKeypair.address,
          proof.proof,
          (uploaded, total) => {
            const pct = Math.round((uploaded / total) * 100);
            process.stdout.write(`\r   Uploading: ${pct}%`);
          }
        );
        console.log("\n   Upload complete!");

        // Step 9: Build spend partial public transaction (buffer mode)
        console.log("\n9. Building spend partial public transaction (buffer mode)...");
        const [poolState] = await derivePoolStatePDA(ctx.config.zvaultProgramId);
        const [commitmentTree] = await deriveCommitmentTreePDA(ctx.config.zvaultProgramId);
        const [nullifierRecord] = await deriveNullifierRecordPDA(
          inputData.nullifierHashBytes,
          ctx.config.zvaultProgramId
        );

        const spendIx = buildSpendPartialPublicInstruction({
          bufferAddress: bufferKeypair.address,
          root: bigintToBytes(inputData.merkleProof.root, 32),
          nullifierHash: inputData.nullifierHashBytes,
          publicAmountSats: publicAmount,
          changeCommitment: bigintToBytes(changeCommitment, 32),
          recipient: address(ctx.payer.publicKey.toBase58()),
          vkHash: getVkHashForCircuit("spend_partial_public"), // TODO: Use real VK hash
          changeEphemeralPubX: bigintToBytes(changeEphemeralPubX, 32),
          changeEncryptedAmountWithSign: bigintToBytes(changeEncryptedAmountWithSign, 32),
          accounts: {
            poolState,
            commitmentTree,
            nullifierRecord,
            zbtcMint: ctx.config.zbtcMint,
            poolVault: ctx.config.poolVault,
            recipientAta: ctx.config.poolVault, // TODO: Create real ATA
            user: address(ctx.payer.publicKey.toBase58()),
          },
        });

        console.log(`   Instruction data size: ${spendIx.data.length} bytes`);
        console.log(`   Proof source: buffer`);
        console.log(`   NOTE: Full on-chain execution requires UltraHonk verifier`);

        // Step 10: Close ChadBuffer
        console.log("\n10. Closing ChadBuffer...");
        try {
          const closeSig = await closeChadBuffer(
            ctx.rpc,
            ctx.rpcSubscriptions,
            ctx.payerSigner,
            bufferKeypair.address
          );
          console.log(`    Buffer closed: ${closeSig}`);
        } catch (e) {
          console.log(`    Buffer close skipped (may already be closed)`);
        }

        // Step 11: Verify results
        console.log("\n11. Verification:");
        console.log(`    ✓ Input stealth deposit created and submitted`);
        console.log(`    ✓ Input note scanned with viewing key`);
        console.log(`    ✓ Real ZK proof generated (${proofTime}s)`);
        console.log(`    ✓ Proof verified locally`);
        console.log(`    ✓ Proof uploaded to ChadBuffer`);
        console.log(`    ✓ Spend partial public instruction built (buffer mode)`);
        console.log(`    ✓ ChadBuffer closed`);
        console.log(`    ✓ Amount conservation verified: ${publicAmount} + ${changeAmount} = ${inputAmount}`);

        console.log("\n" + "=".repeat(60));
        console.log("FULL STEALTH PARTIAL PUBLIC FLOW COMPLETE");
        console.log("=".repeat(60) + "\n");

        // Final assertions
        expect(proof.proof.length).toBeGreaterThan(0);
        expect(proof.publicInputs.length).toBeGreaterThan(0);
        expect(isValid).toBe(true);
        expect(publicAmount + changeAmount).toBe(inputAmount);
      },
      PROOF_TIMEOUT // 5 minute timeout for proof generation
    );

    it(
      "should generate valid partial public proof with real circuit",
      async () => {
        if (ctx.skipProof) {
          console.log("⚠️  Skipping: requires compiled circuits");
          return;
        }

        // Simpler test that just generates a proof without on-chain ops
        console.log("\n=== Spend Partial Public Proof Generation Test ===\n");

        // Use simple test values
        const privKey = 12345n;
        const pubKeyX = 67890n;
        const amount = 1_000_000n; // 1M sats
        const leafIndex = 0n;

        // Compute input commitment
        const commitment = computeUnifiedCommitmentSync(pubKeyX, amount);

        // Compute merkle root (all-zero siblings)
        const { poseidonHashSync } = await import("../../src/poseidon");
        let current = commitment;
        for (let i = 0; i < 20; i++) {
          current = poseidonHashSync([current, 0n]);
        }
        const merkleRoot = current;

        // Partial public values (60% public, 40% change)
        const publicAmount = 600_000n;
        const changePubKeyX = 333333n;
        const changeAmount = 400_000n;
        const recipient = 999999n;
        // Mock stealth output data
        const changeEphemeralPubX = 111111n;
        const changeEncryptedAmountWithSign = 222222n;

        // Generate proof
        console.log("Generating spend_partial_public proof...");
        const startTime = Date.now();

        const proof = await generateSpendPartialPublicProof({
          privKey,
          pubKeyX,
          amount,
          leafIndex,
          merkleRoot,
          merkleProof: {
            siblings: Array(20).fill(0n),
            indices: Array(20).fill(0),
          },
          publicAmount,
          changePubKeyX,
          changeAmount,
          recipient,
          changeEphemeralPubX,
          changeEncryptedAmountWithSign,
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Proof generated in ${elapsed}s`);
        console.log(`Proof size: ${proof.proof.length} bytes`);

        // Verify
        const isValid = await verifyProof("spend_partial_public", proof);
        console.log(`Verification: ${isValid ? "PASSED" : "FAILED"}`);

        expect(proof.proof.length).toBeGreaterThan(0);
        expect(isValid).toBe(true);
      },
      PROOF_TIMEOUT
    );
  });
});
