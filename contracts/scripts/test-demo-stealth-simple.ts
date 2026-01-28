#!/usr/bin/env bun
/**
 * Test Demo Stealth Deposit (simplified - random commitment)
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ZVAULT_PROGRAM_ID,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
} from "@zvault/sdk";
import * as fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";

function loadKeypair(keyPath: string): Keypair {
  const absolutePath = keyPath.replace("~", process.env.HOME || "");
  const secretKey = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function main() {
  console.log("=".repeat(60));
  console.log("Test Demo Stealth Deposit");
  console.log("=".repeat(60));

  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair("~/.config/solana/johnny.json");

  console.log(`\nAuthority: ${authority.publicKey.toBase58()}`);
  console.log(`Program: ${ZVAULT_PROGRAM_ID}`);

  // Derive PDAs
  const [poolStatePDA] = await derivePoolStatePDA();
  const [commitmentTreePDA] = await deriveCommitmentTreePDA();

  console.log(`Pool State: ${poolStatePDA}`);
  console.log(`Commitment Tree: ${commitmentTreePDA}`);

  // Generate random ephemeral key (33 bytes compressed)
  const ephemeralPub = new Uint8Array(33);
  ephemeralPub[0] = 0x02; // compressed prefix
  crypto.getRandomValues(ephemeralPub.subarray(1));

  // Random commitment for testing (in practice would be Poseidon hash)
  const commitment = new Uint8Array(32);
  crypto.getRandomValues(commitment);
  console.log(`\nCommitment: ${Buffer.from(commitment).toString("hex").slice(0, 32)}...`);

  // Encrypted amount (random for testing - contract uses fixed amount anyway)
  const encryptedAmount = new Uint8Array(8);
  crypto.getRandomValues(encryptedAmount);

  // Derive stealth announcement PDA
  const [stealthAnnouncementPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("stealth"), ephemeralPub.slice(1, 33)],
    new PublicKey(ZVAULT_PROGRAM_ID as string)
  );
  console.log(`Stealth Announcement PDA: ${stealthAnnouncementPDA.toBase58()}`);

  // Get zBTC mint and pool vault
  const zbtcMint = new PublicKey("BdUFQhqKpzYVHVg8cQoh7JdpSoHFtwKM4A48AFAjKFAK");
  const poolVault = getAssociatedTokenAddressSync(
    zbtcMint,
    new PublicKey(poolStatePDA as string),
    true,
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`Pool Vault: ${poolVault.toBase58()}`);

  // Build instruction data for ADD_DEMO_STEALTH (discriminator 22)
  const instructionData = Buffer.alloc(74);
  instructionData[0] = 22; // Discriminator
  Buffer.from(ephemeralPub).copy(instructionData, 1);
  Buffer.from(commitment).copy(instructionData, 34);
  Buffer.from(encryptedAmount).copy(instructionData, 66);

  console.log("\n=== Building Transaction ===");

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(poolStatePDA as string), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(commitmentTreePDA as string), isSigner: false, isWritable: true },
      { pubkey: stealthAnnouncementPDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: new PublicKey(ZVAULT_PROGRAM_ID as string),
    data: instructionData,
  });

  const tx = new Transaction().add(ix);

  console.log("Sending transaction...");

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
      commitment: "confirmed",
    });
    console.log(`\n✓ Demo Stealth Deposit successful!`);
    console.log(`Signature: ${sig}`);
    console.log(`\nView on Solscan: https://solscan.io/tx/${sig}?cluster=devnet`);

    // Verify the announcement was created
    const annInfo = await connection.getAccountInfo(stealthAnnouncementPDA);
    if (annInfo) {
      console.log(`\n✓ Stealth Announcement created (${annInfo.data.length} bytes)`);
      console.log(`  Discriminator: 0x${annInfo.data[0].toString(16).padStart(2, '0')}`);
    }

    // Check vault balance
    const vaultInfo = await connection.getAccountInfo(poolVault);
    if (vaultInfo && vaultInfo.data.length >= 72) {
      const view = new DataView(vaultInfo.data.buffer, vaultInfo.data.byteOffset, vaultInfo.data.byteLength);
      const balance = view.getBigUint64(64, true);
      console.log(`  Pool Vault Balance: ${balance} sats (${Number(balance) / 100_000_000} BTC)`);
    }

  } catch (err: any) {
    console.error(`\n✗ Transaction failed:`, err.message);
    if (err.logs) {
      console.error("Logs:", err.logs.slice(-10));
    }
  }
}

main().catch(console.error);
