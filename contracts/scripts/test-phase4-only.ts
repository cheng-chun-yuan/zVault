#!/usr/bin/env bun
/**
 * Test Phase 4 (MSM + Pairing) directly
 * Assumes phases 1-3 already passed and state PDA exists
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = "http://127.0.0.1:8899";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("Phase 4 MSM Test (Direct)");
  console.log("=".repeat(60));

  const conn = new Connection(RPC_URL, "confirmed");

  // Load authority
  const authorityPath = path.join(process.env.HOME!, ".config/solana/id.json");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityPath, "utf-8")))
  );

  console.log("\nAuthority:", authority.publicKey.toBase58());
  console.log("Balance:", (await conn.getBalance(authority.publicKey)) / 1e9, "SOL");

  // Get verifier program ID
  const configPath = path.join(__dirname, "../config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const verifierProgramId = new PublicKey(config.programs.ultrahonkVerifier);

  console.log("Verifier:", verifierProgramId.toBase58());

  // Check if there are any existing verification state accounts
  console.log("\nSearching for verification state PDAs...");
  const accounts = await conn.getProgramAccounts(verifierProgramId, {
    filters: [
      { dataSize: 3000 }, // Approximate size of VerificationState
    ],
  });

  console.log(`Found ${accounts.length} potential verification state accounts`);

  if (accounts.length === 0) {
    console.log("\n⚠️  No verification state PDAs found.");
    console.log("Run test-cu-2phase.ts first to create state through phases 1-3");
    return;
  }

  // Use the first one
  const stateAccount = accounts[0].pubkey;
  console.log("Using state PDA:", stateAccount.toBase58());

  // Read state to check phase
  const stateInfo = await conn.getAccountInfo(stateAccount);
  if (!stateInfo) {
    console.log("State account not found!");
    return;
  }

  const phase = stateInfo.data[0]; // First byte is phase
  console.log(`Current phase: ${phase} (${["uninit", "phase1", "phase2", "phase3", "verified"][phase] || "unknown"})`);

  if (phase !== 3) {
    console.log(`\n⚠️  State is not at phase 3 (current: ${phase})`);
    console.log("Phases 1-3 must complete before testing Phase 4");
    return;
  }

  // Get proof buffer and VK account from state
  // State structure: [phase(1), proof_buffer_key(32), vk_hash(32), ...]
  const proofBufferKey = new PublicKey(stateInfo.data.slice(1, 33));
  const vkHash = stateInfo.data.slice(33, 65);

  console.log("Proof buffer:", proofBufferKey.toBase58());
  console.log("VK hash:", Buffer.from(vkHash).toString("hex").slice(0, 32) + "...");

  // Find VK account (we need to search or derive it)
  // For now, let's use the one we know was created
  const vkAccount = new PublicKey("AwybiZNDin4Rp28C9K5mVEjhJJdMW5MU8NxTfDFqcNPu");
  console.log("VK account:", vkAccount.toBase58());

  console.log("\n" + "=".repeat(60));
  console.log("Testing Phase 4 (MSM + Pairing)");
  console.log("=".repeat(60));

  // Build Phase 4 instruction
  const VERIFY_PHASE4 = 9;
  const ix_data = Buffer.alloc(1 + 32);
  ix_data[0] = VERIFY_PHASE4;
  ix_data.set(vkHash, 1);

  const ix = {
    programId: verifierProgramId,
    keys: [
      { pubkey: proofBufferKey, isSigner: false, isWritable: false },
      { pubkey: vkAccount, isSigner: false, isWritable: false },
      { pubkey: stateAccount, isSigner: false, isWritable: true },
    ],
    data: ix_data,
  };

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  tx.add(ix as any);

  console.log("\nSimulating Phase 4...");
  try {
    const sim = await conn.simulateTransaction(tx, [authority]);

    if (sim.value.err) {
      console.log("❌ Phase 4 failed:", JSON.stringify(sim.value.err));
      console.log("\nLogs:");
      sim.value.logs?.forEach(log => console.log("  ", log));
    } else {
      console.log("✅ Phase 4 passed!");
      console.log(`CU used: ${sim.value.unitsConsumed?.toLocaleString()}`);
      console.log("\nLogs:");
      sim.value.logs?.forEach(log => console.log("  ", log));

      // Submit the transaction
      console.log("\nSubmitting Phase 4 transaction...");
      const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
        commitment: "confirmed",
        skipPreflight: false,
      });
      console.log("✓ Confirmed:", sig);
    }
  } catch (e: any) {
    console.log("❌ Error:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

main().catch(console.error);
