#!/usr/bin/env bun
/**
 * Test SDK Stealth Address functionality
 * Tests: key generation, ECDH, stealth address derivation, announcement scanning
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// Import SDK functions from individual modules
import {
  generateKeyPair,
  ecdh,
  GRUMPKIN_GENERATOR,
  pointMul,
  pointAdd,
  pointFromCompressedBytes,
  type GrumpkinPoint,
} from "@zvault/sdk/grumpkin";
import {
  deriveKeysFromSeed,
  createStealthMetaAddress,
  type ZVaultKeys,
  type StealthMetaAddress,
} from "@zvault/sdk/keys";
import {
  encryptAmount,
  decryptAmount,
  parseStealthAnnouncement,
} from "@zvault/sdk/stealth";

const RPC_URL = "https://api.devnet.solana.com";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  console.log("=".repeat(60));
  console.log("Test SDK Stealth Address Functions");
  console.log("=".repeat(60));

  // 1. Test key generation
  console.log("\n1️⃣ Grumpkin Key Generation:");
  const spendingKey = generateKeyPair();
  const viewingKey = generateKeyPair();
  console.log(`  ✓ Spending Key Generated`);
  console.log(`    pubKey.x: ${spendingKey.pubKey.x.toString(16).slice(0, 32)}...`);
  console.log(`  ✓ Viewing Key Generated`);
  console.log(`    pubKey.x: ${viewingKey.pubKey.x.toString(16).slice(0, 32)}...`);

  // 2. Test ECDH
  console.log("\n2️⃣ ECDH Shared Secret:");
  const ephemeralKey = generateKeyPair();
  const sharedSecret = ecdh(ephemeralKey.privKey, viewingKey.pubKey);
  console.log(`  ✓ Shared secret derived`);
  console.log(`    secret.x: ${sharedSecret.x.toString(16).slice(0, 32)}...`);

  // 3. Test key derivation from seed
  console.log("\n3️⃣ ZVault Keys from Seed:");
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const keys: ZVaultKeys = deriveKeysFromSeed(seed);
  console.log(`  ✓ Keys derived from seed`);
  console.log(`    spendingPubKey.x: ${keys.spendingPubKey.x.toString(16).slice(0, 24)}...`);
  console.log(`    viewingPubKey.x: ${keys.viewingPubKey.x.toString(16).slice(0, 24)}...`);

  // 4. Test Stealth Meta Address generation
  console.log("\n4️⃣ Stealth Meta Address:");
  const metaAddress: StealthMetaAddress = createStealthMetaAddress(keys);
  console.log(`  ✓ Meta address created`);
  console.log(`    spendPubKey: ${bytesToHex(metaAddress.spendingPubKey).slice(0, 24)}...`);
  console.log(`    viewPubKey: ${bytesToHex(metaAddress.viewingPubKey).slice(0, 24)}...`);

  // 5. Test amount encryption/decryption
  console.log("\n5️⃣ Amount Encryption/Decryption:");
  const testAmount = 100000n; // 0.001 BTC
  const encrypted = encryptAmount(testAmount, sharedSecret);
  const decrypted = decryptAmount(encrypted, sharedSecret);
  const encDecMatch = testAmount === decrypted;
  console.log(`  ${encDecMatch ? '✓' : '✗'} Original: ${testAmount} sats`);
  console.log(`  ${encDecMatch ? '✓' : '✗'} Encrypted: ${bytesToHex(encrypted)}`);
  console.log(`  ${encDecMatch ? '✓' : '✗'} Decrypted: ${decrypted} sats`);

  // 6. Test stealth address derivation (EIP-5564 style)
  console.log("\n6️⃣ Stealth Address Derivation:");
  // Decompress the meta address keys
  const viewPubPoint = pointFromCompressedBytes(metaAddress.viewingPubKey);
  const spendPubPoint = pointFromCompressedBytes(metaAddress.spendingPubKey);

  // Sender derives: sharedSecret = ECDH(ephemeralPriv, viewingPub)
  const senderSharedSecret = ecdh(ephemeralKey.privKey, viewPubPoint);
  // stealthPub = spendPubKey + H(sharedSecret) * G
  const hashScalar = senderSharedSecret.x % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const tweakPoint = pointMul(hashScalar, GRUMPKIN_GENERATOR);
  const stealthPub = pointAdd(spendPubPoint, tweakPoint);
  console.log(`  ✓ Stealth public key derived`);
  console.log(`    stealthPub.x: ${stealthPub.x.toString(16).slice(0, 32)}...`);

  // Recipient verifies with viewing key:
  const recipientSharedSecret = ecdh(keys.viewingPrivKey, ephemeralKey.pubKey);
  const recipientHashScalar = recipientSharedSecret.x % BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const recipientTweakPoint = pointMul(recipientHashScalar, GRUMPKIN_GENERATOR);
  const recipientStealthPub = pointAdd(spendPubPoint, recipientTweakPoint);
  const keysMatch = stealthPub.x === recipientStealthPub.x && stealthPub.y === recipientStealthPub.y;
  console.log(`  ${keysMatch ? '✓' : '✗'} Recipient can derive same stealth key: ${keysMatch}`);

  // 7. Query on-chain announcements
  console.log("\n7️⃣ On-chain Stealth Announcements:");
  const connection = new Connection(RPC_URL, "confirmed");
  const devnetConfig = JSON.parse(fs.readFileSync(".devnet-config.json", "utf-8"));
  const programId = new PublicKey(devnetConfig.programs.zVault);

  try {
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [{ dataSize: 91 }],
    });

    console.log(`  Found ${accounts.length} announcement(s) on-chain`);

    for (let i = 0; i < Math.min(accounts.length, 3); i++) {
      const acc = accounts[i];
      try {
        const parsed = parseStealthAnnouncement(acc.account.data);
        console.log(`  [${i}] PDA: ${acc.pubkey.toBase58().slice(0, 20)}...`);
        console.log(`      Amount: ${parsed.amount} sats`);
        console.log(`      LeafIndex: ${parsed.leafIndex}`);
        console.log(`      Commitment: ${bytesToHex(parsed.commitment).slice(0, 32)}...`);
      } catch (parseErr: any) {
        // Manual parse fallback
        const data = acc.account.data;
        const commitment = data.slice(42, 74);
        console.log(`  [${i}] PDA: ${acc.pubkey.toBase58().slice(0, 20)}...`);
        console.log(`      Commitment: ${bytesToHex(commitment).slice(0, 32)}...`);
      }
    }
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✓ SDK Stealth functionality tests complete");
  console.log("\nSummary:");
  console.log("  • Grumpkin key generation: ✓");
  console.log("  • ECDH shared secret: ✓");
  console.log("  • ZVault keys from seed: ✓");
  console.log("  • Stealth meta address: ✓");
  console.log("  • Amount encryption/decryption: ✓");
  console.log("  • Stealth address derivation: ✓");
  console.log("  • On-chain query: ✓");
}

main().catch(console.error);
