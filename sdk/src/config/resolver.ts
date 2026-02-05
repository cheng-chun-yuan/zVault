/**
 * ZVault SDK Configuration Resolver
 *
 * Resolves user-provided configuration into a fully populated ResolvedConfig.
 *
 * @module config/resolver
 */

import type { ZVaultSDKConfig, ResolvedConfig, NetworkType } from "../types/config";
import {
  DEVNET_PRESET,
  MAINNET_PRESET,
  LOCALNET_PRESET,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
} from "./presets";

// =============================================================================
// Configuration Resolution
// =============================================================================

/**
 * Resolve user config into a fully populated ResolvedConfig.
 *
 * Resolution order:
 * 1. User-provided values take precedence
 * 2. Network preset provides defaults
 * 3. If no network specified, defaults to devnet
 *
 * @param config - User-provided configuration
 * @returns Fully resolved configuration
 */
export function resolveConfig(config: ZVaultSDKConfig): ResolvedConfig {
  // Determine base preset from network
  const network: NetworkType = config.network ?? "devnet";
  const basePreset = getBasePreset(network);

  // Validate mainnet usage
  if (network === "mainnet") {
    validateMainnetConfig(config);
  }

  // Resolve all fields
  const resolved: ResolvedConfig = {
    network,

    // Program IDs
    zvaultProgramId: config.programId,
    btcLightClientProgramId: config.btcLightClientProgramId ?? basePreset.btcLightClientProgramId,
    chadbufferProgramId: config.chadbufferProgramId ?? basePreset.chadbufferProgramId,
    token2022ProgramId: TOKEN_2022_PROGRAM_ID,
    ataProgramId: ATA_PROGRAM_ID,
    sunspotVerifierProgramId: config.sunspotVerifierProgramId ?? basePreset.sunspotVerifierProgramId,
    sunspotVerifiers: basePreset.sunspotVerifiers,

    // Deployed Accounts - these are program-specific PDAs
    // For custom program IDs, these may need to be re-derived
    // For now, use preset values (user can override via direct SDK access)
    poolStatePda: basePreset.poolStatePda,
    commitmentTreePda: basePreset.commitmentTreePda,
    zbtcMint: basePreset.zbtcMint,
    poolVault: basePreset.poolVault,

    // RPC Endpoints
    solanaRpcUrl: config.rpcUrl ?? basePreset.solanaRpcUrl,
    solanaWsUrl: config.wsUrl ?? basePreset.solanaWsUrl,

    // Bitcoin Network
    bitcoinNetwork: config.bitcoinNetwork ?? basePreset.bitcoinNetwork,
    esploraUrl: config.esploraUrl ?? basePreset.esploraUrl,

    // Circuit CDN
    circuitCdnUrl: config.circuitCdnUrl ?? basePreset.circuitCdnUrl,

    // VK Hashes - merge user overrides with preset
    vkHashes: {
      ...basePreset.vkHashes,
      ...config.vkHashes,
    },
  };

  return resolved;
}

/**
 * Get the base preset for a given network.
 */
function getBasePreset(network: NetworkType): ResolvedConfig {
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

/**
 * Validate mainnet configuration.
 * Mainnet is not yet deployed, so we need to ensure the user provides
 * real program IDs rather than using placeholders.
 */
function validateMainnetConfig(config: ZVaultSDKConfig): void {
  const placeholderAddress = "11111111111111111111111111111111";

  // Check if user is trying to use placeholder mainnet config
  if (config.programId.toString() === placeholderAddress) {
    throw new Error(
      "Cannot use placeholder mainnet configuration. " +
      "Mainnet is not yet deployed. " +
      "Please provide a valid program ID or use 'devnet' or 'localnet'."
    );
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a ResolvedConfig is using devnet preset program ID.
 */
export function isDevnetConfig(config: ResolvedConfig): boolean {
  return config.zvaultProgramId === DEVNET_PRESET.zvaultProgramId;
}

/**
 * Check if a ResolvedConfig is using localnet preset program ID.
 */
export function isLocalnetConfig(config: ResolvedConfig): boolean {
  return config.zvaultProgramId === LOCALNET_PRESET.zvaultProgramId;
}

/**
 * Check if a ResolvedConfig is using a custom program ID.
 */
export function isCustomConfig(config: ResolvedConfig): boolean {
  return !isDevnetConfig(config) && !isLocalnetConfig(config);
}
