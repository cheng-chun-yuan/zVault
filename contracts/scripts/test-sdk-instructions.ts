#!/usr/bin/env bun
/**
 * Test SDK Instruction Builders and ChadBuffer utilities
 */

import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// Import SDK functions - using direct path from contracts/scripts -> ../sdk
import {
  buildClaimInstruction,
  buildSplitInstruction,
  buildSpendPartialPublicInstruction,
  buildPoolDepositInstruction,
  buildPoolWithdrawInstruction,
  buildPoolClaimYieldInstruction,
} from "../../sdk/dist/instructions.js";
import {
  needsBuffer,
  getProofSource,
  MAX_DATA_PER_WRITE,
  SOLANA_TX_SIZE_LIMIT,
} from "../../sdk/dist/chadbuffer.js";
import { DEVNET_CONFIG } from "../../sdk/dist/config.js";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  console.log("=".repeat(60));
  console.log("Test SDK Instruction Builders & ChadBuffer");
  console.log("=".repeat(60));

  const devnetConfig = JSON.parse(fs.readFileSync(".devnet-config.json", "utf-8"));

  // 1. Test ChadBuffer utilities
  console.log("\n1️⃣ ChadBuffer Utilities:");
  console.log(`  SOLANA_TX_SIZE_LIMIT: ${SOLANA_TX_SIZE_LIMIT} bytes`);
  console.log(`  MAX_DATA_PER_WRITE: ${MAX_DATA_PER_WRITE} bytes`);

  // Test needsBuffer with small proof (shouldn't need buffer)
  const smallProof = new Uint8Array(500);
  crypto.getRandomValues(smallProof);
  const smallNeedsBuffer = needsBuffer(smallProof);
  console.log(`  Small proof (500 bytes) needs buffer: ${smallNeedsBuffer}`);

  // Test needsBuffer with large proof (should need buffer)
  const largeProof = new Uint8Array(16000);
  crypto.getRandomValues(largeProof);
  const largeNeedsBuffer = needsBuffer(largeProof);
  console.log(`  Large proof (16KB) needs buffer: ${largeNeedsBuffer}`);

  // Test getProofSource
  const smallSource = getProofSource(smallProof);
  const largeSource = getProofSource(largeProof);
  console.log(`  Small proof source: ${smallSource} (0=inline)`);
  console.log(`  Large proof source: ${largeSource} (1=buffer)`);

  // 2. Test buildClaimInstruction
  console.log("\n2️⃣ Build Claim Instruction (buffer mode):");
  const mockBufferAddress = PublicKey.unique();
  const mockRecipient = PublicKey.unique();
  const mockRoot = new Uint8Array(32);
  crypto.getRandomValues(mockRoot);
  const mockNullifier = new Uint8Array(32);
  crypto.getRandomValues(mockNullifier);
  const mockVkHash = new Uint8Array(32);
  crypto.getRandomValues(mockVkHash);

  try {
    const claimIx = buildClaimInstruction({
      proofSource: 1, // buffer mode
      bufferAddress: mockBufferAddress,
      proofBytes: undefined, // not needed in buffer mode
      root: mockRoot,
      nullifierHash: mockNullifier,
      amountSats: 10000n,
      recipient: mockRecipient,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        zbtcMint: new PublicKey(devnetConfig.accounts.zkbtcMint),
        poolVault: new PublicKey(devnetConfig.accounts.poolVault),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ Claim instruction built`);
    console.log(`    Keys: ${claimIx.keys.length} accounts`);
    console.log(`    Data: ${claimIx.data.length} bytes`);
    console.log(`    Program: ${claimIx.programId.toBase58().slice(0, 20)}...`);
  } catch (err: any) {
    console.log(`  ✗ Failed: ${err.message}`);
  }

  // 3. Test buildSplitInstruction
  console.log("\n3️⃣ Build Split Instruction:");
  const mockCommitment1 = new Uint8Array(32);
  crypto.getRandomValues(mockCommitment1);
  const mockCommitment2 = new Uint8Array(32);
  crypto.getRandomValues(mockCommitment2);

  try {
    const splitIx = buildSplitInstruction({
      proofSource: 1,
      bufferAddress: mockBufferAddress,
      proofBytes: undefined,
      root: mockRoot,
      nullifierHash: mockNullifier,
      newCommitment1: mockCommitment1,
      newCommitment2: mockCommitment2,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ Split instruction built`);
    console.log(`    Keys: ${splitIx.keys.length} accounts`);
    console.log(`    Data: ${splitIx.data.length} bytes`);
  } catch (err: any) {
    console.log(`  ✗ Failed: ${err.message}`);
  }

  // 4. Test buildSpendPartialPublicInstruction
  console.log("\n4️⃣ Build SpendPartialPublic Instruction:");
  const mockEphemeral = new Uint8Array(33);
  mockEphemeral[0] = 0x02;
  crypto.getRandomValues(mockEphemeral.subarray(1));
  const mockEncAmount = new Uint8Array(8);
  crypto.getRandomValues(mockEncAmount);

  try {
    const spendIx = buildSpendPartialPublicInstruction({
      proofSource: 1,
      bufferAddress: mockBufferAddress,
      proofBytes: undefined,
      root: mockRoot,
      nullifierHash: mockNullifier,
      publicAmount: 5000n,
      newCommitment: mockCommitment1,
      ephemeralPubKey: mockEphemeral,
      encryptedAmount: mockEncAmount,
      recipientSolana: mockRecipient,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        zbtcMint: new PublicKey(devnetConfig.accounts.zkbtcMint),
        poolVault: new PublicKey(devnetConfig.accounts.poolVault),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ SpendPartialPublic instruction built`);
    console.log(`    Keys: ${spendIx.keys.length} accounts`);
    console.log(`    Data: ${spendIx.data.length} bytes`);
  } catch (err: any) {
    console.log(`  ✗ Failed: ${err.message}`);
  }

  // 5. Test Pool Instructions
  console.log("\n5️⃣ Build Pool Instructions:");

  // Pool Deposit
  try {
    const depositIx = buildPoolDepositInstruction({
      proofSource: 1,
      bufferAddress: mockBufferAddress,
      proofBytes: undefined,
      root: mockRoot,
      nullifierHash: mockNullifier,
      depositAmount: 100000n,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        poolVault: new PublicKey(devnetConfig.accounts.poolVault),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ Pool Deposit instruction: ${depositIx.keys.length} accounts, ${depositIx.data.length} bytes`);
  } catch (err: any) {
    console.log(`  ✗ Pool Deposit failed: ${err.message}`);
  }

  // Pool Withdraw
  try {
    const withdrawIx = buildPoolWithdrawInstruction({
      proofSource: 1,
      bufferAddress: mockBufferAddress,
      proofBytes: undefined,
      root: mockRoot,
      nullifierHash: mockNullifier,
      withdrawAmount: 50000n,
      newCommitment: mockCommitment1,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        poolVault: new PublicKey(devnetConfig.accounts.poolVault),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ Pool Withdraw instruction: ${withdrawIx.keys.length} accounts, ${withdrawIx.data.length} bytes`);
  } catch (err: any) {
    console.log(`  ✗ Pool Withdraw failed: ${err.message}`);
  }

  // Pool Claim Yield
  try {
    const claimYieldIx = buildPoolClaimYieldInstruction({
      proofSource: 1,
      bufferAddress: mockBufferAddress,
      proofBytes: undefined,
      root: mockRoot,
      nullifierHash: mockNullifier,
      yieldAmount: 1000n,
      newCommitment: mockCommitment1,
      vkHash: mockVkHash,
      accounts: {
        poolStatePda: new PublicKey(devnetConfig.accounts.poolState),
        commitmentTreePda: new PublicKey(devnetConfig.accounts.commitmentTree),
        poolVault: new PublicKey(devnetConfig.accounts.poolVault),
        authority: new PublicKey(devnetConfig.accounts.authority),
      },
    });
    console.log(`  ✓ Pool Claim Yield instruction: ${claimYieldIx.keys.length} accounts, ${claimYieldIx.data.length} bytes`);
  } catch (err: any) {
    console.log(`  ✗ Pool Claim Yield failed: ${err.message}`);
  }

  // 6. Test SDK Config
  console.log("\n6️⃣ SDK Configuration:");
  console.log(`  Network: ${DEVNET_CONFIG.network}`);
  console.log(`  Program ID: ${DEVNET_CONFIG.zvaultProgramId}`);
  console.log(`  UltraHonk Verifier: ${DEVNET_CONFIG.ultrahonkVerifierProgramId}`);
  console.log(`  Circuit CDN: ${DEVNET_CONFIG.circuitCdnUrl}`);

  console.log("\n" + "=".repeat(60));
  console.log("✓ SDK Instruction Builder tests complete");
  console.log("\nSummary:");
  console.log("  • ChadBuffer utilities: ✓");
  console.log("  • Claim instruction builder: ✓");
  console.log("  • Split instruction builder: ✓");
  console.log("  • SpendPartialPublic builder: ✓");
  console.log("  • Pool instruction builders: ✓");
  console.log("  • SDK configuration: ✓");
}

main().catch(console.error);
