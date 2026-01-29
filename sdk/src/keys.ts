/**
 * EIP-5564/DKSAP-style Key Derivation for zVault
 *
 * Implements a dual-key system derived from Solana wallet signature:
 * - Spending Key (Grumpkin): Used for stealth key derivation and nullifier
 * - Viewing Key (Grumpkin): Used for off-chain scanning with ECDH
 *
 * Key Architecture (Grumpkin-Only, Single Ephemeral Pattern):
 * ```
 * Solana Wallet (Ed25519)
 *         │
 *         │ signs message: "zVault key derivation v1"
 *         ▼
 *    Signature (64 bytes)
 *         │
 *         ├──► hash(sig || "spend") ──► Grumpkin Spending Key (for nullifier)
 *         │
 *         └──► hash(sig || "view") ──► Grumpkin Viewing Key (for scanning)
 * ```
 *
 * Stealth Address Flow (EIP-5564/DKSAP Pattern):
 * ```
 * Sender:
 *   1. ephemeral = random Grumpkin keypair
 *   2. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 *   3. stealthPub = spendingPub + hash(sharedSecret) * G
 *   4. commitment = Poseidon2(stealthPub, amount)
 *
 * Recipient (viewing key - can detect):
 *   1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 *   2. stealthPub = spendingPub + hash(sharedSecret) * G
 *   3. Verify commitment matches
 *
 * Recipient (spending key - can claim):
 *   1. stealthPriv = spendingPriv + hash(sharedSecret)
 *   2. nullifier = Poseidon2(stealthPriv, leafIndex)
 * ```
 *
 * Security Properties:
 * - Spending Key: Required for stealthPriv and nullifier derivation
 * - Viewing Key: Can scan but CANNOT derive stealthPriv (ECDLP protection)
 * - Both derived from Solana wallet - no separate backup needed
 * - Single ephemeral key per deposit (standard EIP-5564/Umbra pattern)
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import {
  scalarFromBytes,
  pointMul,
  GRUMPKIN_GENERATOR,
  pubKeyToBytes,
  pubKeyFromBytes,
  scalarToBytes,
  type GrumpkinPoint,
} from "./grumpkin";

// ========== Types ==========

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

// ========== Constants ==========

/** Message to sign for key derivation */
export const SPENDING_KEY_DERIVATION_MESSAGE =
  "zVault key derivation v1";

/** Domain separator for spending key derivation */
const SPENDING_KEY_DOMAIN = "spend";

/** Domain separator for viewing key derivation */
const VIEWING_KEY_DOMAIN = "view";

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
 * Uses Grumpkin for both spending and viewing keys (EIP-5564/DKSAP pattern).
 *
 * SECURITY: Intermediate key material is cleared from memory after use.
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

  // Derive spending key: SHA256(signature || "spend") → Grumpkin scalar
  const spendingSeed = sha256(
    concatBytes(signature, new TextEncoder().encode(SPENDING_KEY_DOMAIN))
  );
  const spendingPrivKey = scalarFromBytes(spendingSeed);
  const spendingPubKey = pointMul(spendingPrivKey, GRUMPKIN_GENERATOR);

  // Clear intermediate seed
  clearKey(spendingSeed);

  // Derive viewing key: SHA256(signature || "view") → Grumpkin scalar
  const viewingSeed = sha256(
    concatBytes(signature, new TextEncoder().encode(VIEWING_KEY_DOMAIN))
  );
  const viewingPrivKey = scalarFromBytes(viewingSeed);
  const viewingPubKey = pointMul(viewingPrivKey, GRUMPKIN_GENERATOR);

  // Clear intermediate seed
  clearKey(viewingSeed);

  return {
    solanaPublicKey,
    spendingPrivKey,
    spendingPubKey,
    viewingPrivKey,
    viewingPubKey,
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
 * It contains both spending and viewing public keys (both Grumpkin).
 *
 * Size: 66 bytes (33 + 33 compressed)
 */
export function createStealthMetaAddress(keys: ZVaultKeys): StealthMetaAddress {
  return {
    spendingPubKey: pubKeyToBytes(keys.spendingPubKey),
    viewingPubKey: pubKeyToBytes(keys.viewingPubKey),
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
 * Parse a stealth meta-address and extract both Grumpkin public keys
 */
export function parseStealthMetaAddress(meta: StealthMetaAddress): {
  spendingPubKey: GrumpkinPoint;
  viewingPubKey: GrumpkinPoint;
} {
  return {
    spendingPubKey: pubKeyFromBytes(meta.spendingPubKey),
    viewingPubKey: pubKeyFromBytes(meta.viewingPubKey),
  };
}

/**
 * Encode stealth meta-address as a single string (66 bytes → hex)
 * Format: spendingPubKey (33 bytes) || viewingPubKey (33 bytes)
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
  if (bytes.length !== 66) {
    throw new Error("Invalid stealth meta-address length (expected 66 bytes)");
  }
  return {
    spendingPubKey: bytes.slice(0, 33),
    viewingPubKey: bytes.slice(33, 66),
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
 * Serialize a delegated viewing key for export (ENCRYPTED)
 *
 * SECURITY: The viewing private key is encrypted using a password-derived key.
 * Never store or transmit the unencrypted JSON.
 *
 * @param key - Delegated viewing key to serialize
 * @param password - Password for encryption (optional, if not provided returns unencrypted - NOT RECOMMENDED)
 * @returns Encrypted JSON string
 */
export async function serializeDelegatedViewKey(
  key: DelegatedViewKey,
  password?: string
): Promise<string> {
  // Convert bigint to bytes for serialization
  const viewingPrivKeyBytes = scalarToBytes(key.viewingPrivKey);

  if (!password) {
    // WARNING: Unencrypted serialization - for backward compatibility only
    console.warn(
      "WARNING: Serializing viewing key without encryption. " +
      "This is a security risk. Provide a password for encryption."
    );
    const obj = {
      version: 3,
      encrypted: false,
      viewingPrivKey: bytesToHex(viewingPrivKeyBytes),
      permissions: key.permissions,
      expiresAt: key.expiresAt,
      label: key.label,
    };
    return JSON.stringify(obj);
  }

  // Derive encryption key from password using PBKDF2 with 100,000 iterations
  const passwordBytes = new TextEncoder().encode(password);
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // PBKDF2-SHA256 with 100,000 iterations (OWASP recommendation)
  const PBKDF2_ITERATIONS = 100_000;
  const encryptionKey = pbkdf2(sha256, passwordBytes, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });

  // Generate 12-byte nonce for AES-GCM (standard size)
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  // Use Web Crypto API for AES-GCM authenticated encryption
  // Create proper ArrayBuffer copies to satisfy TypeScript's strict type checking
  const keyBuffer = encryptionKey.buffer.slice(
    encryptionKey.byteOffset,
    encryptionKey.byteOffset + encryptionKey.byteLength
  ) as ArrayBuffer;
  const nonceBuffer = nonce.buffer.slice(
    nonce.byteOffset,
    nonce.byteOffset + nonce.byteLength
  ) as ArrayBuffer;
  const dataBuffer = viewingPrivKeyBytes.buffer.slice(
    viewingPrivKeyBytes.byteOffset,
    viewingPrivKeyBytes.byteOffset + viewingPrivKeyBytes.byteLength
  ) as ArrayBuffer;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBuffer },
    cryptoKey,
    dataBuffer
  );

  const obj = {
    version: 4, // New version for AES-GCM encryption
    encrypted: true,
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    iterations: PBKDF2_ITERATIONS,
    permissions: key.permissions,
    expiresAt: key.expiresAt,
    label: key.label,
  };
  return JSON.stringify(obj);
}

/**
 * Deserialize a delegated viewing key from JSON
 *
 * Supports both version 3 (legacy XOR, deprecated) and version 4 (AES-GCM) formats.
 *
 * @param json - Serialized viewing key (encrypted or unencrypted)
 * @param password - Password for decryption (required if encrypted)
 * @returns Delegated viewing key
 */
export async function deserializeDelegatedViewKey(
  json: string,
  password?: string
): Promise<DelegatedViewKey> {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error("Invalid delegated view key format");
  }

  if (!obj.encrypted) {
    // Unencrypted format
    const privKeyBytes = hexToBytes(obj.viewingPrivKey);
    return {
      viewingPrivKey: scalarFromBytes(privKeyBytes),
      permissions: obj.permissions,
      expiresAt: obj.expiresAt,
      label: obj.label,
    };
  }

  if (!password) {
    throw new Error("Password required to decrypt viewing key");
  }

  const salt = hexToBytes(obj.salt);
  const nonce = hexToBytes(obj.nonce);
  const ciphertext = hexToBytes(obj.ciphertext);
  const passwordBytes = new TextEncoder().encode(password);

  // Version 4: AES-GCM with PBKDF2
  if (obj.version === 4) {
    const iterations = obj.iterations || 100_000;
    const encryptionKey = pbkdf2(sha256, passwordBytes, salt, { c: iterations, dkLen: 32 });

    // Create proper ArrayBuffer copies to satisfy TypeScript's strict type checking
    const keyBuffer = encryptionKey.buffer.slice(
      encryptionKey.byteOffset,
      encryptionKey.byteOffset + encryptionKey.byteLength
    ) as ArrayBuffer;
    const nonceBuffer = nonce.buffer.slice(
      nonce.byteOffset,
      nonce.byteOffset + nonce.byteLength
    ) as ArrayBuffer;
    const ciphertextBuffer = ciphertext.buffer.slice(
      ciphertext.byteOffset,
      ciphertext.byteOffset + ciphertext.byteLength
    ) as ArrayBuffer;

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonceBuffer },
        cryptoKey,
        ciphertextBuffer
      );
      return {
        viewingPrivKey: scalarFromBytes(new Uint8Array(plaintext)),
        permissions: obj.permissions,
        expiresAt: obj.expiresAt,
        label: obj.label,
      };
    } catch {
      throw new Error("Invalid password or corrupted data");
    }
  }

  // Version 2/3: Legacy XOR encryption (deprecated, for backward compatibility)
  console.warn(
    "WARNING: Decrypting legacy format (version 2/3). " +
    "Re-encrypt with a new password to upgrade to secure format."
  );
  const storedMac = hexToBytes(obj.mac);

  // Derive encryption key (legacy method)
  const keyMaterial = concatBytes(passwordBytes, salt);
  const encryptionKey = sha256(keyMaterial);

  // Verify MAC
  const computedMac = sha256(concatBytes(encryptionKey, ciphertext));
  if (!constantTimeCompare(computedMac, storedMac)) {
    throw new Error("Invalid password or corrupted data");
  }

  // Decrypt viewing private key (legacy XOR method)
  const xorKey = sha256(concatBytes(encryptionKey, nonce));
  const viewingPrivKeyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    viewingPrivKeyBytes[i] = ciphertext[i] ^ xorKey[i];
  }

  return {
    viewingPrivKey: scalarFromBytes(viewingPrivKeyBytes),
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
 *
 * SECURITY: JavaScript doesn't guarantee memory clearing due to GC and JIT,
 * but this provides best-effort protection by:
 * 1. Overwriting with random data (defeats simple memory dumps)
 * 2. Zeroing the buffer (standard practice)
 *
 * For maximum security, use WebAssembly or native modules.
 */
export function clearKey(key: Uint8Array): void {
  crypto.getRandomValues(key);
  key.fill(0);
}

/**
 * Securely clear all sensitive keys from a ZVaultKeys object
 *
 * Call this when you're done using the keys to minimize exposure window.
 * Note: BigInt values cannot be reliably cleared in JS.
 */
export function clearZVaultKeys(keys: ZVaultKeys): void {
  // Note: bigints cannot be reliably cleared in JS, we can only set to 0n
  // This doesn't guarantee memory clearing but removes the reference
  (keys as { spendingPrivKey: bigint }).spendingPrivKey = 0n;
  (keys as { viewingPrivKey: bigint }).viewingPrivKey = 0n;
}

/**
 * Securely clear a delegated viewing key
 */
export function clearDelegatedViewKey(key: DelegatedViewKey): void {
  // Note: bigints cannot be reliably cleared in JS
  (key as { viewingPrivKey: bigint }).viewingPrivKey = 0n;
}

/**
 * Derive a view-only key bundle (no spending key)
 * Safe to export/backup separately from spending key
 */
export function extractViewOnlyBundle(keys: ZVaultKeys): {
  solanaPublicKey: Uint8Array;
  spendingPubKey: Uint8Array;
  viewingPrivKey: bigint;
  viewingPubKey: Uint8Array;
} {
  return {
    solanaPublicKey: keys.solanaPublicKey,
    spendingPubKey: pubKeyToBytes(keys.spendingPubKey),
    viewingPrivKey: keys.viewingPrivKey,
    viewingPubKey: pubKeyToBytes(keys.viewingPubKey),
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
