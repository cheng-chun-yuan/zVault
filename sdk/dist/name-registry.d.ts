/**
 * Name Registry utilities for ZVault
 *
 * Provides on-chain lookup for .zkey names (human-readable stealth addresses).
 * Names map to (spendingPubKey, viewingPubKey) for easy stealth sends.
 *
 * Example:
 * ```typescript
 * import { lookupZkeyName } from '@zvault/sdk';
 *
 * const entry = await lookupZkeyName(connection, 'alice');
 * if (entry) {
 *   console.log('Found alice.zkey:', entry.spendingPubKey);
 * }
 * ```
 */
/** Maximum name length (excluding .zkey suffix) */
export declare const MAX_NAME_LENGTH = 32;
/** PDA seed for name registry */
export declare const NAME_REGISTRY_SEED = "zkey";
/** Account discriminator */
export declare const NAME_REGISTRY_DISCRIMINATOR = 9;
/** Account size in bytes */
export declare const NAME_REGISTRY_SIZE = 179;
/** Default program ID (devnet) */
export declare const ZVAULT_PROGRAM_ID = "CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR";
/**
 * Parsed name registry entry from on-chain data
 */
export interface NameRegistryEntry {
    /** The registered name (without .zkey suffix) */
    name: string;
    /** SHA256 hash of the lowercase name */
    nameHash: Uint8Array;
    /** Solana pubkey of the owner (can update/transfer) */
    owner: Uint8Array;
    /** Grumpkin spending public key (33 bytes compressed) */
    spendingPubKey: Uint8Array;
    /** X25519 viewing public key (32 bytes) */
    viewingPubKey: Uint8Array;
    /** Registration timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
}
/**
 * Stealth meta-address derived from name registry
 */
export interface ZkeyStealthAddress {
    /** The .zkey name */
    name: string;
    /** Grumpkin spending public key (33 bytes) */
    spendingPubKey: Uint8Array;
    /** X25519 viewing public key (32 bytes) */
    viewingPubKey: Uint8Array;
    /** Combined stealth meta-address (65 bytes = spending + viewing) */
    stealthMetaAddress: Uint8Array;
    /** Hex-encoded stealth meta-address (130 chars) */
    stealthMetaAddressHex: string;
}
/**
 * Check if a name is valid (lowercase alphanumeric + underscore, 1-32 chars)
 */
export declare function isValidName(name: string): boolean;
/**
 * Normalize a name (lowercase, trim, remove .zkey suffix)
 */
export declare function normalizeName(name: string): string;
/**
 * Format a name with .zkey suffix
 */
export declare function formatZkeyName(name: string): string;
/**
 * Get validation error for a name, or null if valid
 */
export declare function getNameValidationError(name: string): string | null;
/**
 * Hash a name using SHA256 (matches on-chain)
 */
export declare function hashName(name: string): Uint8Array;
/**
 * Derive the PDA address for a name registry
 *
 * @param name - The name to look up (with or without .zkey suffix)
 * @param programId - The zVault program ID (defaults to devnet)
 * @returns [pda, bump] tuple
 */
export declare function deriveNameRegistryPDA(name: string, programId?: string): {
    pda: Uint8Array;
    bump: number;
    nameHash: Uint8Array;
};
/**
 * Parse a NameRegistry account data
 *
 * Layout (179 bytes):
 * - discriminator (1 byte) = 0x09
 * - bump (1 byte)
 * - name_hash (32 bytes)
 * - owner (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (32 bytes)
 * - created_at (8 bytes, i64 LE)
 * - updated_at (8 bytes, i64 LE)
 * - _reserved (32 bytes)
 *
 * @param data - Raw account data
 * @param name - Optional name to set in the result
 * @returns Parsed entry or null if invalid
 */
export declare function parseNameRegistry(data: Uint8Array, name?: string): NameRegistryEntry | null;
/**
 * Look up a .zkey name and return the stealth address
 *
 * This is a convenience function that:
 * 1. Derives the PDA for the name
 * 2. Fetches the account data
 * 3. Parses and returns the stealth address
 *
 * @param connection - Solana connection (must have getAccountInfo method)
 * @param name - The name to look up (with or without .zkey suffix)
 * @param programId - The zVault program ID
 * @returns Stealth address or null if not found
 */
export declare function lookupZkeyName(connection: {
    getAccountInfo: (pubkey: {
        toBytes(): Uint8Array;
    }) => Promise<{
        data: Uint8Array;
    } | null>;
}, name: string, programId?: string): Promise<ZkeyStealthAddress | null>;
/**
 * Look up a .zkey name with a pre-constructed PDA
 *
 * Use this when you already have the PDA (e.g., from frontend with wallet adapter)
 *
 * @param getAccountInfo - Function to fetch account data
 * @param pda - The pre-computed PDA
 * @param name - The name being looked up
 * @returns Stealth address or null if not found
 */
export declare function lookupZkeyNameWithPDA(getAccountInfo: () => Promise<{
    data: Uint8Array;
} | null>, name: string): Promise<ZkeyStealthAddress | null>;
/**
 * Build instruction data for REGISTER_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 17
 * - name_len (1 byte)
 * - name (name_len bytes)
 * - name_hash (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (32 bytes)
 */
export declare function buildRegisterNameData(name: string, spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Uint8Array;
/**
 * Build instruction data for UPDATE_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 18
 * - name_hash (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (32 bytes)
 */
export declare function buildUpdateNameData(name: string, spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Uint8Array;
/**
 * Build instruction data for TRANSFER_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 19
 * - name_hash (32 bytes)
 */
export declare function buildTransferNameData(name: string): Uint8Array;
