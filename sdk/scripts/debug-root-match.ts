/**
 * Debug Root Match
 *
 * Takes the on-chain commitment and computes what root SDK would produce.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { poseidon2Hash } from "../src/poseidon2";
import { bigintToBytes } from "../src/crypto";
import { ZERO_HASHES, TREE_DEPTH, parseCommitmentTreeData, CommitmentTreeIndex } from "../src/commitment-tree";

const RPC_URL = "http://127.0.0.1:8899";
const COMMITMENT_TREE_PDA = "5p7WERgzB6AHcga19QehvaTfbiVoM1Bg6drkwzYHYamq";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function bigintToHex(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

async function main() {
  console.log("=== Debug Root Match ===\n");

  const connection = new Connection(RPC_URL, "confirmed");
  const treePda = new PublicKey(COMMITMENT_TREE_PDA);
  const treeAccount = await connection.getAccountInfo(treePda);

  if (!treeAccount) {
    console.log("Tree account not found");
    return;
  }

  const treeState = parseCommitmentTreeData(treeAccount.data);

  console.log("On-chain state:");
  console.log(`  Next index: ${treeState.nextIndex}`);
  console.log(`  Root: 0x${bytesToHex(treeState.currentRoot)}`);

  if (treeState.nextIndex === 0n) {
    console.log("\nTree is empty, nothing to compare");
    return;
  }

  // Get the commitment from frontier[0] - this is the last leaf inserted
  // For a tree with 1 leaf (index 0), this is exactly that leaf
  const commitment = bytesToBigint(treeState.frontier[0]);
  console.log(`\nOn-chain frontier[0] (commitment):`);
  console.log(`  hex: 0x${bytesToHex(treeState.frontier[0])}`);
  console.log(`  bigint: ${commitment}`);

  // Now compute what root SDK would produce for this commitment at index 0
  console.log("\n=== SDK Computation (manual) ===");

  let currentHash = commitment;
  let currentIndex = 0;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const isLeft = currentIndex % 2 === 0;
    const sibling = ZERO_HASHES[level];

    if (isLeft) {
      currentHash = poseidon2Hash([currentHash, sibling]);
    } else {
      currentHash = poseidon2Hash([sibling, currentHash]);
    }
    currentIndex = Math.floor(currentIndex / 2);

    if (level < 3) {
      console.log(`Level ${level}: H(${bigintToHex(isLeft ? commitment : sibling).slice(0, 16)}..., ${bigintToHex(isLeft ? sibling : commitment).slice(0, 16)}...) = ${bigintToHex(currentHash).slice(0, 16)}...`);
    }
  }

  console.log(`\nSDK computed root: 0x${bigintToHex(currentHash)}`);
  console.log(`On-chain root:     0x${bytesToHex(treeState.currentRoot)}`);

  const onChainRootBigint = bytesToBigint(treeState.currentRoot);
  if (currentHash === onChainRootBigint) {
    console.log("\n✅ Roots match!");
  } else {
    console.log("\n❌ Roots don't match");

    // Try reverse byte order
    console.log("\n=== Trying with reversed commitment bytes ===");
    const reversedBytes = new Uint8Array(treeState.frontier[0]).reverse();
    const reversedCommitment = bytesToBigint(reversedBytes);
    console.log(`Reversed commitment: 0x${bigintToHex(reversedCommitment)}`);

    currentHash = reversedCommitment;
    currentIndex = 0;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const isLeft = currentIndex % 2 === 0;
      const sibling = ZERO_HASHES[level];
      if (isLeft) {
        currentHash = poseidon2Hash([currentHash, sibling]);
      } else {
        currentHash = poseidon2Hash([sibling, currentHash]);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    console.log(`SDK root with reversed: 0x${bigintToHex(currentHash)}`);

    if (currentHash === onChainRootBigint) {
      console.log("✅ Roots match with reversed bytes!");
    }
  }

  // Also test with CommitmentTreeIndex class
  console.log("\n=== Using CommitmentTreeIndex class ===");
  const tree = new CommitmentTreeIndex();
  tree.addCommitment(commitment, 10000n);
  console.log(`Tree root: 0x${bigintToHex(tree.getRoot())}`);
}

main().catch(console.error);
