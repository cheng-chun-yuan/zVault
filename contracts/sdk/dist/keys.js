"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPENDING_KEY_DERIVATION_MESSAGE = exports.ViewPermissions = void 0;
exports.deriveKeysFromWallet = deriveKeysFromWallet;
exports.deriveKeysFromSignature = deriveKeysFromSignature;
exports.deriveKeysFromSeed = deriveKeysFromSeed;
exports.createStealthMetaAddress = createStealthMetaAddress;
exports.serializeStealthMetaAddress = serializeStealthMetaAddress;
exports.deserializeStealthMetaAddress = deserializeStealthMetaAddress;
exports.parseStealthMetaAddress = parseStealthMetaAddress;
exports.encodeStealthMetaAddress = encodeStealthMetaAddress;
exports.decodeStealthMetaAddress = decodeStealthMetaAddress;
exports.createDelegatedViewKey = createDelegatedViewKey;
exports.serializeDelegatedViewKey = serializeDelegatedViewKey;
exports.deserializeDelegatedViewKey = deserializeDelegatedViewKey;
exports.isDelegatedKeyValid = isDelegatedKeyValid;
exports.hasPermission = hasPermission;
exports.constantTimeCompare = constantTimeCompare;
exports.clearKey = clearKey;
exports.clearZVaultKeys = clearZVaultKeys;
exports.clearDelegatedViewKey = clearDelegatedViewKey;
exports.extractViewOnlyBundle = extractViewOnlyBundle;
const sha256_1 = require("@noble/hashes/sha256");
const tweetnacl_1 = require("tweetnacl");
const grumpkin_1 = require("./grumpkin");
/**
 * View permission flags for delegated viewing keys
 */
var ViewPermissions;
(function (ViewPermissions) {
    /** Can scan announcements and see amounts */
    ViewPermissions[ViewPermissions["SCAN"] = 1] = "SCAN";
    /** Can see full transaction history */
    ViewPermissions[ViewPermissions["HISTORY"] = 2] = "HISTORY";
    /** Can see incoming transactions only */
    ViewPermissions[ViewPermissions["INCOMING_ONLY"] = 4] = "INCOMING_ONLY";
    /** Full viewing access (scan + history) */
    ViewPermissions[ViewPermissions["FULL"] = 3] = "FULL";
})(ViewPermissions || (exports.ViewPermissions = ViewPermissions = {}));
// ========== Constants ==========
/** Message to sign for key derivation */
exports.SPENDING_KEY_DERIVATION_MESSAGE = "zVault spending key derivation v1";
/** Domain separator for viewing key derivation */
const VIEWING_KEY_DOMAIN = "viewing";
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
async function deriveKeysFromWallet(wallet) {
    if (!wallet.publicKey) {
        throw new Error("Wallet not connected");
    }
    const message = new TextEncoder().encode(exports.SPENDING_KEY_DERIVATION_MESSAGE);
    const signature = await wallet.signMessage(message);
    return deriveKeysFromSignature(signature, wallet.publicKey.toBytes());
}
/**
 * Derive zVault keys from a signature (for testing or custom flows)
 *
 * SECURITY: Intermediate key material is cleared from memory after use.
 *
 * @param signature - 64-byte Ed25519 signature
 * @param solanaPublicKey - 32-byte Solana public key
 * @returns Complete zVault key hierarchy
 */
function deriveKeysFromSignature(signature, solanaPublicKey) {
    if (signature.length !== 64) {
        throw new Error("Signature must be 64 bytes");
    }
    if (solanaPublicKey.length !== 32) {
        throw new Error("Solana public key must be 32 bytes");
    }
    // Derive spending key: SHA256(signature) → Grumpkin scalar
    const spendingSeed = (0, sha256_1.sha256)(signature);
    const spendingPrivKey = (0, grumpkin_1.scalarFromBytes)(spendingSeed);
    const spendingPubKey = (0, grumpkin_1.pointMul)(spendingPrivKey, grumpkin_1.GRUMPKIN_GENERATOR);
    // Clear intermediate seed
    clearKey(spendingSeed);
    // Derive viewing key: SHA256(signature || "viewing") → X25519 scalar
    const viewingSeed = (0, sha256_1.sha256)(concatBytes(signature, new TextEncoder().encode(VIEWING_KEY_DOMAIN)));
    // X25519 requires clamping (done by tweetnacl internally)
    const viewingKeyPair = tweetnacl_1.box.keyPair.fromSecretKey(viewingSeed);
    // Clear intermediate seed
    clearKey(viewingSeed);
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
function deriveKeysFromSeed(seed) {
    // Create a deterministic "signature" from seed
    const fakeSig = new Uint8Array(64);
    const hash1 = (0, sha256_1.sha256)(seed);
    const hash2 = (0, sha256_1.sha256)(concatBytes(seed, new Uint8Array([1])));
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
function createStealthMetaAddress(keys) {
    return {
        spendingPubKey: (0, grumpkin_1.pubKeyToBytes)(keys.spendingPubKey),
        viewingPubKey: keys.viewingPubKey,
    };
}
/**
 * Serialize a stealth meta-address for display/sharing
 */
function serializeStealthMetaAddress(meta) {
    return {
        spendingPubKey: bytesToHex(meta.spendingPubKey),
        viewingPubKey: bytesToHex(meta.viewingPubKey),
    };
}
/**
 * Deserialize a stealth meta-address from string representation
 */
function deserializeStealthMetaAddress(serialized) {
    return {
        spendingPubKey: hexToBytes(serialized.spendingPubKey),
        viewingPubKey: hexToBytes(serialized.viewingPubKey),
    };
}
/**
 * Parse a stealth meta-address and extract the Grumpkin public key
 */
function parseStealthMetaAddress(meta) {
    return {
        spendingPubKey: (0, grumpkin_1.pubKeyFromBytes)(meta.spendingPubKey),
        viewingPubKey: meta.viewingPubKey,
    };
}
/**
 * Encode stealth meta-address as a single string (65 bytes → hex)
 * Format: spendingPubKey (33 bytes) || viewingPubKey (32 bytes)
 */
function encodeStealthMetaAddress(meta) {
    const combined = concatBytes(meta.spendingPubKey, meta.viewingPubKey);
    return bytesToHex(combined);
}
/**
 * Decode stealth meta-address from a single string
 */
function decodeStealthMetaAddress(encoded) {
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
function createDelegatedViewKey(keys, permissions = ViewPermissions.FULL, options = {}) {
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
function serializeDelegatedViewKey(key, password) {
    if (!password) {
        // WARNING: Unencrypted serialization - for backward compatibility only
        console.warn("WARNING: Serializing viewing key without encryption. " +
            "This is a security risk. Provide a password for encryption.");
        const obj = {
            version: 1,
            encrypted: false,
            viewingPrivKey: bytesToHex(key.viewingPrivKey),
            permissions: key.permissions,
            expiresAt: key.expiresAt,
            label: key.label,
        };
        return JSON.stringify(obj);
    }
    // Derive encryption key from password using SHA256
    const passwordBytes = new TextEncoder().encode(password);
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    // Simple PBKDF: key = SHA256(password || salt)
    const keyMaterial = concatBytes(passwordBytes, salt);
    const encryptionKey = (0, sha256_1.sha256)(keyMaterial);
    // Generate nonce for XOR encryption
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);
    // Encrypt viewing private key: ciphertext = privKey XOR SHA256(encryptionKey || nonce)
    const xorKey = (0, sha256_1.sha256)(concatBytes(encryptionKey, nonce));
    const encryptedPrivKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        encryptedPrivKey[i] = key.viewingPrivKey[i] ^ xorKey[i];
    }
    // Compute MAC: SHA256(encryptionKey || encryptedPrivKey)
    const mac = (0, sha256_1.sha256)(concatBytes(encryptionKey, encryptedPrivKey));
    const obj = {
        version: 2,
        encrypted: true,
        salt: bytesToHex(salt),
        nonce: bytesToHex(nonce),
        ciphertext: bytesToHex(encryptedPrivKey),
        mac: bytesToHex(mac),
        permissions: key.permissions,
        expiresAt: key.expiresAt,
        label: key.label,
    };
    return JSON.stringify(obj);
}
/**
 * Deserialize a delegated viewing key from JSON
 *
 * @param json - Serialized viewing key (encrypted or unencrypted)
 * @param password - Password for decryption (required if encrypted)
 * @returns Delegated viewing key
 */
function deserializeDelegatedViewKey(json, password) {
    const obj = JSON.parse(json);
    if (!obj.encrypted || obj.version === 1) {
        // Unencrypted format (legacy or no password provided during serialization)
        return {
            viewingPrivKey: hexToBytes(obj.viewingPrivKey),
            permissions: obj.permissions,
            expiresAt: obj.expiresAt,
            label: obj.label,
        };
    }
    // Encrypted format (version 2)
    if (!password) {
        throw new Error("Password required to decrypt viewing key");
    }
    const salt = hexToBytes(obj.salt);
    const nonce = hexToBytes(obj.nonce);
    const ciphertext = hexToBytes(obj.ciphertext);
    const storedMac = hexToBytes(obj.mac);
    // Derive encryption key
    const passwordBytes = new TextEncoder().encode(password);
    const keyMaterial = concatBytes(passwordBytes, salt);
    const encryptionKey = (0, sha256_1.sha256)(keyMaterial);
    // Verify MAC
    const computedMac = (0, sha256_1.sha256)(concatBytes(encryptionKey, ciphertext));
    if (!constantTimeCompare(computedMac, storedMac)) {
        throw new Error("Invalid password or corrupted data");
    }
    // Decrypt viewing private key
    const xorKey = (0, sha256_1.sha256)(concatBytes(encryptionKey, nonce));
    const viewingPrivKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        viewingPrivKey[i] = ciphertext[i] ^ xorKey[i];
    }
    return {
        viewingPrivKey,
        permissions: obj.permissions,
        expiresAt: obj.expiresAt,
        label: obj.label,
    };
}
/**
 * Check if a delegated viewing key is valid (not expired)
 */
function isDelegatedKeyValid(key) {
    if (!key.expiresAt)
        return true;
    return Date.now() < key.expiresAt;
}
/**
 * Check if a delegated key has a specific permission
 */
function hasPermission(key, permission) {
    return (key.permissions & permission) === permission;
}
// ========== Key Security ==========
/**
 * Safely compare two keys in constant time
 */
function constantTimeCompare(a, b) {
    if (a.length !== b.length)
        return false;
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
function clearKey(key) {
    crypto.getRandomValues(key);
    key.fill(0);
}
/**
 * Securely clear all sensitive keys from a ZVaultKeys object
 *
 * Call this when you're done using the keys to minimize exposure window.
 * Note: The spendingPrivKey is a bigint and cannot be reliably cleared in JS.
 */
function clearZVaultKeys(keys) {
    clearKey(keys.viewingPrivKey);
    // Note: spendingPrivKey is a bigint, we can only set it to 0n
    // This doesn't guarantee memory clearing but removes the reference
    keys.spendingPrivKey = 0n;
}
/**
 * Securely clear a delegated viewing key
 */
function clearDelegatedViewKey(key) {
    clearKey(key.viewingPrivKey);
}
/**
 * Derive a view-only key bundle (no spending key)
 * Safe to export/backup separately from spending key
 */
function extractViewOnlyBundle(keys) {
    return {
        solanaPublicKey: keys.solanaPublicKey,
        spendingPubKey: (0, grumpkin_1.pubKeyToBytes)(keys.spendingPubKey),
        viewingPrivKey: keys.viewingPrivKey,
        viewingPubKey: keys.viewingPubKey,
    };
}
// ========== Utilities ==========
function concatBytes(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
function hexToBytes(hex) {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
    }
    return bytes;
}
