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
import { sha256 } from "@noble/hashes/sha256";
// ========== Constants ==========
/** Maximum name length (excluding .zkey suffix) */
export const MAX_NAME_LENGTH = 32;
/** Allowed characters in names */
export const NAME_REGEX = /^[a-z0-9_]{1,32}$/;
// ========== Name Utilities ==========
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
export function isValidName(name) {
    return NAME_REGEX.test(name);
}
/**
 * Normalize a name (lowercase, trim, remove .zkey suffix)
 *
 * @param name - The name to normalize
 * @returns Normalized name
 */
export function normalizeName(name) {
    let normalized = name.toLowerCase().trim();
    // Remove .zkey suffix if present
    if (normalized.endsWith(".zkey")) {
        normalized = normalized.slice(0, -5);
    }
    return normalized;
}
/**
 * Hash a name for PDA derivation
 *
 * @param name - The name (will be normalized)
 * @returns SHA256 hash of the normalized name
 */
export function hashName(name) {
    const normalized = normalizeName(name);
    if (!isValidName(normalized)) {
        throw new Error(`Invalid name "${name}". Must be 1-32 lowercase letters, numbers, or underscores.`);
    }
    const encoder = new TextEncoder();
    return sha256(encoder.encode(normalized));
}
/**
 * Format a name with .zkey suffix
 *
 * @param name - The name
 * @returns Name with .zkey suffix
 */
export function formatZkeyName(name) {
    const normalized = normalizeName(name);
    return `${normalized}.zkey`;
}
// ========== Instruction Data Builders ==========
/**
 * Build instruction data for REGISTER_NAME
 *
 * @param name - The name to register
 * @param spendingPubKey - Grumpkin spending public key (33 bytes)
 * @param viewingPubKey - X25519 viewing public key (32 bytes)
 * @returns Instruction data bytes
 */
export function buildRegisterNameData(name, spendingPubKey, viewingPubKey) {
    const normalized = normalizeName(name);
    if (!isValidName(normalized)) {
        throw new Error(`Invalid name: ${name}`);
    }
    const nameBytes = new TextEncoder().encode(normalized);
    const nameHash = hashName(normalized);
    if (spendingPubKey.length !== 33) {
        throw new Error("Spending public key must be 33 bytes (compressed Grumpkin)");
    }
    if (viewingPubKey.length !== 32) {
        throw new Error("Viewing public key must be 32 bytes (X25519)");
    }
    // Layout: name_len (1) + name + name_hash (32) + spending_pub (33) + viewing_pub (32)
    const data = new Uint8Array(1 + nameBytes.length + 32 + 33 + 32);
    let offset = 0;
    data[offset] = nameBytes.length;
    offset += 1;
    data.set(nameBytes, offset);
    offset += nameBytes.length;
    data.set(nameHash, offset);
    offset += 32;
    data.set(spendingPubKey, offset);
    offset += 33;
    data.set(viewingPubKey, offset);
    return data;
}
/**
 * Build instruction data for UPDATE_NAME
 *
 * @param name - The name to update
 * @param spendingPubKey - New Grumpkin spending public key (33 bytes)
 * @param viewingPubKey - New X25519 viewing public key (32 bytes)
 * @returns Instruction data bytes
 */
export function buildUpdateNameData(name, spendingPubKey, viewingPubKey) {
    const nameHash = hashName(name);
    if (spendingPubKey.length !== 33) {
        throw new Error("Spending public key must be 33 bytes");
    }
    if (viewingPubKey.length !== 32) {
        throw new Error("Viewing public key must be 32 bytes");
    }
    // Layout: name_hash (32) + spending_pub (33) + viewing_pub (32)
    const data = new Uint8Array(32 + 33 + 32);
    data.set(nameHash, 0);
    data.set(spendingPubKey, 32);
    data.set(viewingPubKey, 65);
    return data;
}
/**
 * Build instruction data for TRANSFER_NAME
 *
 * @param name - The name to transfer
 * @returns Instruction data bytes (just the name hash)
 */
export function buildTransferNameData(name) {
    return hashName(name);
}
// ========== PDA Derivation ==========
/** Seed for name registry PDAs */
export const NAME_REGISTRY_SEED = "zkey";
/**
 * Derive the PDA for a name registry entry
 *
 * @param name - The name (will be normalized and hashed)
 * @param programId - The program ID
 * @returns PDA address and bump seed
 */
export function deriveNameRegistryPDA(name, programId) {
    // Note: This is a placeholder - actual implementation would use
    // @solana/web3.js PublicKey.findProgramAddressSync
    const nameHash = hashName(name);
    // For now, return a placeholder
    // In real implementation:
    // const [address, bump] = PublicKey.findProgramAddressSync(
    //   [Buffer.from(NAME_REGISTRY_SEED), nameHash],
    //   new PublicKey(programId)
    // );
    return {
        address: new Uint8Array(32), // Placeholder
        bump: 255,
    };
}
// ========== Helper Functions ==========
/**
 * Parse a name entry from account data
 *
 * @param data - Raw account data
 * @returns Parsed name entry
 */
export function parseNameEntry(data) {
    if (data.length < 179) {
        return null;
    }
    // Check discriminator
    if (data[0] !== 0x09) {
        return null;
    }
    const nameHash = data.slice(2, 34);
    const owner = data.slice(34, 66);
    const spendingPubKey = data.slice(66, 99);
    const viewingPubKey = data.slice(99, 131);
    const createdAtBytes = data.slice(131, 139);
    const updatedAtBytes = data.slice(139, 147);
    const createdAt = new Date(Number(new DataView(createdAtBytes.buffer).getBigInt64(0, true)) * 1000);
    const updatedAt = new Date(Number(new DataView(updatedAtBytes.buffer).getBigInt64(0, true)) * 1000);
    return {
        name: "", // Name not stored on-chain, only hash
        nameHash,
        spendingPubKey,
        viewingPubKey,
        owner,
        createdAt,
        updatedAt,
    };
}
/**
 * Create a stealth meta-address from a name entry
 */
export function entryToStealthAddress(entry) {
    return {
        spendingPubKey: entry.spendingPubKey,
        viewingPubKey: entry.viewingPubKey,
    };
}
// ========== High-Level API ==========
/**
 * Check if a name is available for registration
 *
 * @param name - The name to check
 * @returns True if available
 */
export function isNameAvailable(name) {
    // Validate format first
    if (!isValidName(normalizeName(name))) {
        return false;
    }
    // In real implementation, would check on-chain
    // This is a placeholder for the SDK interface
    return true;
}
/**
 * Format error message for invalid names
 */
export function getNameValidationError(name) {
    const normalized = normalizeName(name);
    if (normalized.length === 0) {
        return "Name cannot be empty";
    }
    if (normalized.length > MAX_NAME_LENGTH) {
        return `Name cannot exceed ${MAX_NAME_LENGTH} characters`;
    }
    if (!NAME_REGEX.test(normalized)) {
        return "Name can only contain lowercase letters, numbers, and underscores";
    }
    return null;
}
