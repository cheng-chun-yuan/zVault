/**
 * Test Sunspot Groth16 proof verification on Solana
 *
 * Run: bun run test/sunspot-verify.ts
 */

import { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const SUNSPOT_VERIFIER_PROGRAM_ID = "3Sd1FJPA64zrUrbNQPFcsP7BXp2nu4ow3D1qaeZiwS1Y";

async function main() {
  console.log("=== Sunspot Groth16 On-Chain Verification Test ===\n");

  // Connect to localnet
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");

  // Load payer
  const payerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      process.env.HOME + "/.config/solana/id.json",
      "utf-8"
    )))
  );
  console.log(`Payer: ${payerKeypair.publicKey.toBase58()}`);

  // Load proof and public witness
  const proofPath = "../circuits/target/zvault_claim.proof";
  const pwPath = "../circuits/target/zvault_claim.pw";

  const proofBytes = fs.readFileSync(proofPath);
  const pwBytes = fs.readFileSync(pwPath);

  console.log(`Proof size: ${proofBytes.length} bytes`);
  console.log(`Public witness size: ${pwBytes.length} bytes`);

  // Sunspot verifier expects: proof_bytes || public_witness_bytes
  const instructionData = Buffer.concat([proofBytes, pwBytes]);
  console.log(`Total instruction data: ${instructionData.length} bytes`);

  // Create verify instruction
  const verifyIx = new TransactionInstruction({
    programId: new PublicKey(SUNSPOT_VERIFIER_PROGRAM_ID),
    keys: [], // Sunspot verifier doesn't need accounts
    data: instructionData,
  });

  // Build and send transaction with compute budget
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_000_000, // Groth16 verification may need more
  });
  const tx = new Transaction().add(computeBudgetIx).add(verifyIx);
  tx.feePayer = payerKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  console.log("\nSubmitting verification transaction...");

  try {
    // Simulate first
    const simResult = await connection.simulateTransaction(tx);
    if (simResult.value.err) {
      console.log(`Simulation error: ${JSON.stringify(simResult.value.err)}`);
      if (simResult.value.logs) {
        console.log("Logs:");
        simResult.value.logs.forEach(log => console.log(`  ${log}`));
      }
      console.log(`Compute units used: ${simResult.value.unitsConsumed}`);
      throw new Error("Simulation failed");
    }

    console.log(`✅ Simulation passed!`);
    console.log(`Compute units used: ${simResult.value.unitsConsumed}`);

    // Send transaction
    tx.sign(payerKeypair);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log(`✅ Transaction confirmed: ${sig}`);
  } catch (e: any) {
    console.log(`❌ Verification failed: ${e.message}`);
  }
}

main().catch(console.error);
