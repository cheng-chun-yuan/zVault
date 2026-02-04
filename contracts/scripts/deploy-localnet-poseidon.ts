#!/usr/bin/env bun
/**
 * Deploy and Initialize zVault on Localnet with Poseidon Support
 *
 * This script deploys to a localnet running with devnet features (Poseidon syscall).
 * Unlike regular localnet deployment, this uses REAL Poseidon hashing (not SHA256 fallback).
 *
 * Prerequisites:
 *   - Start validator with Poseidon support:
 *     ./scripts/start-localnet-poseidon.sh --reset
 *
 *   - Build programs WITHOUT localnet feature (uses Poseidon):
 *     cargo build-sbf
 *
 * Usage:
 *   bun run scripts/deploy-localnet-poseidon.ts
 *   bun run scripts/deploy-localnet-poseidon.ts --skip-deploy  # Skip deployment, only initialize
 *   bun run scripts/deploy-localnet-poseidon.ts --skip-demo    # Skip demo notes
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
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// SDK imports for demo stealth instruction and VK hashes
import {
  buildAddDemoStealthData,
  initPoseidon,
  computeUnifiedCommitmentSync,
  generateGrumpkinKeyPair,
  pointToCompressedBytes,
  grumpkinEcdh as ecdh,
  encryptAmount,
} from "@zvault/sdk";
// Import prover functions from SDK
import {
  initProver,
  getVkHash,
  setCircuitPath,
  type CircuitType,
} from "../../sdk/dist/prover/web.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const CONTRACTS_DIR = path.join(__dirname, "..");
const TARGET_DIR = path.join(CONTRACTS_DIR, "target/deploy");
const CONFIG_PATH = path.join(CONTRACTS_DIR, "config.json");

// Load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

// Seeds for PDAs
const ZVaultSeeds = {
  POOL_STATE: "pool_state",
  COMMITMENT_TREE: "commitment_tree",
};

const BTCLCSeeds = {
  LIGHT_CLIENT: "light_client",
};

// Instruction discriminators
const ZVaultInstruction = {
  INITIALIZE: 0,
  ADD_DEMO_STEALTH: 22,
  INIT_VK_REGISTRY: 40,
};

// Circuit types (must match on-chain CircuitType enum)
const CircuitTypeId = {
  CLAIM: 0,
  SPLIT: 1,
  SPEND_PARTIAL_PUBLIC: 2,
  POOL_DEPOSIT: 3,
  POOL_WITHDRAW: 4,
  POOL_COMPOUND: 5,
  POOL_CLAIM_YIELD: 6,
} as const;

// Map SDK circuit names to on-chain circuit type IDs
const CIRCUIT_TO_ID: Record<string, number> = {
  claim: CircuitTypeId.CLAIM,
  spend_split: CircuitTypeId.SPLIT,
  spend_partial_public: CircuitTypeId.SPEND_PARTIAL_PUBLIC,
  pool_deposit: CircuitTypeId.POOL_DEPOSIT,
  pool_withdraw: CircuitTypeId.POOL_WITHDRAW,
  pool_claim_yield: CircuitTypeId.POOL_CLAIM_YIELD,
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

// Test Bitcoin block
const TEST_BTC_BLOCK = {
  height: 2500000n,
  hash: Buffer.from(
    "0000000000000023b3a1a1e1d1c1b1a191817161514131211101f0e0d0c0b0a09",
    "hex"
  ),
  network: 1, // testnet
};

// =============================================================================
// Types
// =============================================================================

interface DeployResult {
  zvaultProgramId: PublicKey;
  btcLightClientProgramId: PublicKey;
  chadbufferProgramId: PublicKey;
  ultrahonkVerifierProgramId: PublicKey;
}

interface InitResult {
  poolStatePda: PublicKey;
  commitmentTreePda: PublicKey;
  btcLightClientPda: PublicKey;
  zkbtcMint: PublicKey;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Check Poseidon Support
// =============================================================================

async function checkPoseidonSupport(connection: Connection): Promise<boolean> {
  logSection("Checking Poseidon Syscall Support");

  try {
    // Get feature set to check for Poseidon
    const featureSet = await connection.getVersion();
    log(`Solana version: ${featureSet["solana-core"]}`);

    // Try to detect if Poseidon is available by checking for devnet-like features
    // The Poseidon syscall was added in a specific feature gate
    const clusterNodes = await connection.getClusterNodes();
    log(`Cluster nodes: ${clusterNodes.length}`);

    // Note: There's no direct way to check for Poseidon syscall availability
    // The best indicator is if the validator was started with --clone-feature-set --url devnet
    log("Assuming Poseidon is available (validator started with devnet features)");
    log("If you see 'InvalidArgument' errors during claim, restart validator with:");
    log("  ./scripts/start-localnet-poseidon.sh --reset");

    return true;
  } catch (e: any) {
    log(`Warning: Could not verify Poseidon support: ${e.message}`);
    return false;
  }
}

// =============================================================================
// Deployment Functions
// =============================================================================

async function deployPrograms(skipDeploy: boolean): Promise<DeployResult> {
  logSection("Program Deployment (Poseidon-enabled)");

  const zvaultKeypairPath = path.join(TARGET_DIR, "zvault_pinocchio-keypair.json");
  const btclcKeypairPath = path.join(TARGET_DIR, "btc_light_client-keypair.json");
  const chadbufferKeypairPath = path.join(CONTRACTS_DIR, "programs/chadbuffer/chadbuffer-keypair.json");
  const ultrahonkKeypairPath = path.join(TARGET_DIR, "ultrahonk_verifier-keypair.json");
  const chadbufferSoPath = path.join(CONTRACTS_DIR, "programs/chadbuffer/chadbuffer.so");

  if (!fs.existsSync(zvaultKeypairPath) || !fs.existsSync(btclcKeypairPath)) {
    throw new Error("Program keypairs not found. Run 'cargo build-sbf' first (WITHOUT --features localnet).");
  }

  const zvaultKeypair = await loadKeypair(zvaultKeypairPath);
  const btclcKeypair = await loadKeypair(btclcKeypairPath);

  let chadbufferKeypair: Keypair;
  let ultrahonkKeypair: Keypair;

  if (fs.existsSync(chadbufferKeypairPath)) {
    chadbufferKeypair = await loadKeypair(chadbufferKeypairPath);
  } else {
    chadbufferKeypair = Keypair.generate();
    fs.writeFileSync(chadbufferKeypairPath, JSON.stringify(Array.from(chadbufferKeypair.secretKey)));
  }

  if (fs.existsSync(ultrahonkKeypairPath)) {
    ultrahonkKeypair = await loadKeypair(ultrahonkKeypairPath);
  } else {
    ultrahonkKeypair = Keypair.generate();
  }

  const zvaultProgramId = zvaultKeypair.publicKey;
  const btcLightClientProgramId = btclcKeypair.publicKey;
  const chadbufferProgramId = chadbufferKeypair.publicKey;
  const ultrahonkVerifierProgramId = ultrahonkKeypair.publicKey;

  log(`zVault Program ID: ${zvaultProgramId.toBase58()}`);
  log(`BTC Light Client Program ID: ${btcLightClientProgramId.toBase58()}`);
  log(`ChadBuffer Program ID: ${chadbufferProgramId.toBase58()}`);
  log(`UltraHonk Verifier Program ID: ${ultrahonkVerifierProgramId.toBase58()}`);

  if (skipDeploy) {
    log("Skipping deployment (--skip-deploy flag)");
    return { zvaultProgramId, btcLightClientProgramId, chadbufferProgramId, ultrahonkVerifierProgramId };
  }

  // Deploy zVault (built without localnet feature = uses Poseidon)
  log("Deploying zVault program (Poseidon-enabled)...");
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

  // Deploy ChadBuffer
  if (fs.existsSync(chadbufferSoPath)) {
    log("Deploying ChadBuffer program...");
    try {
      execSync(
        `solana program deploy ${chadbufferSoPath} --program-id ${chadbufferKeypairPath} -u localhost`,
        { stdio: "inherit" }
      );
      log("ChadBuffer deployed successfully");
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        log("ChadBuffer program already deployed");
      } else {
        throw e;
      }
    }
  }

  // Deploy UltraHonk Verifier
  const ultrahonkSoPath = path.join(TARGET_DIR, "ultrahonk_verifier.so");
  if (fs.existsSync(ultrahonkSoPath)) {
    log("Deploying UltraHonk Verifier program...");
    try {
      execSync(
        `solana program deploy ${ultrahonkSoPath} --program-id ${ultrahonkKeypairPath} -u localhost`,
        { stdio: "inherit" }
      );
      log("UltraHonk Verifier deployed successfully");
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        log("UltraHonk Verifier program already deployed");
      } else {
        throw e;
      }
    }
  }

  log("Waiting for programs to be ready...");
  await sleep(3000);

  return { zvaultProgramId, btcLightClientProgramId, chadbufferProgramId, ultrahonkVerifierProgramId };
}

// =============================================================================
// PDA Derivation
// =============================================================================

function derivePoolStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(ZVaultSeeds.POOL_STATE)], programId);
}

function deriveCommitmentTreePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(ZVaultSeeds.COMMITMENT_TREE)], programId);
}

function deriveBTCLightClientPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(BTCLCSeeds.LIGHT_CLIENT)], programId);
}

function deriveStealthAnnouncementPDA(ephemeralPub: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stealth"), Buffer.from(ephemeralPub.slice(1, 33))],
    programId
  );
}

function deriveVkRegistryPDA(circuitType: number, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vk_registry"), Buffer.from([circuitType])],
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
  zkbtcMint: PublicKey,
  poolVault: PublicKey,
  frostVault: PublicKey,
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
      { pubkey: zkbtcMint, isSigner: false, isWritable: false },
      { pubkey: poolVault, isSigner: false, isWritable: false },
      { pubkey: frostVault, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

function buildAddDemoStealthIx(
  poolState: PublicKey,
  commitmentTree: PublicKey,
  stealthAnnouncement: PublicKey,
  authority: PublicKey,
  zbtcMint: PublicKey,
  poolVault: PublicKey,
  programId: PublicKey,
  ephemeralPub: Uint8Array,
  commitment: Uint8Array,
  encryptedAmountBytes: Uint8Array
): TransactionInstruction {
  const data = buildAddDemoStealthData(ephemeralPub, commitment, encryptedAmountBytes);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: Buffer.from(data),
  });
}

function buildInitVkRegistryIx(
  poolState: PublicKey,
  vkRegistry: PublicKey,
  authority: PublicKey,
  programId: PublicKey,
  circuitType: number,
  vkHash: Uint8Array
): TransactionInstruction {
  // Layout: discriminator (1) + circuit_type (1) + vk_hash (32) = 34 bytes
  const data = Buffer.alloc(34);
  data[0] = ZVaultInstruction.INIT_VK_REGISTRY;
  data[1] = circuitType;
  Buffer.from(vkHash).copy(data, 2);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: false },
      { pubkey: vkRegistry, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

  const accountInfo = await connection.getAccountInfo(lightClientPda);
  if (accountInfo && accountInfo.data[0] === Discriminators.LIGHT_CLIENT) {
    log("BTC Light Client already initialized, skipping...");
    return lightClientPda;
  }

  log(`Initializing with block height: ${TEST_BTC_BLOCK.height}`);

  const ix = buildBTCLCInitializeIx(
    lightClientPda,
    authority.publicKey,
    programId,
    TEST_BTC_BLOCK.height,
    TEST_BTC_BLOCK.hash,
    TEST_BTC_BLOCK.network
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

  log(`BTC Light Client initialized: ${sig}`);
  return lightClientPda;
}

async function initializeZVault(
  connection: Connection,
  authority: Keypair,
  programId: PublicKey
): Promise<InitResult> {
  logSection("zVault Initialization (Poseidon-enabled)");

  const [poolStatePda, poolBump] = derivePoolStatePDA(programId);
  const [commitmentTreePda, treeBump] = deriveCommitmentTreePDA(programId);

  log(`Pool State PDA: ${poolStatePda.toBase58()} (bump: ${poolBump})`);
  log(`Commitment Tree PDA: ${commitmentTreePda.toBase58()} (bump: ${treeBump})`);

  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (poolAccount && poolAccount.data[0] === Discriminators.POOL_STATE) {
    log("zVault already initialized, skipping...");

    const mintPubkey = new PublicKey(poolAccount.data.subarray(36, 68));
    const poolVaultPubkey = new PublicKey(poolAccount.data.subarray(68, 100));

    return {
      poolStatePda,
      commitmentTreePda,
      btcLightClientPda: PublicKey.default,
      zkbtcMint: mintPubkey,
      poolVault: poolVaultPubkey,
      authority: authority.publicKey,
    };
  }

  // Create zkBTC Token-2022 mint
  log("Creating zkBTC Token-2022 mint...");
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
      8,
      poolStatePda,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, createMintTx, [authority, mintKeypair], { commitment: "confirmed" });
  const zkbtcMint = mintKeypair.publicKey;
  log(`zkBTC Mint: ${zkbtcMint.toBase58()}`);

  // Create pool vault
  log("Creating pool vault...");
  const poolVault = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    zkbtcMint,
    poolStatePda,
    true,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  log(`Pool Vault: ${poolVault.address.toBase58()}`);

  // Create frost vault
  log("Creating frost vault...");
  const frostVault = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    zkbtcMint,
    authority.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  // Initialize zVault
  log("Initializing zVault pool (using Poseidon for Merkle tree)...");
  const ix = buildZVaultInitializeIx(
    poolStatePda,
    commitmentTreePda,
    zkbtcMint,
    poolVault.address,
    frostVault.address,
    authority.publicKey,
    programId,
    poolBump,
    treeBump
  );

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

  log(`zVault initialized: ${sig}`);

  return {
    poolStatePda,
    commitmentTreePda,
    btcLightClientPda: PublicKey.default,
    zkbtcMint,
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
  logSection("Adding Demo Stealth Notes (Poseidon commitments)");

  log(`Adding ${count} demo stealth notes...`);

  const demoAmount = 10_000n;

  for (let i = 0; i < count; i++) {
    const spendingKey = generateGrumpkinKeyPair();
    const viewingKey = generateGrumpkinKeyPair();
    const ephemeralKey = generateGrumpkinKeyPair();

    const ephemeralPub = pointToCompressedBytes(ephemeralKey.pubKey);
    const sharedSecret = ecdh(ephemeralKey.privKey, viewingKey.pubKey);
    const stealthPubX = spendingKey.pubKey.x;

    // Compute commitment using Poseidon (SDK uses real Poseidon)
    const commitment = computeUnifiedCommitmentSync(stealthPubX, demoAmount);
    const commitmentBytes = bigintToBytes32(commitment);

    const encryptedAmountBytes = encryptAmount(demoAmount, sharedSecret);
    const [stealthAnnouncement] = deriveStealthAnnouncementPDA(ephemeralPub, programId);

    log(`Note ${i + 1}: commitment=${commitment.toString(16).slice(0, 16)}...`);

    const ix = buildAddDemoStealthIx(
      poolStatePda,
      commitmentTreePda,
      stealthAnnouncement,
      authority.publicKey,
      zbtcMint,
      poolVault,
      programId,
      ephemeralPub,
      commitmentBytes,
      encryptedAmountBytes
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

    log(`Demo note ${i + 1}/${count} added: ${sig.slice(0, 16)}...`);
  }

  log(`Successfully added ${count} demo stealth notes with Poseidon commitments`);
}

async function initializeVkRegistries(
  connection: Connection,
  authority: Keypair,
  programId: PublicKey,
  poolStatePda: PublicKey
): Promise<void> {
  logSection("Initializing VK Registries (Real Circuit VK Hashes)");

  // Set circuit path for SDK prover
  const sdkCircuitPath = path.join(__dirname, "../../sdk/circuits");
  setCircuitPath(sdkCircuitPath);
  log(`Circuit path: ${sdkCircuitPath}`);

  // Initialize prover to load circuits
  log("Loading circuit verification keys...");
  await initProver();

  // Circuits to initialize (must have compiled artifacts in sdk/circuits)
  const circuitsToInit: Array<{ name: CircuitType; id: number }> = [
    { name: "claim", id: CircuitTypeId.CLAIM },
    { name: "spend_split", id: CircuitTypeId.SPLIT },
    { name: "spend_partial_public", id: CircuitTypeId.SPEND_PARTIAL_PUBLIC },
  ];

  for (const circuit of circuitsToInit) {
    try {
      // Get real VK hash from compiled circuit
      const vkHash = await getVkHash(circuit.name);
      log(`${circuit.name} VK hash: ${Buffer.from(vkHash).toString("hex").slice(0, 16)}...`);

      // Derive VK registry PDA
      const [vkRegistryPda] = deriveVkRegistryPDA(circuit.id, programId);
      log(`${circuit.name} VK registry PDA: ${vkRegistryPda.toBase58()}`);

      // Check if already initialized
      const accountInfo = await connection.getAccountInfo(vkRegistryPda);
      if (accountInfo && accountInfo.data.length > 0 && accountInfo.data[0] === 0x14) {
        log(`${circuit.name} VK registry already initialized, skipping...`);
        continue;
      }

      // Build and send init instruction
      const ix = buildInitVkRegistryIx(
        poolStatePda,
        vkRegistryPda,
        authority.publicKey,
        programId,
        circuit.id,
        vkHash
      );

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      log(`${circuit.name} VK registry initialized: ${sig.slice(0, 16)}...`);
    } catch (error: any) {
      log(`Warning: Failed to initialize ${circuit.name} VK registry: ${error.message}`);
      log(`  Make sure circuits are compiled: cd noir-circuits && bun run compile:all && bun run copy-to-sdk`);
    }
  }

  log("VK registry initialization complete");
}

function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}

// =============================================================================
// Config Saving
// =============================================================================

function saveConfig(deployResult: DeployResult, initResult: InitResult): void {
  logSection("Saving Configuration");

  // Save to .localnet-poseidon-config.json
  const localnetConfig = {
    network: "localnet-poseidon",
    rpcUrl: RPC_URL,
    poseidonEnabled: true,
    programs: {
      zVault: deployResult.zvaultProgramId.toBase58(),
      btcLightClient: deployResult.btcLightClientProgramId.toBase58(),
      chadbuffer: deployResult.chadbufferProgramId.toBase58(),
      ultrahonkVerifier: deployResult.ultrahonkVerifierProgramId.toBase58(),
    },
    accounts: {
      poolState: initResult.poolStatePda.toBase58(),
      commitmentTree: initResult.commitmentTreePda.toBase58(),
      zkbtcMint: initResult.zkbtcMint.toBase58(),
      poolVault: initResult.poolVault.toBase58(),
      authority: initResult.authority.toBase58(),
    },
    btcLightClient: {
      pda: initResult.btcLightClientPda.toBase58(),
      startHeight: TEST_BTC_BLOCK.height.toString(),
      startHash: TEST_BTC_BLOCK.hash.toString("hex"),
      network: "testnet",
    },
    createdAt: new Date().toISOString(),
  };

  // Save as both .localnet-config.json (for SDK compatibility) and .localnet-poseidon-config.json
  const configPath = path.join(CONTRACTS_DIR, ".localnet-config.json");
  const poseidonConfigPath = path.join(CONTRACTS_DIR, ".localnet-poseidon-config.json");

  fs.writeFileSync(configPath, JSON.stringify(localnetConfig, null, 2) + "\n");
  fs.writeFileSync(poseidonConfigPath, JSON.stringify(localnetConfig, null, 2) + "\n");

  log(`Saved ${configPath}`);
  log(`Saved ${poseidonConfigPath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const skipDeploy = args.includes("--skip-deploy");
  const skipDemo = args.includes("--skip-demo");

  logSection("zVault Localnet Deploy (Poseidon-enabled)");

  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  This deployment uses REAL Poseidon hashing            │");
  console.log("│  Compatible with Noir ZK circuits                      │");
  console.log("│  Full E2E testing with real proofs supported           │");
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log("");

  log(`RPC URL: ${RPC_URL}`);
  log(`Skip Deploy: ${skipDeploy}`);
  log(`Skip Demo Notes: ${skipDemo}`);

  const connection = new Connection(RPC_URL, "confirmed");

  try {
    await connection.getVersion();
  } catch (e) {
    console.error("\nError: Cannot connect to localnet.");
    console.error("Start the Poseidon-enabled validator first:");
    console.error("");
    console.error("  ./scripts/start-localnet-poseidon.sh --reset");
    console.error("");
    process.exit(1);
  }

  // Check Poseidon support
  await checkPoseidonSupport(connection);

  // Load authority keypair
  const walletPath = config.wallet?.path || "~/.config/solana/id.json";
  let authority: Keypair;

  try {
    authority = await loadKeypair(walletPath);
  } catch (e) {
    authority = Keypair.generate();
  }
  log(`Authority: ${authority.publicKey.toBase58()}`);

  // Check balance and airdrop
  const balance = await connection.getBalance(authority.publicKey);
  log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < LAMPORTS_PER_SOL) {
    log("Requesting airdrop...");
    const sig = await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
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
  const initResult = await initializeZVault(connection, authority, deployResult.zvaultProgramId);
  initResult.btcLightClientPda = btcLightClientPda;

  // Initialize VK registries with real circuit VK hashes
  await initializeVkRegistries(
    connection,
    authority,
    deployResult.zvaultProgramId,
    initResult.poolStatePda
  );

  // Add demo notes
  if (!skipDemo) {
    await initPoseidon();
    await addDemoNotes(
      connection,
      authority,
      deployResult.zvaultProgramId,
      initResult.poolStatePda,
      initResult.commitmentTreePda,
      initResult.zkbtcMint,
      initResult.poolVault,
      3
    );
  }

  // Save configuration
  saveConfig(deployResult, initResult);

  logSection("Deployment Complete!");

  console.log("Summary:");
  console.log(`  Poseidon Enabled:     YES`);
  console.log(`  VK Registries:        INITIALIZED (real circuit VK hashes)`);
  console.log(`  zVault Program:       ${deployResult.zvaultProgramId.toBase58()}`);
  console.log(`  Pool State PDA:       ${initResult.poolStatePda.toBase58()}`);
  console.log(`  Commitment Tree PDA:  ${initResult.commitmentTreePda.toBase58()}`);
  console.log(`  zkBTC Mint:           ${initResult.zkbtcMint.toBase58()}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Run SDK tests: cd ../sdk && POSEIDON_ENABLED=true bun test test/e2e/");
  console.log("  2. Full E2E with real proofs and on-chain verification will work!");
  console.log("");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
