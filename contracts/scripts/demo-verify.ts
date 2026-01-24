/**
 * Demo: Verify Bitcoin Deposit via SPV Proof
 *
 * Run: bun run scripts/demo-verify.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';

// Test deposit data
const TEST_DATA = {
  txid: "bec8672b7dab057d6ccbcb52f664f9964652e6706646f849aef507b7f554d2ab",
  amount: 100000, // sats
  taprootAddress: "tb1pafqqaayy9actlajpqnyks50n4yvy4xmhgcn0ahhe4gnjjwwz6j4s3ll6pt",
  commitment: "1205444fd4eb0649c6d26a7fe15893f0ded3131fa060dcf6edf1b1f9ff586e9f",
  blockHeight: 850000,
};

// Program IDs
const BTC_LIGHT_CLIENT = new PublicKey("8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG");
const ZVAULT = new PublicKey("4qCkVgFUWQENxPXq86ccN7ZjBgyx7ehbkkfCXxCmrn4F");

async function main() {
  console.log("\n=== sbBTC SPV Verification Demo ===\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // 1. Show light client status
  console.log("1. Bitcoin Light Client Status");
  console.log("   Program:", BTC_LIGHT_CLIENT.toBase58());

  const [lightClientPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("light_client")],
    BTC_LIGHT_CLIENT
  );
  console.log("   Light Client PDA:", lightClientPda.toBase58());

  try {
    const lcAccount = await connection.getAccountInfo(lightClientPda);
    if (lcAccount) {
      // Parse tip height (skip discriminator 8 bytes + bump 1 byte)
      const tipHeight = lcAccount.data.readBigUInt64LE(9);
      console.log("   On-chain tip height:", tipHeight.toString());
    }
  } catch (e) {
    console.log("   (Light client not initialized yet)");
  }

  // 2. Show test deposit details
  console.log("\n2. Test Bitcoin Deposit");
  console.log("   Txid:", TEST_DATA.txid);
  console.log("   Amount:", TEST_DATA.amount, "sats (", TEST_DATA.amount / 100_000_000, "BTC)");
  console.log("   Taproot Address:", TEST_DATA.taprootAddress);
  console.log("   Commitment:", TEST_DATA.commitment.slice(0, 16) + "...");

  // 3. Show verification flow
  console.log("\n3. SPV Verification Flow");
  console.log("   a. Raw transaction uploaded to ChadBuffer");
  console.log("   b. Call verify_deposit with:");
  console.log("      - txid (32 bytes)");
  console.log("      - merkle_proof (siblings + indices)");
  console.log("      - block_height:", TEST_DATA.blockHeight);
  console.log("   c. Contract verifies:");
  console.log("      - hash(raw_tx) == txid");
  console.log("      - merkle_proof against block merkle_root");
  console.log("      - block has 6+ confirmations");
  console.log("   d. Commitment extracted from OP_RETURN");
  console.log("   e. Commitment stored in merkle tree");

  // 4. Show zVault status
  console.log("\n4. zVault Contract");
  console.log("   Program:", ZVAULT.toBase58());

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state")],
    ZVAULT
  );
  console.log("   Pool State PDA:", poolPda.toBase58());

  // 5. Architecture
  console.log("\n5. Architecture");
  console.log("   ┌─────────────┐    ┌──────────────┐    ┌─────────────┐");
  console.log("   │  Bitcoin    │───▶│   Relayer    │───▶│ btc-light-  │");
  console.log("   │  (testnet)  │    │  (Railway)   │    │   client    │");
  console.log("   └─────────────┘    └──────────────┘    └──────┬──────┘");
  console.log("                                                  │");
  console.log("   ┌─────────────┐    ┌──────────────┐    ┌──────▼──────┐");
  console.log("   │    User     │───▶│verify_deposit│───▶│ zVault│");
  console.log("   │ (SPV proof) │    │(permissionless)   │ (mint sbBTC)│");
  console.log("   └─────────────┘    └──────────────┘    └─────────────┘");

  console.log("\n=== Demo Complete ===\n");
}

main().catch(console.error);
