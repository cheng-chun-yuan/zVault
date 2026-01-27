#!/usr/bin/env bun
/**
 * Deploy and Initialize zVault on Localnet
 *
 * This script:
 * 1. Deploys both zVault and BTC Light Client programs
 * 2. Initializes the BTC Light Client with a test block
 * 3. Creates the sbBTC Token-2022 mint
 * 4. Initializes the zVault pool state and commitment tree
 * 5. Adds demo notes for testing
 *
 * Prerequisites:
 *   - solana-test-validator running (run: solana-test-validator --reset)
 *   - Programs built (run: cargo build-sbf)
 *
 * Usage:
 *   bun run scripts/deploy-localnet.ts
 *   bun run scripts/deploy-localnet.ts --skip-deploy  # Skip deployment, only initialize
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const CONTRACTS_DIR = path.join(__dirname, "..");
const TARGET_DIR = path.join(CONTRACTS_DIR, "target/deploy");
const CONFIG_PATH = path.join(CONTRACTS_DIR, "config.json");

// Load config to get program paths
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

// Seeds for zVault PDAs
const ZVaultSeeds = {
  POOL_STATE: "pool_state",
  COMMITMENT_TREE: "commitment_tree",
};

// Seeds for BTC Light Client PDAs
const BTCLCSeeds = {
  LIGHT_CLIENT: "light_client",
};

// Instruction discriminators
const ZVaultInstruction = {
  INITIALIZE: 0,
  ADD_DEMO_NOTE: 21,
};

const BTCLCInstruction = {
  INITIALIZE: 0,
};

// Discriminators for parsing
const Discriminators = {
  POOL_STATE: 0x01,
  COMMITMENT_TREE: 0x05,
  LIGHT_CLIENT: 0x01,
};

// Test Bitcoin block (Bitcoin testnet block ~2,500,000)
const TEST_BTC_BLOCK = {
  height: 2500000n,
  hash: Buffer.from(
    "0000000000000023b3a1a1e1d1c1b1a191817161514131211101f0e0d0c0b0a09",
    "hex"
  ),
  network: 1, // 0=mainnet, 1=testnet
};

// =============================================================================
// Types
// =============================================================================

interface DeployResult {
  zvaultProgramId: PublicKey;
  btcLightClientProgramId: PublicKey;
}

interface InitResult {
  poolStatePda: PublicKey;
  commitmentTreePda: PublicKey;
  btcLightClientPda: PublicKey;
  sbbtcMint: PublicKey;
  poolVault: PublicKey;
  authority: PublicKey;
}

// =============================================================================
// Helpers
// =============================================================================

function log(msg: string) {
  console.log(`[${new Date().toISOString().split("T")[1].slice(0, 8)}] ${msg}`);
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60) + "\n");
}

async function loadKeypair(keyPath: string): Promise<Keypair> {
  const absolutePath = keyPath.replace("~", process.env.HOME || "");
  const secretKey = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function generateSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Deployment Functions
// =============================================================================

async function deployPrograms(skipDeploy: boolean): Promise<DeployResult> {
  logSection("Program Deployment");

  // Get program IDs from keypairs
  const zvaultKeypairPath = path.join(TARGET_DIR, "zvault_pinocchio-keypair.json");
  const btclcKeypairPath = path.join(TARGET_DIR, "btc_light_client-keypair.json");

  if (!fs.existsSync(zvaultKeypairPath) || !fs.existsSync(btclcKeypairPath)) {
    throw new Error("Program keypairs not found. Run 'cargo build-sbf' first.");
  }

  const zvaultKeypair = await loadKeypair(zvaultKeypairPath);
  const btclcKeypair = await loadKeypair(btclcKeypairPath);

  const zvaultProgramId = zvaultKeypair.publicKey;
  const btcLightClientProgramId = btclcKeypair.publicKey;

  log(`zVault Program ID: ${zvaultProgramId.toBase58()}`);
  log(`BTC Light Client Program ID: ${btcLightClientProgramId.toBase58()}`);

  if (skipDeploy) {
    log("Skipping deployment (--skip-deploy flag)");
    return { zvaultProgramId, btcLightClientProgramId };
  }

  // Deploy zVault
  log("Deploying zVault program...");
  try {
    execSync(
      `solana program deploy ${TARGET_DIR}/zvault_pinocchio.so --program-id ${zvaultKeypairPath} -u localhost`,
      { stdio: "inherit" }
    );
    log("zVault deployed successfully");
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      log("zVault program already deployed");
    } else {
      throw e;
    }
  }

  // Deploy BTC Light Client
  log("Deploying BTC Light Client program...");
  try {
    execSync(
      `solana program deploy ${TARGET_DIR}/btc_light_client.so --program-id ${btclcKeypairPath} -u localhost`,
      { stdio: "inherit" }
    );
    log("BTC Light Client deployed successfully");
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      log("BTC Light Client program already deployed");
    } else {
      throw e;
    }
  }

  // Wait for programs to be fully deployed
  log("Waiting for programs to be ready...");
  await sleep(3000);

  return { zvaultProgramId, btcLightClientProgramId };
}

// =============================================================================
// PDA Derivation
// =============================================================================

function derivePoolStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZVaultSeeds.POOL_STATE)],
    programId
  );
}

function deriveCommitmentTreePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ZVaultSeeds.COMMITMENT_TREE)],
    programId
  );
}

function deriveBTCLightClientPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BTCLCSeeds.LIGHT_CLIENT)],
    programId
  );
}

// =============================================================================
// Instruction Builders
// =============================================================================

function buildBTCLCInitializeIx(
  lightClientPda: PublicKey,
  payer: PublicKey,
  programId: PublicKey,
  startHeight: bigint,
  startBlockHash: Buffer,
  network: number
): TransactionInstruction {
  // Instruction data: discriminator (1) + height (8) + hash (32) + network (1) = 42 bytes
  const data = Buffer.alloc(42);
  data[0] = BTCLCInstruction.INITIALIZE;
  data.writeBigUInt64LE(startHeight, 1);
  startBlockHash.copy(data, 9);
  data[41] = network;

  return new TransactionInstruction({
    keys: [
      { pubkey: lightClientPda, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

function buildZVaultInitializeIx(
  poolState: PublicKey,
  commitmentTree: PublicKey,
  sbbtcMint: PublicKey,
  poolVault: PublicKey,
  frostVault: PublicKey,
  privacyCashPool: PublicKey,
  authority: PublicKey,
  programId: PublicKey,
  poolBump: number,
  treeBump: number
): TransactionInstruction {
  const data = Buffer.alloc(3);
  data[0] = ZVaultInstruction.INITIALIZE;
  data[1] = poolBump;
  data[2] = treeBump;

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: sbbtcMint, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: false },
      { pubkey: frostVault, isSigner: false, isWritable: false },
      { pubkey: privacyCashPool, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

function buildAddDemoNoteIx(
  poolState: PublicKey,
  commitmentTree: PublicKey,
  authority: PublicKey,
  zbtcMint: PublicKey,
  poolVault: PublicKey,
  programId: PublicKey,
  secret: Uint8Array
): TransactionInstruction {
  const data = Buffer.alloc(1 + 32);
  data[0] = ZVaultInstruction.ADD_DEMO_NOTE;
  Buffer.from(secret).copy(data, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// =============================================================================
// Initialization Functions
// =============================================================================

async function initializeBTCLightClient(
  connection: Connection,
  authority: Keypair,
  programId: PublicKey
): Promise<PublicKey> {
  logSection("BTC Light Client Initialization");

  const [lightClientPda] = deriveBTCLightClientPDA(programId);
  log(`BTC Light Client PDA: ${lightClientPda.toBase58()}`);

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(lightClientPda);
  if (accountInfo && accountInfo.data[0] === Discriminators.LIGHT_CLIENT) {
    log("BTC Light Client already initialized, skipping...");
    return lightClientPda;
  }

  log(`Initializing with block height: ${TEST_BTC_BLOCK.height}`);
  log(`Block hash: ${TEST_BTC_BLOCK.hash.toString("hex")}`);
  log(`Network: ${TEST_BTC_BLOCK.network === 0 ? "mainnet" : "testnet"}`);

  const ix = buildBTCLCInitializeIx(
    lightClientPda,
    authority.publicKey,
    programId,
    TEST_BTC_BLOCK.height,
    TEST_BTC_BLOCK.hash,
    TEST_BTC_BLOCK.network
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "confirmed",
  });

  log(`BTC Light Client initialized: ${sig}`);
  return lightClientPda;
}

async function initializeZVault(
  connection: Connection,
  authority: Keypair,
  programId: PublicKey
): Promise<InitResult> {
  logSection("zVault Initialization");

  const [poolStatePda, poolBump] = derivePoolStatePDA(programId);
  const [commitmentTreePda, treeBump] = deriveCommitmentTreePDA(programId);

  log(`Pool State PDA: ${poolStatePda.toBase58()} (bump: ${poolBump})`);
  log(`Commitment Tree PDA: ${commitmentTreePda.toBase58()} (bump: ${treeBump})`);

  // Check if already initialized
  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (poolAccount && poolAccount.data[0] === Discriminators.POOL_STATE) {
    log("zVault already initialized, skipping...");

    // Parse existing pool state to get mint and vault info
    // Pool state layout: discriminator(1) + bump(1) + flags(1) + padding(1) + authority(32) + zbtc_mint(32) + ...
    const mintPubkey = new PublicKey(poolAccount.data.subarray(36, 68));
    // pool_vault is at offset 100 (after zbtc_mint(32) + privacy_cash_pool(32))
    const poolVaultPubkey = new PublicKey(poolAccount.data.subarray(100, 132));

    log(`Existing mint: ${mintPubkey.toBase58()}`);
    log(`Existing pool vault: ${poolVaultPubkey.toBase58()}`);

    return {
      poolStatePda,
      commitmentTreePda,
      btcLightClientPda: PublicKey.default,
      sbbtcMint: mintPubkey,
      poolVault: poolVaultPubkey,
      authority: authority.publicKey,
    };
  }

  // Create sbBTC Token-2022 mint with pool PDA as mint authority
  log("Creating sbBTC Token-2022 mint...");
  const mintKeypair = Keypair.generate();
  const mintLen = getMintLen([]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      8, // decimals (satoshis)
      poolStatePda, // mint authority is pool PDA (critical for CPI minting!)
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, createMintTx, [authority, mintKeypair], {
    commitment: "confirmed",
  });
  const sbbtcMint = mintKeypair.publicKey;
  log(`sbBTC Mint: ${sbbtcMint.toBase58()}`);

  // Create pool vault (ATA for pool PDA)
  log("Creating pool vault...");
  const poolVault = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    sbbtcMint,
    poolStatePda,
    true, // allowOwnerOffCurve (PDA)
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  log(`Pool Vault: ${poolVault.address.toBase58()}`);

  // Create frost vault (for freeze/thaw operations)
  log("Creating frost vault...");
  const frostVault = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    sbbtcMint,
    authority.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  log(`Frost Vault: ${frostVault.address.toBase58()}`);

  // Privacy cash pool (dummy for testing)
  const privacyCashPool = Keypair.generate().publicKey;

  // Initialize zVault
  log("Initializing zVault pool...");
  const ix = buildZVaultInitializeIx(
    poolStatePda,
    commitmentTreePda,
    sbbtcMint,
    poolVault.address,
    frostVault.address,
    privacyCashPool,
    authority.publicKey,
    programId,
    poolBump,
    treeBump
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "confirmed",
  });

  log(`zVault initialized: ${sig}`);

  return {
    poolStatePda,
    commitmentTreePda,
    btcLightClientPda: PublicKey.default,
    sbbtcMint,
    poolVault: poolVault.address,
    authority: authority.publicKey,
  };
}

async function addDemoNotes(
  connection: Connection,
  authority: Keypair,
  programId: PublicKey,
  poolStatePda: PublicKey,
  commitmentTreePda: PublicKey,
  zbtcMint: PublicKey,
  poolVault: PublicKey,
  count: number = 3
): Promise<void> {
  logSection("Adding Demo Notes");

  log(`Adding ${count} demo notes to commitment tree...`);
  log(`zBTC will be minted to pool vault: ${poolVault.toBase58()}`);

  for (let i = 0; i < count; i++) {
    const secret = generateSecret();
    const ix = buildAddDemoNoteIx(
      poolStatePda,
      commitmentTreePda,
      authority.publicKey,
      zbtcMint,
      poolVault,
      programId,
      secret
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
      commitment: "confirmed",
    });

    log(`Demo note ${i + 1}/${count} added: ${sig.slice(0, 16)}...`);
  }

  log(`Successfully added ${count} demo notes`);
}

// =============================================================================
// Config Saving
// =============================================================================

function saveLocalnetConfig(
  deployResult: DeployResult,
  initResult: InitResult
): void {
  logSection("Saving Configuration");

  // Update config.json with localnet values
  config.programs.localnet = {
    zVault: deployResult.zvaultProgramId.toBase58(),
    btc_light_client: deployResult.btcLightClientProgramId.toBase58(),
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`Updated ${CONFIG_PATH}`);

  // Save detailed localnet config
  const localnetConfig = {
    network: "localnet",
    rpcUrl: RPC_URL,
    programs: {
      zVault: deployResult.zvaultProgramId.toBase58(),
      btcLightClient: deployResult.btcLightClientProgramId.toBase58(),
    },
    accounts: {
      poolState: initResult.poolStatePda.toBase58(),
      commitmentTree: initResult.commitmentTreePda.toBase58(),
      sbbtcMint: initResult.sbbtcMint.toBase58(),
      poolVault: initResult.poolVault.toBase58(),
      authority: initResult.authority.toBase58(),
    },
    btcLightClient: {
      pda: initResult.btcLightClientPda.toBase58(),
      startHeight: TEST_BTC_BLOCK.height.toString(),
      startHash: TEST_BTC_BLOCK.hash.toString("hex"),
      network: TEST_BTC_BLOCK.network === 0 ? "mainnet" : "testnet",
    },
    createdAt: new Date().toISOString(),
  };

  const localnetConfigPath = path.join(CONTRACTS_DIR, ".localnet-config.json");
  fs.writeFileSync(localnetConfigPath, JSON.stringify(localnetConfig, null, 2) + "\n");
  log(`Saved ${localnetConfigPath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const skipDeploy = args.includes("--skip-deploy");

  logSection("zVault Localnet Deploy & Initialize");

  log(`RPC URL: ${RPC_URL}`);
  log(`Skip Deploy: ${skipDeploy}`);

  // Connect to localnet
  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const version = await connection.getVersion();
    log(`Solana version: ${version["solana-core"]}`);
  } catch (e) {
    console.error("\nError: Cannot connect to localnet.");
    console.error("Make sure solana-test-validator is running:");
    console.error("  solana-test-validator --reset\n");
    process.exit(1);
  }

  // Load authority keypair
  const walletPath = config.wallet?.path || "~/.config/solana/id.json";
  let authority: Keypair;

  try {
    authority = await loadKeypair(walletPath);
    log(`Authority: ${authority.publicKey.toBase58()}`);
  } catch (e) {
    log("Creating new authority keypair...");
    authority = Keypair.generate();
    log(`Authority: ${authority.publicKey.toBase58()}`);
  }

  // Check balance and airdrop if needed
  const balance = await connection.getBalance(authority.publicKey);
  log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < LAMPORTS_PER_SOL) {
    log("Requesting airdrop...");
    const sig = await connection.requestAirdrop(
      authority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    log("Airdrop successful");
  }

  // Deploy programs
  const deployResult = await deployPrograms(skipDeploy);

  // Initialize BTC Light Client
  const btcLightClientPda = await initializeBTCLightClient(
    connection,
    authority,
    deployResult.btcLightClientProgramId
  );

  // Initialize zVault
  const initResult = await initializeZVault(
    connection,
    authority,
    deployResult.zvaultProgramId
  );
  initResult.btcLightClientPda = btcLightClientPda;

  // Add demo notes (now also mints zBTC to pool vault)
  await addDemoNotes(
    connection,
    authority,
    deployResult.zvaultProgramId,
    initResult.poolStatePda,
    initResult.commitmentTreePda,
    initResult.sbbtcMint,
    initResult.poolVault,
    3
  );

  // Save configuration
  saveLocalnetConfig(deployResult, initResult);

  logSection("Deployment Complete!");

  console.log("Summary:");
  console.log(`  zVault Program:       ${deployResult.zvaultProgramId.toBase58()}`);
  console.log(`  BTC Light Client:     ${deployResult.btcLightClientProgramId.toBase58()}`);
  console.log(`  Pool State PDA:       ${initResult.poolStatePda.toBase58()}`);
  console.log(`  Commitment Tree PDA:  ${initResult.commitmentTreePda.toBase58()}`);
  console.log(`  sbBTC Mint:           ${initResult.sbbtcMint.toBase58()}`);
  console.log(`  BTC LC PDA:           ${btcLightClientPda.toBase58()}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Build SDK: cd ../sdk && bun run build");
  console.log("  2. Run tests: bun run test:all");
  console.log("");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
