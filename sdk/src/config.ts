/**
 * ZVault SDK Configuration
 *
 * Centralized configuration for all network-specific addresses, endpoints, and settings.
 * This is the SINGLE SOURCE OF TRUTH for all on-chain addresses and configuration.
 *
 * When deploying to a new network or updating addresses:
 * 1. Update the relevant network config below
 * 2. Bump SDK version
 * 3. Publish to npm
 *
 * @module config
 */

import { address, type Address } from "@solana/kit";

// =============================================================================
// Network Types
// =============================================================================

export type NetworkType = "devnet" | "mainnet" | "localnet";

export interface NetworkConfig {
  /** Network identifier */
  network: NetworkType;

  // -------------------------------------------------------------------------
  // Program IDs
  // -------------------------------------------------------------------------

  /** zVault main program ID */
  zvaultProgramId: Address;

  /** BTC Light Client program ID */
  btcLightClientProgramId: Address;

  /** ChadBuffer program ID (for SPV verification) */
  chadbufferProgramId: Address;

  /** Token-2022 program ID */
  token2022ProgramId: Address;

  /** Associated Token Account program ID */
  ataProgramId: Address;

  // -------------------------------------------------------------------------
  // Deployed Accounts (PDAs and Mints)
  // -------------------------------------------------------------------------

  /** Pool State PDA address */
  poolStatePda: Address;

  /** Commitment Tree PDA address */
  commitmentTreePda: Address;

  /** zBTC Mint address (Token-2022) */
  zbtcMint: Address;

  /** Pool Vault (ATA for pool holding zBTC) */
  poolVault: Address;

  // -------------------------------------------------------------------------
  // RPC Endpoints
  // -------------------------------------------------------------------------

  /** Solana RPC endpoint */
  solanaRpcUrl: string;

  /** Solana WebSocket endpoint */
  solanaWsUrl: string;

  // -------------------------------------------------------------------------
  // Bitcoin Network
  // -------------------------------------------------------------------------

  /** Bitcoin network (testnet3, mainnet) */
  bitcoinNetwork: "testnet" | "mainnet";

  /** Esplora API endpoint */
  esploraUrl: string;

  // -------------------------------------------------------------------------
  // Circuit CDN
  // -------------------------------------------------------------------------

  /** Base URL for circuit artifacts */
  circuitCdnUrl: string;
}

// =============================================================================
// Program IDs (Constants)
// =============================================================================

/** Token-2022 Program ID */
export const TOKEN_2022_PROGRAM_ID: Address = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Associated Token Account Program ID */
export const ATA_PROGRAM_ID: Address = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** ChadBuffer Program ID (immutable) */
export const CHADBUFFER_PROGRAM_ID: Address = address(
  "CHADLCyF9jJLvTp4rJe9PMSPG8x8B2KSJsXJmBaG6yCZ"
);

// =============================================================================
// Network Configurations
// =============================================================================

/**
 * Devnet Configuration (v1.0.2)
 *
 * Current deployment as of 2025-01-29:
 * - Contract rebuilt with `devnet` feature
 * - Mint authority transferred to pool PDA
 * - Demo stealth deposit working
 */
export const DEVNET_CONFIG: NetworkConfig = {
  network: "devnet",

  // Program IDs
  zvaultProgramId: address("DjnryiDxMsUY8pzYCgynVUGDgv45J9b3XbSDnp4qDYrq"),
  btcLightClientProgramId: address("AvXLG43quQpc9aaE1fUxXdd1UFVBCMBkX9vFgjZSShrn"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts
  poolStatePda: address("ASgByRooB2piAA7qAeERvPCFS1sqjzShdx1hXGg35TUq"),
  commitmentTreePda: address("2M5F53Z9Pd7sYFiWaDKfpwYvPan1g44bV7D2sAeaVtHP"),
  zbtcMint: address("BdUFQhqKpzYVHVg8cQoh7JdpSoHFtwKM4A48AFAjKFAK"),
  poolVault: address("HNe2SvmQzHPHzRcLwfp1vQVwJq9ELeMZ3dJSbKyMkNdD"),

  // RPC Endpoints
  solanaRpcUrl: "https://api.devnet.solana.com",
  solanaWsUrl: "wss://api.devnet.solana.com",

  // Bitcoin Network
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN
  circuitCdnUrl: "https://cdn.jsdelivr.net/npm/@zvault/sdk@latest/circuits",
};

/**
 * Mainnet Configuration (placeholder - not yet deployed)
 */
export const MAINNET_CONFIG: NetworkConfig = {
  network: "mainnet",

  // Program IDs (placeholder - update when deployed)
  zvaultProgramId: address("11111111111111111111111111111111"),
  btcLightClientProgramId: address("11111111111111111111111111111111"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts (placeholder - update when deployed)
  poolStatePda: address("11111111111111111111111111111111"),
  commitmentTreePda: address("11111111111111111111111111111111"),
  zbtcMint: address("11111111111111111111111111111111"),
  poolVault: address("11111111111111111111111111111111"),

  // RPC Endpoints
  solanaRpcUrl: "https://api.mainnet-beta.solana.com",
  solanaWsUrl: "wss://api.mainnet-beta.solana.com",

  // Bitcoin Network
  bitcoinNetwork: "mainnet",
  esploraUrl: "https://blockstream.info/api",

  // Circuit CDN
  circuitCdnUrl: "https://cdn.jsdelivr.net/npm/@zvault/sdk@latest/circuits",
};

/**
 * Localnet Configuration (for local development)
 */
export const LOCALNET_CONFIG: NetworkConfig = {
  network: "localnet",

  // Program IDs (will be set dynamically during local deploy)
  zvaultProgramId: address("DjnryiDxMsUY8pzYCgynVUGDgv45J9b3XbSDnp4qDYrq"),
  btcLightClientProgramId: address("AvXLG43quQpc9aaE1fUxXdd1UFVBCMBkX9vFgjZSShrn"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts (derived from local deploy)
  poolStatePda: address("ASgByRooB2piAA7qAeERvPCFS1sqjzShdx1hXGg35TUq"),
  commitmentTreePda: address("2M5F53Z9Pd7sYFiWaDKfpwYvPan1g44bV7D2sAeaVtHP"),
  zbtcMint: address("BdUFQhqKpzYVHVg8cQoh7JdpSoHFtwKM4A48AFAjKFAK"),
  poolVault: address("HNe2SvmQzHPHzRcLwfp1vQVwJq9ELeMZ3dJSbKyMkNdD"),

  // RPC Endpoints
  solanaRpcUrl: "http://127.0.0.1:8899",
  solanaWsUrl: "ws://127.0.0.1:8900",

  // Bitcoin Network (use testnet for local dev)
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN (use local files for development)
  circuitCdnUrl: "/circuits",
};

// =============================================================================
// Default Configuration
// =============================================================================

/** Current active configuration (defaults to devnet) */
let currentConfig: NetworkConfig = DEVNET_CONFIG;

/**
 * Get the current network configuration
 */
export function getConfig(): NetworkConfig {
  return currentConfig;
}

/**
 * Set the network configuration
 *
 * @param network - Network type or custom config
 */
export function setConfig(network: NetworkType | NetworkConfig): void {
  if (typeof network === "string") {
    switch (network) {
      case "devnet":
        currentConfig = DEVNET_CONFIG;
        break;
      case "mainnet":
        currentConfig = MAINNET_CONFIG;
        break;
      case "localnet":
        currentConfig = LOCALNET_CONFIG;
        break;
      default:
        throw new Error(`Unknown network: ${network}`);
    }
  } else {
    currentConfig = network;
  }
}

/**
 * Create a custom configuration by overriding specific values
 *
 * @param base - Base configuration to extend
 * @param overrides - Values to override
 */
export function createConfig(
  base: NetworkConfig,
  overrides: Partial<NetworkConfig>
): NetworkConfig {
  return { ...base, ...overrides };
}

// =============================================================================
// Convenience Exports (for backwards compatibility)
// =============================================================================

/** Default zVault program ID (from current config) */
export const ZVAULT_PROGRAM_ID: Address = DEVNET_CONFIG.zvaultProgramId;

/** Default BTC Light Client program ID (from current config) */
export const BTC_LIGHT_CLIENT_PROGRAM_ID: Address = DEVNET_CONFIG.btcLightClientProgramId;

// =============================================================================
// Version Info
// =============================================================================

export const SDK_VERSION = "1.0.3";

export const DEPLOYMENT_INFO = {
  version: SDK_VERSION,
  deployedAt: "2025-01-29",
  network: "devnet" as NetworkType,
  features: ["demo-stealth", "name-registry", "stealth-addresses"],
  notes: "Contract rebuilt with devnet feature, mint authority transferred to pool PDA",
};
