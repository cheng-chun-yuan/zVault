/**
 * Localnet Initialization and Demo Commitment Seeder
 *
 * This script:
 * 1. Creates sbBTC Token-2022 mint
 * 2. Initializes the pool with current wallet as authority
 * 3. Adds 10 demo commitments (free-coupon-01 to free-coupon-10)
 *
 * Run: SOLANA_RPC_URL=http://127.0.0.1:8899 bun run scripts/localnet-init-and-seed.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
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
  createMint,
  getOrCreateAssociatedTokenAccount,
  createAccount,
} from "@solana/spl-token";
import { buildPoseidon } from "circomlibjs";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

// Program ID - use environment variable or default to devnet-new
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || "CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR"
);

// Seeds for PDAs
const POOL_STATE_SEED = Buffer.from("pool_state");
const COMMITMENT_TREE_SEED = Buffer.from("commitment_tree");

// Field modulus for BN254
const BN254_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// Demo coupon seeds and amounts
const COUPONS = [
  { seed: "free-coupon-01", amountSats: 100_000 },
  { seed: "free-coupon-02", amountSats: 50_000 },
  { seed: "free-coupon-03", amountSats: 200_000 },
  { seed: "free-coupon-04", amountSats: 75_000 },
  { seed: "free-coupon-05", amountSats: 150_000 },
  { seed: "free-coupon-06", amountSats: 25_000 },
  { seed: "free-coupon-07", amountSats: 500_000 },
  { seed: "free-coupon-08", amountSats: 80_000 },
  { seed: "free-coupon-09", amountSats: 120_000 },
  { seed: "free-coupon-10", amountSats: 300_000 },
];

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
 * Derive nullifier and secret from seed
 */
function deriveFromSeed(seed: string, index: number = 0): { nullifier: bigint; secret: bigint } {
  const master = createHash("sha256").update(seed).digest();

  const nullifierInput = Buffer.alloc(37);
  master.copy(nullifierInput, 0);
  nullifierInput.writeUInt32LE(index, 32);
  nullifierInput[36] = 0;
  const nullifierHash = createHash("sha256").update(nullifierInput).digest();
  const nullifier = BigInt("0x" + nullifierHash.toString("hex")) % BN254_FIELD;

  const secretInput = Buffer.alloc(37);
  master.copy(secretInput, 0);
  secretInput.writeUInt32LE(index, 32);
  secretInput[36] = 1;
  const secretHash = createHash("sha256").update(secretInput).digest();
  const secret = BigInt("0x" + secretHash.toString("hex")) % BN254_FIELD;

  return { nullifier, secret };
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

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("    LOCALNET INIT AND SEED DEMO COMMITMENTS");
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

  // Connect to localnet
  const rpcUrl = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("RPC:", rpcUrl);

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.5 * 1e9) {
    console.log("Requesting airdrop...");
    try {
      const sig = await connection.requestAirdrop(wallet.publicKey, 2 * 1e9);
      await connection.confirmTransaction(sig);
      console.log("Airdrop successful");
    } catch (e) {
      console.log("Airdrop failed, continuing anyway...");
    }
  }

  // Setup Anchor provider
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: "confirmed" }
  );

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/stealthbridge.json");
  if (!fs.existsSync(idlPath)) {
    console.error("IDL not found. Run 'anchor build' first.");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  // Set the program ID from the IDL address field
  idl.address = PROGRAM_ID.toBase58();
  const program = new Program(idl, provider);

  console.log("Program loaded, methods:", Object.keys((program.methods as any) || {}));

  // Derive PDAs
  const [poolStatePda, poolBump] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  const [commitmentTreePda, treeBump] = PublicKey.findProgramAddressSync([COMMITMENT_TREE_SEED], PROGRAM_ID);

  console.log("\nProgram ID:", PROGRAM_ID.toBase58());
  console.log("Pool State PDA:", poolStatePda.toBase58());
  console.log("Commitment Tree PDA:", commitmentTreePda.toBase58());

  // ============================================================
  // STEP 1: Create sbBTC Mint and Initialize Pool
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 1: Initialize Pool");
  console.log("-".repeat(70));

  const poolAccount = await connection.getAccountInfo(poolStatePda);

  let sbbtcMint: PublicKey;
  let poolVault: PublicKey;
  let frostVault: PublicKey;

  if (poolAccount) {
    console.log("Pool already initialized, reading existing config...");
    // Extract mint address from pool state (offset: 8 + 1 + 1 + 32 = 42, then 32 bytes for sbbtc_mint)
    // Actually let's just create a new mint anyway for simplicity
    const mintOffset = 8 + 1 + 1 + 32; // discriminator + bump + paused + authority
    const sbbtcMintBytes = poolAccount.data.slice(mintOffset, mintOffset + 32);
    sbbtcMint = new PublicKey(sbbtcMintBytes);
    console.log("Existing sbBTC Mint:", sbbtcMint.toBase58());

    // Get pool vault and frost vault
    const poolVaultOffset = mintOffset + 32 + 32; // after mint and privacy_cash_pool
    poolVault = new PublicKey(poolAccount.data.slice(poolVaultOffset, poolVaultOffset + 32));
    frostVault = new PublicKey(poolAccount.data.slice(poolVaultOffset + 32, poolVaultOffset + 64));
  } else {
    console.log("Creating new sbBTC mint (Token-2022)...");

    // Create mint with pool PDA as authority
    sbbtcMint = await createMint(
      connection,
      wallet,
      poolStatePda,  // mint authority = pool PDA
      null,          // no freeze authority
      8,             // 8 decimals
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("sbBTC Mint created:", sbbtcMint.toBase58());

    // Create pool vault
    const poolVaultAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      sbbtcMint,
      poolStatePda,
      true,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    poolVault = poolVaultAccount.address;
    console.log("Pool vault created:", poolVault.toBase58());

    // Create frost vault
    frostVault = await createAccount(
      connection,
      wallet,
      sbbtcMint,
      wallet.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("FROST vault created:", frostVault.toBase58());

    // Initialize pool
    console.log("Initializing pool...");
    const privacyCashPool = Keypair.generate();

    try {
      console.log("  Building initialize instruction manually...");
      console.log("  pool_bump:", poolBump);
      console.log("  czbtc_mint:", sbbtcMint.toBase58());

      // Pinocchio uses single-byte discriminator: INITIALIZE = 0
      // Build instruction data: discriminator (1 byte) + pool_bump (1 byte) + tree_bump (1 byte)
      const data = Buffer.alloc(3);
      data[0] = 0;  // INITIALIZE
      data[1] = poolBump;
      data[2] = treeBump;

      const initIx = new TransactionInstruction({
        keys: [
          { pubkey: poolStatePda, isSigner: false, isWritable: true },
          { pubkey: commitmentTreePda, isSigner: false, isWritable: true },
          { pubkey: sbbtcMint, isSigner: false, isWritable: false },
          { pubkey: poolVault, isSigner: false, isWritable: false },
          { pubkey: frostVault, isSigner: false, isWritable: false },
          { pubkey: privacyCashPool.publicKey, isSigner: false, isWritable: false },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data,
      });

      const tx = new Transaction().add(initIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log("Pool initialized:", sig);
    } catch (err: any) {
      console.error("Failed to initialize:", err.message);
      if (err.logs) {
        console.error("Logs:", err.logs.slice(0, 5));
      }
      // Try to continue anyway in case it's already initialized
    }
  }

  // ============================================================
  // STEP 2: Generate Coupon Notes
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 2: Generate Coupon Notes");
  console.log("-".repeat(70));

  const poseidon = await buildPoseidon();
  const poseidonHash = (...inputs: bigint[]): bigint => {
    const hash = poseidon(inputs.map((i) => poseidon.F.e(i)));
    return poseidon.F.toObject(hash);
  };

  const couponNotes: CouponNote[] = [];

  for (const coupon of COUPONS) {
    const { nullifier, secret } = deriveFromSeed(coupon.seed);
    const commitment = poseidonHash(nullifier, secret);
    const nullifierHash = poseidonHash(nullifier);

    const note: CouponNote = {
      seed: coupon.seed,
      nullifier: nullifier.toString(),
      secret: secret.toString(),
      commitment: commitment.toString(),
      nullifierHash: nullifierHash.toString(),
      amountSats: coupon.amountSats,
    };

    couponNotes.push(note);
    console.log(
      `  ${coupon.seed}: ${(coupon.amountSats / 100_000_000).toFixed(8)} BTC`
    );
  }

  // ============================================================
  // STEP 3: Add Demo Commitments
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 3: Add Demo Commitments to Merkle Tree");
  console.log("-".repeat(70));

  // Pinocchio uses single-byte discriminator: ADD_DEMO_COMMITMENT = 11

  for (let i = 0; i < couponNotes.length; i++) {
    const note = couponNotes[i];
    const commitmentBytes = bigintToBytes32(BigInt(note.commitment));

    try {
      // Build instruction data: discriminator (1) + commitment (32) + amount (8) = 41 bytes
      const data = Buffer.alloc(41);
      data[0] = 11;  // ADD_DEMO_COMMITMENT
      data.set(commitmentBytes, 1);
      data.writeBigUInt64LE(BigInt(note.amountSats), 33);

      const addDemoIx = new TransactionInstruction({
        keys: [
          { pubkey: poolStatePda, isSigner: false, isWritable: true },
          { pubkey: commitmentTreePda, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data,
      });

      const tx = new Transaction().add(addDemoIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);

      // Get leaf index from logs
      await new Promise(resolve => setTimeout(resolve, 300));

      const txInfo = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (txInfo?.meta?.logMessages) {
        for (const log of txInfo.meta.logMessages) {
          const match = log.match(/index=(\d+)/);
          if (match) {
            note.leafIndex = parseInt(match[1]);
            break;
          }
        }
      }

      note.leafIndex = note.leafIndex ?? i;
      console.log(
        `  + ${note.seed}: leaf_index=${note.leafIndex}, tx=${sig.slice(0, 16)}...`
      );
    } catch (err: any) {
      if (err.message?.includes("already in use") || err.message?.includes("already initialized")) {
        console.log(`  = ${note.seed}: Already added (skipping)`);
        note.leafIndex = i;
      } else {
        console.log(`  x ${note.seed}: ${err.message?.slice(0, 60)}...`);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // ============================================================
  // STEP 4: Save Results
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("         RESULTS");
  console.log("=".repeat(70));

  // Save coupon notes to JSON
  const outputPath = path.join(__dirname, "../coupon-notes.json");
  fs.writeFileSync(outputPath, JSON.stringify(couponNotes, null, 2));
  console.log("\nCoupon notes saved to:", outputPath);

  // Print claim links
  console.log("\nClaim Links (seed IS the claim link):\n");
  for (const note of couponNotes) {
    const btcAmount = (note.amountSats / 100_000_000).toFixed(8);
    console.log(`  ${note.seed}: ${btcAmount} BTC (leaf ${note.leafIndex ?? "?"})`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("         DONE");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
