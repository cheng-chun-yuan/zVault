/**
 * Stealth Types
 *
 * Type definitions for stealth operations in zVault.
 * Based on EIP-5564/DKSAP pattern.
 *
 * @module types/stealth
 */

import type { GrumpkinPoint } from "../crypto";

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
 * Prepared claim inputs for ZK proof (requires spending key)
 *
 * Uses EIP-5564/DKSAP stealth key derivation:
 * - stealthPriv = spendingPriv + hash(sharedSecret)
 * - nullifier = Poseidon(stealthPriv, leafIndex)
 */
export interface StealthClaimInputs {
  /** Stealth private key */
  stealthPrivKey: bigint;
  /** Amount in satoshis */
  amount: bigint;
  /** Leaf index in Merkle tree */
  leafIndex: number;
  /** Merkle proof path elements */
  merklePath: bigint[];
  /** Merkle path indices */
  merkleIndices: number[];
  /** Merkle root */
  merkleRoot: bigint;
  /** Computed nullifier */
  nullifier: bigint;
  /** Public amount */
  amountPub: bigint;
}

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
