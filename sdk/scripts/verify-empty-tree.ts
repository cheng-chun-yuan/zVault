/**
 * Verify Empty Tree Root
 *
 * Checks that the on-chain commitment tree's root matches
 * the SDK's expected empty tree root (ZERO_HASHES[20]).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { ZERO_HASHES, parseCommitmentTreeData } from "../src/commitment-tree";

const RPC_URL = "http://127.0.0.1:8899";

// From .localnet-config.json
const COMMITMENT_TREE_PDA = "5p7WERgzB6AHcga19QehvaTfbiVoM1Bg6drkwzYHYamq";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bigintToHex(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

async function main() {
  console.log("Verifying Empty Tree Root\n");
  console.log("=".repeat(60) + "\n");

  const connection = new Connection(RPC_URL, "confirmed");

  // Fetch commitment tree account
  const treePda = new PublicKey(COMMITMENT_TREE_PDA);
  const accountInfo = await connection.getAccountInfo(treePda);

  if (!accountInfo) {
    console.log("❌ Commitment tree account not found");
    process.exit(1);
  }

  console.log(`Account size: ${accountInfo.data.length} bytes`);

  // Parse tree state
  const treeState = parseCommitmentTreeData(accountInfo.data);

  const onChainRoot = bytesToHex(treeState.currentRoot);
  const expectedRoot = bigintToHex(ZERO_HASHES[20]);

  console.log(`\nOn-chain root:  0x${onChainRoot}`);
  console.log(`Expected root:  0x${expectedRoot}`);
  console.log(`Next index:     ${treeState.nextIndex}`);

  if (onChainRoot === expectedRoot) {
    console.log("\n✅ Empty tree root matches!");
    console.log("\nThe SDK and contract are using the same Merkle tree algorithm.");
  } else {
    console.log("\n❌ Root mismatch!");
    console.log("\nDebug info:");
    console.log(`  discriminator: ${treeState.discriminator}`);
    console.log(`  bump: ${treeState.bump}`);
    console.log(`  nextIndex: ${treeState.nextIndex}`);
    console.log(`  rootHistoryIndex: ${treeState.rootHistoryIndex}`);
    process.exit(1);
  }
}

main().catch(console.error);
