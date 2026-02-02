/**
 * Note Types
 *
 * Type definitions for notes (shielded commitments) in zVault.
 *
 * @module types/note
 */

/**
 * Note structure for shielded amounts
 *
 * Core secrets (always required):
 * - amount, nullifier, secret
 *
 * Computed values (from Noir circuits):
 * - note, commitment, nullifierHash
 * These are 0n until computed by circuits
 */
export interface Note {
  /** Amount in satoshis */
  amount: bigint;
  /** Random nullifier (field element) */
  nullifier: bigint;
  /** Random secret (field element) */
  secret: bigint;
  /** note = Poseidon(nullifier, secret) - computed by circuit */
  note: bigint;
  /** commitment = Poseidon(note, amount) - computed by circuit */
  commitment: bigint;
  /** nullifierHash = Poseidon(nullifier) - computed by circuit */
  nullifierHash: bigint;
  /** 32-byte representations */
  nullifierBytes: Uint8Array;
  secretBytes: Uint8Array;
  commitmentBytes: Uint8Array;
  nullifierHashBytes: Uint8Array;
}

/**
 * Serializable note data (for storage/transmission)
 * Only stores essential secrets - hashes recomputed by circuits
 */
export interface SerializedNote {
  amount: string;
  nullifier: string;
  secret: string;
  /** Optional pre-computed commitment */
  commitment?: string;
  /** Optional pre-computed nullifier hash */
  nullifierHash?: string;
}

/**
 * Simple note data structure (for Noir circuit inputs)
 *
 * NOTE: When using Noir circuits, the commitment is computed INSIDE the circuit
 * using Poseidon. The SDK just provides the raw note data.
 */
export interface NoteData {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
}

/**
 * Stealth note structure for dual-key ECDH system
 *
 * Key differences from basic Note:
 * - Uses random value instead of nullifier/secret for commitment
 * - Stores ephemeral spending pubkey for proof generation
 * - Nullifier derived from (spendingPrivKey, leafIndex) in circuit
 */
export interface StealthNote {
  /** Amount in satoshis */
  amount: bigint;

  /** Random value for commitment */
  random: bigint;

  /** Ephemeral Grumpkin spending public key (from sender) */
  ephemeralSpendPubX: bigint;
  ephemeralSpendPubY: bigint;

  /** Leaf index in Merkle tree (set when commitment added on-chain) */
  leafIndex: number;

  /** Note public key = Poseidon(ECDHShared.x, ECDHShared.y) */
  notePubKey: bigint;

  /** Commitment = Poseidon(notePubKey, amount, random) */
  commitment: bigint;

  /** Byte representations */
  randomBytes: Uint8Array;
  commitmentBytes: Uint8Array;
}

/**
 * Serializable stealth note data
 */
export interface SerializedStealthNote {
  amount: string;
  random: string;
  ephemeralSpendPubX: string;
  ephemeralSpendPubY: string;
  leafIndex: number;
  notePubKey?: string;
  commitment?: string;
}
