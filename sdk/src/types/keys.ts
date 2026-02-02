/**
 * Key Types
 *
 * Type definitions for cryptographic keys in zVault.
 * Based on EIP-5564/DKSAP dual-key system.
 *
 * @module types/keys
 */

import type { GrumpkinPoint } from "../crypto";

// ==========================================================================
// Core Key Types
// ==========================================================================

/**
 * Complete zVault key hierarchy derived from Solana wallet
 *
 * Uses dual Grumpkin keys (EIP-5564/DKSAP pattern):
 * - Spending key: For stealthPriv derivation and nullifier generation
 * - Viewing key: For ECDH-based scanning (can detect but cannot spend)
 */
export interface ZVaultKeys {
  /** Solana public key (32 bytes) - user identity */
  solanaPublicKey: Uint8Array;

  /** Grumpkin spending private key (scalar) - for stealthPriv and nullifier */
  spendingPrivKey: bigint;

  /** Grumpkin spending public key (point) - share publicly */
  spendingPubKey: GrumpkinPoint;

  /** Grumpkin viewing private key (scalar) - for ECDH scanning */
  viewingPrivKey: bigint;

  /** Grumpkin viewing public key (point) - share publicly */
  viewingPubKey: GrumpkinPoint;
}

/**
 * Stealth meta-address for receiving funds (EIP-5564/DKSAP pattern)
 *
 * This is what users share publicly to receive private payments.
 * Both keys are Grumpkin points for consistent cryptography.
 *
 * Total size: 66 bytes (33 + 33 compressed)
 */
export interface StealthMetaAddress {
  /** Grumpkin spending public key (33 bytes compressed) */
  spendingPubKey: Uint8Array;

  /** Grumpkin viewing public key (33 bytes compressed) */
  viewingPubKey: Uint8Array;
}

/**
 * Serialized stealth meta-address for display/sharing
 */
export interface SerializedStealthMetaAddress {
  /** Hex-encoded spending public key */
  spendingPubKey: string;

  /** Hex-encoded viewing public key */
  viewingPubKey: string;
}

// ==========================================================================
// Viewing Key Types
// ==========================================================================

/**
 * View permission flags for delegated viewing keys
 */
export enum ViewPermissions {
  /** Can scan announcements and see amounts */
  SCAN = 1 << 0,

  /** Can see full transaction history */
  HISTORY = 1 << 1,

  /** Can see incoming transactions only */
  INCOMING_ONLY = 1 << 2,

  /** Full viewing access (scan + history) */
  FULL = SCAN | HISTORY,
}

/**
 * Delegated viewing key for auditors/compliance
 *
 * Uses Grumpkin scalar for viewing key (matches EIP-5564/DKSAP pattern)
 */
export interface DelegatedViewKey {
  /** Grumpkin viewing private key (scalar) */
  viewingPrivKey: bigint;

  /** Permission flags */
  permissions: ViewPermissions;

  /** Optional expiration timestamp (Unix ms) */
  expiresAt?: number;

  /** Optional label for identification */
  label?: string;
}

// ==========================================================================
// Wallet Adapter Interface
// ==========================================================================

/**
 * Minimal wallet adapter interface for signing
 * Compatible with @solana/wallet-adapter-base
 */
export interface WalletSignerAdapter {
  publicKey: { toBytes(): Uint8Array } | null;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

// ==========================================================================
// View-Only Bundle
// ==========================================================================

/**
 * View-only key bundle (no spending key)
 * Safe to export/backup separately from spending key
 */
export interface ViewOnlyKeyBundle {
  solanaPublicKey: Uint8Array;
  spendingPubKey: Uint8Array;
  viewingPrivKey: bigint;
  viewingPubKey: Uint8Array;
}
