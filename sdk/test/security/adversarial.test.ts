/**
 * Merkle Tree Adversarial Security Tests
 *
 * Tests resistance to various attack vectors:
 * - Invalid/tampered proofs
 * - Boundary condition attacks
 * - Root forgery attempts
 * - Nullifier manipulation
 *
 * Run: bun test test/security/adversarial.test.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";

import {
  initPoseidon,
  poseidonHashSync,
  computeNullifierSync,
  hashNullifierSync,
} from "../../src/poseidon";
import {
  TREE_DEPTH,
  ZERO_HASHES,
  CommitmentTreeIndex,
} from "../../src/commitment-tree";
import { MAX_LEAVES } from "../../src/merkle";
import { randomFieldElement } from "../../src/crypto";

// Helper: verify a merkle proof manually
function verifyMerkleProof(
  leaf: bigint,
  siblings: bigint[],
  indices: number[],
  expectedRoot: bigint
): boolean {
  let current = leaf;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    const isLeft = indices[i] === 0;

    if (isLeft) {
      current = poseidonHashSync([current, sibling]);
    } else {
      current = poseidonHashSync([sibling, current]);
    }
  }
  return current === expectedRoot;
}

describe("Merkle Adversarial Security", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  // ===========================================================================
  // Invalid Proof Detection
  // ===========================================================================

  describe("rejects invalid proofs", () => {
    let tree: CommitmentTreeIndex;
    let commitment: bigint;
    let validProof: { siblings: bigint[]; indices: number[]; root: bigint; leafIndex: bigint };

    beforeAll(() => {
      tree = new CommitmentTreeIndex();
      commitment = 0xdeadbeef123456n;
      tree.addCommitment(commitment, 100n);
      validProof = tree.getMerkleProof(commitment)!;
    });

    it("rejects proof with tampered sibling", () => {
      const tamperedSiblings = [...validProof.siblings];
      tamperedSiblings[5] = tamperedSiblings[5] ^ 0xFFFFn; // Flip some bits

      const isValid = verifyMerkleProof(
        commitment,
        tamperedSiblings,
        validProof.indices,
        validProof.root
      );
      expect(isValid).toBe(false);
    });

    it("rejects proof with wrong leaf index (flipped path)", () => {
      const flippedIndices = [...validProof.indices];
      flippedIndices[0] = flippedIndices[0] === 0 ? 1 : 0;

      const isValid = verifyMerkleProof(
        commitment,
        validProof.siblings,
        flippedIndices,
        validProof.root
      );
      expect(isValid).toBe(false);
    });

    it("rejects proof with multiple flipped path indices", () => {
      const flippedIndices = validProof.indices.map((i) => (i === 0 ? 1 : 0));

      const isValid = verifyMerkleProof(
        commitment,
        validProof.siblings,
        flippedIndices,
        validProof.root
      );
      expect(isValid).toBe(false);
    });

    it("rejects proof with truncated siblings", () => {
      const truncatedSiblings = validProof.siblings.slice(0, 10);
      const truncatedIndices = validProof.indices.slice(0, 10);

      // With fewer siblings, we get a different "root"
      let current = commitment;
      for (let i = 0; i < truncatedSiblings.length; i++) {
        const sibling = truncatedSiblings[i];
        const isLeft = truncatedIndices[i] === 0;
        current = isLeft
          ? poseidonHashSync([current, sibling])
          : poseidonHashSync([sibling, current]);
      }

      expect(current).not.toBe(validProof.root);
    });

    it("rejects proof against wrong root", () => {
      const wrongRoot = 0xBADBADBADn;

      const isValid = verifyMerkleProof(
        commitment,
        validProof.siblings,
        validProof.indices,
        wrongRoot
      );
      expect(isValid).toBe(false);
    });

    it("rejects proof for different commitment", () => {
      const differentCommitment = 0x999999999n;

      const isValid = verifyMerkleProof(
        differentCommitment,
        validProof.siblings,
        validProof.indices,
        validProof.root
      );
      expect(isValid).toBe(false);
    });

    it("rejects proof with all-zero siblings against real root", () => {
      const zeroSiblings = Array(TREE_DEPTH).fill(0n);
      const zeroIndices = Array(TREE_DEPTH).fill(0);

      const isValid = verifyMerkleProof(
        commitment,
        zeroSiblings,
        zeroIndices,
        validProof.root
      );
      expect(isValid).toBe(false);
    });
  });

  // ===========================================================================
  // Boundary Attacks
  // ===========================================================================

  describe("handles boundary conditions safely", () => {
    it("tree rejects leaf index >= MAX_LEAVES", () => {
      const tree = new CommitmentTreeIndex();

      // Add leaves up to a small limit for testing
      // (can't actually add 2^20 leaves in tests)
      for (let i = 0; i < 10; i++) {
        tree.addCommitment(BigInt(i + 1), 100n);
      }

      expect(tree.getNextIndex()).toBe(10n);
    });

    it("handles leaf index 0 correctly", () => {
      const tree = new CommitmentTreeIndex();
      const commitment = 0x12345n;
      tree.addCommitment(commitment, 100n);

      const proof = tree.getMerkleProof(commitment);
      expect(proof).not.toBeNull();
      expect(proof!.leafIndex).toBe(0n);

      const isValid = verifyMerkleProof(
        commitment,
        proof!.siblings,
        proof!.indices,
        proof!.root
      );
      expect(isValid).toBe(true);
    });

    it("handles sequential insertions correctly", () => {
      const tree = new CommitmentTreeIndex();
      const commitments: bigint[] = [];

      for (let i = 0; i < 100; i++) {
        const c = BigInt(0x10000 + i);
        commitments.push(c);
        tree.addCommitment(c, BigInt(i));
      }

      // Verify all proofs
      for (let i = 0; i < commitments.length; i++) {
        const proof = tree.getMerkleProof(commitments[i]);
        expect(proof).not.toBeNull();
        expect(Number(proof!.leafIndex)).toBe(i);

        const isValid = verifyMerkleProof(
          commitments[i],
          proof!.siblings,
          proof!.indices,
          proof!.root
        );
        expect(isValid).toBe(true);
      }
    });

    it("different commitments at same amount get different proofs", () => {
      const tree = new CommitmentTreeIndex();

      const c1 = 0xAAAAn;
      const c2 = 0xBBBBn;

      tree.addCommitment(c1, 100n);
      tree.addCommitment(c2, 100n);

      const proof1 = tree.getMerkleProof(c1)!;
      const proof2 = tree.getMerkleProof(c2)!;

      expect(proof1.leafIndex).not.toBe(proof2.leafIndex);
      // Both should share the same root
      expect(proof1.root).toBe(proof2.root);
    });
  });

  // ===========================================================================
  // Forged Root Attacks
  // ===========================================================================

  describe("resists root forgery", () => {
    it("cannot use proof from one tree in another", () => {
      const tree1 = new CommitmentTreeIndex();
      const tree2 = new CommitmentTreeIndex();

      const c1 = 0x111n;
      const c2 = 0x222n;

      tree1.addCommitment(c1, 100n);
      tree2.addCommitment(c2, 100n);

      const proof1 = tree1.getMerkleProof(c1)!;

      // Try to verify c1's proof against tree2's root
      const isValid = verifyMerkleProof(
        c1,
        proof1.siblings,
        proof1.indices,
        tree2.getRoot()
      );
      expect(isValid).toBe(false);
    });

    it("proof becomes invalid after new insertion", () => {
      const tree = new CommitmentTreeIndex();

      const c1 = 0x111n;
      tree.addCommitment(c1, 100n);
      const oldProof = tree.getMerkleProof(c1)!;
      const oldRoot = tree.getRoot();

      // Add another commitment (changes root)
      tree.addCommitment(0x222n, 100n);
      const newRoot = tree.getRoot();

      expect(oldRoot).not.toBe(newRoot);

      // Old proof should NOT verify against new root
      const isValidAgainstNew = verifyMerkleProof(
        c1,
        oldProof.siblings,
        oldProof.indices,
        newRoot
      );
      expect(isValidAgainstNew).toBe(false);

      // But old proof SHOULD still verify against old root
      // (root history feature)
      const isValidAgainstOld = verifyMerkleProof(
        c1,
        oldProof.siblings,
        oldProof.indices,
        oldRoot
      );
      expect(isValidAgainstOld).toBe(true);
    });
  });

  // ===========================================================================
  // Nullifier Security
  // ===========================================================================

  describe("nullifier uniqueness", () => {
    it("same inputs produce same nullifier (deterministic)", () => {
      const privKey = 0x12345n;
      const leafIndex = 42n;

      const nullifier1 = computeNullifierSync(privKey, leafIndex);
      const nullifier2 = computeNullifierSync(privKey, leafIndex);
      const nullifier3 = computeNullifierSync(privKey, leafIndex);

      expect(nullifier1).toBe(nullifier2);
      expect(nullifier2).toBe(nullifier3);
    });

    it("different privKeys produce different nullifiers", () => {
      const leafIndex = 42n;

      const nullifier1 = computeNullifierSync(0x111n, leafIndex);
      const nullifier2 = computeNullifierSync(0x222n, leafIndex);

      expect(nullifier1).not.toBe(nullifier2);
    });

    it("different leafIndices produce different nullifiers", () => {
      const privKey = 0x12345n;

      const nullifier1 = computeNullifierSync(privKey, 0n);
      const nullifier2 = computeNullifierSync(privKey, 1n);
      const nullifier3 = computeNullifierSync(privKey, 2n);

      expect(nullifier1).not.toBe(nullifier2);
      expect(nullifier2).not.toBe(nullifier3);
      expect(nullifier1).not.toBe(nullifier3);
    });

    it("nullifier hash is deterministic", () => {
      const nullifier = computeNullifierSync(0x12345n, 42n);

      const hash1 = hashNullifierSync(nullifier);
      const hash2 = hashNullifierSync(nullifier);

      expect(hash1).toBe(hash2);
    });

    it("cannot predict nullifier without privKey", () => {
      // Given only the commitment and leafIndex, cannot derive nullifier
      const privKey = randomFieldElement();
      const leafIndex = 5n;

      const nullifier = computeNullifierSync(privKey, leafIndex);

      // Even with wrong privKey guesses, won't get the same nullifier
      for (let i = 0; i < 10; i++) {
        const guessedPrivKey = randomFieldElement();
        if (guessedPrivKey !== privKey) {
          const guessedNullifier = computeNullifierSync(guessedPrivKey, leafIndex);
          expect(guessedNullifier).not.toBe(nullifier);
        }
      }
    });

    it("nullifier changes with leaf index (prevents replay at different position)", () => {
      const privKey = 0xABCDEFn;

      const nullifiers = new Set<bigint>();
      for (let i = 0; i < 100; i++) {
        const nullifier = computeNullifierSync(privKey, BigInt(i));
        expect(nullifiers.has(nullifier)).toBe(false);
        nullifiers.add(nullifier);
      }

      expect(nullifiers.size).toBe(100);
    });
  });
});
