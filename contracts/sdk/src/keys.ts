/**
 * RAILGUN-style Key Derivation for zVault
 *
 * Implements a dual-key system derived from Solana wallet signature:
 * - Spending Key (Grumpkin): Used for in-circuit ECDH (~2k constraints)
 * - Viewing Key (X25519): Used for off-chain scanning (fast)
 *
 * Key Architecture:
 * ```
 * Solana Wallet (Ed25519)
 *         │
 *         │ signs message: "zVault spending key v1"
 *         ▼
 *    Signature (64 bytes)
 *         │
 *         ├──► SHA256 ──► Grumpkin Spending Key (for ZK proofs)
 *         │
 *         └──► SHA256(sig || "view") ──► X25519 Viewing Key (for scanning)
 * ```
 *
 * Security Properties:
 * - Spending Key: Required for nullifier derivation and proof generation
 * - Viewing Key: Can scan/decrypt but CANNOT spend (no nullifier derivation)
 * - Both derived from Solana wallet - no separate backup needed
 * - Delegation: Viewing key can be shared with auditors for read-only access
 */

import { sha256 } from "@noble/hashes/sha256";
import { box } from "tweetnacl";
import {
  scalarFromBytes,
  pointMul,
  GRUMPKIN_GENERATOR,
  pubKeyToBytes,
  pubKeyFromBytes,
  type GrumpkinPoint,
} from "./grumpkin";

// ========== Types ==========

/**
 * Complete zVault key hierarchy derived from Solana wallet
 */
export interface ZVaultKeys {
  /** Solana public key (32 bytes) - user identity */
  solanaPublicKey: Uint8Array;

  /** Grumpkin spending private key (scalar) - for ZK proofs */
  spendingPrivKey: bigint;

  /** Grumpkin spending public key (point) - share publicly */
  spendingPubKey: GrumpkinPoint;

  /** X25519 viewing private key (32 bytes) - for scanning */
  viewingPrivKey: Uint8Array;

  /** X25519 viewing public key (32 bytes) - share publicly */
  viewingPubKey: Uint8Array;
}

/**
 * Stealth meta-address for receiving funds
 * This is what users share publicly to receive private payments
 */
export interface StealthMetaAddress {
  /** Grumpkin spending public key (33 bytes compressed) */
  spendingPubKey: Uint8Array;

  /** X25519 viewing public key (32 bytes) */
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
 */
export interface DelegatedViewKey {
  /** X25519 viewing private key */
  viewingPrivKey: Uint8Array;

  /** Permission flags */
  permissions: ViewPermissions;

  /** Optional expiration timestamp (Unix ms) */
  expiresAt?: number;

  /** Optional label for identification */
  label?: string;
}

// ========== Constants ==========

/** Message to sign for key derivation */
export const SPENDING_KEY_DERIVATION_MESSAGE =
  "zVault spending key derivation v1";

/** Domain separator for viewing key derivation */
const VIEWING_KEY_DOMAIN = "viewing";

// ========== Wallet Adapter Interface ==========

/**
 * Minimal wallet adapter interface for signing
 * Compatible with @solana/wallet-adapter-base
 */
export interface WalletSignerAdapter {
  publicKey: { toBytes(): Uint8Array } | null;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

// ========== Key Derivation ==========

/**
 * Derive zVault keys from Solana wallet signature
 *
 * This is the primary key derivation function. The user signs a deterministic
 * message, and both spending and viewing keys are derived from that signature.
 *
 * @param wallet - Solana wallet adapter with signMessage capability
 * @returns Complete zVault key hierarchy
 */
export async function deriveKeysFromWallet(
  wallet: WalletSignerAdapter
): Promise<ZVaultKeys> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  const message = new TextEncoder().encode(SPENDING_KEY_DERIVATION_MESSAGE);
  const signature = await wallet.signMessage(message);

  return deriveKeysFromSignature(signature, wallet.publicKey.toBytes());
}

/**
 * Derive zVault keys from a signature (for testing or custom flows)
 *
 * @param signature - 64-byte Ed25519 signature
 * @param solanaPublicKey - 32-byte Solana public key
 * @returns Complete zVault key hierarchy
 */
export function deriveKeysFromSignature(
  signature: Uint8Array,
  solanaPublicKey: Uint8Array
): ZVaultKeys {
  if (signature.length !== 64) {
    throw new Error("Signature must be 64 bytes");
  }

  if (solanaPublicKey.length !== 32) {
    throw new Error("Solana public key must be 32 bytes");
  }

  // Derive spending key: SHA256(signature) → Grumpkin scalar
  const spendingSeed = sha256(signature);
  const spendingPrivKey = scalarFromBytes(spendingSeed);
  const spendingPubKey = pointMul(spendingPrivKey, GRUMPKIN_GENERATOR);

  // Derive viewing key: SHA256(signature || "viewing") → X25519 scalar
  const viewingSeed = sha256(
    concatBytes(signature, new TextEncoder().encode(VIEWING_KEY_DOMAIN))
  );
  // X25519 requires clamping (done by tweetnacl internally)
  const viewingKeyPair = box.keyPair.fromSecretKey(viewingSeed);

  return {
    solanaPublicKey,
    spendingPrivKey,
    spendingPubKey,
    viewingPrivKey: viewingKeyPair.secretKey,
    viewingPubKey: viewingKeyPair.publicKey,
  };
}

/**
 * Derive keys from a seed phrase (for deterministic testing)
 *
 * @param seed - Arbitrary seed bytes
 * @returns Complete zVault key hierarchy (with zero solanaPublicKey)
 */
export function deriveKeysFromSeed(seed: Uint8Array): ZVaultKeys {
  // Create a deterministic "signature" from seed
  const fakeSig = new Uint8Array(64);
  const hash1 = sha256(seed);
  const hash2 = sha256(concatBytes(seed, new Uint8Array([1])));
  fakeSig.set(hash1, 0);
  fakeSig.set(hash2, 32);

  return deriveKeysFromSignature(fakeSig, new Uint8Array(32));
}

// ========== Stealth Meta-Address ==========

/**
 * Create a stealth meta-address from zVault keys
 *
 * This is the public address that users share to receive funds.
 * It contains the spending and viewing public keys.
 */
export function createStealthMetaAddress(keys: ZVaultKeys): StealthMetaAddress {
  return {
    spendingPubKey: pubKeyToBytes(keys.spendingPubKey),
    viewingPubKey: keys.viewingPubKey,
  };
}

/**
 * Serialize a stealth meta-address for display/sharing
 */
export function serializeStealthMetaAddress(
  meta: StealthMetaAddress
): SerializedStealthMetaAddress {
  return {
    spendingPubKey: bytesToHex(meta.spendingPubKey),
    viewingPubKey: bytesToHex(meta.viewingPubKey),
  };
}

/**
 * Deserialize a stealth meta-address from string representation
 */
export function deserializeStealthMetaAddress(
  serialized: SerializedStealthMetaAddress
): StealthMetaAddress {
  return {
    spendingPubKey: hexToBytes(serialized.spendingPubKey),
    viewingPubKey: hexToBytes(serialized.viewingPubKey),
  };
}

/**
 * Parse a stealth meta-address and extract the Grumpkin public key
 */
export function parseStealthMetaAddress(meta: StealthMetaAddress): {
  spendingPubKey: GrumpkinPoint;
  viewingPubKey: Uint8Array;
} {
  return {
    spendingPubKey: pubKeyFromBytes(meta.spendingPubKey),
    viewingPubKey: meta.viewingPubKey,
  };
}

/**
 * Encode stealth meta-address as a single string (65 bytes → hex)
 * Format: spendingPubKey (33 bytes) || viewingPubKey (32 bytes)
 */
export function encodeStealthMetaAddress(meta: StealthMetaAddress): string {
  const combined = concatBytes(meta.spendingPubKey, meta.viewingPubKey);
  return bytesToHex(combined);
}

/**
 * Decode stealth meta-address from a single string
 */
export function decodeStealthMetaAddress(encoded: string): StealthMetaAddress {
  const bytes = hexToBytes(encoded);
  if (bytes.length !== 65) {
    throw new Error("Invalid stealth meta-address length (expected 65 bytes)");
  }
  return {
    spendingPubKey: bytes.slice(0, 33),
    viewingPubKey: bytes.slice(33, 65),
  };
}

// ========== Viewing Key Delegation ==========

/**
 * Create a delegated viewing key for auditors/compliance
 *
 * The delegated key allows read-only access to transaction history
 * without the ability to spend funds (no nullifier derivation).
 *
 * @param keys - Full zVault keys
 * @param permissions - Access level for the delegate
 * @param options - Optional expiration and label
 * @returns Delegated viewing key
 */
export function createDelegatedViewKey(
  keys: ZVaultKeys,
  permissions: ViewPermissions = ViewPermissions.FULL,
  options: { expiresAt?: number; label?: string } = {}
): DelegatedViewKey {
  return {
    viewingPrivKey: keys.viewingPrivKey,
    permissions,
    expiresAt: options.expiresAt,
    label: options.label,
  };
}

/**
 * Serialize a delegated viewing key for export
 */
export function serializeDelegatedViewKey(key: DelegatedViewKey): string {
  const obj = {
    viewingPrivKey: bytesToHex(key.viewingPrivKey),
    permissions: key.permissions,
    expiresAt: key.expiresAt,
    label: key.label,
  };
  return JSON.stringify(obj);
}

/**
 * Deserialize a delegated viewing key from JSON
 */
export function deserializeDelegatedViewKey(json: string): DelegatedViewKey {
  const obj = JSON.parse(json);
  return {
    viewingPrivKey: hexToBytes(obj.viewingPrivKey),
    permissions: obj.permissions,
    expiresAt: obj.expiresAt,
    label: obj.label,
  };
}

/**
 * Check if a delegated viewing key is valid (not expired)
 */
export function isDelegatedKeyValid(key: DelegatedViewKey): boolean {
  if (!key.expiresAt) return true;
  return Date.now() < key.expiresAt;
}

/**
 * Check if a delegated key has a specific permission
 */
export function hasPermission(
  key: DelegatedViewKey,
  permission: ViewPermissions
): boolean {
  return (key.permissions & permission) === permission;
}

// ========== Key Security ==========

/**
 * Safely compare two keys in constant time
 */
export function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Securely clear sensitive key material from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this is best effort
 */
export function clearKey(key: Uint8Array): void {
  crypto.getRandomValues(key);
  key.fill(0);
}

/**
 * Derive a view-only key bundle (no spending key)
 * Safe to export/backup separately from spending key
 */
export function extractViewOnlyBundle(keys: ZVaultKeys): {
  solanaPublicKey: Uint8Array;
  spendingPubKey: Uint8Array;
  viewingPrivKey: Uint8Array;
  viewingPubKey: Uint8Array;
} {
  return {
    solanaPublicKey: keys.solanaPublicKey,
    spendingPubKey: pubKeyToBytes(keys.spendingPubKey),
    viewingPrivKey: keys.viewingPrivKey,
    viewingPubKey: keys.viewingPubKey,
  };
}

// ========== Utilities ==========

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}
