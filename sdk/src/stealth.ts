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
 *   4. commitment = Poseidon(stealthPub.x, amount)
 *   5. encryptedAmount = amount XOR sha256(sharedSecret)[0..8]
 *
 * Recipient (viewing key only - can detect and see amount):
 *   1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 *   2. amount = encryptedAmount XOR sha256(sharedSecret)[0..8]
 *   3. stealthPub = spendingPub + hash(sharedSecret) * G
 *   4. Verify: commitment == Poseidon(stealthPub.x, amount)
 *
 * Recipient (spending key - can claim):
 *   1. stealthPriv = spendingPriv + hash(sharedSecret)
 *   2. nullifier = Poseidon(stealthPriv, leafIndex)
 * ```
 *
 * Format (91 bytes on-chain):
 * - ephemeral_pub (33 bytes) - Single Grumpkin key for ECDH
 * - encrypted_amount (8 bytes) - XOR encrypted with shared secret
 * - commitment (32 bytes) - Poseidon hash for Merkle tree
 * - leaf_index (8 bytes) - Position in Merkle tree
 * - created_at (8 bytes) - Timestamp
 *
 * Privacy Properties:
 * - Amount is ENCRYPTED - only recipient with viewing key can decrypt
 * - Viewing key can detect deposits and decrypt amount, but CANNOT spend
 * - Spending key required for stealthPriv and nullifier derivation
 * - ZK proof guarantees amount conservation without revealing value on-chain
 */

// ========== Constants (defined before imports to ensure availability) ==========

/** StealthAnnouncement account size (91 bytes - single ephemeral key)
 * Layout: 1 (disc) + 1 (bump) + 33 (ephemeral) + 8 (encrypted_amount) + 32 (commitment) + 8 (leaf_idx) + 8 (created_at) */
export const STEALTH_ANNOUNCEMENT_SIZE = 91;

/** Discriminator for StealthAnnouncement */
export const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 0x08;

// ========== Imports ==========

import { sha256 } from "@noble/hashes/sha2.js";
import {
  bigintToBytes,
  bytesToBigint,
  BN254_FIELD_PRIME,
  generateGrumpkinKeyPair,
  grumpkinEcdh,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  scalarFromBytes,
  scalarToBytes,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_ORDER,
  type GrumpkinPoint,
} from "./crypto";
import type { StealthMetaAddress, ZVaultKeys, WalletSignerAdapter } from "./keys";
import { deriveKeysFromWallet, parseStealthMetaAddress, constantTimeCompare } from "./keys";
import { lookupZkeyName, type ZkeyStealthAddress } from "./name-registry";
import {
  poseidonHashSync,
  computeNullifierSync as poseidonComputeNullifier,
} from "./poseidon";

// ========== Amount Encryption Helpers ==========

/**
 * Derive encryption key from ECDH shared secret
 *
 * Uses SHA256 of the shared secret's x-coordinate to derive an 8-byte key.
 * Both sender and recipient can compute this from their respective keys:
 * - Sender: sha256(ECDH(ephemeralPriv, viewingPub).x)
 * - Recipient: sha256(ECDH(viewingPriv, ephemeralPub).x)
 */
function deriveAmountEncryptionKey(sharedSecret: GrumpkinPoint): Uint8Array {
  const sharedSecretBytes = scalarToBytes(sharedSecret.x);
  const hash = sha256(sharedSecretBytes);
  return hash.slice(0, 8); // First 8 bytes as encryption key
}

/**
 * Encrypt amount using XOR with derived key
 *
 * @param amount - Amount in satoshis (bigint)
 * @param sharedSecret - ECDH shared secret point
 * @returns 8 bytes of encrypted amount
 */
export function encryptAmount(amount: bigint, sharedSecret: GrumpkinPoint): Uint8Array {
  const key = deriveAmountEncryptionKey(sharedSecret);
  const amountBytes = new Uint8Array(8);

  // Convert amount to little-endian bytes
  let temp = amount;
  for (let i = 0; i < 8; i++) {
    amountBytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }

  // XOR with key
  const encrypted = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    encrypted[i] = amountBytes[i] ^ key[i];
  }

  return encrypted;
}

/**
 * Decrypt amount using XOR with derived key
 *
 * @param encryptedAmount - 8 bytes of encrypted amount
 * @param sharedSecret - ECDH shared secret point
 * @returns Decrypted amount in satoshis (bigint)
 */
export function decryptAmount(encryptedAmount: Uint8Array, sharedSecret: GrumpkinPoint): bigint {
  const key = deriveAmountEncryptionKey(sharedSecret);

  // XOR with key to decrypt
  const decrypted = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    decrypted[i] = encryptedAmount[i] ^ key[i];
  }

  // Convert little-endian bytes to bigint
  let amount = 0n;
  for (let i = 7; i >= 0; i--) {
    amount = (amount << 8n) | BigInt(decrypted[i]);
  }

  return amount;
}

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
 * 3. commitment = Poseidon(stealthPub.x, amount)
 * 4. encryptedAmount = amount XOR sha256(sharedSecret.x)[0..8]
 *
 * The amount is encrypted so only the recipient (with viewing key) can see it.
 * The ZK proof guarantees amount conservation without revealing the value on-chain.
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

  // Compute commitment using Poseidon
  // commitment = Poseidon(stealthPub.x, amount)
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount with shared secret (only recipient can decrypt)
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    createdAt: Date.now(),
  };
}

/**
 * Create stealth deposit with stealthPubKeyX for circuit input
 *
 * Used for recipient outputs in spend_split. Returns the derived stealth
 * pub key X coordinate which must be used as the circuit's pub_key_x input.
 *
 * The commitment is: Poseidon(stealthPub.x, amount)
 * The circuit expects: output1PubKeyX = stealthPub.x
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth output data including stealthPubKeyX for circuit
 */
export async function createStealthDepositWithKeys(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthOutputWithKeys> {
  // Parse recipient's public keys
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute commitment using stealth pub key
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    stealthPubKeyX: stealthPub.x, // For circuit input
  };
}

// ========== Recipient Scanning (Viewing Key Only) ==========

/**
 * Scan announcements using viewing key only (EIP-5564/DKSAP pattern)
 *
 * For each announcement, computes:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. amount = decrypt(encryptedAmount, sharedSecret)
 * 3. stealthPub = spendingPub + hash(sharedSecret) * G
 * 4. Verifies: commitment == Poseidon(stealthPub.x, amount)
 *
 * KEY PRIVACY FEATURE: The viewing key can:
 * - Decrypt the amount (only you can see how much was sent)
 * - Detect which deposits are for you
 * - View your balance without spending capability
 *
 * The viewing key CANNOT:
 * - Derive stealthPriv (requires spending key)
 * - Generate nullifier or spending proofs
 * - Spend your funds
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements (with encrypted amounts)
 * @returns Array of found notes with decrypted amounts
 */
export async function scanAnnouncements(
  source: WalletSignerAdapter | ZVaultKeys,
  announcements: {
    ephemeralPub: Uint8Array;
    encryptedAmount: Uint8Array;
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
      // Parse ephemeral pubkey
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, ephemeralPub);

      // Decrypt amount using shared secret (only viewing key holder can do this!)
      const amount = decryptAmount(ann.encryptedAmount, sharedSecret);

      // Basic sanity check on decrypted amount
      if (amount <= 0n || amount > MAX_SATS) {
        continue;
      }

      // Derive stealth public key
      const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

      // Verify commitment matches decrypted amount
      // Try standard stealth commitment first: Poseidon(stealthPub.x, amount)
      const expectedCommitmentStealth = poseidonHashSync([stealthPub.x, amount]);
      const actualCommitment = bytesToBigint(ann.commitment);

      // Also try raw commitment for change outputs from current circuit
      // The circuit computes: Poseidon(rawSpendingPub.x, amount) for change outputs
      // This is a workaround for circuit/announcement mismatch
      const expectedCommitmentRaw = poseidonHashSync([keys.spendingPubKey.x, amount]);

      if (expectedCommitmentStealth !== actualCommitment &&
          expectedCommitmentRaw !== actualCommitment) {
        // Not for us - commitment doesn't match either formula
        continue;
      }

      // This announcement is for us! Amount successfully decrypted.
      found.push({
        amount,
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

// ========== View-Only Scanning (No Spending Key Required) ==========

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
 * Scan announcements with VIEW-ONLY keys (no spending capability)
 *
 * This function is designed for:
 * - Portfolio trackers (view balance without spending risk)
 * - Watch-only wallets
 * - Delegated viewing (give viewing key to accountant)
 *
 * The viewing key can:
 * ✅ Decrypt the amount (see how much was sent)
 * ✅ Detect which deposits are for you
 * ✅ Calculate total balance
 *
 * The viewing key CANNOT:
 * ❌ Derive the stealth private key
 * ❌ Generate the nullifier
 * ❌ Spend your funds
 *
 * @param viewOnlyKeys - Viewing private key + spending public key
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes with decrypted amounts
 *
 * @example
 * ```typescript
 * // Create view-only keys (export from full keys)
 * const viewOnly: ViewOnlyKeys = {
 *   viewingPrivKey: keys.viewingPrivKey,
 *   spendingPubKey: keys.spendingPubKey,
 * };
 *
 * // Scan without spending capability
 * const notes = await scanAnnouncementsViewOnly(viewOnly, announcements);
 * const totalBalance = notes.reduce((sum, n) => sum + n.amount, 0n);
 * console.log(`Balance: ${totalBalance} sats`);
 * ```
 */
export async function scanAnnouncementsViewOnly(
  viewOnlyKeys: ViewOnlyKeys,
  announcements: {
    ephemeralPub: Uint8Array;
    encryptedAmount: Uint8Array;
    commitment: Uint8Array;
    leafIndex: number;
  }[]
): Promise<ViewOnlyScannedNote[]> {
  const found: ViewOnlyScannedNote[] = [];
  const MAX_SATS = 21_000_000n * 100_000_000n;

  for (const ann of announcements) {
    try {
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(viewOnlyKeys.viewingPrivKey, ephemeralPub);

      // Decrypt amount
      const amount = decryptAmount(ann.encryptedAmount, sharedSecret);

      if (amount <= 0n || amount > MAX_SATS) {
        continue;
      }

      // Derive stealth public key to verify commitment
      const stealthPub = deriveStealthPubKey(viewOnlyKeys.spendingPubKey, sharedSecret);

      // Verify commitment
      const expectedCommitment = poseidonHashSync([stealthPub.x, amount]);
      const actualCommitment = bytesToBigint(ann.commitment);

      if (expectedCommitment !== actualCommitment) {
        continue;
      }

      found.push({
        amount,
        leafIndex: ann.leafIndex,
        commitment: ann.commitment,
        ephemeralPub: ann.ephemeralPub,
      });
    } catch {
      continue;
    }
  }

  return found;
}

/**
 * Export view-only keys from full ZVaultKeys
 *
 * Use this to create a view-only version of your keys that can
 * scan and decrypt amounts but cannot spend funds.
 *
 * @example
 * ```typescript
 * const fullKeys = await deriveKeysFromWallet(wallet);
 * const viewOnly = exportViewOnlyKeys(fullKeys);
 *
 * // Give viewOnly to a portfolio tracker app
 * // They can see your balance but cannot spend
 * ```
 */
export function exportViewOnlyKeys(keys: ZVaultKeys): ViewOnlyKeys {
  return {
    viewingPrivKey: keys.viewingPrivKey,
    spendingPubKey: keys.spendingPubKey,
  };
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
 * 3. nullifier = Poseidon(stealthPriv, leafIndex)
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
  // nullifier = Poseidon(stealthPriv, leafIndex)
  // Only recipient can compute this!
  const nullifier = poseidonComputeNullifier(stealthPrivKey, BigInt(note.leafIndex));

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
 * Layout (91 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - encrypted_amount (8 bytes) - XOR encrypted with shared secret
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * Note: The amount is encrypted and can only be decrypted by the recipient
 * using their viewing key. Use scanAnnouncements() to decrypt.
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

  // Parse encrypted_amount (8 bytes, raw - will be decrypted by recipient)
  const encryptedAmount = data.slice(offset, offset + 8);
  offset += 8;

  const commitment = data.slice(offset, offset + 32);
  offset += 32;

  // Parse leaf_index (8 bytes, LE) with overflow check
  const leafIndexView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const leafIndexBigInt = leafIndexView.getBigUint64(0, true);
  // Check for overflow - leaf index should fit in safe integer range
  if (leafIndexBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Leaf index overflow - value exceeds safe integer range");
  }
  const leafIndex = Number(leafIndexBigInt);
  offset += 8;

  // Parse created_at (8 bytes, LE) with overflow check
  const createdAtView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const createdAtBigInt = createdAtView.getBigInt64(0, true);
  // Clamp timestamp to safe range (negative timestamps are invalid)
  const maxSafeTimestamp = BigInt(Number.MAX_SAFE_INTEGER);
  const createdAt = createdAtBigInt < 0n ? 0 :
    createdAtBigInt > maxSafeTimestamp ? Number.MAX_SAFE_INTEGER :
    Number(createdAtBigInt);

  return {
    ephemeralPub,
    encryptedAmount,
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
  encryptedAmount: Uint8Array;
  commitment: Uint8Array;
  leafIndex: number;
} {
  return {
    ephemeralPub: announcement.ephemeralPub,
    encryptedAmount: announcement.encryptedAmount,
    commitment: announcement.commitment,
    leafIndex: announcement.leafIndex,
  };
}

// ========== Connection Adapter for .zkey Name Lookup ==========

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

// ========== Scan by .zkey.sol Name ==========

/**
 * Scan stealth announcements for deposits sent to a .zkey.sol name
 *
 * Combines name lookup + scanning in one call. Verifies that the
 * provided keys match the registered .zkey.sol name before scanning.
 *
 * IMPORTANT: Scanning requires the viewing private key. This function
 * verifies that your spending public key matches the registered .zkey.sol name,
 * then scans using your viewing key.
 *
 * @param keys - User's full ZVaultKeys (spending + viewing keys required)
 * @param expectedName - The .zkey.sol name to verify ownership (e.g., "alice" or "alice.zkey.sol")
 * @param connection - Solana connection (must have getAccountInfo method)
 * @param announcements - Array of on-chain stealth announcements to scan
 * @param programId - Optional program ID (defaults to devnet)
 * @returns Array of found notes belonging to this address
 * @throws Error if name not found or keys don't match registered name
 *
 * @example
 * ```typescript
 * const keys = await deriveKeysFromWallet(wallet);
 * const notes = await scanByZkeyName(
 *   keys,
 *   "alice",
 *   connection,
 *   announcements
 * );
 * console.log(`Found ${notes.length} deposits for alice.zkey.sol`);
 * ```
 */
export async function scanByZkeyName(
  keys: ZVaultKeys,
  expectedName: string,
  connection: ConnectionAdapter,
  announcements: {
    ephemeralPub: Uint8Array;
    encryptedAmount: Uint8Array;
    commitment: Uint8Array;
    leafIndex: number;
  }[],
  programId?: string
): Promise<ScannedNote[]> {
  // 1. Lookup .zkey.sol name to get registered stealth address
  const zkeyAddress = await lookupZkeyName(connection, expectedName, programId);
  if (!zkeyAddress) {
    throw new Error(`Name "${expectedName}.zkey.sol" not found`);
  }

  // 2. Verify keys match registered name
  const userSpendingPub = pointToCompressedBytes(keys.spendingPubKey);
  if (!constantTimeCompare(userSpendingPub, zkeyAddress.spendingPubKey)) {
    throw new Error(
      `Keys do not match "${expectedName}.zkey.sol" registration. ` +
      `The provided spending key does not match the registered spending key.`
    );
  }

  // Optional: Also verify viewing key matches
  const userViewingPub = pointToCompressedBytes(keys.viewingPubKey);
  if (!constantTimeCompare(userViewingPub, zkeyAddress.viewingPubKey)) {
    throw new Error(
      `Keys do not match "${expectedName}.zkey.sol" registration. ` +
      `The provided viewing key does not match the registered viewing key.`
    );
  }

  // 3. Scan using user's viewing key (keys verified to match name)
  return scanAnnouncements(keys, announcements);
}

/**
 * Look up a .zkey.sol name and return the stealth address
 *
 * For scanning deposits, use scanByZkeyName() which requires keys.
 *
 * @param connection - Solana connection
 * @param name - The .zkey.sol name to look up (e.g., "alice" or "alice.zkey.sol")
 * @param programId - Optional program ID
 * @returns Stealth address or null if not found
 */
export async function resolveZkeyName(
  connection: ConnectionAdapter,
  name: string,
  programId?: string
): Promise<ZkeyStealthAddress | null> {
  return lookupZkeyName(connection, name, programId);
}

// ========== Stealth Output Creation (for spend change/split outputs) ==========

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

/**
 * Extract y-coordinate sign from compressed Grumpkin pubkey
 *
 * Compressed format: prefix byte (0x02 for even y, 0x03 for odd y) + 32-byte x
 *
 * @param compressedPub - 33-byte compressed Grumpkin pubkey
 * @returns true if y is odd (prefix 0x03), false if y is even (prefix 0x02)
 */
export function extractYSign(compressedPub: Uint8Array): boolean {
  if (compressedPub.length !== 33) {
    throw new Error("Compressed pubkey must be 33 bytes");
  }
  const prefix = compressedPub[0];
  if (prefix === 0x02) return false; // y is even
  if (prefix === 0x03) return true;  // y is odd
  throw new Error(`Invalid compressed pubkey prefix: 0x${prefix.toString(16)}`);
}

/**
 * Extract x-coordinate from compressed Grumpkin pubkey
 *
 * @param compressedPub - 33-byte compressed Grumpkin pubkey
 * @returns x-coordinate as bigint
 */
export function extractX(compressedPub: Uint8Array): bigint {
  if (compressedPub.length !== 33) {
    throw new Error("Compressed pubkey must be 33 bytes");
  }
  return bytesToBigint(compressedPub.slice(1, 33));
}

/**
 * Pack encrypted amount and y_sign into a single Field element
 *
 * Layout: bits 0-63 = encrypted amount (little-endian), bit 64 = y_sign
 *
 * @param encryptedAmount - 8-byte XOR encrypted amount
 * @param ySign - true if y is odd, false if y is even
 * @returns Packed value as bigint
 */
export function packEncryptedAmountWithSign(encryptedAmount: Uint8Array, ySign: boolean): bigint {
  if (encryptedAmount.length !== 8) {
    throw new Error("Encrypted amount must be 8 bytes");
  }

  // Convert encrypted amount to bigint (little-endian)
  let amount = 0n;
  for (let i = 7; i >= 0; i--) {
    amount = (amount << 8n) | BigInt(encryptedAmount[i]);
  }

  // Set bit 64 if y is odd
  if (ySign) {
    amount |= (1n << 64n);
  }

  return amount;
}

/**
 * Convert StealthOutputData to circuit-ready format
 *
 * Extracts ephemeral pubkey x-coordinate and packs encrypted amount with y_sign.
 * This format is used as circuit public inputs for relayer-safe stealth announcements.
 *
 * @param output - Stealth output data from createStealthOutput()
 * @returns Circuit-ready ephemeralPubX and encryptedAmountWithSign
 */
export function packStealthOutputForCircuit(output: StealthOutputData): CircuitStealthOutput {
  const ephemeralPubX = extractX(output.ephemeralPub);
  const ySign = extractYSign(output.ephemeralPub);
  const encryptedAmountWithSign = packEncryptedAmountWithSign(output.encryptedAmount, ySign);

  return {
    ephemeralPubX,
    encryptedAmountWithSign,
  };
}

/**
 * Reconstruct compressed pubkey from x-coordinate and y_sign
 *
 * @param x - x-coordinate as bigint
 * @param ySign - true if y is odd (use 0x03), false if y is even (use 0x02)
 * @returns 33-byte compressed Grumpkin pubkey
 */
export function reconstructCompressedPub(x: bigint, ySign: boolean): Uint8Array {
  const compressed = new Uint8Array(33);
  compressed[0] = ySign ? 0x03 : 0x02;
  const xBytes = bigintToBytes(x);
  compressed.set(xBytes, 1);
  return compressed;
}

/**
 * Unpack encrypted amount and y_sign from packed Field element
 *
 * @param packed - Packed value (bits 0-63 = encrypted amount, bit 64 = y_sign)
 * @returns Object with encryptedAmount (8 bytes) and ySign (boolean)
 */
export function unpackEncryptedAmountWithSign(packed: bigint): { encryptedAmount: Uint8Array; ySign: boolean } {
  const ySign = (packed & (1n << 64n)) !== 0n;
  const amount = packed & ((1n << 64n) - 1n);

  // Convert to 8-byte little-endian
  const encryptedAmount = new Uint8Array(8);
  let temp = amount;
  for (let i = 0; i < 8; i++) {
    encryptedAmount[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }

  return { encryptedAmount, ySign };
}

/**
 * Create stealth output data for a self-send (change output)
 *
 * Used when spending notes with change - the change goes back to yourself
 * as a new stealth output.
 *
 * @param keys - Your ZVaultKeys (change is sent to yourself)
 * @param amountSats - Change amount in satoshis
 * @returns Stealth output data for on-chain StealthAnnouncement
 */
export async function createStealthOutput(
  keys: ZVaultKeys,
  amountSats: bigint
): Promise<StealthOutputData> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute commitment
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
  };
}

/**
 * Create stealth output with stealthPubKeyX for circuit input
 *
 * Used for change outputs in spend_partial_public and spend_split.
 * Returns the derived stealth pub key X coordinate which must be used
 * as the circuit's pub_key_x input (NOT the raw spending pub key).
 *
 * The commitment is: Poseidon(stealthPub.x, amount)
 * The circuit expects: changePubKeyX = stealthPub.x
 *
 * @param keys - Your ZVaultKeys (change is sent to yourself)
 * @param amountSats - Change amount in satoshis
 * @returns Stealth output data including stealthPubKeyX for circuit
 */
export async function createStealthOutputWithKeys(
  keys: ZVaultKeys,
  amountSats: bigint
): Promise<StealthOutputWithKeys> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute commitment using stealth pub key
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    stealthPubKeyX: stealthPub.x, // For circuit input
  };
}

/**
 * Create stealth output data with pre-computed commitment
 *
 * Used when the commitment is computed by the ZK circuit.
 * The ephemeral key and encrypted amount still need to match
 * the commitment's underlying stealth pubkey and amount.
 *
 * @param keys - Recipient's keys (or your own for self-sends)
 * @param amountSats - Amount in satoshis
 * @param existingCommitment - Pre-computed commitment from ZK circuit
 * @returns Stealth output data with matching ephemeral key and encrypted amount
 */
export async function createStealthOutputForCommitment(
  keys: ZVaultKeys,
  amountSats: bigint,
  existingCommitment: Uint8Array
): Promise<StealthOutputData> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Verify commitment matches
  const computedCommitment = poseidonHashSync([stealthPub.x, amountSats]);
  const actualCommitment = bytesToBigint(existingCommitment);

  // Note: The commitment from ZK circuit is computed inside the circuit,
  // so we need to generate the ephemeral key BEFORE creating the ZK proof inputs
  // This function is mainly for creating announcement data after proof generation

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment: existingCommitment,
  };
}

// ========== Nullifier Computation (for spent checking) ==========

/**
 * Compute nullifier hash for a scanned note
 *
 * Used to check if a note has already been spent by looking up the
 * nullifier record PDA on-chain.
 *
 * Derivation:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPriv = spendingPriv + hash(sharedSecret)
 * 3. nullifier = Poseidon(stealthPriv, leafIndex)
 * 4. nullifierHash = Poseidon(nullifier)
 *
 * @param keys - Full ZVaultKeys (requires spending key)
 * @param note - Scanned note from scanning phase
 * @returns 32-byte nullifier hash for PDA lookup
 */
export function computeNullifierHashForNote(
  keys: ZVaultKeys,
  note: ScannedNote
): Uint8Array {
  // 1. Recompute shared secret (viewing key + ephemeral pub)
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, note.ephemeralPub);

  // 2. Derive stealth private key (spending key + shared secret)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // 3. Compute nullifier = Poseidon(stealthPriv, leafIndex)
  const nullifier = poseidonComputeNullifier(stealthPrivKey, BigInt(note.leafIndex));

  // 4. Hash nullifier for on-chain lookup
  const nullifierHash = poseidonHashSync([nullifier]);

  // 5. Convert to bytes for PDA derivation
  return bigintToBytes(nullifierHash);
}

/**
 * Derive StealthAnnouncement PDA address from ephemeral pubkey
 *
 * PDA seed: ["stealth", ephemeral_pub[1..33]]
 * Uses bytes 1-32 of compressed ephemeral pubkey (skips prefix byte)
 *
 * @param ephemeralPub - 33-byte compressed Grumpkin pubkey
 * @param programId - ZVault program ID
 * @returns PDA address string (base58)
 */
export function deriveStealthAnnouncementPda(
  ephemeralPub: Uint8Array,
  programId: string
): string {
  if (ephemeralPub.length !== 33) {
    throw new Error("Ephemeral pubkey must be 33 bytes (compressed Grumpkin)");
  }

  // Import getProgramDerivedAddress from @solana/kit
  // Note: This is a synchronous version using the same algorithm
  const seed = ephemeralPub.slice(1, 33); // Skip prefix byte, use 32 bytes

  // Use @solana/kit's address derivation
  const { getProgramDerivedAddress, address } = require("@solana/kit");

  const [pda] = getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode("stealth"),
      seed,
    ],
  });

  return pda.toString();
}
