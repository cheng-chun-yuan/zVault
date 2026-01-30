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

  // -------------------------------------------------------------------------
  // UltraHonk Verifier (Client-side ZK)
  // -------------------------------------------------------------------------

  /** UltraHonk verifier program ID (browser proof generation via bb.js) */
  ultrahonkVerifierProgramId: Address;

  // -------------------------------------------------------------------------
  // VK Hashes (for CPI verification)
  // -------------------------------------------------------------------------

  /** VK hashes for each circuit type (32 bytes each, hex-encoded) */
  vkHashes: {
    claim: string;
    split: string;
    spendPartialPublic: string;
    poolDeposit: string;
    poolWithdraw: string;
    poolClaimYield: string;
    poolCompound: string;
  };
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
 * Devnet Configuration (v1.0.4)
 *
 * Current deployment as of 2025-01-30:
 * - Fresh clean deployment for demo
 * - New program IDs and accounts
 */
export const DEVNET_CONFIG: NetworkConfig = {
  network: "devnet",

  // Program IDs
  zvaultProgramId: address("AorrjgAcJFHzAXcCTejhJT9p93HHMqYLLqZ4NKKE8nsv"),
  btcLightClientProgramId: address("S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts
  poolStatePda: address("6w44R8FZhX4F7akWL6UXZr13K2Q9pGmyDiAoTXfxgR7i"),
  commitmentTreePda: address("43b5j5HEwHkDP35CX78KwszKX2rFdkQQfTA1JG6bzyS4"),
  zbtcMint: address("2LmCSgq5jTtfnHe5YF6Sii6Pyc33xrPLJAYjtHhsCDPi"),
  poolVault: address("DKpjj5ygnJwGZfXMWrZaPf3ZdxtxSgvHg2Kk8HhGhdXV"),

  // RPC Endpoints
  solanaRpcUrl: "https://api.devnet.solana.com",
  solanaWsUrl: "wss://api.devnet.solana.com",

  // Bitcoin Network
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN (UltraHonk artifacts: .json, .vk files)
  circuitCdnUrl: "https://circuits.amidoggy.xyz",

  // UltraHonk Verifier (browser proof generation via bb.js)
  ultrahonkVerifierProgramId: address("5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd"),

  // VK Hashes (to be updated with actual hashes from compiled circuits)
  vkHashes: {
    claim: "0000000000000000000000000000000000000000000000000000000000000000",
    split: "0000000000000000000000000000000000000000000000000000000000000000",
    spendPartialPublic: "0000000000000000000000000000000000000000000000000000000000000000",
    poolDeposit: "0000000000000000000000000000000000000000000000000000000000000000",
    poolWithdraw: "0000000000000000000000000000000000000000000000000000000000000000",
    poolClaimYield: "0000000000000000000000000000000000000000000000000000000000000000",
    poolCompound: "0000000000000000000000000000000000000000000000000000000000000000",
  },
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

  // UltraHonk Verifier (placeholder)
  ultrahonkVerifierProgramId: address("11111111111111111111111111111111"),

  // VK Hashes (placeholder - update when deployed)
  vkHashes: {
    claim: "0000000000000000000000000000000000000000000000000000000000000000",
    split: "0000000000000000000000000000000000000000000000000000000000000000",
    spendPartialPublic: "0000000000000000000000000000000000000000000000000000000000000000",
    poolDeposit: "0000000000000000000000000000000000000000000000000000000000000000",
    poolWithdraw: "0000000000000000000000000000000000000000000000000000000000000000",
    poolClaimYield: "0000000000000000000000000000000000000000000000000000000000000000",
    poolCompound: "0000000000000000000000000000000000000000000000000000000000000000",
  },
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

  // UltraHonk Verifier (use devnet for local testing)
  ultrahonkVerifierProgramId: address("5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd"),

  // VK Hashes (use devnet hashes for local testing)
  vkHashes: {
    claim: "0000000000000000000000000000000000000000000000000000000000000000",
    split: "0000000000000000000000000000000000000000000000000000000000000000",
    spendPartialPublic: "0000000000000000000000000000000000000000000000000000000000000000",
    poolDeposit: "0000000000000000000000000000000000000000000000000000000000000000",
    poolWithdraw: "0000000000000000000000000000000000000000000000000000000000000000",
    poolClaimYield: "0000000000000000000000000000000000000000000000000000000000000000",
    poolCompound: "0000000000000000000000000000000000000000000000000000000000000000",
  },
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
 * @throws Error if mainnet is selected (not yet deployed)
 */
export function setConfig(network: NetworkType | NetworkConfig): void {
  if (typeof network === "string") {
    switch (network) {
      case "devnet":
        currentConfig = DEVNET_CONFIG;
        break;
      case "mainnet":
        throw new Error(
          "Mainnet is not yet deployed. " +
          "zVault is currently available on devnet only. " +
          "Use setConfig('devnet') or wait for mainnet deployment announcement."
        );
      case "localnet":
        currentConfig = LOCALNET_CONFIG;
        break;
      default:
        throw new Error(`Unknown network: ${network}`);
    }
  } else {
    // Check if custom config is using placeholder mainnet addresses
    if (network.network === "mainnet" && network.zvaultProgramId === MAINNET_CONFIG.zvaultProgramId) {
      throw new Error(
        "Cannot use placeholder mainnet configuration. " +
        "Mainnet is not yet deployed."
      );
    }
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

export const SDK_VERSION = "1.6.0";

export const DEPLOYMENT_INFO = {
  version: SDK_VERSION,
  deployedAt: "2025-01-30",
  network: "devnet" as NetworkType,
  features: [
    "demo-stealth",
    "name-registry",
    "stealth-addresses",
    "reverse-lookup",
    "ultrahonk-browser-proving",
  ],
  notes: "Client-side UltraHonk proof generation via bb.js",
};
