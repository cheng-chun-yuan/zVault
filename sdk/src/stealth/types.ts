/**
 * Stealth Address Types
 *
 * All interfaces and type definitions for the stealth address system.
 * EIP-5564/DKSAP pattern implementation.
 */

import type { GrumpkinPoint } from "../crypto";

// ========== Constants ==========

/** StealthAnnouncement account size (91 bytes - single ephemeral key)
 * Layout: 1 (disc) + 1 (bump) + 33 (ephemeral) + 8 (encrypted_amount) + 32 (commitment) + 8 (leaf_idx) + 8 (created_at) */
export const STEALTH_ANNOUNCEMENT_SIZE = 91;

/** Discriminator for StealthAnnouncement */
export const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 0x08;

// ========== Stealth Deposit Types ==========

/**
 * Stealth Deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Uses single Grumpkin ephemeral key for ECDH stealth address derivation.
 *
 * Stealth key derivation:
 * - sharedSecret = ECDH(ephemeral.priv, viewingPub)
 * - stealthPub = spendingPub + hash(sharedSecret) * G
 * - commitment = Poseidon(stealthPub.x, amount)
 * - encryptedAmount = amount XOR sha256(sharedSecret.x)[0..8]
 */
export interface StealthDeposit {
  /** Single Grumpkin ephemeral public key (33 bytes compressed) */
  ephemeralPub: Uint8Array;

  /** Encrypted amount (8 bytes) - XOR with sha256(sharedSecret.x)[0..8]
   * Only recipient with viewing key can decrypt */
  encryptedAmount: Uint8Array;

  /** Commitment for Merkle tree (32 bytes) - Poseidon(stealthPub.x, amount) */
  commitment: Uint8Array;

  /** Unix timestamp when created */
  createdAt: number;
}

// ========== Scanned Note Types ==========

/**
 * Scanned note from announcement (viewing key can detect)
 *
 * Viewing key can compute stealthPub but CANNOT derive stealthPriv.
 */
export interface ScannedNote {
  /** Amount in satoshis (from verified BTC transaction) */
  amount: bigint;

  /** Grumpkin ephemeral public key (needed for shared secret) */
  ephemeralPub: GrumpkinPoint;

  /** Computed stealth public key */
  stealthPub: GrumpkinPoint;

  /** Leaf index in Merkle tree */
  leafIndex: number;

  /** Original announcement commitment */
  commitment: Uint8Array;
}

/**
 * Scanned note from view-only scanning (no spending capability)
 */
export interface ViewOnlyScannedNote {
  /** Decrypted amount in satoshis */
  amount: bigint;
  /** Leaf index in Merkle tree */
  leafIndex: number;
  /** Commitment for verification */
  commitment: Uint8Array;
  /** Ephemeral public key (needed for claiming later) */
  ephemeralPub: Uint8Array;
}

// ========== Claim Input Types ==========

/**
 * Prepared claim inputs for ZK proof (requires spending key)
 *
 * Uses EIP-5564/DKSAP stealth key derivation:
 * - stealthPriv = spendingPriv + hash(sharedSecret)
 * - nullifier = Poseidon(stealthPriv, leafIndex)
 */
export interface ClaimInputs {
  // Private inputs for ZK proof
  stealthPrivKey: bigint;
  amount: bigint;
  leafIndex: number;
  merklePath: bigint[];
  merkleIndices: number[];

  // Public inputs
  merkleRoot: bigint;
  nullifier: bigint;
  amountPub: bigint;
}

// ========== On-chain Types ==========

/**
 * Parsed stealth announcement from on-chain data
 *
 * Note: encryptedAmount can only be decrypted by the recipient using their viewing key.
 * Use scanAnnouncements() to automatically decrypt and verify.
 */
export interface OnChainStealthAnnouncement {
  ephemeralPub: Uint8Array;
  /** Encrypted amount (8 bytes) - decrypt with viewing key via scanAnnouncements() */
  encryptedAmount: Uint8Array;
  commitment: Uint8Array;
  leafIndex: number;
  createdAt: number;
}

// ========== View-Only Keys ==========

/**
 * View-only keys for scanning without spending capability
 *
 * Use this for portfolio trackers, watch-only wallets, or delegated viewing.
 */
export interface ViewOnlyKeys {
  /** Viewing private key (Grumpkin scalar) - for ECDH */
  viewingPrivKey: bigint;
  /** Spending public key (Grumpkin point) - for stealth derivation */
  spendingPubKey: GrumpkinPoint;
}

// ========== Stealth Output Types ==========

/**
 * Stealth output data for creating StealthAnnouncement on-chain
 *
 * Used when creating change outputs from spend operations.
 */
export interface StealthOutputData {
  /** Grumpkin ephemeral public key (33 bytes compressed) */
  ephemeralPub: Uint8Array;
  /** XOR encrypted amount (8 bytes) */
  encryptedAmount: Uint8Array;
  /** Commitment = Poseidon(stealthPub.x, amount) */
  commitment: Uint8Array;
}

/**
 * Extended stealth output data including the derived stealth pub key
 *
 * Used for passing correct pub key to circuit inputs. The circuit expects
 * the stealth-derived pub key X coordinate, not the raw spending pub key.
 */
export interface StealthOutputWithKeys extends StealthOutputData {
  /** Derived stealth public key x-coordinate (for circuit input) */
  stealthPubKeyX: bigint;
}

/**
 * Circuit-ready stealth output data
 *
 * Used for spend_split and spend_partial_public circuit inputs.
 * Contains the ephemeral pubkey x-coordinate and packed encrypted amount with y_sign.
 */
export interface CircuitStealthOutput {
  /** Ephemeral pubkey x-coordinate (Field element) */
  ephemeralPubX: bigint;
  /** Packed: bits 0-63 = encrypted amount, bit 64 = y_sign */
  encryptedAmountWithSign: bigint;
}

// ========== Connection Adapter ==========

import type { Address } from "@solana/kit";

/**
 * Minimal connection adapter for name registry lookups
 *
 * Works with @solana/kit RPC clients and custom implementations
 */
export interface ConnectionAdapter {
  getAccountInfo: (
    pubkey: Address
  ) => Promise<{ data: Uint8Array } | null>;
}

// ========== Announcement Format for Scanning ==========

/**
 * Announcement format expected by scanAnnouncements
 */
export interface AnnouncementScanFormat {
  ephemeralPub: Uint8Array;
  encryptedAmount: Uint8Array;
  commitment: Uint8Array;
  leafIndex: number;
}
