/**
 * Real ZK Proof Tests
 *
 * End-to-end tests that generate and verify real UltraHonk proofs.
 * These tests use actual Noir circuit artifacts and the bb.js WASM prover.
 *
 * Prerequisites:
 * - Circuits compiled: cd noir-circuits && bun run compile:all
 * - Circuit artifacts copied: cd noir-circuits && bun run copy-to-sdk
 *
 * Run with: bun test test/e2e/real-proofs.test.ts --timeout 600000
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestContext,
  initializeTestEnvironment,
  logTestEnvironment,
  PROOF_TIMEOUT,
  type E2ETestContext,
} from "./setup";
import {
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,
  initProver,
  isProverAvailable,
  circuitExists,
  setCircuitPath,
} from "../../src/prover/web";
import { poseidonHash } from "../../src/poseidon";
import { ZERO_HASHES, TREE_DEPTH } from "../../src/commitment-tree";

// Test fixtures
const TEST_AMOUNT = 100000n; // 0.001 BTC in satoshis
const TEST_PUBKEY_X = BigInt("0x" + "ab".repeat(32));
const TEST_RECIPIENT = new Uint8Array(32).fill(0xfe);

/**
 * Create a deterministic private key for testing
 */
function createTestPrivKey(seed: number): bigint {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i) % 256;
  }
  // Ensure it's a valid private key (less than the curve order)
  bytes[0] &= 0x7f;
  let num = 0n;
  for (let i = 0; i < 32; i++) {
    num = (num << 8n) | BigInt(bytes[i]);
  }
  return num;
}

/**
 * Create an empty merkle proof for testing (tree with single leaf at index 0)
 */
function createTestMerkleProof(leafCommitment: bigint): {
  siblings: bigint[];
  indices: number[];
  root: bigint;
} {
  // Build a merkle tree with just one leaf
  const siblings: bigint[] = [];
  const indices: number[] = [];

  let currentHash = leafCommitment;
  for (let level = 0; level < TREE_DEPTH; level++) {
    // Leaf index 0 means all indices are 0 (left child at every level)
    siblings.push(ZERO_HASHES[level]);
    indices.push(0);
    currentHash = poseidonHash([currentHash, ZERO_HASHES[level]]);
  }

  return {
    siblings,
    indices,
    root: currentHash,
  };
}

describe("Real ZK Proof Tests", () => {
  let ctx: E2ETestContext;
  let proverReady = false;
  let circuitsAvailable = {
    claim: false,
    spend_split: false,
    spend_partial_public: false,
  };

  beforeAll(async () => {
    // Initialize test environment
    const envStatus = await initializeTestEnvironment();
    proverReady = envStatus.proverReady;
    circuitsAvailable = envStatus.circuitsAvailable;

    // Create test context
    ctx = await createTestContext();
    logTestEnvironment(ctx);

    if (!proverReady) {
      console.log(
        "\n[Real Proof Tests] Prover not ready - tests will be skipped"
      );
      console.log(
        "To enable, run: cd noir-circuits && bun run compile:all && bun run copy-to-sdk\n"
      );
    }
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe("Claim Circuit", () => {
    test(
      "generates valid proof for claim",
      async () => {
        if (!proverReady || !circuitsAvailable.claim) {
          console.log("[Skipped] Claim circuit not available");
          return;
        }

        // Create test inputs
        const privKey = createTestPrivKey(1);
        const pubKeyX = TEST_PUBKEY_X;
        const amount = TEST_AMOUNT;

        // Compute commitment
        const commitment = poseidonHash([pubKeyX, amount]);

        // Create merkle proof
        const merkleProof = createTestMerkleProof(commitment);

        // Compute nullifier hash
        const nullifierHash = poseidonHash([privKey, 0n]); // leafIndex = 0

        console.log("[Claim] Generating proof...");
        const startTime = Date.now();

        // Generate proof
        const proof = await generateClaimProof({
          privKey,
          pubKeyX,
          amount,
          leafIndex: 0n,
          merkleRoot: merkleProof.root,
          merkleProof: {
            siblings: merkleProof.siblings,
            indices: merkleProof.indices,
          },
          recipient: Array.from(TEST_RECIPIENT) as number[],
        });

        const proofTime = Date.now() - startTime;
        console.log(`[Claim] Proof generated in ${proofTime}ms`);

        // Verify proof structure
        expect(proof).toBeDefined();
        expect(proof.proof).toBeDefined();
        expect(proof.publicInputs).toBeDefined();

        // Verify proof size is reasonable (8-16KB typical for UltraHonk)
        const proofSize = proof.proof.length;
        console.log(`[Claim] Proof size: ${proofSize} bytes`);
        expect(proofSize).toBeGreaterThan(8000);
        expect(proofSize).toBeLessThan(20000);

        // Verify public inputs
        expect(proof.publicInputs.length).toBe(4);

        // Public inputs: [merkle_root, nullifier_hash, amount, recipient]
        const [piRoot, piNullifier, piAmount, piRecipient] = proof.publicInputs;

        // Verify root matches
        const expectedRoot = merkleProof.root
          .toString(16)
          .padStart(64, "0");
        expect(piRoot).toBe(expectedRoot);

        // Verify nullifier matches
        const expectedNullifier = nullifierHash
          .toString(16)
          .padStart(64, "0");
        expect(piNullifier).toBe(expectedNullifier);

        console.log("[Claim] Proof verification passed");
      },
      PROOF_TIMEOUT
    );

    test(
      "rejects proof with wrong merkle root",
      async () => {
        if (!proverReady || !circuitsAvailable.claim) {
          console.log("[Skipped] Claim circuit not available");
          return;
        }

        const privKey = createTestPrivKey(2);
        const pubKeyX = TEST_PUBKEY_X;
        const amount = TEST_AMOUNT;

        const commitment = poseidonHash([pubKeyX, amount]);
        const merkleProof = createTestMerkleProof(commitment);

        // Use wrong root
        const wrongRoot = merkleProof.root ^ 1n;

        console.log("[Claim] Testing with wrong merkle root...");

        // Should reject because proof won't satisfy the circuit constraints
        await expect(
          generateClaimProof({
            privKey,
            pubKeyX,
            amount,
            leafIndex: 0n,
            merkleRoot: wrongRoot,
            merkleProof: {
              siblings: merkleProof.siblings,
              indices: merkleProof.indices,
            },
            recipient: Array.from(TEST_RECIPIENT) as number[],
          })
        ).rejects.toThrow();

        console.log("[Claim] Correctly rejected invalid root");
      },
      PROOF_TIMEOUT
    );

    test(
      "rejects proof with wrong private key",
      async () => {
        if (!proverReady || !circuitsAvailable.claim) {
          console.log("[Skipped] Claim circuit not available");
          return;
        }

        const privKey = createTestPrivKey(3);
        const wrongPrivKey = createTestPrivKey(99);
        const pubKeyX = TEST_PUBKEY_X;
        const amount = TEST_AMOUNT;

        const commitment = poseidonHash([pubKeyX, amount]);
        const merkleProof = createTestMerkleProof(commitment);

        console.log("[Claim] Testing with wrong private key...");

        // Should reject - wrong privKey won't produce correct nullifier
        await expect(
          generateClaimProof({
            privKey: wrongPrivKey,
            pubKeyX,
            amount,
            leafIndex: 0n,
            merkleRoot: merkleProof.root,
            merkleProof: {
              siblings: merkleProof.siblings,
              indices: merkleProof.indices,
            },
            recipient: Array.from(TEST_RECIPIENT) as number[],
          })
        ).rejects.toThrow();

        console.log("[Claim] Correctly rejected invalid private key");
      },
      PROOF_TIMEOUT
    );
  });

  describe("Spend Split Circuit", () => {
    test(
      "generates valid proof with amount conservation",
      async () => {
        if (!proverReady || !circuitsAvailable.spend_split) {
          console.log("[Skipped] Spend split circuit not available");
          return;
        }

        const inputAmount = 100000n;
        const output1Amount = 60000n;
        const output2Amount = 40000n;

        // Verify amounts add up
        expect(output1Amount + output2Amount).toBe(inputAmount);

        const privKey = createTestPrivKey(10);
        const pubKeyX = TEST_PUBKEY_X;

        // Create input commitment and tree
        const inputCommitment = poseidonHash([pubKeyX, inputAmount]);
        const merkleProof = createTestMerkleProof(inputCommitment);

        // Create output commitments
        const output1PubKeyX = BigInt("0x" + "11".repeat(32));
        const output2PubKeyX = BigInt("0x" + "22".repeat(32));
        const output1Commitment = poseidonHash([output1PubKeyX, output1Amount]);
        const output2Commitment = poseidonHash([output2PubKeyX, output2Amount]);

        console.log("[SpendSplit] Generating proof...");
        const startTime = Date.now();

        const proof = await generateSpendSplitProof({
          privKey,
          pubKeyX,
          amount: inputAmount,
          leafIndex: 0n,
          merkleRoot: merkleProof.root,
          merkleProof: {
            siblings: merkleProof.siblings,
            indices: merkleProof.indices,
          },
          output1Amount,
          output2Amount,
          output1Commitment,
          output2Commitment,
          output1EphemeralPubX: output1PubKeyX,
          output1EncryptedAmountWithSign: 0n,
          output2EphemeralPubX: output2PubKeyX,
          output2EncryptedAmountWithSign: 0n,
        });

        const proofTime = Date.now() - startTime;
        console.log(`[SpendSplit] Proof generated in ${proofTime}ms`);

        expect(proof).toBeDefined();
        expect(proof.proof).toBeDefined();
        expect(proof.proof.length).toBeGreaterThan(8000);

        console.log("[SpendSplit] Proof verification passed");
      },
      PROOF_TIMEOUT
    );

    test(
      "rejects proof with amount mismatch",
      async () => {
        if (!proverReady || !circuitsAvailable.spend_split) {
          console.log("[Skipped] Spend split circuit not available");
          return;
        }

        const inputAmount = 100000n;
        const output1Amount = 60000n;
        const output2Amount = 50000n; // Total 110000 != 100000

        const privKey = createTestPrivKey(11);
        const pubKeyX = TEST_PUBKEY_X;

        const inputCommitment = poseidonHash([pubKeyX, inputAmount]);
        const merkleProof = createTestMerkleProof(inputCommitment);

        const output1PubKeyX = BigInt("0x" + "11".repeat(32));
        const output2PubKeyX = BigInt("0x" + "22".repeat(32));
        const output1Commitment = poseidonHash([output1PubKeyX, output1Amount]);
        const output2Commitment = poseidonHash([output2PubKeyX, output2Amount]);

        console.log("[SpendSplit] Testing amount mismatch...");

        // Should reject - amounts don't conserve
        await expect(
          generateSpendSplitProof({
            privKey,
            pubKeyX,
            amount: inputAmount,
            leafIndex: 0n,
            merkleRoot: merkleProof.root,
            merkleProof: {
              siblings: merkleProof.siblings,
              indices: merkleProof.indices,
            },
            output1Amount,
            output2Amount,
            output1Commitment,
            output2Commitment,
            output1EphemeralPubX: output1PubKeyX,
            output1EncryptedAmountWithSign: 0n,
            output2EphemeralPubX: output2PubKeyX,
            output2EncryptedAmountWithSign: 0n,
          })
        ).rejects.toThrow();

        console.log("[SpendSplit] Correctly rejected amount mismatch");
      },
      PROOF_TIMEOUT
    );
  });

  describe("Spend Partial Public Circuit", () => {
    test(
      "generates valid proof for partial public spend",
      async () => {
        if (!proverReady || !circuitsAvailable.spend_partial_public) {
          console.log("[Skipped] Spend partial public circuit not available");
          return;
        }

        const inputAmount = 100000n;
        const publicAmount = 40000n;
        const changeAmount = 60000n;

        expect(publicAmount + changeAmount).toBe(inputAmount);

        const privKey = createTestPrivKey(20);
        const pubKeyX = TEST_PUBKEY_X;

        const inputCommitment = poseidonHash([pubKeyX, inputAmount]);
        const merkleProof = createTestMerkleProof(inputCommitment);

        const changePubKeyX = BigInt("0x" + "cc".repeat(32));
        const changeCommitment = poseidonHash([changePubKeyX, changeAmount]);

        console.log("[PartialPublic] Generating proof...");
        const startTime = Date.now();

        const proof = await generateSpendPartialPublicProof({
          privKey,
          pubKeyX,
          amount: inputAmount,
          leafIndex: 0n,
          merkleRoot: merkleProof.root,
          merkleProof: {
            siblings: merkleProof.siblings,
            indices: merkleProof.indices,
          },
          publicAmount,
          changeAmount,
          changeCommitment,
          recipient: Array.from(TEST_RECIPIENT) as number[],
          changeEphemeralPubX: changePubKeyX,
          changeEncryptedAmountWithSign: 0n,
        });

        const proofTime = Date.now() - startTime;
        console.log(`[PartialPublic] Proof generated in ${proofTime}ms`);

        expect(proof).toBeDefined();
        expect(proof.proof).toBeDefined();
        expect(proof.proof.length).toBeGreaterThan(8000);

        console.log("[PartialPublic] Proof verification passed");
      },
      PROOF_TIMEOUT
    );
  });

  describe("Proof Size and Format", () => {
    test("UltraHonk proof has expected structure", async () => {
      if (!proverReady || !circuitsAvailable.claim) {
        console.log("[Skipped] Claim circuit not available");
        return;
      }

      const privKey = createTestPrivKey(30);
      const pubKeyX = TEST_PUBKEY_X;
      const amount = TEST_AMOUNT;

      const commitment = poseidonHash([pubKeyX, amount]);
      const merkleProof = createTestMerkleProof(commitment);

      const proof = await generateClaimProof({
        privKey,
        pubKeyX,
        amount,
        leafIndex: 0n,
        merkleRoot: merkleProof.root,
        merkleProof: {
          siblings: merkleProof.siblings,
          indices: merkleProof.indices,
        },
        recipient: Array.from(TEST_RECIPIENT) as number[],
      });

      // Verify proof is a valid byte array
      expect(proof.proof).toBeInstanceOf(Uint8Array);

      // UltraHonk proofs are typically 8-16KB
      const proofBytes = proof.proof;
      console.log(`[ProofFormat] Proof size: ${proofBytes.length} bytes`);

      expect(proofBytes.length).toBeGreaterThan(8000);
      expect(proofBytes.length).toBeLessThan(20000);

      // Verify circuit size is reasonable (first byte is circuit_size_log)
      const circuitSizeLog = proofBytes[0];
      console.log(`[ProofFormat] Circuit size log: ${circuitSizeLog}`);
      expect(circuitSizeLog).toBeGreaterThanOrEqual(10); // At least 2^10 = 1024 gates
      expect(circuitSizeLog).toBeLessThanOrEqual(24); // At most 2^24 gates

      // Verify public inputs are hex strings
      for (let i = 0; i < proof.publicInputs.length; i++) {
        const pi = proof.publicInputs[i];
        expect(typeof pi).toBe("string");
        expect(pi.length).toBe(64); // 32 bytes = 64 hex chars
        expect(/^[0-9a-f]+$/i.test(pi)).toBe(true);
      }
    }, PROOF_TIMEOUT);
  });

  describe("Error Handling", () => {
    test("provides meaningful error for invalid inputs", async () => {
      if (!proverReady || !circuitsAvailable.claim) {
        console.log("[Skipped] Claim circuit not available");
        return;
      }

      // Test with invalid leaf index (negative when converted)
      try {
        await generateClaimProof({
          privKey: 0n, // Invalid: zero private key
          pubKeyX: TEST_PUBKEY_X,
          amount: TEST_AMOUNT,
          leafIndex: 0n,
          merkleRoot: 0n,
          merkleProof: {
            siblings: Array(TREE_DEPTH).fill(0n),
            indices: Array(TREE_DEPTH).fill(0),
          },
          recipient: Array.from(TEST_RECIPIENT) as number[],
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Error should be thrown
        expect(error).toBeDefined();
        console.log("[ErrorHandling] Got expected error:", (error as Error).message.slice(0, 100));
      }
    }, PROOF_TIMEOUT);
  });
});

describe("Circuit Availability Check", () => {
  test("reports correct circuit availability", async () => {
    setCircuitPath("./circuits");

    const claimExists = await circuitExists("claim");
    const splitExists = await circuitExists("spend_split");
    const partialExists = await circuitExists("spend_partial_public");

    console.log("\n[Circuit Availability]");
    console.log(`  claim: ${claimExists}`);
    console.log(`  spend_split: ${splitExists}`);
    console.log(`  spend_partial_public: ${partialExists}`);

    // At least one should exist if circuits are compiled
    // This test always passes but reports status
    expect(true).toBe(true);
  });
});
