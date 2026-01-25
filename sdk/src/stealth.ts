/**
 * Stealth address utilities for ZVault
 *
 * EIP-5564/DKSAP Pattern (Single Ephemeral Grumpkin Key):
 *
 * Stealth Deposit Flow:
 * ```
 * Sender:
 *   1. ephemeral = random Grumpkin keypair
 *   2. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 *   3. stealthPub = spendingPub + hash(sharedSecret) * G
 *   4. commitment = Poseidon2(stealthPub.x, amount)
 *
 * Recipient (viewing key - can detect):
 *   1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 *   2. stealthPub = spendingPub + hash(sharedSecret) * G
 *   3. Verify: commitment == Poseidon2(stealthPub.x, amount)
 *
 * Recipient (spending key - can claim):
 *   1. stealthPriv = spendingPriv + hash(sharedSecret)
 *   2. nullifier = Poseidon2(stealthPriv, leafIndex)
 * ```
 *
 * Format (98 bytes on-chain):
 * - ephemeral_pub (33 bytes) - Single Grumpkin key for ECDH
 * - amount_sats (8 bytes) - Verified BTC amount from SPV proof
 * - commitment (32 bytes) - Poseidon2 hash for Merkle tree
 * - leaf_index (8 bytes) - Position in Merkle tree
 * - created_at (8 bytes) - Timestamp
 *
 * Security Properties:
 * - Viewing key can detect deposits but CANNOT derive stealthPriv (ECDLP)
 * - Spending key required for stealthPriv and nullifier derivation
 * - Single ephemeral key is standard (EIP-5564, Umbra, Railgun pattern)
 */

// ========== Constants (defined before imports to ensure availability) ==========

/** StealthAnnouncement account size (98 bytes - single ephemeral key) */
export const STEALTH_ANNOUNCEMENT_SIZE = 98;

/** Discriminator for StealthAnnouncement */
export const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 0x08;

// ========== Imports ==========

import { sha256 } from "@noble/hashes/sha256";
import { bigintToBytes, bytesToBigint, BN254_FIELD_PRIME } from "./crypto";
import {
  generateKeyPair as generateGrumpkinKeyPair,
  ecdh as grumpkinEcdh,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  scalarFromBytes,
  scalarToBytes,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_ORDER,
  type GrumpkinPoint,
} from "./grumpkin";
import type { StealthMetaAddress, ZVaultKeys, WalletSignerAdapter } from "./keys";
import { deriveKeysFromWallet, parseStealthMetaAddress } from "./keys";
import {
  poseidon2Hash,
  computeCommitment as poseidon2ComputeCommitment,
  computeNullifier as poseidon2ComputeNullifier,
} from "./poseidon2";

// ========== Type Guard ==========

/**
 * Type guard to distinguish between WalletSignerAdapter and ZVaultKeys
 */
export function isWalletAdapter(source: unknown): source is WalletSignerAdapter {
  return (
    typeof source === "object" &&
    source !== null &&
    "signMessage" in source &&
    typeof (source as WalletSignerAdapter).signMessage === "function"
  );
}

// ========== Types ==========

/**
 * Stealth Deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Uses single Grumpkin ephemeral key for ECDH stealth address derivation.
 *
 * Stealth key derivation:
 * - sharedSecret = ECDH(ephemeral.priv, viewingPub)
 * - stealthPub = spendingPub + hash(sharedSecret) * G
 * - commitment = Poseidon2(stealthPub.x, amount)
 */
export interface StealthDeposit {
  /** Single Grumpkin ephemeral public key (33 bytes compressed) */
  ephemeralPub: Uint8Array;

  /** Amount in satoshis (stored directly - no encryption needed) */
  amountSats: bigint;

  /** Commitment for Merkle tree (32 bytes) - Poseidon2(stealthPub.x, amount) */
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
 * - nullifier = Poseidon2(stealthPriv, leafIndex)
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

// ========== On-chain Announcement ==========

/**
 * Size of StealthAnnouncement account on-chain (single ephemeral key)
 *
 * Layout (98 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - amount_sats (8 bytes) - verified from BTC tx
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * SAVINGS: 33 bytes from previous dual-key format (131 → 98)
 */

/**
 * Parsed stealth announcement from on-chain data
 */
export interface OnChainStealthAnnouncement {
  ephemeralPub: Uint8Array;
  amountSats: bigint;
  commitment: Uint8Array;
  leafIndex: number;
  createdAt: number;
}

// ========== Helper Functions ==========

/**
 * Domain separator for stealth key derivation
 */
const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-stealth-v1");

/**
 * Derive stealth scalar from shared secret (EIP-5564 pattern)
 *
 * stealthScalar = hash(sharedSecret || domain) mod order
 */
function deriveStealthScalar(sharedSecret: GrumpkinPoint): bigint {
  // Serialize shared secret point
  const sharedBytes = pointToCompressedBytes(sharedSecret);

  // Hash with domain separator
  const hashInput = new Uint8Array(sharedBytes.length + STEALTH_KEY_DOMAIN.length);
  hashInput.set(sharedBytes, 0);
  hashInput.set(STEALTH_KEY_DOMAIN, sharedBytes.length);

  const hash = sha256(hashInput);
  return scalarFromBytes(hash);
}

/**
 * Derive stealth public key (EIP-5564 pattern)
 *
 * stealthPub = spendingPub + hash(sharedSecret) * G
 */
function deriveStealthPubKey(
  spendingPub: GrumpkinPoint,
  sharedSecret: GrumpkinPoint
): GrumpkinPoint {
  const scalar = deriveStealthScalar(sharedSecret);
  const scalarPoint = pointMul(scalar, GRUMPKIN_GENERATOR);
  return pointAdd(spendingPub, scalarPoint);
}

/**
 * Derive stealth private key (EIP-5564 pattern)
 *
 * stealthPriv = spendingPriv + hash(sharedSecret)
 */
function deriveStealthPrivKey(
  spendingPriv: bigint,
  sharedSecret: GrumpkinPoint
): bigint {
  const scalar = deriveStealthScalar(sharedSecret);
  // Add scalars modulo curve order
  return (spendingPriv + scalar) % GRUMPKIN_ORDER;
}

// ========== Sender Functions ==========

/**
 * Create a stealth deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Generates ONE ephemeral Grumpkin keypair and derives stealth address:
 * 1. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. commitment = Poseidon2(stealthPub.x, amount)
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export async function createStealthDeposit(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthDeposit> {
  // Parse recipient's public keys (both Grumpkin now)
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate single ephemeral Grumpkin keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key (for recipient scanning)
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key (EIP-5564 pattern)
  // stealthPub = spendingPub + hash(sharedSecret) * G
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute commitment using Poseidon2
  // commitment = Poseidon2(stealthPub.x, amount)
  const commitmentBigint = poseidon2Hash([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    amountSats,
    commitment,
    createdAt: Date.now(),
  };
}

// ========== Recipient Scanning (Viewing Key Only) ==========

/**
 * Scan announcements using viewing key only (EIP-5564/DKSAP pattern)
 *
 * For each announcement, computes:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. Verifies: commitment == Poseidon2(stealthPub.x, amount)
 *
 * This function can DETECT deposits but CANNOT:
 * - Derive stealthPriv (requires spending key)
 * - Generate nullifier or spending proofs
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes (ready for claim preparation)
 */
export async function scanAnnouncements(
  source: WalletSignerAdapter | ZVaultKeys,
  announcements: {
    ephemeralPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
  }[]
): Promise<ScannedNote[]> {
  // Get keys from source
  const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;

  const found: ScannedNote[] = [];
  const MAX_SATS = 21_000_000n * 100_000_000n; // 21M BTC in sats

  for (const ann of announcements) {
    try {
      // Basic sanity check on amount
      if (ann.amountSats <= 0n || ann.amountSats > MAX_SATS) {
        continue;
      }

      // Parse ephemeral pubkey
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, ephemeralPub);

      // Derive stealth public key
      const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

      // Verify commitment matches
      const expectedCommitment = poseidon2Hash([stealthPub.x, ann.amountSats]);
      const actualCommitment = bytesToBigint(ann.commitment);

      if (expectedCommitment !== actualCommitment) {
        // Not for us - commitment doesn't match
        continue;
      }

      // This announcement is for us!
      found.push({
        amount: ann.amountSats,
        ephemeralPub,
        stealthPub,
        leafIndex: ann.leafIndex,
        commitment: ann.commitment,
      });
    } catch {
      // Parsing failed - skip this announcement
      continue;
    }
  }

  return found;
}

// ========== Claim Preparation (Spending Key Required) ==========

/**
 * Prepare claim inputs for ZK proof generation (EIP-5564/DKSAP pattern)
 *
 * CRITICAL: This function requires the spending private key.
 *
 * Derivation:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)  [already computed in scanning]
 * 2. stealthPriv = spendingPriv + hash(sharedSecret)
 * 3. nullifier = Poseidon2(stealthPriv, leafIndex)
 *
 * Why sender cannot claim:
 * - Sender knows ephemeralPriv and can compute sharedSecret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Cannot derive stealthPriv without spendingPrivKey (ECDLP)
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param note - Scanned note from scanning phase
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir claim circuit
 */
export async function prepareClaimInputs(
  source: WalletSignerAdapter | ZVaultKeys,
  note: ScannedNote,
  merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
  }
): Promise<ClaimInputs> {
  // Get keys from source
  const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;

  // Recompute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, note.ephemeralPub);

  // Derive stealth private key (EIP-5564 pattern)
  // stealthPriv = spendingPriv + hash(sharedSecret)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // Verify stealth public key matches (sanity check)
  const expectedStealthPub = pointMul(stealthPrivKey, GRUMPKIN_GENERATOR);
  if (expectedStealthPub.x !== note.stealthPub.x || expectedStealthPub.y !== note.stealthPub.y) {
    throw new Error(
      "Stealth key mismatch - this note may not belong to you or the announcement is invalid"
    );
  }

  // CRITICAL: Nullifier from stealth private key + leaf index
  // nullifier = Poseidon2(stealthPriv, leafIndex)
  // Only recipient can compute this!
  const nullifier = poseidon2ComputeNullifier(stealthPrivKey, BigInt(note.leafIndex));

  return {
    // Private inputs
    stealthPrivKey,
    amount: note.amount,
    leafIndex: note.leafIndex,
    merklePath: merkleProof.pathElements,
    merkleIndices: merkleProof.pathIndices,

    // Public inputs
    merkleRoot: merkleProof.root,
    nullifier,
    amountPub: note.amount,
  };
}

// ========== On-chain Parsing ==========

/**
 * Parse a StealthAnnouncement account data (single ephemeral key)
 *
 * Layout (98 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - amount_sats (8 bytes) - verified BTC amount
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 */
export function parseStealthAnnouncement(
  data: Uint8Array
): OnChainStealthAnnouncement | null {
  if (data.length < STEALTH_ANNOUNCEMENT_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== STEALTH_ANNOUNCEMENT_DISCRIMINATOR) {
    return null;
  }

  let offset = 2; // Skip discriminator and bump

  const ephemeralPub = data.slice(offset, offset + 33);
  offset += 33;

  // Parse amount_sats (8 bytes, LE)
  const amountView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const amountSats = amountView.getBigUint64(0, true);
  offset += 8;

  const commitment = data.slice(offset, offset + 32);
  offset += 32;

  // Parse leaf_index (8 bytes, LE)
  const leafIndexView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const leafIndex = Number(leafIndexView.getBigUint64(0, true));
  offset += 8;

  // Parse created_at (8 bytes, LE)
  const createdAtView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const createdAt = Number(createdAtView.getBigInt64(0, true));

  return {
    ephemeralPub,
    amountSats,
    commitment,
    leafIndex,
    createdAt,
  };
}

/**
 * Convert on-chain announcement to format expected by scanAnnouncements
 */
export function announcementToScanFormat(
  announcement: OnChainStealthAnnouncement
): {
  ephemeralPub: Uint8Array;
  amountSats: bigint;
  commitment: Uint8Array;
  leafIndex: number;
} {
  return {
    ephemeralPub: announcement.ephemeralPub,
    amountSats: announcement.amountSats,
    commitment: announcement.commitment,
    leafIndex: announcement.leafIndex,
  };
}
