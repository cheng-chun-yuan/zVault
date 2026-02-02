/**
 * ZVault SDK Configuration Types
 *
 * Defines the configuration interfaces for instance-based SDK initialization.
 *
 * @module types/config
 */

import type { Address } from "@solana/kit";

// =============================================================================
// Network Types
// =============================================================================

export type NetworkType = "devnet" | "mainnet" | "localnet";

export type BitcoinNetwork = "testnet" | "mainnet";

// =============================================================================
// User-Facing Configuration (Input)
// =============================================================================

/**
 * SDK Configuration provided by the user.
 *
 * Only `programId` is required. All other fields have sensible defaults
 * based on the selected network.
 *
 * @example
 * ```typescript
 * const config: ZVaultSDKConfig = {
 *   programId: "YourProgramId...",
 *   network: "devnet",
 *   rpcUrl: "https://custom-rpc.example.com",
 * };
 * ```
 */
export interface ZVaultSDKConfig {
  /** zVault program ID (required) */
  programId: Address;

  /** Network type - determines default endpoints and settings */
  network?: NetworkType;

  /** Custom Solana RPC endpoint */
  rpcUrl?: string;

  /** Custom Solana WebSocket endpoint */
  wsUrl?: string;

  /** Base URL for circuit artifacts (compiled Noir circuits) */
  circuitCdnUrl?: string;

  /** Bitcoin network (testnet or mainnet) */
  bitcoinNetwork?: BitcoinNetwork;

  /** Esplora API endpoint for Bitcoin data */
  esploraUrl?: string;

  // -------------------------------------------------------------------------
  // Program IDs (optional overrides)
  // -------------------------------------------------------------------------

  /** BTC Light Client program ID */
  btcLightClientProgramId?: Address;

  /** ChadBuffer program ID (for large proof uploads) */
  chadbufferProgramId?: Address;

  /** UltraHonk verifier program ID */
  ultrahonkVerifierProgramId?: Address;

  // -------------------------------------------------------------------------
  // VK Hashes (optional overrides)
  // -------------------------------------------------------------------------

  /** VK hashes for each circuit type (SHA256 of verification keys) */
  vkHashes?: Partial<VKHashes>;
}

// =============================================================================
// Resolved Configuration (Internal)
// =============================================================================

/**
 * VK (Verification Key) hashes for each circuit type.
 * These are SHA256 hashes of the compiled circuit verification keys.
 */
export interface VKHashes {
  claim: string;
  split: string;
  spendPartialPublic: string;
  poolDeposit: string;
  poolWithdraw: string;
  poolClaimYield: string;
  poolCompound: string;
}

/**
 * Fully resolved SDK configuration.
 *
 * All optional fields from ZVaultSDKConfig are resolved to concrete values
 * based on network defaults or user overrides.
 */
export interface ResolvedConfig {
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

  /** UltraHonk verifier program ID */
  ultrahonkVerifierProgramId: Address;

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

  /** Bitcoin network (testnet, mainnet) */
  bitcoinNetwork: BitcoinNetwork;

  /** Esplora API endpoint */
  esploraUrl: string;

  // -------------------------------------------------------------------------
  // Circuit CDN
  // -------------------------------------------------------------------------

  /** Base URL for circuit artifacts */
  circuitCdnUrl: string;

  // -------------------------------------------------------------------------
  // VK Hashes
  // -------------------------------------------------------------------------

  /** VK hashes for each circuit type (32 bytes each, hex-encoded) */
  vkHashes: VKHashes;
}

// =============================================================================
// Legacy NetworkConfig (for backwards compatibility)
// =============================================================================

/**
 * Legacy NetworkConfig interface.
 * @deprecated Use ZVaultSDKConfig and ResolvedConfig instead.
 */
export interface NetworkConfig extends ResolvedConfig {}
