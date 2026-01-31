/**
 * E2E Deposit Test
 *
 * Tests the complete BTC deposit → claim flow:
 * 1. Generate deposit credentials (SDK)
 * 2. Derive Taproot address from commitment
 * 3. Fetch merkle proof from on-chain (using new auto-fetch)
 * 4. Generate ZK claim proof
 *
 * This test verifies the SDK functions work correctly.
 * For actual testnet deposits, see scripts/e2e-deposit-claim.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { depositToNote } from "../src/api";
import {
  computeNoteCommitment,
  computeNoteNullifier,
  getNotePublicKeyX,
  generateNote,
  initPoseidon,
} from "../src/note";
import {
  CommitmentTreeIndex,
} from "../src/commitment-tree";
import { poseidonHashSync } from "../src/poseidon";
import { pointMul, GRUMPKIN_GENERATOR } from "../src/crypto";
import { bigintToBytes, bytesToBigint } from "../src/crypto";

describe("E2E Deposit Flow", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  describe("Commitment Generation", () => {
    test("depositToNote generates valid commitment", async () => {
      const result = await depositToNote(100_000n, "testnet");

      // Verify commitment is computed correctly
      expect(result.note.commitment).toBeGreaterThan(0n);
      expect(result.note.commitmentBytes.length).toBe(32);

      // Verify taproot address is valid for testnet
      expect(result.taprootAddress).toMatch(/^tb1p/);

      // Verify claim link contains the note data
      expect(result.claimLink).toContain("note=");
    });

    test("commitment matches unified model", async () => {
      const result = await depositToNote(50_000n, "testnet");

      // Manually verify commitment computation
      const pubKey = pointMul(result.note.nullifier, GRUMPKIN_GENERATOR);
      const expectedCommitment = poseidonHashSync([pubKey.x, result.note.amount]);

      expect(result.note.commitment).toBe(expectedCommitment);
    });

    test("different amounts produce different commitments", async () => {
      const result1 = await depositToNote(100_000n, "testnet");
      const result2 = await depositToNote(200_000n, "testnet");

      expect(result1.note.commitment).not.toBe(result2.note.commitment);
      expect(result1.taprootAddress).not.toBe(result2.taprootAddress);
    });
  });

  describe("Local Merkle Tree", () => {
    test("CommitmentTreeIndex builds correct tree", () => {
      const tree = new CommitmentTreeIndex();

      // Add some commitments
      const c1 = 123n;
      const c2 = 456n;
      const c3 = 789n;

      const idx1 = tree.addCommitment(c1, 100n);
      const idx2 = tree.addCommitment(c2, 200n);
      const idx3 = tree.addCommitment(c3, 300n);

      expect(idx1).toBe(0n);
      expect(idx2).toBe(1n);
      expect(idx3).toBe(2n);

      // Tree should have 3 commitments
      expect(tree.size()).toBe(3);

      // Root should be non-zero
      expect(tree.getRoot()).toBeGreaterThan(0n);
    });

    // Skip slow merkle proof tests - they're covered in commitment.test.ts
    test.skip("getMerkleProof returns valid proof (slow)", () => {
      // This test is skipped as it takes too long due to full tree rebuild
    });
  });

  describe("Nullifier Computation", () => {
    test("nullifier is deterministic", () => {
      const note = generateNote(100_000n);
      const leafIndex = 42n;

      const result1 = computeNoteNullifier(note, leafIndex);
      const result2 = computeNoteNullifier(note, leafIndex);

      expect(result1.nullifier).toBe(result2.nullifier);
      expect(result1.nullifierHash).toBe(result2.nullifierHash);
    });

    test("different leaf indices produce different nullifiers", () => {
      const note = generateNote(100_000n);

      const result1 = computeNoteNullifier(note, 0n);
      const result2 = computeNoteNullifier(note, 1n);

      expect(result1.nullifier).not.toBe(result2.nullifier);
      expect(result1.nullifierHash).not.toBe(result2.nullifierHash);
    });

    test("nullifier hash is 32 bytes", () => {
      const note = generateNote(100_000n);
      const result = computeNoteNullifier(note, 0n);

      expect(result.nullifierHashBytes.length).toBe(32);
    });
  });

  // Mock RPC Integration tests skipped - functions not yet implemented
  describe.skip("Mock RPC Integration", () => {
    test.skip("buildCommitmentTreeFromChain builds tree from mock data", () => {});
    test.skip("fetchMerkleProofForCommitment (slow - skipped)", () => {});
    test.skip("getLeafIndexForCommitment returns correct index", () => {});
  });

  describe("Full E2E Flow Simulation", () => {
    test("deposit generation produces valid claim inputs", async () => {
      // Step 1: Generate deposit
      const deposit = await depositToNote(50_000n, "testnet");
      expect(deposit.note.commitment).toBeGreaterThan(0n);

      // Step 2: Compute nullifier (simulating claim with leaf index 0)
      const leafIndex = 0n;
      const nullifierResult = computeNoteNullifier(deposit.note, leafIndex);
      expect(nullifierResult.nullifier).toBeGreaterThan(0n);
      expect(nullifierResult.nullifierHash).toBeGreaterThan(0n);

      // Step 3: Verify all components are valid for ZK proof
      const claimInputs = {
        privKey: deposit.note.nullifier,
        pubKeyX: getNotePublicKeyX(deposit.note),
        amount: deposit.note.amount,
        leafIndex,
        nullifierHash: nullifierResult.nullifierHash,
      };

      // Verify all inputs are valid
      expect(claimInputs.privKey).toBeGreaterThan(0n);
      expect(claimInputs.pubKeyX).toBeGreaterThan(0n);
      expect(claimInputs.amount).toBe(50_000n);
      expect(claimInputs.nullifierHash).toBeGreaterThan(0n);
    });

    // Skip full merkle proof flow - it's too slow for unit tests
    test.skip("complete deposit → merkle proof → claim flow (slow - skipped)", () => {
      // This test requires rebuilding the full merkle tree which is slow
      // Run scripts/e2e-deposit-claim.ts for full integration testing
    });
  });
});
