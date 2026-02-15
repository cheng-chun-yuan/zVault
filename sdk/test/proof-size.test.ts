/**
 * Test to verify proof size and format for non-ZK keccak mode
 *
 * Expected sizes (non-ZK, keccak mode):
 * - Proof: (67 + 11*logN) * 32 bytes
 * - For logN=15: 7424 bytes
 * - VK: 3680 bytes (split format)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../src/poseidon";
import { initProver } from "../src/prover/web";
import {
  createTestNote,
  createRealMerkleProof,
  generateRealClaimProof,
  bytesToHex,
} from "./e2e/helpers";

describe("Proof Size Verification", () => {
  beforeAll(async () => {
    console.log("Initializing Poseidon...");
    await initPoseidon();
    console.log("Initializing prover...");
    await initProver();
    console.log("Setup complete!\n");
  }, 120000);

  it("should generate non-ZK keccak proof with expected size", async () => {
    // Create a real test note with valid commitment
    const amount = 100_000n; // 0.001 BTC in sats
    const note = createTestNote(amount);

    console.log("=== Test Note ===");
    console.log(`Amount: ${amount} sats`);
    console.log(`Commitment: ${note.commitment.toString(16).slice(0, 16)}...`);
    console.log(`Leaf index: ${note.leafIndex}`);

    // Create a real Merkle proof
    const merkleProof = createRealMerkleProof(note.commitment);
    console.log(`\nMerkle root: ${merkleProof.root.toString(16).slice(0, 16)}...`);
    console.log(`Proof depth: ${merkleProof.siblings.length}`);

    // Generate real proof
    console.log("\n=== Generating UltraHonk Proof ===");
    const startTime = Date.now();

    const recipient = 0x1234567890ABCDEF1234567890ABCDEF12345678n;
    const proofBytes = await generateRealClaimProof(note, merkleProof, recipient);

    const elapsed = Date.now() - startTime;
    console.log(`Proof generation time: ${elapsed}ms`);

    // Analyze proof
    console.log("\n=== Proof Analysis ===");
    console.log(`Proof size: ${proofBytes.length} bytes`);
    console.log(`Proof size: ${proofBytes.length / 32} field elements`);

    // Calculate expected size for non-ZK
    // Formula: (67 + 11*logN) * 32
    const expectedSizeLogN15 = (67 + 11 * 15) * 32; // 7424 bytes
    const expectedSizeLogN16 = (67 + 11 * 16) * 32; // 7776 bytes
    const expectedSizeLogN14 = (67 + 11 * 14) * 32; // 7072 bytes

    console.log(`\nExpected sizes (non-ZK):`);
    console.log(`  logN=14: ${expectedSizeLogN14} bytes`);
    console.log(`  logN=15: ${expectedSizeLogN15} bytes`);
    console.log(`  logN=16: ${expectedSizeLogN16} bytes`);

    // Check if it's ZK mode (much larger)
    if (proofBytes.length > 10000) {
      console.log(`\n⚠️  WARNING: Proof size ${proofBytes.length} suggests ZK mode!`);
      console.log(`   Expected non-ZK size: ~7424 bytes`);
      console.log(`   Actual size: ${proofBytes.length} bytes`);
      console.log(`   bb.js may be generating ZK proofs despite { keccak: true }`);
    } else {
      console.log(`\n✓ Proof size ${proofBytes.length} is consistent with non-ZK mode`);

      // Estimate logN from proof size
      // size = (67 + 11*logN) * 32
      // logN = (size/32 - 67) / 11
      const estimatedLogN = (proofBytes.length / 32 - 67) / 11;
      console.log(`   Estimated circuit logN: ~${estimatedLogN.toFixed(1)}`);
    }

    // Print first few bytes of proof for debugging
    console.log(`\nProof header (first 64 bytes):`);
    console.log(bytesToHex(proofBytes.slice(0, 64)));

    // Basic sanity checks
    expect(proofBytes.length).toBeGreaterThan(0);

    // Non-ZK proof should be < 10000 bytes for typical circuits
    // ZK proofs are typically > 15000 bytes
    expect(proofBytes.length).toBeLessThan(10000);

  }, 300000); // 5 minute timeout for proof generation
});
