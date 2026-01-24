/**
 * Seed Coupon Commitments
 *
 * Generates commitments from seed phrases (free-coupon-01 to free-coupon-10)
 * and adds them to the on-chain Merkle tree.
 *
 * The seed IS the claim link - much simpler!
 *
 * Run: bun run scripts/seed-coupon-commitments.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { buildPoseidon } from "circomlibjs";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

// Program ID (deployed zVault)
const PROGRAM_ID = new PublicKey("3Df8Xv9hMtVVLRxagnbCsofvgn18yPzfCqTmbUEnx9KF");

// Seeds for PDAs
const POOL_STATE_SEED = Buffer.from("pool_state");
const COMMITMENT_TREE_SEED = Buffer.from("commitment_tree");

// Field modulus for BN254
const BN254_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// Demo coupon seeds and amounts
const COUPONS = [
  { seed: "free-coupon-01", amountSats: 100_000 },   // 0.001 BTC
  { seed: "free-coupon-02", amountSats: 50_000 },    // 0.0005 BTC
  { seed: "free-coupon-03", amountSats: 200_000 },   // 0.002 BTC
  { seed: "free-coupon-04", amountSats: 75_000 },    // 0.00075 BTC
  { seed: "free-coupon-05", amountSats: 150_000 },   // 0.0015 BTC
  { seed: "free-coupon-06", amountSats: 25_000 },    // 0.00025 BTC
  { seed: "free-coupon-07", amountSats: 500_000 },   // 0.005 BTC
  { seed: "free-coupon-08", amountSats: 80_000 },    // 0.0008 BTC
  { seed: "free-coupon-09", amountSats: 120_000 },   // 0.0012 BTC
  { seed: "free-coupon-10", amountSats: 300_000 },   // 0.003 BTC
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
 * Derive nullifier and secret from seed (matches SDK's deriveNote)
 *
 * master = SHA256(seed)
 * nullifier = SHA256(master || index || 0) mod BN254
 * secret = SHA256(master || index || 1) mod BN254
 */
function deriveFromSeed(seed: string, index: number = 0): { nullifier: bigint; secret: bigint } {
  // Step 1: master = SHA256(seed)
  const master = createHash("sha256").update(seed).digest();

  // Step 2: Derive nullifier = SHA256(master || index || 0) mod field
  const nullifierInput = Buffer.alloc(37);
  master.copy(nullifierInput, 0);
  nullifierInput.writeUInt32LE(index, 32);
  nullifierInput[36] = 0; // domain = 0 for nullifier
  const nullifierHash = createHash("sha256").update(nullifierInput).digest();
  const nullifier = BigInt("0x" + nullifierHash.toString("hex")) % BN254_FIELD;

  // Step 3: Derive secret = SHA256(master || index || 1) mod field
  const secretInput = Buffer.alloc(37);
  master.copy(secretInput, 0);
  secretInput.writeUInt32LE(index, 32);
  secretInput[36] = 1; // domain = 1 for secret
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
  console.log("         SEED COUPON COMMITMENTS (free-coupon-01 to 10)");
  console.log("=".repeat(70) + "\n");

  // Initialize Poseidon
  console.log("Initializing Poseidon hash function...");
  const poseidon = await buildPoseidon();
  const poseidonHash = (...inputs: bigint[]): bigint => {
    const hash = poseidon(inputs.map((i) => poseidon.F.e(i)));
    return poseidon.F.toObject(hash);
  };

  // Generate coupon notes from seeds
  console.log("\nDeriving notes from seeds...\n");
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
      `  ${coupon.seed}: ${(coupon.amountSats / 100_000_000).toFixed(8)} BTC (${coupon.amountSats} sats)`
    );
    console.log(`    nullifier: ${nullifier.toString().slice(0, 20)}...`);
    console.log(`    commitment: ${commitment.toString().slice(0, 20)}...`);
  }

  // Try to load wallet and connect to devnet
  let connection: Connection;
  let wallet: Keypair | null = null;

  try {
    const walletPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
    if (fs.existsSync(walletPath)) {
      const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
      wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
      console.log("\nWallet loaded:", wallet.publicKey.toBase58());
    }
  } catch (e) {
    console.log("\nNo wallet found, will output notes without on-chain submission");
  }

  // Connect to Solana
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  connection = new Connection(rpcUrl, "confirmed");
  console.log("Connected to:", rpcUrl);

  // Derive PDAs
  const [poolStatePda] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  const [commitmentTreePda] = PublicKey.findProgramAddressSync([COMMITMENT_TREE_SEED], PROGRAM_ID);

  console.log("\nProgram ID:", PROGRAM_ID.toBase58());
  console.log("Pool State PDA:", poolStatePda.toBase58());
  console.log("Commitment Tree PDA:", commitmentTreePda.toBase58());

  // Check if pool is initialized
  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (!poolAccount) {
    console.log("\n⚠️  Pool not initialized on devnet.");
    console.log("   Run deployment first or use localnet.\n");
  }

  // If we have wallet and pool exists, submit commitments
  if (wallet && poolAccount) {
    console.log("\n" + "-".repeat(70));
    console.log("Submitting commitments to on-chain Merkle tree...");
    console.log("-".repeat(70) + "\n");

    const provider = new AnchorProvider(
      connection,
      new Wallet(wallet),
      { commitment: "confirmed" }
    );

    // Load IDL
    const idlPath = path.join(__dirname, "../target/idl/stealthbridge.json");
    if (!fs.existsSync(idlPath)) {
      console.log("IDL not found at:", idlPath);
      console.log("Run 'anchor build' first.");
    } else {
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
      const program = new Program(idl, provider);

      // Check if wallet is authority
      const authorityOffset = 8 + 1 + 1; // discriminator + bump + paused
      const authorityBytes = poolAccount.data.slice(authorityOffset, authorityOffset + 32);
      const authority = new PublicKey(authorityBytes);

      if (!wallet.publicKey.equals(authority)) {
        console.log("⚠️  Wallet is not pool authority.");
        console.log("   Wallet:", wallet.publicKey.toBase58());
        console.log("   Authority:", authority.toBase58());
      } else {
        // Submit each commitment
        for (let i = 0; i < couponNotes.length; i++) {
          const note = couponNotes[i];
          const commitmentBytes = bigintToBytes32(BigInt(note.commitment));

          try {
            const tx = await (program.methods as any)
              .addDemoCommitment(
                Array.from(commitmentBytes),
                new anchor.BN(note.amountSats)
              )
              .accounts({
                poolState: poolStatePda,
                commitmentTree: commitmentTreePda,
                authority: wallet.publicKey,
              })
              .rpc();

            // Get leaf index from logs
            const txInfo = await connection.getTransaction(tx, {
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

            console.log(
              `  ✓ ${note.seed}: leaf_index=${note.leafIndex ?? "?"}, tx=${tx.slice(0, 16)}...`
            );
          } catch (err: any) {
            if (err.message?.includes("already in use")) {
              console.log(`  ⏭️  ${note.seed}: Already added (skipping)`);
            } else {
              console.log(`  ✗ ${note.seed}: ${err.message?.slice(0, 50)}...`);
            }
          }
        }
      }
    }
  }

  // Output the coupon notes
  console.log("\n" + "=".repeat(70));
  console.log("              COUPON NOTES OUTPUT");
  console.log("=".repeat(70) + "\n");

  // Save to JSON
  const outputPath = path.join(__dirname, "../coupon-notes.json");
  fs.writeFileSync(outputPath, JSON.stringify(couponNotes, null, 2));
  console.log(`Coupon notes saved to: ${outputPath}`);

  // Print simple claim links
  console.log("\n" + "-".repeat(70));
  console.log("Claim Links (just the seed!):");
  console.log("-".repeat(70) + "\n");

  for (const note of couponNotes) {
    const btcAmount = (note.amountSats / 100_000_000).toFixed(8);
    console.log(`${note.seed}: ${btcAmount} BTC`);
    console.log(`  → https://localhost:3000/claim?note=${encodeURIComponent(note.seed)}\n`);
  }

  // Generate frontend test-data.ts format
  console.log("\n" + "-".repeat(70));
  console.log("Frontend test-data.ts (already updated):");
  console.log("-".repeat(70) + "\n");

  console.log("Seeds and amounts match frontend/src/lib/test-data.ts");
  console.log("The seed IS the claim link - users just enter the seed to claim!");

  console.log("\n" + "=".repeat(70));
  console.log("              DONE");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
