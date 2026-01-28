/**
 * Integration Tests for Noir Proof Generation
 *
 * Tests real proof generation and verification using compiled Noir circuits.
 * These tests require circuit artifacts in ./circuits directory.
 */

import { expect, test, describe, beforeAll } from "bun:test";
import {
  initProver,
  setCircuitPath,
  isProverAvailable,
  generateClaimProof,
  generateSplitProof,
  generateTransferProof,
  verifyProof,
  cleanup,
  circuitExists,
} from "./prover";
import { hashNullifier, computeNoteCommitment, poseidon2Hash } from "./poseidon2";

/**
 * Compute merkle root from commitment using all-zero siblings.
 * This mirrors what the Noir circuit does in test_claim_circuit.
 */
function computeMerkleRootFromCommitment(commitment: bigint, depth: number): bigint {
  let current = commitment;
  for (let i = 0; i < depth; i++) {
    current = poseidon2Hash([current, 0n]);
  }
  return current;
}

// Set circuit path for tests (relative to sdk/)
beforeAll(async () => {
  setCircuitPath("./circuits");
});

// ============================================================================
// 1. PROVER INITIALIZATION
// ============================================================================

describe("PROVER INITIALIZATION", () => {
  test("initProver() loads WASM modules", async () => {
    await initProver();
    // Should complete without throwing
    expect(true).toBe(true);
  });

  test("isProverAvailable() returns true when circuits exist", async () => {
    const available = await isProverAvailable();
    expect(available).toBe(true);
  });

  test("circuitExists() finds compiled circuits", async () => {
    expect(await circuitExists("claim")).toBe(true);
    expect(await circuitExists("split")).toBe(true);
    expect(await circuitExists("transfer")).toBe(true);
  });
});

// ============================================================================
// 2. CLAIM PROOF GENERATION
// ============================================================================

describe("CLAIM PROOF", () => {
  test("generates and verifies claim proof", async () => {
    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100000n;

    // Compute commitment = poseidon2([poseidon2([nullifier, secret]), amount])
    const commitment = computeNoteCommitment(nullifier, secret, amount);

    // Compute merkle root using depth-20 tree with all-zero siblings
    // This mirrors the test in claim/src/main.nr
    const merkleRoot = computeMerkleRootFromCommitment(commitment, 20);

    // Create a 20-level merkle proof (all zeros, index 0 = left child at each level)
    const merkleProof = {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    };

    const proof = await generateClaimProof({
      nullifier,
      secret,
      amount,
      merkleRoot,
      merkleProof,
    });

    expect(proof.proof).toBeInstanceOf(Uint8Array);
    expect(proof.proof.length).toBeGreaterThan(0);
    expect(proof.publicInputs).toBeArray();

    // Verify the proof
    const isValid = await verifyProof("claim", proof);
    expect(isValid).toBe(true);
  }, 120000); // 120s timeout for proof generation
});

// ============================================================================
// 3. SPLIT PROOF GENERATION
// ============================================================================

describe("SPLIT PROOF", () => {
  test("generates and verifies split proof (1→2)", async () => {
    // Input commitment (matching circuit test values)
    const inputNullifier = 12345n;
    const inputSecret = 67890n;
    const inputAmount = 100000000n;

    // Output 1
    const output1Nullifier = 11111n;
    const output1Secret = 22222n;
    const output1Amount = 60000000n;

    // Output 2
    const output2Nullifier = 33333n;
    const output2Secret = 44444n;
    const output2Amount = 40000000n; // 60000000 + 40000000 = 100000000

    // Compute input commitment and merkle root (depth 20)
    const inputCommitment = computeNoteCommitment(inputNullifier, inputSecret, inputAmount);
    const merkleRoot = computeMerkleRootFromCommitment(inputCommitment, 20);

    // 20-level merkle proof (matching circuit)
    const merkleProof = {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    };

    const proof = await generateSplitProof({
      inputNullifier,
      inputSecret,
      inputAmount,
      merkleRoot,
      merkleProof,
      output1Nullifier,
      output1Secret,
      output1Amount,
      output2Nullifier,
      output2Secret,
      output2Amount,
    });

    expect(proof.proof).toBeInstanceOf(Uint8Array);
    expect(proof.proof.length).toBeGreaterThan(0);

    // Verify
    const isValid = await verifyProof("split", proof);
    expect(isValid).toBe(true);
  }, 120000);

  test("split proof fails if amounts don't conserve", async () => {
    const merkleProof = {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    };

    await expect(
      generateSplitProof({
        inputNullifier: 1n,
        inputSecret: 2n,
        inputAmount: 100000n,
        merkleRoot: 0n,
        merkleProof,
        output1Nullifier: 3n,
        output1Secret: 4n,
        output1Amount: 60000n,
        output2Nullifier: 5n,
        output2Secret: 6n,
        output2Amount: 50000n, // 60000 + 50000 = 110000 ≠ 100000
      })
    ).rejects.toThrow("Split must conserve amount");
  });
});

// ============================================================================
// 4. TRANSFER PROOF GENERATION
// ============================================================================

describe("TRANSFER PROOF", () => {
  test("generates and verifies transfer proof (1→1)", async () => {
    // Match circuit test values
    const inputNullifier = 12345n;
    const inputSecret = 67890n;
    const amount = 1000000n;

    const outputNullifier = 11111n;
    const outputSecret = 22222n;

    const inputCommitment = computeNoteCommitment(inputNullifier, inputSecret, amount);
    const merkleRoot = computeMerkleRootFromCommitment(inputCommitment, 20);

    // 20-level merkle proof
    const merkleProof = {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    };

    const proof = await generateTransferProof({
      inputNullifier,
      inputSecret,
      amount,
      merkleRoot,
      merkleProof,
      outputNullifier,
      outputSecret,
    });

    expect(proof.proof).toBeInstanceOf(Uint8Array);
    expect(proof.proof.length).toBeGreaterThan(0);

    const isValid = await verifyProof("transfer", proof);
    expect(isValid).toBe(true);
  }, 120000);
});

// ============================================================================
// 5. PROOF SERIALIZATION
// ============================================================================

describe("PROOF SERIALIZATION", () => {
  test("proof bytes are consistent", async () => {
    const nullifier = 12345n;
    const secret = 67890n;
    const amount = 100000n;

    const commitment = computeNoteCommitment(nullifier, secret, amount);
    const merkleRoot = computeMerkleRootFromCommitment(commitment, 20);

    const merkleProof = {
      siblings: Array(20).fill(0n),
      indices: Array(20).fill(0),
    };

    const proof = await generateClaimProof({
      nullifier,
      secret,
      amount,
      merkleRoot,
      merkleProof,
    });

    // Proof should be consistent format
    expect(proof.proof[0]).toBeDefined();
    expect(proof.publicInputs.length).toBeGreaterThan(0);

    // Public inputs should be field elements as strings
    for (const pi of proof.publicInputs) {
      expect(typeof pi).toBe("string");
      expect(BigInt(pi)).toBeGreaterThanOrEqual(0n);
    }
  }, 120000);
});

// ============================================================================
// 6. CLEANUP
// ============================================================================

describe("CLEANUP", () => {
  test("cleanup() releases resources", async () => {
    await cleanup();
    // Should complete without throwing
    expect(true).toBe(true);
  });
});
