/**
 * Debug Poseidon2 Consistency
 *
 * Compares SDK poseidon2 output with on-chain results.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { poseidon2Hash } from "../src/poseidon2";
import { bigintToBytes, bytesToBigint } from "../src/crypto";
import { ZERO_HASHES, parseCommitmentTreeData, CommitmentTreeIndex } from "../src/commitment-tree";

const RPC_URL = "http://127.0.0.1:8899";
const COMMITMENT_TREE_PDA = "5p7WERgzB6AHcga19QehvaTfbiVoM1Bg6drkwzYHYamq";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bigintToHex(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

async function main() {
  console.log("=== Debug Poseidon2 Consistency ===\n");

  const connection = new Connection(RPC_URL, "confirmed");
  const treePda = new PublicKey(COMMITMENT_TREE_PDA);
  const treeAccount = await connection.getAccountInfo(treePda);

  if (!treeAccount) {
    console.log("Tree account not found");
    return;
  }

  const treeState = parseCommitmentTreeData(treeAccount.data);
  console.log(`On-chain next index: ${treeState.nextIndex}`);
  console.log(`On-chain root: 0x${bytesToHex(treeState.currentRoot)}`);

  // Test with a known commitment value
  const testCommitment = 12345678901234567890n;
  const testCommitmentBytes = bigintToBytes(testCommitment);

  console.log(`\nTest commitment (bigint): ${testCommitment}`);
  console.log(`Test commitment (hex): 0x${bigintToHex(testCommitment)}`);
  console.log(`Test commitment (bytes): ${bytesToHex(testCommitmentBytes)}`);

  // SDK computation: H(commitment, 0)
  const sdkHash = poseidon2Hash([testCommitment, 0n]);
  console.log(`\nSDK H(commitment, 0): 0x${bigintToHex(sdkHash)}`);

  // Check ZERO_HASHES[0]
  console.log(`\nZERO_HASHES[0] (bigint): ${ZERO_HASHES[0]}`);
  const zeroBytes = bigintToBytes(ZERO_HASHES[0]);
  console.log(`ZERO_HASHES[0] (bytes): ${bytesToHex(zeroBytes)}`);

  // Test the full tree computation
  const localTree = new CommitmentTreeIndex();
  console.log(`\nEmpty tree root: 0x${bigintToHex(localTree.getRoot())}`);

  localTree.addCommitment(testCommitment, 10000n);
  const afterInsert = localTree.getRoot();
  console.log(`After inserting test commitment: 0x${bigintToHex(afterInsert)}`);

  // Compare with on-chain frontier (if available)
  if (treeState.nextIndex > 0n) {
    console.log("\nOn-chain frontier[0]:");
    const frontier0 = treeState.frontier[0];
    const frontier0Bigint = bytesToBigint(frontier0);
    console.log(`  bytes: ${bytesToHex(frontier0)}`);
    console.log(`  bigint: ${frontier0Bigint}`);

    // Compute what SDK would get for this commitment
    // We don't know the original commitment value, but we can check if
    // the SDK's poseidon2 produces matching results for known inputs
  }

  // Test byte conversion round-trip
  console.log("\n=== Byte Conversion Test ===");
  const original = 0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755n;
  const bytes = bigintToBytes(original);
  const backToBigint = bytesToBigint(bytes);
  console.log(`Original: 0x${bigintToHex(original)}`);
  console.log(`Bytes:    ${bytesToHex(bytes)}`);
  console.log(`Back:     0x${bigintToHex(backToBigint)}`);
  console.log(`Match:    ${original === backToBigint}`);
}

main().catch(console.error);
