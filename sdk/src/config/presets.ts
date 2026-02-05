/**
 * ZVault SDK Configuration Presets
 *
 * Predefined network configurations for devnet, mainnet, and localnet.
 * These serve as defaults when creating an SDK instance.
 *
 * @module config/presets
 */

import { address, type Address } from "@solana/kit";
import type { ResolvedConfig, VKHashes } from "../types/config";

// =============================================================================
// Program ID Constants
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
// Default VK Hashes (placeholder zeros)
// =============================================================================

const ZERO_VK_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

const EMPTY_VK_HASHES: VKHashes = {
  claim: ZERO_VK_HASH,
  split: ZERO_VK_HASH,
  spendPartialPublic: ZERO_VK_HASH,
  poolDeposit: ZERO_VK_HASH,
  poolWithdraw: ZERO_VK_HASH,
  poolClaimYield: ZERO_VK_HASH,
  poolCompound: ZERO_VK_HASH,
};

// =============================================================================
// Network Presets
// =============================================================================

/**
 * Devnet Configuration (v2.2.0)
 *
 * Fresh deployment 2026-02-05:
 * - Groth16 via Sunspot CPI (replaced UltraHonk)
 * - No localnet verification skips
 * - Program ID: 3B98dVdvQCLGVavcSz35igiby3ZqVv1SNUBCvDkVGMbq
 */
export const DEVNET_PRESET: ResolvedConfig = {
  network: "devnet",

  // Program IDs (fresh deployment 2026-02-05)
  zvaultProgramId: address("3B98dVdvQCLGVavcSz35igiby3ZqVv1SNUBCvDkVGMbq"),
  btcLightClientProgramId: address("S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn"),
  chadbufferProgramId: CHADBUFFER_PROGRAM_ID,
  token2022ProgramId: TOKEN_2022_PROGRAM_ID,
  ataProgramId: ATA_PROGRAM_ID,

  // Deployed Accounts (fresh deployment 2026-02-05)
  poolStatePda: address("HoSZ1ywBeAEWSNSSzxLNmAs6CodCM4b1Y3rzLGNarffm"),
  commitmentTreePda: address("Exd9HHYjm5MsMpxxCFSKwCUuWBM77BJMA1pnkwHUXBZo"),
  zbtcMint: address("FPXFZ2eMuLJXnBq1JkppggWvaMCPtENiqT7foodeabgy"),
  poolVault: address("7GJruCrMQs97M6exQ8KyPcwqRyndQjSq8tk8HsQY1aoP"),

  // RPC Endpoints
  solanaRpcUrl: "https://api.devnet.solana.com",
  solanaWsUrl: "wss://api.devnet.solana.com",

  // Bitcoin Network
  bitcoinNetwork: "testnet",
  esploraUrl: "https://blockstream.info/testnet/api",

  // Circuit CDN (Sunspot Groth16 artifacts)
  circuitCdnUrl: "https://circuits.amidoggy.xyz",

  // Sunspot Groth16 Verifier
  sunspotVerifierProgramId: address("3Sd1FJPA64zrUrbNQPFcsP7BXp2nu4ow3D1qaeZiwS1Y"),

  // VK Hashes (SHA256 of compiled circuit verification keys)
  // Generated from noir-circuits/target/*.vk files
  vkHashes: {
    claim: "ecdb35295508ab629da18883e0ee5215d45245a2501bd899bf597ec614d92cbb",
    split: "ec636be32affbfbd7d4164ed0f2124c10b044f9977320e3b17e50afd98ab7e80",
    spendPartialPublic: "68d1fa3779d6e8625fe90884a5a6a799c86f838dd24678b0716befcd91983356",
    poolDeposit: "d0031935b97882b2e144534f83ee435de5081e35999d3278dedc239df4ca524e",
    poolWithdraw: "f8da71fa209229f4eb0eec726c9b94b7e6da2b11e37f1c6c0b946a6c4c67d24e",
    poolClaimYield: "1371dcacf34dca75b805d1a427a8f6fd975a9ca088e850bfe085c1de1db852e7",
    poolCompound: ZERO_VK_HASH,
  },
};

/**
 * Mainnet Configuration (placeholder - not yet deployed)
 */
export const MAINNET_PRESET: ResolvedConfig = {
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

  // Sunspot Verifier (placeholder - update when deployed)
  sunspotVerifierProgramId: address("11111111111111111111111111111111"),

  // VK Hashes (placeholder - update when deployed)
  vkHashes: EMPTY_VK_HASHES,
};

/**
 * Localnet Configuration (for local development)
 * Synced with .localnet-config.json (2026-01-30)
 */
export const LOCALNET_PRESET: ResolvedConfig = {
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

  // Sunspot Groth16 Verifier (deployed to localnet)
  sunspotVerifierProgramId: address("3Sd1FJPA64zrUrbNQPFcsP7BXp2nu4ow3D1qaeZiwS1Y"),

  // VK Hashes (use devnet hashes for local testing)
  vkHashes: EMPTY_VK_HASHES,
};

// =============================================================================
// Preset Lookup
// =============================================================================

/**
 * Get preset configuration by network type.
 */
export function getPreset(network: "devnet" | "mainnet" | "localnet"): ResolvedConfig {
  switch (network) {
    case "devnet":
      return DEVNET_PRESET;
    case "mainnet":
      return MAINNET_PRESET;
    case "localnet":
      return LOCALNET_PRESET;
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}
