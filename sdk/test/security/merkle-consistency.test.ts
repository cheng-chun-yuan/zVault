/**
 * Merkle Tree Cross-Implementation Consistency Tests
 *
 * Verifies that SDK merkle implementations produce identical results
 * and match known test vectors.
 *
 * Run: bun test test/security/merkle-consistency.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";

import { initPoseidon, poseidonHashSync } from "../../src/poseidon";
import {
  TREE_DEPTH,
  ZERO_HASHES,
  CommitmentTreeIndex,
} from "../../src/commitment-tree";
import {
  createMerkleProof,
  validateMerkleProofStructure,
  leafIndexToPathIndices,
  pathIndicesToLeafIndex,
  MAX_LEAVES,
} from "../../src/merkle";

// Test vectors from shared file
import vectors from "../../../test-vectors/merkle-vectors.json";

describe("Merkle Cross-Implementation Consistency", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  // ===========================================================================
  // Zero Hash Constants
  // ===========================================================================

  describe("ZERO_HASHES match across implementations", () => {
    it("commitment-tree.ts ZERO_HASHES[0] is zero", () => {
      expect(ZERO_HASHES[0]).toBe(0n);
    });

    it("commitment-tree.ts ZERO_HASHES[1] matches Poseidon(0, 0)", () => {
      const computed = poseidonHashSync([0n, 0n]);
      expect(ZERO_HASHES[1]).toBe(computed);
    });

    it("each ZERO_HASH[i] = Poseidon(ZERO_HASH[i-1], ZERO_HASH[i-1])", () => {
      for (let i = 1; i <= 5; i++) {
        const computed = poseidonHashSync([ZERO_HASHES[i - 1], ZERO_HASHES[i - 1]]);
        expect(ZERO_HASHES[i]).toBe(computed);
      }
    });

    it("ZERO_HASHES[20] matches test vector (empty tree root)", () => {
      const vectorEntry = vectors.zero_hashes.find((z) => z.level === 20);
      expect(vectorEntry).toBeDefined();
      const expected = BigInt(vectorEntry!.value);
      expect(ZERO_HASHES[20]).toBe(expected);
    });

    it("commitment-tree has correct TREE_DEPTH", () => {
      expect(TREE_DEPTH).toBe(vectors.constants.TREE_DEPTH);
    });
  });

  // ===========================================================================
  // Poseidon Hash Consistency
  // ===========================================================================

  describe("Poseidon hash produces consistent results", () => {
    it("hash(0, 0) matches test vector", () => {
      const result = poseidonHashSync([0n, 0n]);
      const expected = BigInt(vectors.poseidon_hash[0].expected);
      expect(result).toBe(expected);
    });

    it("hash is deterministic", () => {
      const a = 12345n;
      const b = 67890n;

      const hash1 = poseidonHashSync([a, b]);
      const hash2 = poseidonHashSync([a, b]);
      const hash3 = poseidonHashSync([a, b]);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("hash(a, b) != hash(b, a) for a != b (non-commutative)", () => {
      const a = 0x1234n;
      const b = 0x5678n;

      const hashAB = poseidonHashSync([a, b]);
      const hashBA = poseidonHashSync([b, a]);

      expect(hashAB).not.toBe(hashBA);
    });

    it("different inputs produce different outputs", () => {
      const hash1 = poseidonHashSync([1n, 2n]);
      const hash2 = poseidonHashSync([1n, 3n]);
      const hash3 = poseidonHashSync([2n, 2n]);

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });
  });

  // ===========================================================================
  // Tree Root Consistency
  // ===========================================================================

  describe("Merkle root computation is consistent", () => {
    it("empty tree root matches ZERO_HASHES[TREE_DEPTH]", () => {
      const tree = new CommitmentTreeIndex();
      expect(tree.getRoot()).toBe(ZERO_HASHES[TREE_DEPTH]);
    });

    it("single leaf tree produces consistent root", () => {
      const tree1 = new CommitmentTreeIndex();
      const tree2 = new CommitmentTreeIndex();

      const commitment = 0x123456789abcdef0n;

      tree1.addCommitment(commitment, 100n);
      tree2.addCommitment(commitment, 100n);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
      expect(tree1.getRoot()).not.toBe(ZERO_HASHES[TREE_DEPTH]);
    });

    it("insertion order affects root", () => {
      const tree1 = new CommitmentTreeIndex();
      const tree2 = new CommitmentTreeIndex();

      const c1 = 111n;
      const c2 = 222n;

      tree1.addCommitment(c1, 100n);
      tree1.addCommitment(c2, 100n);

      tree2.addCommitment(c2, 100n);
      tree2.addCommitment(c1, 100n);

      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it("1000 sequential inserts produce deterministic root", () => {
      const tree1 = new CommitmentTreeIndex();
      const tree2 = new CommitmentTreeIndex();

      for (let i = 0; i < 1000; i++) {
        const commitment = BigInt(i * 12345 + 67890);
        tree1.addCommitment(commitment, BigInt(i));
        tree2.addCommitment(commitment, BigInt(i));
      }

      expect(tree1.getRoot()).toBe(tree2.getRoot());
      expect(tree1.size()).toBe(1000);
    });
  });

  // ===========================================================================
  // Proof Generation Consistency
  // ===========================================================================

  describe("Merkle proof generation is consistent", () => {
    it("generated proof has correct structure", () => {
      const tree = new CommitmentTreeIndex();
      const commitment = 0xabcdef123456n;
      tree.addCommitment(commitment, 100n);

      const proof = tree.getMerkleProof(commitment);
      expect(proof).not.toBeNull();
      expect(proof!.siblings.length).toBe(TREE_DEPTH);
      expect(proof!.indices.length).toBe(TREE_DEPTH);
    });

    it("proof verifies against computed root", () => {
      const tree = new CommitmentTreeIndex();
      const commitments = [111n, 222n, 333n, 444n, 555n];

      for (const c of commitments) {
        tree.addCommitment(c, 100n);
      }

      // Verify proof for each commitment
      for (const c of commitments) {
        const proof = tree.getMerkleProof(c);
        expect(proof).not.toBeNull();
        expect(proof!.root).toBe(tree.getRoot());

        // Manually verify the proof
        let current = c;
        for (let i = 0; i < proof!.siblings.length; i++) {
          const sibling = proof!.siblings[i];
          const isLeft = proof!.indices[i] === 0;

          if (isLeft) {
            current = poseidonHashSync([current, sibling]);
          } else {
            current = poseidonHashSync([sibling, current]);
          }
        }
        expect(current).toBe(proof!.root);
      }
    });

    it("pathIndicesToLeafIndex inverts leafIndexToPathIndices", () => {
      for (const leafIndex of [0, 1, 2, 7, 100, 1000, 1048575]) {
        const indices = leafIndexToPathIndices(leafIndex, TREE_DEPTH);
        const recovered = pathIndicesToLeafIndex(indices);
        expect(recovered).toBe(leafIndex);
      }
    });

    it("leafIndexToPathIndices produces correct path for index 0", () => {
      const indices = leafIndexToPathIndices(0, TREE_DEPTH);
      expect(indices.every((i) => i === 0)).toBe(true);
    });

    it("leafIndexToPathIndices produces correct path for max index", () => {
      const maxIndex = (1 << TREE_DEPTH) - 1;
      const indices = leafIndexToPathIndices(maxIndex, TREE_DEPTH);
      expect(indices.every((i) => i === 1)).toBe(true);
    });
  });

  // ===========================================================================
  // Merkle Proof Structure Validation
  // ===========================================================================

  describe("MerkleProof structure validation", () => {
    it("validates correct proof structure", () => {
      const pathElements = Array(TREE_DEPTH)
        .fill(null)
        .map(() => new Uint8Array(32));
      const pathIndices = Array(TREE_DEPTH).fill(0);
      const root = new Uint8Array(32);

      const proof = createMerkleProof(pathElements, pathIndices, 0, root);
      expect(validateMerkleProofStructure(proof)).toBe(true);
    });

    it("rejects proof with wrong path element count", () => {
      const pathElements = Array(TREE_DEPTH - 1)
        .fill(null)
        .map(() => new Uint8Array(32));
      const pathIndices = Array(TREE_DEPTH).fill(0);
      const root = new Uint8Array(32);

      expect(() => createMerkleProof(pathElements, pathIndices, 0, root)).toThrow();
    });

    it("rejects proof with wrong path indices count", () => {
      const pathElements = Array(TREE_DEPTH)
        .fill(null)
        .map(() => new Uint8Array(32));
      const pathIndices = Array(TREE_DEPTH - 1).fill(0);
      const root = new Uint8Array(32);

      expect(() => createMerkleProof(pathElements, pathIndices, 0, root)).toThrow();
    });
  });
});
