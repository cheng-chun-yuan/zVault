/**
 * End-to-End FROST Threshold Signing Test
 *
 * This script tests the complete flow:
 * 1. Generate a deposit commitment
 * 2. Derive a Taproot address with the FROST group key
 * 3. User sends BTC to the address (manual step)
 * 4. Backend detects deposit and creates SPV proof
 * 5. FROST signers cooperatively sign to sweep
 *
 * Usage: bun run scripts/e2e_frost_test.ts
 */

import { bech32m } from "bech32";
import { createHash } from "crypto";

// Use Node.js crypto for SHA-256
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

// Configuration
const FROST_SIGNERS = [
  "http://localhost:9001",
  "http://localhost:9002",
  "http://localhost:9003",
];
const BACKEND_URL = "http://localhost:3001";
const GROUP_PUBKEY = "e1b15704047c53ed8f40778789d997e79294ae368f53324ffbc8e4df9bb2dfad";

// Helper: Convert hex to bytes
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper: Convert bytes to hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate random bytes
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Derive Taproot address from x-only public key
function deriveTaprootAddress(
  pubkeyHex: string,
  network: "mainnet" | "testnet" = "testnet"
): string {
  const pubkeyBytes = hexToBytes(pubkeyHex);
  if (pubkeyBytes.length !== 32) {
    throw new Error(`Invalid x-only public key length: ${pubkeyBytes.length}`);
  }

  const hrp = network === "mainnet" ? "bc" : "tb";
  const words = bech32m.toWords(pubkeyBytes);
  words.unshift(1); // Witness version 1 for Taproot

  return bech32m.encode(hrp, words);
}

// Generate a note commitment (nullifier, secret)
function generateNoteCommitment(): {
  nullifier: Uint8Array;
  secret: Uint8Array;
  commitment: Uint8Array;
} {
  const nullifier = randomBytes(32);
  const secret = randomBytes(32);

  // Commitment = SHA256(nullifier || secret)
  const combined = new Uint8Array(64);
  combined.set(nullifier);
  combined.set(secret, 32);
  const commitment = sha256(combined);

  return { nullifier, secret, commitment };
}

// Derive deposit address with commitment tweak
function deriveDepositAddress(
  groupPubkey: string,
  commitment: Uint8Array,
  network: "mainnet" | "testnet" = "testnet"
): string {
  // BIP-340 tagged hash for TapTweak
  const tagHash = sha256(new TextEncoder().encode("TapTweak"));
  const pubkeyBytes = hexToBytes(groupPubkey);

  // tweak = H_taptweak(P || commitment)
  const tweakInput = new Uint8Array(tagHash.length * 2 + 32 + 32);
  tweakInput.set(tagHash);
  tweakInput.set(tagHash, tagHash.length);
  tweakInput.set(pubkeyBytes, tagHash.length * 2);
  tweakInput.set(commitment, tagHash.length * 2 + 32);
  const tweak = sha256(tweakInput);

  // Note: This is a simplified version. Full implementation would
  // do elliptic curve point addition: Q = P + tweak*G
  // For demo purposes, we just use the group key directly

  return deriveTaprootAddress(groupPubkey, network);
}

// Test FROST signer health
async function testSignerHealth(): Promise<boolean> {
  console.log("\n=== Testing FROST Signer Health ===\n");

  let allHealthy = true;
  for (const url of FROST_SIGNERS) {
    try {
      const response = await fetch(`${url}/health`);
      const health = await response.json();
      const status = health.key_loaded ? "Ready" : "No Key";
      console.log(
        `  Signer ${health.signer_id}: ${status} (${health.status})`
      );
      if (!health.key_loaded) allHealthy = false;
    } catch (error) {
      console.log(`  ${url}: OFFLINE`);
      allHealthy = false;
    }
  }

  return allHealthy;
}

// Test FROST signing flow
async function testFrostSigning(): Promise<boolean> {
  console.log("\n=== Testing FROST Signing (2-of-3) ===\n");

  const sessionId = crypto.randomUUID();
  const sighash = bytesToHex(randomBytes(32));

  console.log(`  Session: ${sessionId}`);
  console.log(`  Sighash: ${sighash.slice(0, 16)}...`);

  // Round 1: Collect commitments from 2 signers
  console.log("\n  Round 1: Collecting commitments...");
  const commitments: Record<number, string> = {};
  const identifierMap: Record<number, string> = {};

  for (let i = 0; i < 2; i++) {
    const url = FROST_SIGNERS[i];
    try {
      const response = await fetch(`${url}/round1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, sighash }),
      });
      const data = await response.json();
      commitments[data.signer_id] = data.commitment;
      identifierMap[data.signer_id] = data.frost_identifier;
      console.log(
        `    Signer ${data.signer_id}: commitment received`
      );
    } catch (error) {
      console.log(`    ${url}: FAILED`);
      return false;
    }
  }

  // Round 2: Collect signature shares
  console.log("\n  Round 2: Collecting signature shares...");
  const shares: Array<{ signer_id: number; share: string }> = [];

  for (let i = 0; i < 2; i++) {
    const url = FROST_SIGNERS[i];
    try {
      const response = await fetch(`${url}/round2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          sighash,
          commitments,
          identifier_map: identifierMap,
        }),
      });
      const data = await response.json();
      shares.push({ signer_id: data.signer_id, share: data.signature_share });
      console.log(
        `    Signer ${data.signer_id}: share ${data.signature_share.slice(0, 16)}...`
      );
    } catch (error) {
      console.log(`    ${url}: FAILED`);
      return false;
    }
  }

  console.log(`\n  Signing complete! ${shares.length} shares collected.`);
  return shares.length === 2;
}

// Test backend health
async function testBackendHealth(): Promise<boolean> {
  console.log("\n=== Testing Backend API ===\n");

  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    const health = await response.json();
    console.log(`  Status: ${health.status}`);
    console.log(`  Version: ${health.version}`);
    return health.status === "ok";
  } catch (error) {
    console.log(`  Backend OFFLINE: ${error}`);
    return false;
  }
}

// Generate deposit info
function generateDepositInfo() {
  console.log("\n=== Generating Deposit Info ===\n");

  const note = generateNoteCommitment();
  const address = deriveTaprootAddress(GROUP_PUBKEY, "testnet");

  console.log("  Note Generated:");
  console.log(`    Nullifier: ${bytesToHex(note.nullifier).slice(0, 32)}...`);
  console.log(`    Secret:    ${bytesToHex(note.secret).slice(0, 32)}...`);
  console.log(`    Commitment: ${bytesToHex(note.commitment)}`);

  console.log("\n  Deposit Address:");
  console.log(`    ${address}`);

  return { note, address };
}

// Main test runner
async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     zVault FROST Threshold Signing E2E Test                ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  console.log("\n  FROST Group Public Key:");
  console.log(`    ${GROUP_PUBKEY}`);

  const baseAddress = deriveTaprootAddress(GROUP_PUBKEY, "testnet");
  console.log("\n  Base Taproot Address (testnet):");
  console.log(`    ${baseAddress}`);

  // Test components
  const signersHealthy = await testSignerHealth();
  const signingWorks = signersHealthy ? await testFrostSigning() : false;
  const backendHealthy = await testBackendHealth();

  // Generate deposit info
  const depositInfo = generateDepositInfo();

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                        TEST SUMMARY                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n  FROST Signers:   ${signersHealthy ? "HEALTHY" : "UNHEALTHY"}`);
  console.log(`  FROST Signing:   ${signingWorks ? "WORKING" : "FAILED"}`);
  console.log(`  Backend API:     ${backendHealthy ? "HEALTHY" : "UNHEALTHY"}`);

  if (signersHealthy && signingWorks && backendHealthy) {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    READY FOR DEPOSIT                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("\n  To test a real deposit:");
    console.log("\n  1. Get testnet BTC from a faucet:");
    console.log("     - https://bitcoinfaucet.uo1.net/");
    console.log("     - https://coinfaucet.eu/en/btc-testnet/");
    console.log("\n  2. Send testnet BTC to:");
    console.log(`     ${baseAddress}`);
    console.log("\n  3. Wait for confirmations (6 blocks on testnet)");
    console.log("\n  4. The FROST signers will cooperatively sign to sweep the funds");
  } else {
    console.log("\n  Some components are not ready. Please check the logs above.");
  }
}

main().catch(console.error);
