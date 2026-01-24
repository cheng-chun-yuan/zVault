/**
 * Deploy and Seed Demo Commitments
 *
 * This script:
 * 1. Creates sbBTC Token-2022 mint (if needed)
 * 2. Creates pool vault and FROST vault (if needed)
 * 3. Initializes the pool (if not already initialized)
 * 4. Adds 10 demo commitments to the on-chain Merkle tree
 *
 * Run: bun run scripts/deploy-and-seed.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAccount,
  getOrCreateAssociatedTokenAccount,
  getMint,
} from "@solana/spl-token";
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

// State file to persist addresses between runs
const STATE_FILE = path.join(__dirname, "../.deploy-state.json");

interface DeployState {
  sbbtcMint?: string;
  poolVault?: string;
  frostVault?: string;
  initialized?: boolean;
}

function loadState(): DeployState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return {};
}

function saveState(state: DeployState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("         DEPLOY AND SEED DEMO COMMITMENTS");
  console.log("=".repeat(70) + "\n");

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  if (!fs.existsSync(walletPath)) {
    console.error("Wallet not found at:", walletPath);
    console.error("Set ANCHOR_WALLET env var or ensure ~/.config/solana/id.json exists");
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Connect to Solana
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  console.log("RPC:", rpcUrl);

  // Check wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL");

  if (balance < 0.1 * 1e9) {
    console.error("\nInsufficient balance. Need at least 0.1 SOL for deployment.");
    console.error("Run: solana airdrop 1 --url devnet");
    process.exit(1);
  }

  // Setup Anchor provider
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/zVault.json");
  if (!fs.existsSync(idlPath)) {
    console.error("IDL not found. Run 'anchor build' first.");
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Derive PDAs
  const [poolStatePda, poolBump] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  const [commitmentTreePda] = PublicKey.findProgramAddressSync([COMMITMENT_TREE_SEED], PROGRAM_ID);

  console.log("\nProgram ID:", PROGRAM_ID.toBase58());
  console.log("Pool State PDA:", poolStatePda.toBase58());
  console.log("Commitment Tree PDA:", commitmentTreePda.toBase58());

  // Load deployment state
  let state = loadState();

  // ============================================================
  // STEP 1: Create sbBTC Token-2022 Mint (if needed)
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 1: Create sbBTC Token-2022 Mint");
  console.log("-".repeat(70));

  let sbbtcMint: PublicKey;

  if (state.sbbtcMint) {
    sbbtcMint = new PublicKey(state.sbbtcMint);
    console.log("  Using existing mint:", sbbtcMint.toBase58());

    // Verify it exists
    try {
      await getMint(connection, sbbtcMint, undefined, TOKEN_2022_PROGRAM_ID);
      console.log("  ✓ Mint verified");
    } catch {
      console.log("  Mint not found, creating new one...");
      state.sbbtcMint = undefined;
    }
  }

  if (!state.sbbtcMint) {
    console.log("  Creating new sbBTC mint (Token-2022)...");
    try {
      sbbtcMint = await createMint(
        connection,
        wallet,
        poolStatePda,  // mint authority = pool PDA
        null,          // no freeze authority
        8,             // 8 decimals (like BTC satoshis)
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      state.sbbtcMint = sbbtcMint.toBase58();
      saveState(state);
      console.log("  ✓ Mint created:", sbbtcMint.toBase58());
    } catch (err: any) {
      console.error("  ✗ Failed to create mint:", err.message);
      process.exit(1);
    }
  }

  sbbtcMint = new PublicKey(state.sbbtcMint!);

  // ============================================================
  // STEP 2: Create Pool Vault (if needed)
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 2: Create Pool Vault");
  console.log("-".repeat(70));

  let poolVault: PublicKey;

  if (state.poolVault) {
    poolVault = new PublicKey(state.poolVault);
    console.log("  Using existing pool vault:", poolVault.toBase58());
  } else {
    console.log("  Creating pool vault (ATA for pool PDA)...");
    try {
      const poolVaultAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet,
        sbbtcMint,
        poolStatePda,
        true,  // allowOwnerOffCurve
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      poolVault = poolVaultAccount.address;
      state.poolVault = poolVault.toBase58();
      saveState(state);
      console.log("  ✓ Pool vault created:", poolVault.toBase58());
    } catch (err: any) {
      console.error("  ✗ Failed to create pool vault:", err.message);
      process.exit(1);
    }
  }

  poolVault = new PublicKey(state.poolVault!);

  // ============================================================
  // STEP 3: Create FROST Vault (if needed)
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 3: Create FROST Vault");
  console.log("-".repeat(70));

  let frostVault: PublicKey;

  if (state.frostVault) {
    frostVault = new PublicKey(state.frostVault);
    console.log("  Using existing FROST vault:", frostVault.toBase58());
  } else {
    console.log("  Creating FROST vault (owned by authority)...");
    try {
      frostVault = await createAccount(
        connection,
        wallet,
        sbbtcMint,
        wallet.publicKey,  // owned by authority
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      state.frostVault = frostVault.toBase58();
      saveState(state);
      console.log("  ✓ FROST vault created:", frostVault.toBase58());
    } catch (err: any) {
      console.error("  ✗ Failed to create FROST vault:", err.message);
      process.exit(1);
    }
  }

  frostVault = new PublicKey(state.frostVault!);

  // ============================================================
  // STEP 4: Initialize Pool (if needed)
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 4: Initialize Pool");
  console.log("-".repeat(70));

  const poolAccount = await connection.getAccountInfo(poolStatePda);

  if (poolAccount) {
    console.log("  Pool already initialized, skipping...");
  } else {
    console.log("  Initializing pool...");

    // Create a dummy privacy cash pool (just needs to be a valid pubkey)
    const privacyCashPool = Keypair.generate();

    try {
      // Anchor uses camelCase for accounts internally
      const tx = await (program.methods as any)
        .initialize(poolBump)
        .accounts({
          poolState: poolStatePda,
          sbbtcMint: sbbtcMint,
          poolVault: poolVault,
          frostVault: frostVault,
          privacyCashPool: privacyCashPool.publicKey,
          authority: wallet.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      console.log("  ✓ Pool initialized:", tx);
      state.initialized = true;
      saveState(state);
    } catch (err: any) {
      if (err.message?.includes("already in use")) {
        console.log("  Pool already initialized (concurrent init)");
      } else {
        console.error("  ✗ Failed to initialize pool:", err.message);
        console.error("  Full error:", err);
        process.exit(1);
      }
    }
  }

  // ============================================================
  // STEP 5: Initialize Commitment Tree (if needed)
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 5: Initialize Commitment Tree");
  console.log("-".repeat(70));

  const commitmentTreeAccount = await connection.getAccountInfo(commitmentTreePda);

  if (commitmentTreeAccount) {
    console.log("  Commitment tree already initialized, skipping...");
  } else {
    console.log("  Initializing commitment tree...");

    // Find bump for commitment tree
    const [, treeBump] = PublicKey.findProgramAddressSync([COMMITMENT_TREE_SEED], PROGRAM_ID);

    try {
      const tx = await (program.methods as any)
        .initCommitmentTree(treeBump)
        .accounts({
          poolState: poolStatePda,
          commitmentTree: commitmentTreePda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      console.log("  ✓ Commitment tree initialized:", tx);
    } catch (err: any) {
      if (err.message?.includes("already in use")) {
        console.log("  Commitment tree already initialized (concurrent init)");
      } else {
        console.error("  ✗ Failed to initialize commitment tree:", err.message);
        console.error("  Full error:", err);
        process.exit(1);
      }
    }
  }

  // ============================================================
  // STEP 6: Generate Demo Notes
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 6: Generate Demo Notes");
  console.log("-".repeat(70));

  const poseidon = await buildPoseidon();
  const poseidonHash = (...inputs: bigint[]): bigint => {
    const hash = poseidon(inputs.map((i) => poseidon.F.e(i)));
    return poseidon.F.toObject(hash);
  };

  const demoNotes: DemoNote[] = [];
  for (let i = 0; i < 10; i++) {
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
    const commitment = poseidonHash(nullifier, secret);
    const nullifierHash = poseidonHash(nullifier);
    const amountSats = DEMO_AMOUNTS[i];

    demoNotes.push({
      nullifier: nullifier.toString(),
      secret: secret.toString(),
      commitment: commitment.toString(),
      nullifierHash: nullifierHash.toString(),
      amountSats,
      claimLink: createClaimLink(nullifier.toString(), secret.toString()),
    });

    console.log(`  Note ${i + 1}: ${(amountSats / 100_000_000).toFixed(8)} BTC (${amountSats.toLocaleString()} sats)`);
  }

  // ============================================================
  // STEP 7: Add Demo Commitments to Merkle Tree
  // ============================================================
  console.log("\n" + "-".repeat(70));
  console.log("STEP 7: Add Demo Commitments to Merkle Tree");
  console.log("-".repeat(70));

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

      // Get leaf index from transaction logs
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for confirmation

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

      console.log(`  ✓ Note ${i + 1}: leaf_index=${note.leafIndex ?? "?"}, tx=${tx.slice(0, 16)}...`);
    } catch (err: any) {
      console.error(`  ✗ Note ${i + 1} failed:`, err.message);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // ============================================================
  // STEP 8: Output Results
  // ============================================================
  console.log("\n" + "=".repeat(70));
  console.log("         DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));

  // Save to JSON file
  const outputPath = path.join(__dirname, "../demo-notes.json");
  fs.writeFileSync(outputPath, JSON.stringify(demoNotes, null, 2));
  console.log("\nDemo notes saved to:", outputPath);

  // Generate TypeScript code
  console.log("\n// ============ Copy to frontend/src/lib/test-data.ts ============\n");
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

  // Print claim links
  console.log("-".repeat(70));
  console.log("Claim Links:");
  console.log("-".repeat(70) + "\n");

  const baseUrl = process.env.FRONTEND_URL || "https://sbbtc.app";
  for (let i = 0; i < demoNotes.length; i++) {
    const note = demoNotes[i];
    const btcAmount = (note.amountSats / 100_000_000).toFixed(8);
    console.log(`${i + 1}. ${btcAmount} BTC: ${baseUrl}/claim?note=${note.claimLink.slice(0, 30)}...`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("         DONE - Pool initialized with 10 demo commitments");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
