/**
 * Test Merkle Tree Consistency
 *
 * Verifies that the SDK's CommitmentTreeIndex produces the same roots
 * as the on-chain contract would.
 */

import { CommitmentTreeIndex, ZERO_HASHES, TREE_DEPTH } from "../src/commitment-tree";
import { poseidon2Hash } from "../src/poseidon2";

function bigintToHex(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

// Verify ZERO_HASHES are computed correctly
function verifyZeroHashes(): boolean {
  console.log("=== Verifying ZERO_HASHES ===\n");

  let valid = true;
  let prev = 0n;

  for (let i = 0; i <= TREE_DEPTH; i++) {
    if (i === 0) {
      if (ZERO_HASHES[i] !== 0n) {
        console.log(`❌ Level 0 should be 0n, got ${bigintToHex(ZERO_HASHES[i])}`);
        valid = false;
      } else {
        console.log(`✓ Level 0: 0x${"0".repeat(64)} (empty leaf)`);
      }
    } else {
      const expected = poseidon2Hash([prev, prev]);
      if (ZERO_HASHES[i] !== expected) {
        console.log(`❌ Level ${i}: Expected ${bigintToHex(expected)}, got ${bigintToHex(ZERO_HASHES[i])}`);
        valid = false;
      } else {
        console.log(`✓ Level ${i}: ${bigintToHex(ZERO_HASHES[i])}`);
      }
    }
    prev = ZERO_HASHES[i];
  }

  console.log(`\nEmpty tree root: ${bigintToHex(ZERO_HASHES[TREE_DEPTH])}`);
  return valid;
}

// Test tree with sequential insertions
function testTreeInsertions(): boolean {
  console.log("\n=== Testing Tree Insertions ===\n");

  const tree = new CommitmentTreeIndex();

  // Verify empty tree root
  const emptyRoot = tree.getRoot();
  console.log(`Empty tree root: ${bigintToHex(emptyRoot)}`);
  console.log(`Expected:        ${bigintToHex(ZERO_HASHES[TREE_DEPTH])}`);

  if (emptyRoot !== ZERO_HASHES[TREE_DEPTH]) {
    console.log("❌ Empty tree root mismatch!");
    return false;
  }
  console.log("✓ Empty tree root matches\n");

  // Insert some commitments and track roots
  const testCommitments = [
    { value: 123456789n, amount: 10000n },
    { value: 987654321n, amount: 20000n },
    { value: 111111111n, amount: 30000n },
    { value: 222222222n, amount: 40000n },
    { value: 333333333n, amount: 50000n },
  ];

  for (let i = 0; i < testCommitments.length; i++) {
    const { value, amount } = testCommitments[i];
    const index = tree.addCommitment(value, amount);
    const root = tree.getRoot();

    console.log(`Insert #${i}: commitment=${bigintToHex(value)}`);
    console.log(`  Index: ${index}, Root: ${bigintToHex(root)}`);

    // Verify merkle proof
    const proof = tree.getMerkleProof(value);
    if (!proof) {
      console.log("  ❌ Failed to get merkle proof");
      return false;
    }

    // Verify proof manually
    let computedRoot = value;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const sibling = proof.siblings[level];
      const isRight = proof.indices[level] === 1;

      if (isRight) {
        computedRoot = poseidon2Hash([sibling, computedRoot]);
      } else {
        computedRoot = poseidon2Hash([computedRoot, sibling]);
      }
    }

    if (computedRoot !== root) {
      console.log(`  ❌ Proof verification failed: computed=${bigintToHex(computedRoot)}, expected=${bigintToHex(root)}`);
      return false;
    }
    console.log(`  ✓ Merkle proof verified`);
  }

  return true;
}

// Test export/import round-trip
function testExportImport(): boolean {
  console.log("\n=== Testing Export/Import ===\n");

  const tree1 = new CommitmentTreeIndex();

  // Add some commitments
  tree1.addCommitment(12345n, 1000n);
  tree1.addCommitment(67890n, 2000n);
  tree1.addCommitment(11111n, 3000n);

  const root1 = tree1.getRoot();
  console.log(`Original tree root: ${bigintToHex(root1)}`);

  // Export and import to new tree
  const exported = tree1.export();
  const tree2 = new CommitmentTreeIndex();
  tree2.import(exported);

  const root2 = tree2.getRoot();
  console.log(`Imported tree root: ${bigintToHex(root2)}`);

  if (root1 !== root2) {
    console.log("❌ Roots don't match after import!");
    return false;
  }
  console.log("✓ Export/import preserves tree state");

  return true;
}

// Run all tests
async function main() {
  console.log("Merkle Tree Consistency Tests\n");
  console.log("=".repeat(60) + "\n");

  let allPassed = true;

  if (!verifyZeroHashes()) {
    allPassed = false;
  }

  if (!testTreeInsertions()) {
    allPassed = false;
  }

  if (!testExportImport()) {
    allPassed = false;
  }

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("\n✅ All tests passed!\n");
    process.exit(0);
  } else {
    console.log("\n❌ Some tests failed!\n");
    process.exit(1);
  }
}

main().catch(console.error);
