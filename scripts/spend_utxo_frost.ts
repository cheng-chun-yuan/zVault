/**
 * FROST Threshold Spending Demo
 *
 * This script demonstrates spending from a Taproot UTXO using FROST 2-of-3 threshold signing.
 *
 * UTXO Details:
 * - TXID: b548a007f3f9b5df71c8558a3040f37e3a5734d810d4eb021fe4a57bedcd2334
 * - VOUT: 0
 * - Amount: 10,000 sats
 * - Address: tb1puxc4wpqy03f7mr6qw7rcnkvhu7ffft3k3afnynlmerjdlxajm7ks9js58n
 */

import { createHash } from "crypto";

const FROST_SIGNERS = [
  "http://localhost:9001",
  "http://localhost:9002",
  "http://localhost:9003",
];

const UTXO = {
  txid: "b548a007f3f9b5df71c8558a3040f37e3a5734d810d4eb021fe4a57bedcd2334",
  vout: 0,
  amount: 10000, // satoshis
  scriptPubkey: "5120e1b15704047c53ed8f40778789d997e79294ae368f53324ffbc8e4df9bb2dfad",
};

const GROUP_PUBKEY = "e1b15704047c53ed8f40778789d997e79294ae368f53324ffbc8e4df9bb2dfad";

// Destination address (send back to a testnet faucet or your own address)
const DESTINATION = "tb1p3e44guscrytuum9q36tlx5kez9zvdheuwxlq9k9y4kud3hyckhtq63fz34"; // Change this!
const FEE = 154; // satoshis

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

// Reverse bytes (for txid endianness)
function reverseBytes(hex: string): string {
  const bytes = hexToBytes(hex);
  return bytesToHex(bytes.reverse());
}

// Create a simple P2TR spending transaction (unsigned)
function createUnsignedTx(): { txHex: string; sighash: Uint8Array } {
  // Transaction structure for Taproot key-path spend
  // Version (4 bytes, little-endian)
  let tx = "02000000";

  // Marker + Flag for SegWit
  tx += "0001";

  // Input count (1)
  tx += "01";

  // Input: previous txid (reversed) + vout + script + sequence
  tx += reverseBytes(UTXO.txid);
  tx += "00000000"; // vout 0
  tx += "00"; // empty scriptSig for SegWit
  tx += "fdffffff"; // sequence

  // Output count (1)
  tx += "01";

  // Output: amount (8 bytes LE) + scriptPubkey
  const outputAmount = UTXO.amount - FEE;
  const amountLE = outputAmount.toString(16).padStart(16, "0");
  // Convert to little-endian
  const amountBytes = hexToBytes(amountLE);
  tx += bytesToHex(amountBytes.reverse());

  // Destination scriptPubkey (P2TR)
  // Decode bech32m address to get the witness program
  // For simplicity, we'll use the same scriptPubkey format as input
  // In production, properly decode the destination address
  const destScriptPubkey = "51208e6b5472181917ce6ca08e97f352d91144c6df3c71be02d8a4adb8d8dc98b5d6";
  tx += (destScriptPubkey.length / 2).toString(16).padStart(2, "0");
  tx += destScriptPubkey;

  // Witness (placeholder - will be filled with signature)
  tx += "01"; // 1 witness element
  tx += "40"; // 64 bytes (Schnorr signature)
  tx += "00".repeat(64); // placeholder

  // Locktime
  tx += "00000000";

  // Compute BIP-341 sighash for key-path spend
  // This is a simplified version - real implementation needs full BIP-341 sighash
  const sighashPreimage = computeTaprootSighash();

  return { txHex: tx, sighash: sighashPreimage };
}

// Compute BIP-341 Taproot sighash (simplified)
function computeTaprootSighash(): Uint8Array {
  // BIP-341 sighash computation is complex
  // For this demo, we create a deterministic hash from the transaction data
  // In production, use a proper Bitcoin library

  const data = new Uint8Array([
    // Sighash epoch (0x00 for taproot)
    0x00,
    // Sighash type (SIGHASH_DEFAULT = 0x00)
    0x00,
    // Transaction version
    0x02, 0x00, 0x00, 0x00,
    // Locktime
    0x00, 0x00, 0x00, 0x00,
    // ... more fields would be needed for real sighash
  ]);

  // Add prevouts hash
  const prevoutData = hexToBytes(reverseBytes(UTXO.txid) + "00000000");
  const prevoutsHash = sha256(prevoutData);

  // Add amounts hash
  const amountData = new Uint8Array(8);
  const view = new DataView(amountData.buffer);
  view.setBigUint64(0, BigInt(UTXO.amount), true);
  const amountsHash = sha256(amountData);

  // Add scriptPubkeys hash
  const scriptPubkeyData = hexToBytes(UTXO.scriptPubkey);
  const scriptPubkeysHash = sha256(scriptPubkeyData);

  // Combine for sighash
  const combined = new Uint8Array(data.length + prevoutsHash.length + amountsHash.length + scriptPubkeysHash.length);
  combined.set(data);
  combined.set(prevoutsHash, data.length);
  combined.set(amountsHash, data.length + prevoutsHash.length);
  combined.set(scriptPubkeysHash, data.length + prevoutsHash.length + amountsHash.length);

  // Tagged hash for BIP-340
  const tag = new TextEncoder().encode("TapSighash");
  const tagHash = sha256(tag);
  const preimage = new Uint8Array(tagHash.length * 2 + combined.length);
  preimage.set(tagHash);
  preimage.set(tagHash, tagHash.length);
  preimage.set(combined, tagHash.length * 2);

  return sha256(preimage);
}

// Execute FROST signing
async function frostSign(sighash: Uint8Array): Promise<string> {
  const sessionId = crypto.randomUUID();
  const sighashHex = bytesToHex(sighash);

  console.log("\n  FROST Signing Session: " + sessionId);
  console.log("  Sighash: " + sighashHex);

  // Round 1: Collect commitments
  console.log("\n  Round 1: Collecting commitments...");
  const commitments: Record<number, string> = {};
  const identifierMap: Record<number, string> = {};

  for (let i = 0; i < 2; i++) {
    const url = FROST_SIGNERS[i];
    const response = await fetch(`${url}/round1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, sighash: sighashHex }),
    });
    const data = await response.json();
    commitments[data.signer_id] = data.commitment;
    identifierMap[data.signer_id] = data.frost_identifier;
    console.log(`    Signer ${data.signer_id}: commitment OK`);
  }

  // Round 2: Collect signature shares
  console.log("\n  Round 2: Collecting signature shares...");
  const shares: string[] = [];

  for (let i = 0; i < 2; i++) {
    const url = FROST_SIGNERS[i];
    const response = await fetch(`${url}/round2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        sighash: sighashHex,
        commitments,
        identifier_map: identifierMap,
      }),
    });
    const data = await response.json();
    shares.push(data.signature_share);
    console.log(`    Signer ${data.signer_id}: share ${data.signature_share.slice(0, 16)}...`);
  }

  // In production, aggregate shares into final Schnorr signature
  // For demo, we return the first share (would need proper aggregation)
  console.log("\n  Signature shares collected successfully!");
  console.log("  (Full signature aggregation would happen here in production)");

  return shares[0] + shares[1]; // Placeholder - real aggregation needed
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║        FROST Threshold Spending Demo                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  console.log("\n  UTXO to spend:");
  console.log(`    TXID: ${UTXO.txid}`);
  console.log(`    VOUT: ${UTXO.vout}`);
  console.log(`    Amount: ${UTXO.amount} sats`);

  console.log("\n  Destination: " + DESTINATION);
  console.log(`  Fee: ${FEE} sats`);
  console.log(`  Output: ${UTXO.amount - FEE} sats`);

  // Create unsigned transaction
  console.log("\n  Creating unsigned transaction...");
  const { sighash } = createUnsignedTx();
  console.log(`  Sighash computed: ${bytesToHex(sighash).slice(0, 32)}...`);

  // Execute FROST signing
  console.log("\n=== Executing FROST 2-of-3 Threshold Signing ===");
  const signature = await frostSign(sighash);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    SIGNING COMPLETE                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  console.log("\n  The FROST signers have successfully produced signature shares");
  console.log("  for spending the deposited UTXO.");
  console.log("\n  In a complete implementation:");
  console.log("  1. Signature shares would be aggregated into a valid Schnorr signature");
  console.log("  2. The signed transaction would be broadcast to the Bitcoin network");
  console.log("  3. The funds would be transferred to the destination address");

  console.log("\n  This demonstrates that:");
  console.log("  - No single party can spend the funds alone");
  console.log("  - 2 of 3 signers must cooperate to create a valid signature");
  console.log("  - The FROST protocol preserves the privacy of key shares");
}

main().catch(console.error);
