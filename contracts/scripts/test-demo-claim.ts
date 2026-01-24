/**
 * Test Demo Claim
 *
 * Tests claiming a demo commitment on devnet using demo mode (vk_hash = zeros).
 *
 * Run: SOLANA_RPC_URL=https://api.devnet.solana.com bun run scripts/test-demo-claim.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Program ID - devnet new deployment
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR"
);

// Instruction discriminator for CLAIM
const CLAIM_DISCRIMINATOR = 9;

// Seeds for PDAs
const POOL_STATE_SEED = Buffer.from("pool_state");
const COMMITMENT_TREE_SEED = Buffer.from("commitment_tree");
const NULLIFIER_SEED = Buffer.from("nullifier");

interface CouponNote {
  seed: string;
  nullifier: string;
  secret: string;
  commitment: string;
  nullifierHash: string;
  amountSats: number;
  leafIndex?: number;
}

/**
 * Convert bigint to 32-byte array (big-endian)
 */
function bigintToBytes32(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Build ClaimData for demo mode
 *
 * Layout (200 bytes total):
 * - proof_hash (32) - zeros for demo
 * - merkle_root (32) - zeros for demo (skipped in demo mode)
 * - nullifier_hash_pi (32) - public input
 * - amount_pi (32) - big-endian amount in last 8 bytes
 * - vk_hash (32) - all zeros = demo mode
 * - nullifier_hash (32) - must match nullifier_hash_pi
 * - amount (8) - little-endian u64
 */
function buildClaimData(nullifierHashBigint: bigint, amountSats: number): Uint8Array {
  const data = new Uint8Array(200);
  let offset = 0;

  // proof_hash (32 bytes) - zeros for demo
  offset += 32;

  // merkle_root (32 bytes) - zeros (skipped in demo mode)
  offset += 32;

  // nullifier_hash_pi (32 bytes) - public input
  const nullifierHashBytes = bigintToBytes32(nullifierHashBigint);
  data.set(nullifierHashBytes, offset);
  offset += 32;

  // amount_pi (32 bytes) - big-endian amount in last 8 bytes
  const amountBigEndian = new Uint8Array(32);
  const amountBE = new DataView(amountBigEndian.buffer);
  amountBE.setBigUint64(24, BigInt(amountSats), false); // big-endian
  data.set(amountBigEndian, offset);
  offset += 32;

  // vk_hash (32 bytes) - all zeros = demo mode
  offset += 32;

  // nullifier_hash (32 bytes) - must match nullifier_hash_pi
  data.set(nullifierHashBytes, offset);
  offset += 32;

  // amount (8 bytes) - little-endian u64
  const amountLE = new DataView(data.buffer, offset);
  amountLE.setBigUint64(0, BigInt(amountSats), true); // little-endian

  return data;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("         TEST DEMO CLAIM");
  console.log("=".repeat(70) + "\n");

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/johnny.json`;
  if (!fs.existsSync(walletPath)) {
    console.error("Wallet not found at:", walletPath);
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Connect to devnet
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("RPC:", rpcUrl);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  // Load coupon notes
  const notesPath = path.join(__dirname, "../coupon-notes.json");
  if (!fs.existsSync(notesPath)) {
    console.error("Coupon notes not found. Run localnet-init-and-seed.ts first.");
    process.exit(1);
  }

  const couponNotes: CouponNote[] = JSON.parse(fs.readFileSync(notesPath, "utf-8"));
  console.log(`\nLoaded ${couponNotes.length} coupon notes`);

  // Get coupon index from command line argument or default to 0
  const couponIndex = parseInt(process.argv[2] || "0", 10);
  if (couponIndex < 0 || couponIndex >= couponNotes.length) {
    console.error(`Invalid coupon index: ${couponIndex}. Must be 0-${couponNotes.length - 1}`);
    process.exit(1);
  }
  const note = couponNotes[couponIndex];
  console.log(`\nTesting claim for: ${note.seed}`);
  console.log(`  Amount: ${note.amountSats} sats (${(note.amountSats / 100_000_000).toFixed(8)} BTC)`);
  console.log(`  Nullifier Hash: ${note.nullifierHash.slice(0, 30)}...`);

  // Derive PDAs
  const [poolStatePda] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  const [commitmentTreePda] = PublicKey.findProgramAddressSync([COMMITMENT_TREE_SEED], PROGRAM_ID);

  console.log("\nProgram ID:", PROGRAM_ID.toBase58());
  console.log("Pool State PDA:", poolStatePda.toBase58());

  // Check pool state exists
  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (!poolAccount) {
    console.error("\nPool not initialized on devnet.");
    console.error("Run: SOLANA_RPC_URL=https://api.devnet.solana.com bun run scripts/localnet-init-and-seed.ts");
    process.exit(1);
  }

  // Extract sbBTC mint from pool state
  // Layout: discriminator(1) + bump(1) + flags(1) + padding(1) + authority(32) + sbbtc_mint(32)
  const mintOffset = 4 + 32; // after discriminator+bump+flags+padding+authority
  const sbbtcMintBytes = poolAccount.data.slice(mintOffset, mintOffset + 32);
  const sbbtcMint = new PublicKey(sbbtcMintBytes);
  console.log("sbBTC Mint:", sbbtcMint.toBase58());

  // Derive nullifier PDA
  const nullifierHashBytes = bigintToBytes32(BigInt(note.nullifierHash));
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [NULLIFIER_SEED, nullifierHashBytes],
    PROGRAM_ID
  );
  console.log("Nullifier PDA:", nullifierPda.toBase58());

  // Check if nullifier already used
  const nullifierAccount = await connection.getAccountInfo(nullifierPda);
  if (nullifierAccount) {
    console.log("\n⚠️  This coupon has already been claimed!");
    console.log("   Try a different coupon by changing couponIndex in the script.");
    process.exit(1);
  }

  // Get or create user's token account
  console.log("\nSetting up token account...");
  let userTokenAccount: PublicKey;

  try {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      sbbtcMint,
      wallet.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    userTokenAccount = ata.address;
    console.log("User Token Account:", userTokenAccount.toBase58());
  } catch (err: any) {
    console.log("Creating ATA manually...");
    userTokenAccount = getAssociatedTokenAddressSync(
      sbbtcMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("User Token Account (ATA):", userTokenAccount.toBase58());
  }

  // Build claim instruction
  console.log("\n" + "-".repeat(70));
  console.log("Building CLAIM instruction (demo mode)...");
  console.log("-".repeat(70));

  const claimData = buildClaimData(BigInt(note.nullifierHash), note.amountSats);

  // Full instruction data: discriminator (1 byte) + claimData (200 bytes)
  const instructionData = new Uint8Array(1 + claimData.length);
  instructionData[0] = CLAIM_DISCRIMINATOR;
  instructionData.set(claimData, 1);

  console.log("Instruction data length:", instructionData.length, "bytes");

  const claimIx = new TransactionInstruction({
    keys: [
      { pubkey: poolStatePda, isSigner: false, isWritable: true },
      { pubkey: commitmentTreePda, isSigner: false, isWritable: true },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
      { pubkey: sbbtcMint, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: Buffer.from(instructionData),
  });

  // Send transaction
  console.log("\nSending claim transaction...");

  try {
    const tx = new Transaction().add(claimIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });

    console.log("\n" + "=".repeat(70));
    console.log("         CLAIM SUCCESSFUL!");
    console.log("=".repeat(70));
    console.log(`\nCoupon: ${note.seed}`);
    console.log(`Amount: ${note.amountSats} sats (${(note.amountSats / 100_000_000).toFixed(8)} BTC)`);
    console.log(`Transaction: ${sig}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Check token balance
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const tokenBalance = await connection.getTokenAccountBalance(userTokenAccount);
    console.log(`\nToken Balance: ${tokenBalance.value.uiAmountString} sbBTC`);
  } catch (err: any) {
    console.error("\n" + "=".repeat(70));
    console.error("         CLAIM FAILED");
    console.error("=".repeat(70));
    console.error("\nError:", err.message);

    if (err.logs) {
      console.error("\nProgram logs:");
      for (const log of err.logs) {
        console.error("  ", log);
      }
    }

    // Parse specific error codes
    if (err.message.includes("NullifierAlreadyUsed")) {
      console.log("\n→ This coupon has already been claimed. Try a different one.");
    } else if (err.message.includes("AmountTooSmall")) {
      console.log("\n→ Amount is below minimum deposit threshold.");
    } else if (err.message.includes("InvalidRoot")) {
      console.log("\n→ Merkle root validation failed (should be skipped in demo mode).");
    } else if (err.message.includes("ZkVerificationFailed")) {
      console.log("\n→ ZK verification failed - check nullifier_hash and amount match.");
    }
  }

  console.log("\n" + "=".repeat(70) + "\n");
}

main().catch(console.error);
