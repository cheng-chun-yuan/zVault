/**
 * Test stealth deposit to a specific stealth meta-address
 */

import {
  createStealthDeposit,
  buildAddDemoStealthData,
  decodeStealthMetaAddress,
  DEVNET_CONFIG,
} from "../dist/index.js";

// Helper functions
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Target stealth meta-address (66 bytes = 33 + 33)
const STEALTH_META_ADDRESS = "031ab0e25f17a53440917dd8569f919e779217f3662529bb83c991f3e7a6c37584031d8801645a108e20c5988b8d1fc6d997858750afc69e4c2413353345c5afb301";

async function main() {
  console.log("=== Testing Stealth Deposit ===\n");

  // Parse stealth meta-address using SDK function
  const recipientMeta = decodeStealthMetaAddress(STEALTH_META_ADDRESS);

  console.log("Recipient Spending PubKey:", bytesToHex(recipientMeta.spendingPubKey));
  console.log("Recipient Viewing PubKey:", bytesToHex(recipientMeta.viewingPubKey));
  console.log("");

  // Create stealth deposit (10,000 sats = 0.0001 BTC)
  const amount = 10000n;
  console.log("Creating stealth deposit for", amount.toString(), "sats...\n");

  const deposit = await createStealthDeposit(recipientMeta, amount);

  console.log("=== Stealth Deposit Created ===");
  console.log("Ephemeral PubKey:", bytesToHex(deposit.ephemeralPubKey));
  console.log("Commitment:", bytesToHex(deposit.commitment));
  console.log("Encrypted Amount:", bytesToHex(deposit.encryptedAmount));
  console.log("Stealth PubKey X:", deposit.stealthPubKeyX.toString(16));
  console.log("");

  // Build the instruction data
  const instructionData = buildAddDemoStealthData(
    deposit.ephemeralPubKey,
    deposit.commitment,
    deposit.encryptedAmount
  );

  console.log("=== Instruction Data ===");
  console.log("Total size:", instructionData.length, "bytes");
  console.log("Hex:", bytesToHex(instructionData));
  console.log("");

  // Output for API call
  console.log("=== For Demo API Call ===");
  console.log(JSON.stringify({
    type: "stealth",
    ephemeralPub: bytesToHex(deposit.ephemeralPubKey),
    commitment: bytesToHex(deposit.commitment),
    encryptedAmount: bytesToHex(deposit.encryptedAmount),
    amount: Number(amount),
  }, null, 2));
  console.log("");

  console.log("=== Config ===");
  console.log("Program ID:", DEVNET_CONFIG.zvaultProgramId);
}

main().catch(console.error);
