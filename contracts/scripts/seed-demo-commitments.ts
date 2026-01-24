/**
 * Seed Demo Commitments
 *
 * Generates 10 demo notes with Poseidon commitments and adds them
 * to the on-chain Merkle tree via add_demo_commitment instruction.
 *
 * Run: bun run scripts/seed-demo-commitments.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { buildPoseidon } from "circomlibjs";
import * as fs from "fs";
import * as path from "path";

// Program ID (deployed zVault)
const PROGRAM_ID = new PublicKey("4qCkVgFUWQENxPXq86ccN7ZjBgyx7ehbkkfCXxCmrn4F");

// Seeds for PDAs
const POOL_STATE_SEED = Buffer.from("pool_state");
const COMMITMENT_TREE_SEED = Buffer.from("commitment_tree");

// Field modulus for BN254
const BN254_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// Demo note amounts in satoshis
const DEMO_AMOUNTS = [
  100_000,  // 0.001 BTC
  50_000,   // 0.0005 BTC
  200_000,  // 0.002 BTC
  75_000,   // 0.00075 BTC
  150_000,  // 0.0015 BTC
  25_000,   // 0.00025 BTC
  500_000,  // 0.005 BTC
  80_000,   // 0.0008 BTC
  120_000,  // 0.0012 BTC
  300_000,  // 0.003 BTC
];

interface DemoNote {
  nullifier: string;
  secret: string;
  commitment: string;
  nullifierHash: string;
  amountSats: number;
  claimLink: string;
  leafIndex?: number;
}

/**
 * Generate a random field element
 */
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const bn = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  return bn % BN254_FIELD;
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
 * Create base64 claim link from nullifier and secret
 */
function createClaimLink(nullifier: string, secret: string): string {
  const data = JSON.stringify({ n: nullifier, s: secret });
  return Buffer.from(data).toString("base64");
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("              SEED DEMO COMMITMENTS");
  console.log("=".repeat(70) + "\n");

  // Initialize Poseidon
  console.log("Initializing Poseidon hash function...");
  const poseidon = await buildPoseidon();
  const poseidonHash = (...inputs: bigint[]): bigint => {
    const hash = poseidon(inputs.map((i) => poseidon.F.e(i)));
    return poseidon.F.toObject(hash);
  };

  // Generate 10 demo notes
  console.log("\nGenerating 10 demo notes...\n");
  const demoNotes: DemoNote[] = [];

  for (let i = 0; i < 10; i++) {
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = poseidonHash(nullifier, secret);
    const nullifierHash = poseidonHash(nullifier);
    const amountSats = DEMO_AMOUNTS[i];

    const note: DemoNote = {
      nullifier: nullifier.toString(),
      secret: secret.toString(),
      commitment: commitment.toString(),
      nullifierHash: nullifierHash.toString(),
      amountSats,
      claimLink: createClaimLink(nullifier.toString(), secret.toString()),
    };

    demoNotes.push(note);
    console.log(
      `  Note ${i + 1}: ${(amountSats / 100_000_000).toFixed(8)} BTC (${amountSats} sats)`
    );
  }

  // Try to load wallet and connect to devnet
  let connection: Connection;
  let wallet: Keypair | null = null;

  try {
    // Try to load local wallet
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
    console.log("\nPool not initialized. Run 'anchor test' first to initialize.");
    console.log("Outputting notes without on-chain submission...\n");
  }

  // If we have a wallet and pool exists, submit commitments on-chain
  if (wallet && poolAccount) {
    console.log("\n" + "-".repeat(70));
    console.log("Submitting commitments to on-chain Merkle tree...");
    console.log("-".repeat(70) + "\n");

    // Setup Anchor provider
    const provider = new AnchorProvider(
      connection,
      new Wallet(wallet),
      { commitment: "confirmed" }
    );

    // Load IDL
    const idlPath = path.join(__dirname, "../target/idl/zVault.json");
    if (!fs.existsSync(idlPath)) {
      console.log("IDL not found. Run 'anchor build' first.");
      process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new Program(idl, provider);

    // Check if wallet is the authority
    // Read pool state to get authority
    const poolData = await connection.getAccountInfo(poolStatePda);
    if (poolData) {
      // Pool state layout: discriminator (8) + bump (1) + paused (1) + authority (32)
      const authorityOffset = 8 + 1 + 1;
      const authorityBytes = poolData.data.slice(authorityOffset, authorityOffset + 32);
      const authority = new PublicKey(authorityBytes);

      if (!wallet.publicKey.equals(authority)) {
        console.log("Warning: Wallet is not the pool authority.");
        console.log("  Wallet:", wallet.publicKey.toBase58());
        console.log("  Authority:", authority.toBase58());
        console.log("\nOnly the pool authority can add demo commitments.");
        console.log("Outputting notes without on-chain submission...\n");
      } else {
        // Submit each commitment
        for (let i = 0; i < demoNotes.length; i++) {
          const note = demoNotes[i];
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

            // Parse leaf index from logs
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
              `  ✓ Note ${i + 1} added: leaf_index=${note.leafIndex ?? "?"}, tx=${tx.slice(0, 16)}...`
            );
          } catch (err: any) {
            console.log(`  ✗ Note ${i + 1} failed: ${err.message}`);
          }
        }
      }
    }
  }

  // Output the demo notes
  console.log("\n" + "=".repeat(70));
  console.log("              DEMO NOTES OUTPUT");
  console.log("=".repeat(70) + "\n");

  // Generate TypeScript code for test-data.ts
  console.log("// Copy this to frontend/src/lib/test-data.ts\n");
  console.log("export const DEMO_NOTES: TestNote[] = [");

  for (let i = 0; i < demoNotes.length; i++) {
    const note = demoNotes[i];
    const btcAmount = (note.amountSats / 100_000_000).toFixed(8);

    console.log(`  {
    // Demo Note #${i + 1} - ${note.amountSats.toLocaleString()} sats (${btcAmount} BTC)
    nullifier: "${note.nullifier}",
    secret: "${note.secret}",
    commitment: "${note.commitment}",
    nullifierHash: "${note.nullifierHash}",
    amountSats: ${note.amountSats},
    claimLink: "${note.claimLink}",
    taprootAddress: "tb1p_demo_${i + 1}",
    description: "Demo: ${btcAmount} BTC (${note.amountSats.toLocaleString()} sats)",${note.leafIndex !== undefined ? `\n    leafIndex: ${note.leafIndex},` : ""}
  },`);
  }

  console.log("];\n");

  // Save to JSON file
  const outputPath = path.join(__dirname, "../demo-notes.json");
  fs.writeFileSync(outputPath, JSON.stringify(demoNotes, null, 2));
  console.log(`Demo notes saved to: ${outputPath}`);

  // Print claim links
  console.log("\n" + "-".repeat(70));
  console.log("Claim Links (share these for demo):");
  console.log("-".repeat(70) + "\n");

  for (let i = 0; i < demoNotes.length; i++) {
    const note = demoNotes[i];
    const btcAmount = (note.amountSats / 100_000_000).toFixed(8);
    console.log(`${i + 1}. ${btcAmount} BTC:`);
    console.log(`   https://sbbtc.app/claim?note=${note.claimLink}\n`);
  }

  console.log("=".repeat(70));
  console.log("              DONE");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
