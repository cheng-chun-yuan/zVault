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
import { type GrumpkinPoint } from "./grumpkin";
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
export declare enum ViewPermissions {
    /** Can scan announcements and see amounts */
    SCAN = 1,
    /** Can see full transaction history */
    HISTORY = 2,
    /** Can see incoming transactions only */
    INCOMING_ONLY = 4,
    /** Full viewing access (scan + history) */
    FULL = 3
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
/** Message to sign for key derivation */
export declare const SPENDING_KEY_DERIVATION_MESSAGE = "zVault spending key derivation v1";
/**
 * Minimal wallet adapter interface for signing
 * Compatible with @solana/wallet-adapter-base
 */
export interface WalletSignerAdapter {
    publicKey: {
        toBytes(): Uint8Array;
    } | null;
    signMessage(message: Uint8Array): Promise<Uint8Array>;
}
/**
 * Derive zVault keys from Solana wallet signature
 *
 * This is the primary key derivation function. The user signs a deterministic
 * message, and both spending and viewing keys are derived from that signature.
 *
 * @param wallet - Solana wallet adapter with signMessage capability
 * @returns Complete zVault key hierarchy
 */
export declare function deriveKeysFromWallet(wallet: WalletSignerAdapter): Promise<ZVaultKeys>;
/**
 * Derive zVault keys from a signature (for testing or custom flows)
 *
 * SECURITY: Intermediate key material is cleared from memory after use.
 *
 * @param signature - 64-byte Ed25519 signature
 * @param solanaPublicKey - 32-byte Solana public key
 * @returns Complete zVault key hierarchy
 */
export declare function deriveKeysFromSignature(signature: Uint8Array, solanaPublicKey: Uint8Array): ZVaultKeys;
/**
 * Derive keys from a seed phrase (for deterministic testing)
 *
 * @param seed - Arbitrary seed bytes
 * @returns Complete zVault key hierarchy (with zero solanaPublicKey)
 */
export declare function deriveKeysFromSeed(seed: Uint8Array): ZVaultKeys;
/**
 * Create a stealth meta-address from zVault keys
 *
 * This is the public address that users share to receive funds.
 * It contains the spending and viewing public keys.
 */
export declare function createStealthMetaAddress(keys: ZVaultKeys): StealthMetaAddress;
/**
 * Serialize a stealth meta-address for display/sharing
 */
export declare function serializeStealthMetaAddress(meta: StealthMetaAddress): SerializedStealthMetaAddress;
/**
 * Deserialize a stealth meta-address from string representation
 */
export declare function deserializeStealthMetaAddress(serialized: SerializedStealthMetaAddress): StealthMetaAddress;
/**
 * Parse a stealth meta-address and extract the Grumpkin public key
 */
export declare function parseStealthMetaAddress(meta: StealthMetaAddress): {
    spendingPubKey: GrumpkinPoint;
    viewingPubKey: Uint8Array;
};
/**
 * Encode stealth meta-address as a single string (65 bytes → hex)
 * Format: spendingPubKey (33 bytes) || viewingPubKey (32 bytes)
 */
export declare function encodeStealthMetaAddress(meta: StealthMetaAddress): string;
/**
 * Decode stealth meta-address from a single string
 */
export declare function decodeStealthMetaAddress(encoded: string): StealthMetaAddress;
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
export declare function createDelegatedViewKey(keys: ZVaultKeys, permissions?: ViewPermissions, options?: {
    expiresAt?: number;
    label?: string;
}): DelegatedViewKey;
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
export declare function serializeDelegatedViewKey(key: DelegatedViewKey, password?: string): string;
/**
 * Deserialize a delegated viewing key from JSON
 *
 * @param json - Serialized viewing key (encrypted or unencrypted)
 * @param password - Password for decryption (required if encrypted)
 * @returns Delegated viewing key
 */
export declare function deserializeDelegatedViewKey(json: string, password?: string): DelegatedViewKey;
/**
 * Check if a delegated viewing key is valid (not expired)
 */
export declare function isDelegatedKeyValid(key: DelegatedViewKey): boolean;
/**
 * Check if a delegated key has a specific permission
 */
export declare function hasPermission(key: DelegatedViewKey, permission: ViewPermissions): boolean;
/**
 * Safely compare two keys in constant time
 */
export declare function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean;
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
export declare function clearKey(key: Uint8Array): void;
/**
 * Securely clear all sensitive keys from a ZVaultKeys object
 *
 * Call this when you're done using the keys to minimize exposure window.
 * Note: The spendingPrivKey is a bigint and cannot be reliably cleared in JS.
 */
export declare function clearZVaultKeys(keys: ZVaultKeys): void;
/**
 * Securely clear a delegated viewing key
 */
export declare function clearDelegatedViewKey(key: DelegatedViewKey): void;
/**
 * Derive a view-only key bundle (no spending key)
 * Safe to export/backup separately from spending key
 */
export declare function extractViewOnlyBundle(keys: ZVaultKeys): {
    solanaPublicKey: Uint8Array;
    spendingPubKey: Uint8Array;
    viewingPrivKey: Uint8Array;
    viewingPubKey: Uint8Array;
};
