/**
 * Test Circom Poseidon (Solana-compatible)
 *
 * Computes ZERO_HASHES using circomlibjs and compares with on-chain.
 */

import { buildPoseidon } from "circomlibjs";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = "http://127.0.0.1:8899";
const COMMITMENT_TREE_PDA = "5p7WERgzB6AHcga19QehvaTfbiVoM1Bg6drkwzYHYamq";
const TREE_DEPTH = 20;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bigintToHex(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

async function main() {
  console.log("=== Test Circom Poseidon (Solana-compatible) ===\n");

  // Build poseidon hash function
  const poseidon = await buildPoseidon();

  // Compute ZERO_HASHES using Circom's poseidon
  console.log("Computing ZERO_HASHES with Circom poseidon:\n");

  const zeroHashes: bigint[] = [];
  zeroHashes[0] = 0n;

  for (let i = 1; i <= TREE_DEPTH; i++) {
    const prev = zeroHashes[i - 1];
    // poseidon takes array of inputs, returns Uint8Array
    const hash = poseidon([prev, prev]);
    // Convert Uint8Array to bigint (poseidon.F.toObject returns a bigint)
    zeroHashes[i] = poseidon.F.toObject(hash);
  }

  console.log("ZERO_HASHES (Circom poseidon):");
  for (let i = 0; i <= TREE_DEPTH; i++) {
    console.log(`  Level ${i}: 0x${bigintToHex(zeroHashes[i])}`);
  }

  console.log(`\nEmpty tree root (Circom): 0x${bigintToHex(zeroHashes[TREE_DEPTH])}`);

  // Fetch on-chain root
  const connection = new Connection(RPC_URL, "confirmed");
  const treePda = new PublicKey(COMMITMENT_TREE_PDA);
  const treeAccount = await connection.getAccountInfo(treePda);

  if (treeAccount) {
    // Root is at offset 8 (after discriminator + bump + padding)
    const onChainRoot = treeAccount.data.slice(8, 40);
    console.log(`On-chain root:           0x${bytesToHex(onChainRoot)}`);

    // Parse next_index to check if tree is empty
    const nextIndex = treeAccount.data.slice(40, 48);
    let nextIndexValue = 0n;
    for (let i = 0; i < 8; i++) {
      nextIndexValue |= BigInt(nextIndex[i]) << BigInt(i * 8);
    }
    console.log(`On-chain next_index: ${nextIndexValue}`);

    if (nextIndexValue === 0n) {
      // Compare empty tree roots
      const onChainRootHex = bytesToHex(onChainRoot);
      const circomRootHex = bigintToHex(zeroHashes[TREE_DEPTH]);

      if (onChainRootHex === circomRootHex) {
        console.log("\n✅ Empty tree roots MATCH! Circom poseidon is compatible with Solana.");
      } else {
        console.log("\n❌ Empty tree roots don't match");
        console.log("   Solana likely uses different Poseidon parameters");
      }
    }
  }

  // Also print format for Rust
  console.log("\n\n=== Rust format ===\n");
  console.log("pub const ZERO_HASHES: [[u8; 32]; TREE_DEPTH + 1] = [");
  for (let i = 0; i <= TREE_DEPTH; i++) {
    const hex = bigintToHex(zeroHashes[i]);
    console.log(`    hex_literal::hex!("${hex}"), // Level ${i}`);
  }
  console.log("];");
}

main().catch(console.error);
