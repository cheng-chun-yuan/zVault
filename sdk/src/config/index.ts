/**
 * ZVault SDK Configuration
 *
 * @module config
 */

// Presets
export {
  DEVNET_PRESET,
  MAINNET_PRESET,
  LOCALNET_PRESET,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  CHADBUFFER_PROGRAM_ID,
  LOCALNET_CHADBUFFER_PROGRAM_ID,
  getPreset,
} from "./presets";

// Resolver
export {
  resolveConfig,
  isDevnetConfig,
  isLocalnetConfig,
  isCustomConfig,
} from "./resolver";

// Re-export types
export type {
  ZVaultSDKConfig,
  ResolvedConfig,
  NetworkConfig,
  NetworkType,
  BitcoinNetwork,
  VKHashes,
} from "../types/config";
