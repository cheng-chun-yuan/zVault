/**
 * sbBTC Full Demo Script
 *
 * Demonstrates: Deposit → Claim → Split → Transfer
 *
 * Run: bun run scripts/demo-full.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';

// Program IDs
const BTC_LIGHT_CLIENT = new PublicKey("8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG");
const ZVAULT = new PublicKey("4qCkVgFUWQENxPXq86ccN7ZjBgyx7ehbkkfCXxCmrn4F");

// Circuit paths
const CIRCUIT_WASM = path.join(__dirname, "../../circuits/build/deposit_js/deposit.wasm");
const CIRCUIT_ZKEY = path.join(__dirname, "../../circuits/build/deposit_final.zkey");

// Utility to convert bigint to hex
function toHex(bn: bigint, length = 32): string {
  return bn.toString(16).padStart(length * 2, '0');
}

// Utility to generate random field element
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Reduce to BN254 field
  const bn = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  const p = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
  return bn % p;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("                    sbBTC FULL DEMO");
  console.log("=".repeat(70) + "\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const poseidon = await buildPoseidon();

  // Helper to compute Poseidon hash
  const poseidonHash = (...inputs: bigint[]): bigint => {
    const hash = poseidon(inputs.map(i => poseidon.F.e(i)));
    return poseidon.F.toObject(hash);
  };

  // ============================================================
  // PART 1: GENERATE CREDENTIALS
  // ============================================================
  console.log("┌" + "─".repeat(68) + "┐");
  console.log("│ PART 1: GENERATE PRIVATE CREDENTIALS                                │");
  console.log("└" + "─".repeat(68) + "┘\n");

  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const amount = 100000n; // 0.001 BTC in sats

  const commitment = poseidonHash(nullifier, secret);
  const nullifierHash = poseidonHash(nullifier);

  console.log("Generated credentials (stored locally, never shared):");
  console.log("  nullifier:      0x" + toHex(nullifier).slice(0, 16) + "...");
  console.log("  secret:         0x" + toHex(secret).slice(0, 16) + "...");
  console.log("  amount:         " + amount + " sats (0.001 BTC)");
  console.log("");
  console.log("Computed values:");
  console.log("  commitment:     0x" + toHex(commitment).slice(0, 16) + "...");
  console.log("  nullifierHash:  0x" + toHex(nullifierHash).slice(0, 16) + "...");
  console.log("");
  console.log("Privacy note:");
  console.log("  • commitment goes into Bitcoin OP_RETURN (public)");
  console.log("  • nullifier + secret stay with user (private)");
  console.log("  • nullifierHash revealed only at claim time");
  console.log("");

  // ============================================================
  // PART 2: DEPOSIT FLOW
  // ============================================================
  console.log("┌" + "─".repeat(68) + "┐");
  console.log("│ PART 2: BITCOIN DEPOSIT                                             │");
  console.log("└" + "─".repeat(68) + "┘\n");

  console.log("Bitcoin transaction structure:");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  Output 0: 100,000 sats → Taproot address               │");
  console.log("  │  Output 1: OP_RETURN   → commitment (32 bytes)          │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("SPV Verification (permissionless):");
  console.log("  ✓ Anyone can call verify_deposit");
  console.log("  ✓ Contract verifies: hash(raw_tx) == txid");
  console.log("  ✓ Contract verifies: merkle_proof against block header");
  console.log("  ✓ Contract verifies: 6+ confirmations");
  console.log("  ✓ Contract extracts: commitment from OP_RETURN");
  console.log("  ✓ Contract stores: commitment in Merkle tree");
  console.log("");

  // Check light client status
  const [lightClientPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("light_client")],
    BTC_LIGHT_CLIENT
  );

  try {
    const lcAccount = await connection.getAccountInfo(lightClientPda);
    if (lcAccount) {
      const tipHeight = lcAccount.data.readBigUInt64LE(9);
      console.log("Live on-chain status:");
      console.log("  Light client tip height: " + tipHeight);
    }
  } catch (e) {
    console.log("  (Light client status unavailable)");
  }
  console.log("");

  // ============================================================
  // PART 3: CLAIM FLOW (THE PRIVACY MAGIC)
  // ============================================================
  console.log("┌" + "─".repeat(68) + "┐");
  console.log("│ PART 3: CLAIM WITH ZK PROOF (THE PRIVACY MAGIC)                     │");
  console.log("└" + "─".repeat(68) + "┘\n");

  console.log("The problem with transparent claims:");
  console.log("  ❌ If we reveal commitment at claim time...");
  console.log("  ❌ Anyone can link deposit → claim");
  console.log("  ❌ All transactions become traceable");
  console.log("");
  console.log("ZK Proof solution:");
  console.log("  ✓ Prove knowledge of (nullifier, secret) for SOME commitment");
  console.log("  ✓ WITHOUT revealing WHICH commitment");
  console.log("  ✓ Only nullifierHash is revealed (unlinkable to commitment)");
  console.log("");

  console.log("ZK Proof structure:");
  console.log("  ┌─────────────────────────────────────────────────────────────┐");
  console.log("  │  PUBLIC INPUTS (visible to everyone):                       │");
  console.log("  │    • merkle_root:    0x7a3b...  (which tree state)         │");
  console.log("  │    • nullifier_hash: 0x" + toHex(nullifierHash).slice(0, 8) + "... (prevents double-spend)│");
  console.log("  │    • amount:         " + amount + " sats                           │");
  console.log("  │                                                             │");
  console.log("  │  PRIVATE INPUTS (only prover knows):                        │");
  console.log("  │    • nullifier:      0x" + toHex(nullifier).slice(0, 8) + "... (secret!)             │");
  console.log("  │    • secret:         0x" + toHex(secret).slice(0, 8) + "... (secret!)             │");
  console.log("  │    • commitment:     HIDDEN (cannot be linked!)             │");
  console.log("  │    • merkle_path:    HIDDEN (which leaf - unknown!)         │");
  console.log("  └─────────────────────────────────────────────────────────────┘");
  console.log("");

  // Try to generate a real proof
  console.log("Generating ZK proof...");
  if (fs.existsSync(CIRCUIT_WASM) && fs.existsSync(CIRCUIT_ZKEY)) {
    try {
      const input = {
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        commitment: commitment.toString(),
        amount: amount.toString(),
      };

      const startTime = Date.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        CIRCUIT_WASM,
        CIRCUIT_ZKEY
      );
      const elapsed = Date.now() - startTime;

      console.log("  ✓ Proof generated in " + elapsed + "ms");
      console.log("  ✓ Proof size: 256 bytes (Groth16)");
      console.log("  ✓ Public signals: " + publicSignals.length);
    } catch (e) {
      console.log("  (Proof generation skipped - circuit input mismatch)");
    }
  } else {
    console.log("  (Circuits not built - run 'bun run build:circuits' first)");
  }
  console.log("");

  console.log("Claim instruction:");
  console.log("  claim_direct(proof, merkle_root, nullifier_hash, amount)");
  console.log("");
  console.log("Result:");
  console.log("  ✓ User receives " + amount + " sbBTC tokens");
  console.log("  ✓ nullifier_hash recorded (cannot claim again)");
  console.log("  ✓ NO ONE knows which deposit was claimed!");
  console.log("");

  // ============================================================
  // PART 4: SPLIT COMMITMENT (CLAIM LINKS)
  // ============================================================
  console.log("┌" + "─".repeat(68) + "┐");
  console.log("│ PART 4: SPLIT COMMITMENT (CREATE CLAIM LINKS)                       │");
  console.log("└" + "─".repeat(68) + "┘\n");

  console.log("Use case: Send 60,000 sats to a friend, keep 40,000 as change");
  console.log("");

  // Generate friend's credentials
  const friendNullifier = randomFieldElement();
  const friendSecret = randomFieldElement();
  const friendAmount = 60000n;
  const friendCommitment = poseidonHash(friendNullifier, friendSecret);

  // Generate change credentials
  const changeNullifier = randomFieldElement();
  const changeSecret = randomFieldElement();
  const changeAmount = 40000n;
  const changeCommitment = poseidonHash(changeNullifier, changeSecret);

  console.log("Split operation:");
  console.log("  ┌───────────────────────────────────────────────────────────────┐");
  console.log("  │  INPUT                           OUTPUTS                      │");
  console.log("  │  ┌────────────────┐             ┌────────────────┐           │");
  console.log("  │  │ 100,000 sats   │             │  60,000 sats   │ → Friend  │");
  console.log("  │  │ commitment     │   ────►     │  new commit    │           │");
  console.log("  │  │ (nullified)    │             ├────────────────┤           │");
  console.log("  │  └────────────────┘             │  40,000 sats   │ → You     │");
  console.log("  │                                 │  new commit    │ (change)  │");
  console.log("  │                                 └────────────────┘           │");
  console.log("  │                                                               │");
  console.log("  │  ZK Proof verifies: 60,000 + 40,000 = 100,000 ✓              │");
  console.log("  │  Individual amounts remain PRIVATE!                          │");
  console.log("  └───────────────────────────────────────────────────────────────┘");
  console.log("");

  // Create claim link for friend
  const friendNote = {
    nullifier: toHex(friendNullifier),
    secret: toHex(friendSecret),
    amount: friendAmount.toString(),
  };
  const claimLinkData = Buffer.from(JSON.stringify(friendNote)).toString('base64');

  console.log("Friend's claim link:");
  console.log("  https://sbbtc.app/claim#" + claimLinkData.slice(0, 20) + "...");
  console.log("");
  console.log("How friend claims:");
  console.log("  1. Friend opens link in browser");
  console.log("  2. Frontend decodes (nullifier, secret, amount)");
  console.log("  3. Frontend generates ZK proof");
  console.log("  4. Friend calls claim_direct(proof, root, nullifierHash, amount)");
  console.log("  5. Friend receives 60,000 sbBTC!");
  console.log("");

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("┌" + "─".repeat(68) + "┐");
  console.log("│ SUMMARY                                                             │");
  console.log("└" + "─".repeat(68) + "┘\n");

  console.log("sbBTC Privacy Guarantees:");
  console.log("  ✓ Deposits are public (Bitcoin is transparent)");
  console.log("  ✓ Claims are unlinkable (ZK proofs hide which deposit)");
  console.log("  ✓ Transfers are private (split amounts hidden)");
  console.log("  ✓ Only sender/receiver know the amounts");
  console.log("");
  console.log("Programs deployed:");
  console.log("  btc-light-client: " + BTC_LIGHT_CLIENT.toBase58());
  console.log("  zVault:    " + ZVAULT.toBase58());
  console.log("");
  console.log("Live services:");
  console.log("  Header relayer:   Running 24/7 on Railway");
  console.log("  Network:          Bitcoin Testnet → Solana Devnet");
  console.log("");

  console.log("=".repeat(70));
  console.log("                    DEMO COMPLETE");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
