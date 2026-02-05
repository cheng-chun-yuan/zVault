/**
 * ZVault SDK Configuration
 *
 * Centralized configuration for all network-specific addresses, endpoints, and settings.
 * This is the SINGLE SOURCE OF TRUTH for all on-chain addresses and configuration.
 *
 * NOTE: This module provides backward-compatible global config functions.
 * For new code, use the instance-based SDK via createZVaultSDK().
 *
 * @module config
 */

import type { Address } from "@solana/kit";

// Re-export presets for backwards compatibility
export {
  DEVNET_PRESET as DEVNET_CONFIG,
  MAINNET_PRESET as MAINNET_CONFIG,
  LOCALNET_PRESET as LOCALNET_CONFIG,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  CHADBUFFER_PROGRAM_ID,
  LOCALNET_CHADBUFFER_PROGRAM_ID,
} from "./config/presets";

// Re-export types
export type {
  NetworkType,
  NetworkConfig,
  ResolvedConfig,
  ZVaultSDKConfig,
  VKHashes,
  BitcoinNetwork,
  SunspotVerifiers,
} from "./types/config";

// Import presets for use in this module
import {
  DEVNET_PRESET,
  MAINNET_PRESET,
  LOCALNET_PRESET,
} from "./config/presets";

import type { NetworkConfig, NetworkType } from "./types/config";

// =============================================================================
// Global Configuration State (Legacy API)
// =============================================================================

/** Current active configuration (defaults to devnet) */
let currentConfig: NetworkConfig = DEVNET_PRESET;

/**
 * Get the current network configuration
 * @deprecated Use createZVaultSDK() for instance-based configuration
 */
export function getConfig(): NetworkConfig {
  return currentConfig;
}

/**
 * Set the network configuration
 *
 * @deprecated Use createZVaultSDK() for instance-based configuration
 * @param network - Network type or custom config
 * @throws Error if mainnet is selected (not yet deployed)
 */
export function setConfig(network: NetworkType | NetworkConfig): void {
  if (typeof network === "string") {
    switch (network) {
      case "devnet":
        currentConfig = DEVNET_PRESET;
        break;
      case "mainnet":
        throw new Error(
          "Mainnet is not yet deployed. " +
          "zVault is currently available on devnet only. " +
          "Use setConfig('devnet') or wait for mainnet deployment announcement."
        );
      case "localnet":
        currentConfig = LOCALNET_PRESET;
        break;
      default:
        throw new Error(`Unknown network: ${network}`);
    }
  } else {
    // Check if custom config is using placeholder mainnet addresses
    if (network.network === "mainnet" && network.zvaultProgramId === MAINNET_PRESET.zvaultProgramId) {
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
 * @deprecated Use createZVaultSDK() with config overrides
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

/** Default zVault program ID (from devnet config) */
export const ZVAULT_PROGRAM_ID: Address = DEVNET_PRESET.zvaultProgramId;

/** Default BTC Light Client program ID (from devnet config) */
export const BTC_LIGHT_CLIENT_PROGRAM_ID: Address = DEVNET_PRESET.btcLightClientProgramId;

// =============================================================================
// Version Info
// =============================================================================

export const SDK_VERSION = "2.1.0";

export const DEPLOYMENT_INFO = {
  version: SDK_VERSION,
  deployedAt: "2026-02-02",
  network: "devnet" as NetworkType,
  features: [
    "instance-based-sdk",
    "demo-stealth",
    "name-registry",
    "stealth-addresses",
    "reverse-lookup",
    "groth16-sunspot-proving",
  ],
  notes: "Instance-based SDK with namespaced methods. Client-side Groth16 proof generation via Sunspot",
};
