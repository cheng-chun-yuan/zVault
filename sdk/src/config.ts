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
  // Backend Services (Optional - for custom deployments)
  // -------------------------------------------------------------------------

  /** Backend API URL (deposit tracking, redemption) */
  backendApiUrl?: string;

  /** Header relayer service URL */
  headerRelayerUrl?: string;

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

/** ChadBuffer Program ID (deployed to devnet 2025-01-30) */
export const CHADBUFFER_PROGRAM_ID: Address = address(
  "C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF"
);

/** ChadBuffer Program ID for localnet testing */
export const LOCALNET_CHADBUFFER_PROGRAM_ID: Address = address(
  "EgWyMVFZewHmjJ9GGvVBTyaC376Xp7qu7CAFjWYPYYDv"
);

// =============================================================================
// Network Configurations
// =============================================================================

/**
 * Devnet Configuration (v2.1.0)
 *
 * Fresh deployment 2026-02-02:
 * - Simplified instruction format (no proof_source byte for split/partial-public)
 * - Instruction introspection pattern for verifier
 * - Program ID: GqdjVMBDmFEd6wSV4TzRsvnVWnE4pMMdhVo8U4iXvYUX
 */
export const DEVNET_CONFIG: NetworkConfig = {
  network: "devnet",

  // Program IDs (fresh deployment 2026-02-02)
  zvaultProgramId: address("GqdjVMBDmFEd6wSV4TzRsvnVWnE4pMMdhVo8U4iXvYUX"),
  btcLightClientProgramId: address("S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts (fresh deployment 2026-02-02)
  poolStatePda: address("Bq8FTMnpyspkygAr3yN6tU8dzDhD5Ag19oVN3xXwy3gg"),
  commitmentTreePda: address("M4hjajsFJU98xdx6ZtLuzgVPUKP6TTKXjfFpBiNE272"),
  zbtcMint: address("AUuocP2KQVkUnt8pFtBx5CHpDargEPQNeq29hwtQoxFY"),
  poolVault: address("5VCCporx5wvF2y8W97o55r1FiEb4pxp6RLRJMm3wQ1Ck"),

  // RPC Endpoints
  solanaRpcUrl: "https://api.devnet.solana.com",
  solanaWsUrl: "wss://api.devnet.solana.com",

  // Bitcoin Network
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN (UltraHonk artifacts: .json, .vk files)
  circuitCdnUrl: "https://circuits.amidoggy.xyz",

  // Backend Services
  backendApiUrl: "https://api.zvault.io",
  headerRelayerUrl: "https://relay.zvault.io",

  // UltraHonk Verifier (browser proof generation via bb.js)
  ultrahonkVerifierProgramId: address("5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd"),

  // VK Hashes (SHA256 of compiled circuit verification keys)
  // Generated from noir-circuits/target/*.vk files
  vkHashes: {
    claim: "ecdb35295508ab629da18883e0ee5215d45245a2501bd899bf597ec614d92cbb",
    split: "ec636be32affbfbd7d4164ed0f2124c10b044f9977320e3b17e50afd98ab7e80",
    spendPartialPublic: "68d1fa3779d6e8625fe90884a5a6a799c86f838dd24678b0716befcd91983356",
    poolDeposit: "d0031935b97882b2e144534f83ee435de5081e35999d3278dedc239df4ca524e",
    poolWithdraw: "f8da71fa209229f4eb0eec726c9b94b7e6da2b11e37f1c6c0b946a6c4c67d24e",
    poolClaimYield: "1371dcacf34dca75b805d1a427a8f6fd975a9ca088e850bfe085c1de1db852e7",
    poolCompound: "0000000000000000000000000000000000000000000000000000000000000000", // Not compiled yet
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

  // Backend Services
  backendApiUrl: "https://api.zvault.io",
  headerRelayerUrl: "https://relay.zvault.io",

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
 * Synced with .localnet-config.json (2026-01-30)
 */
export const LOCALNET_CONFIG: NetworkConfig = {
  network: "localnet",

  // Program IDs (synced with .localnet-config.json)
  zvaultProgramId: address("zKeyrLmpT8W9o8iRvhizuSihLAFLhfAGBvfM638Pbw8"),
  btcLightClientProgramId: address("S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn"),
  chadbufferProgramId: LOCALNET_CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts (synced with .localnet-config.json 2026-01-30)
  poolStatePda: address("ELGSdquznDBd6uUkWsBAmguMBmtuur7D5kapwoyZq44J"),
  commitmentTreePda: address("5p7WERgzB6AHcga19QehvaTfbiVoM1Bg6drkwzYHYamq"),
  zbtcMint: address("GU5DQFtz48SkSaLyHnL5fq7LN8MNiz9X5ujuLw7gjP2J"),
  poolVault: address("C9e9SiHUCXBE4QQYJs7rhExJL1xUjkPb4sXJXz7wMDwi"),

  // RPC Endpoints
  solanaRpcUrl: "http://127.0.0.1:8899",
  solanaWsUrl: "ws://127.0.0.1:8900",

  // Bitcoin Network (use testnet for local dev)
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN (use local files for development)
  circuitCdnUrl: "/circuits",

  // Backend Services (local development)
  backendApiUrl: "http://127.0.0.1:3001",
  headerRelayerUrl: "http://127.0.0.1:3002",

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

/** Default zVault program ID (from current config) - Hurb4hZa5FR3VFMyDnrrVcHfVrDXHEazR7rX91PB42Ly */
export const ZVAULT_PROGRAM_ID: Address = DEVNET_CONFIG.zvaultProgramId;

/** Default BTC Light Client program ID (from current config) */
export const BTC_LIGHT_CLIENT_PROGRAM_ID: Address = DEVNET_CONFIG.btcLightClientProgramId;

// =============================================================================
// Backend Service URLs
// =============================================================================

/** Default backend API URL */
const DEFAULT_BACKEND_API_URL = "https://api.zvault.io";

/** Default header relayer URL */
const DEFAULT_HEADER_RELAYER_URL = "https://relay.zvault.io";

/**
 * Get the backend API URL from current config
 * Falls back to default if not configured
 */
export function getBackendApiUrl(): string {
  return currentConfig.backendApiUrl ?? DEFAULT_BACKEND_API_URL;
}

/**
 * Get the header relayer URL from current config
 * Falls back to default if not configured
 */
export function getHeaderRelayerUrl(): string {
  return currentConfig.headerRelayerUrl ?? DEFAULT_HEADER_RELAYER_URL;
}

// =============================================================================
// Version Info
// =============================================================================

export const SDK_VERSION = "2.0.4";

export const DEPLOYMENT_INFO = {
  version: SDK_VERSION,
  deployedAt: "2026-02-02",
  network: "devnet" as NetworkType,
  features: [
    "demo-stealth",
    "name-registry",
    "stealth-addresses",
    "reverse-lookup",
    "ultrahonk-browser-proving",
    "configurable-backend-urls",
  ],
  notes: "Client-side UltraHonk proof generation via bb.js. Configurable backend/relayer URLs.",
};
