/**
 * Optional .zkey Name Registry for zVault
 *
 * Allows users to register human-readable names like "albert.zkey"
 * for their stealth addresses.
 *
 * Privacy Note:
 * - Registering a name reveals you USE zVault (existence)
 * - But does NOT allow tracking your transactions (ECDH protects this)
 * - Use off-chain sharing if you want maximum privacy
 *
 * @example
 * ```typescript
 * // Register a name
 * const nameHash = hashName("albert");
 * await registerName(connection, payer, "albert", spendingPubKey, viewingPubKey);
 *
 * // Look up a name
 * const address = await lookupName(connection, "albert");
 * console.log(address.spendingPubKey, address.viewingPubKey);
 *
 * // Send to a name
 * const deposit = await sendToName(connection, "albert", 100000n);
 * ```
 */
import type { StealthMetaAddress } from "./keys";
/** Maximum name length (excluding .zkey suffix) */
export declare const MAX_NAME_LENGTH = 32;
/** Allowed characters in names */
export declare const NAME_REGEX: RegExp;
/**
 * Registered name entry
 */
export interface NameEntry {
    /** The registered name (without .zkey suffix) */
    name: string;
    /** SHA256 hash of the lowercase name */
    nameHash: Uint8Array;
    /** Grumpkin spending public key (33 bytes compressed) */
    spendingPubKey: Uint8Array;
    /** X25519 viewing public key (32 bytes) */
    viewingPubKey: Uint8Array;
    /** Owner's Solana public key (can update the entry) */
    owner: Uint8Array;
    /** Registration timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
}
/**
 * Name lookup result
 */
export interface NameLookupResult {
    /** Whether the name is registered */
    exists: boolean;
    /** The entry if it exists */
    entry?: NameEntry;
    /** Stealth meta-address if exists */
    stealthAddress?: StealthMetaAddress;
}
/**
 * Validate a name format
 *
 * Rules:
 * - 1-32 characters
 * - Lowercase letters, numbers, and underscores only
 * - No .zkey suffix (added automatically)
 *
 * @param name - The name to validate
 * @returns True if valid
 */
export declare function isValidName(name: string): boolean;
/**
 * Normalize a name (lowercase, trim, remove .zkey suffix)
 *
 * @param name - The name to normalize
 * @returns Normalized name
 */
export declare function normalizeName(name: string): string;
/**
 * Hash a name for PDA derivation
 *
 * @param name - The name (will be normalized)
 * @returns SHA256 hash of the normalized name
 */
export declare function hashName(name: string): Uint8Array;
/**
 * Format a name with .zkey suffix
 *
 * @param name - The name
 * @returns Name with .zkey suffix
 */
export declare function formatZkeyName(name: string): string;
/**
 * Build instruction data for REGISTER_NAME
 *
 * @param name - The name to register
 * @param spendingPubKey - Grumpkin spending public key (33 bytes)
 * @param viewingPubKey - X25519 viewing public key (32 bytes)
 * @returns Instruction data bytes
 */
export declare function buildRegisterNameData(name: string, spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Uint8Array;
/**
 * Build instruction data for UPDATE_NAME
 *
 * @param name - The name to update
 * @param spendingPubKey - New Grumpkin spending public key (33 bytes)
 * @param viewingPubKey - New X25519 viewing public key (32 bytes)
 * @returns Instruction data bytes
 */
export declare function buildUpdateNameData(name: string, spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Uint8Array;
/**
 * Build instruction data for TRANSFER_NAME
 *
 * @param name - The name to transfer
 * @returns Instruction data bytes (just the name hash)
 */
export declare function buildTransferNameData(name: string): Uint8Array;
/** Seed for name registry PDAs */
export declare const NAME_REGISTRY_SEED = "zkey";
/**
 * Derive the PDA for a name registry entry
 *
 * @param name - The name (will be normalized and hashed)
 * @param programId - The program ID
 * @returns PDA address and bump seed
 */
export declare function deriveNameRegistryPDA(name: string, programId: Uint8Array): {
    address: Uint8Array;
    bump: number;
};
/**
 * Parse a name entry from account data
 *
 * @param data - Raw account data
 * @returns Parsed name entry
 */
export declare function parseNameEntry(data: Uint8Array): NameEntry | null;
/**
 * Create a stealth meta-address from a name entry
 */
export declare function entryToStealthAddress(entry: NameEntry): StealthMetaAddress;
/**
 * Check if a name is available for registration
 *
 * @param name - The name to check
 * @returns True if available
 */
export declare function isNameAvailable(name: string): boolean;
/**
 * Format error message for invalid names
 */
export declare function getNameValidationError(name: string): string | null;
