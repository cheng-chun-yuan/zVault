/**
 * E2E Test Setup
 *
 * Shared setup utilities for E2E tests with solana-test-validator.
 * Provides validator detection, configuration loading, and test utilities.
 *
 * Prerequisites:
 * - solana-test-validator running with devnet features:
 *   solana-test-validator --clone-feature-set --url devnet --reset
 * - Programs deployed to localnet:
 *   cd contracts && bun run deploy:localnet
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import { setConfig, getConfig, LOCALNET_CONFIG, type NetworkConfig } from "../../src/config";
import { initPoseidon } from "../../src/poseidon";
import { initProver, setCircuitPath } from "../../src/prover/web";

// =============================================================================
// Types
// =============================================================================

export interface LocalnetConfig {
  network: string;
  rpcUrl: string;
  programs: {
    zVault: string;
    btcLightClient: string;
    ultrahonkVerifier: string;
    chadbuffer: string;
  };
  accounts: {
    poolState: string;
    commitmentTree: string;
    zkbtcMint: string;
    poolVault: string;
    authority?: string;
  };
  btcLightClient?: {
    pda: string;
    startHeight: string;
    startHash?: string;
    network?: string;
  };
  createdAt?: string;
}

export interface E2ETestContext {
  connection: Connection;
  payer: Keypair;
  config: NetworkConfig;
  localnetConfig: LocalnetConfig;
  skipOnChain: boolean;
}

// =============================================================================
// Constants
// =============================================================================

export const RPC_URL = "http://127.0.0.1:8899";
export const WS_URL = "ws://127.0.0.1:8900";
export const TEST_TIMEOUT = 120_000; // 2 minutes for proof generation
export const MOCK_PROOF_SIZE = 10 * 1024; // 10KB typical UltraHonk proof

const LOCALNET_CONFIG_PATH = path.resolve(
  __dirname,
  "../../../../contracts/.localnet-config.json"
);

const DEFAULT_KEYPAIR_PATH = path.join(
  process.env.HOME || "~",
  ".config/solana/id.json"
);

// =============================================================================
// Validator Detection
// =============================================================================

/**
 * Check if the local validator is running
 */
export async function isValidatorRunning(connection?: Connection): Promise<boolean> {
  const conn = connection || new Connection(RPC_URL, "confirmed");
  try {
    await conn.getVersion();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for validator to be ready with retries
 */
export async function waitForValidator(
  maxRetries: number = 5,
  delayMs: number = 1000
): Promise<boolean> {
  const connection = new Connection(RPC_URL, "confirmed");

  for (let i = 0; i < maxRetries; i++) {
    if (await isValidatorRunning(connection)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load localnet configuration from .localnet-config.json
 */
export function loadLocalnetConfig(): LocalnetConfig | null {
  try {
    if (!fs.existsSync(LOCALNET_CONFIG_PATH)) {
      console.warn(`Localnet config not found at: ${LOCALNET_CONFIG_PATH}`);
      return null;
    }

    const content = fs.readFileSync(LOCALNET_CONFIG_PATH, "utf-8");
    return JSON.parse(content) as LocalnetConfig;
  } catch (error) {
    console.warn(`Failed to load localnet config: ${error}`);
    return null;
  }
}

/**
 * Load or generate a test keypair
 */
export function loadKeypair(keypairPath?: string): Keypair {
  const filePath = keypairPath || DEFAULT_KEYPAIR_PATH;

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const secretKey = new Uint8Array(JSON.parse(content));
      return Keypair.fromSecretKey(secretKey);
    }
  } catch (error) {
    console.warn(`Failed to load keypair from ${filePath}: ${error}`);
  }

  // Generate a new keypair for testing
  console.log("Generating new test keypair...");
  return Keypair.generate();
}

// =============================================================================
// Test Setup
// =============================================================================

/**
 * Request airdrop and wait for confirmation
 */
export async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  lamports: number = 2 * LAMPORTS_PER_SOL
): Promise<string> {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Initialize all required modules for E2E testing
 */
export async function initializeTestEnvironment(): Promise<void> {
  // Set circuit path for prover
  setCircuitPath("./circuits");

  // Initialize Poseidon hasher
  await initPoseidon();

  // Initialize WASM prover
  try {
    await initProver();
  } catch (error) {
    console.warn("Failed to initialize prover (circuits may not be compiled):", error);
  }
}

/**
 * Create a complete E2E test context
 *
 * Returns a context object with all necessary components for E2E testing.
 * Sets skipOnChain=true if validator is not available.
 */
export async function createTestContext(): Promise<E2ETestContext> {
  // Check validator availability
  const validatorRunning = await isValidatorRunning();

  // Load localnet config
  const localnetConfig = loadLocalnetConfig();

  // Set SDK config to localnet
  setConfig("localnet");
  const config = getConfig();

  // Create connection
  const connection = new Connection(RPC_URL, "confirmed");

  // Load or generate payer keypair
  const payer = loadKeypair();

  // Determine if we should skip on-chain tests
  let skipOnChain = !validatorRunning;

  if (validatorRunning && !localnetConfig) {
    console.warn("Validator running but no localnet config found. On-chain tests will be skipped.");
    skipOnChain = true;
  }

  // Try to fund the payer if validator is running
  if (!skipOnChain) {
    try {
      const balance = await connection.getBalance(payer.publicKey);
      if (balance < LAMPORTS_PER_SOL) {
        console.log(`Airdropping 2 SOL to test payer: ${payer.publicKey.toBase58()}`);
        await airdrop(connection, payer.publicKey);
      }
    } catch (error) {
      console.warn("Failed to airdrop to payer:", error);
      skipOnChain = true;
    }
  }

  return {
    connection,
    payer,
    config,
    localnetConfig: localnetConfig || {
      network: "localnet",
      rpcUrl: RPC_URL,
      programs: {
        zVault: LOCALNET_CONFIG.zvaultProgramId.toString(),
        btcLightClient: LOCALNET_CONFIG.btcLightClientProgramId.toString(),
        ultrahonkVerifier: LOCALNET_CONFIG.ultrahonkVerifierProgramId.toString(),
        chadbuffer: LOCALNET_CONFIG.chadbufferProgramId.toString(),
      },
      accounts: {
        poolState: LOCALNET_CONFIG.poolStatePda.toString(),
        commitmentTree: LOCALNET_CONFIG.commitmentTreePda.toString(),
        zkbtcMint: LOCALNET_CONFIG.zbtcMint.toString(),
        poolVault: LOCALNET_CONFIG.poolVault.toString(),
      },
    },
    skipOnChain,
  };
}

/**
 * Log test environment status
 */
export function logTestEnvironment(ctx: E2ETestContext): void {
  console.log("\n" + "=".repeat(60));
  console.log("E2E Test Environment");
  console.log("=".repeat(60));
  console.log(`Network: ${ctx.config.network}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Payer: ${ctx.payer.publicKey.toBase58()}`);
  console.log(`Skip On-Chain Tests: ${ctx.skipOnChain}`);
  console.log(`zVault Program: ${ctx.localnetConfig.programs.zVault}`);
  console.log(`Pool State: ${ctx.localnetConfig.accounts.poolState}`);
  console.log(`Commitment Tree: ${ctx.localnetConfig.accounts.commitmentTree}`);
  console.log("=".repeat(60) + "\n");
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Wait for a transaction to confirm
 */
export async function waitForConfirmation(
  connection: Connection,
  signature: string,
  commitment: "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  await connection.confirmTransaction(signature, commitment);
}

/**
 * Get account data or null if not found
 */
export async function getAccountData(
  connection: Connection,
  pubkey: PublicKey
): Promise<Buffer | null> {
  const info = await connection.getAccountInfo(pubkey);
  return info?.data || null;
}

/**
 * Check if a program is deployed
 */
export async function isProgramDeployed(
  connection: Connection,
  programId: PublicKey
): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(programId);
    return info !== null && info.executable;
  } catch {
    return false;
  }
}
