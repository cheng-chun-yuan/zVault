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
import { type GrumpkinPoint } from "./grumpkin";
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
/** Message to sign for key derivation */
export declare const SPENDING_KEY_DERIVATION_MESSAGE = "zVault key derivation v1";
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
 * Uses Grumpkin for both spending and viewing keys (EIP-5564/DKSAP pattern).
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
 * It contains both spending and viewing public keys (both Grumpkin).
 *
 * Size: 66 bytes (33 + 33 compressed)
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
 * Parse a stealth meta-address and extract both Grumpkin public keys
 */
export declare function parseStealthMetaAddress(meta: StealthMetaAddress): {
    spendingPubKey: GrumpkinPoint;
    viewingPubKey: GrumpkinPoint;
};
/**
 * Encode stealth meta-address as a single string (66 bytes → hex)
 * Format: spendingPubKey (33 bytes) || viewingPubKey (33 bytes)
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
 * Note: BigInt values cannot be reliably cleared in JS.
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
    viewingPrivKey: bigint;
    viewingPubKey: Uint8Array;
};
