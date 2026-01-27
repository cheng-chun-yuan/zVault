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

import { sha256 } from "@noble/hashes/sha2.js";

// ========== Constants ==========

/** Maximum name length (excluding .zkey suffix) */
export const MAX_NAME_LENGTH = 32;

/** Allowed characters regex */
const NAME_REGEX = /^[a-z0-9_]{1,32}$/;

/** PDA seed for name registry */
export const NAME_REGISTRY_SEED = "zkey";

/** Account discriminator */
export const NAME_REGISTRY_DISCRIMINATOR = 0x09;

/** Account size in bytes */
export const NAME_REGISTRY_SIZE = 180;

/** Default program ID (devnet) */
export const ZVAULT_PROGRAM_ID = "BDH9iTYp2nBptboCcSmTn7GTkzYTzaMr7MMG5D5sXXRp";

// ========== Types ==========

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

  /** Grumpkin viewing public key (33 bytes compressed) */
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

  /** Grumpkin viewing public key (33 bytes compressed) */
  viewingPubKey: Uint8Array;

  /** Combined stealth meta-address (65 bytes = spending + viewing) */
  stealthMetaAddress: Uint8Array;

  /** Hex-encoded stealth meta-address (130 chars) */
  stealthMetaAddressHex: string;
}

// ========== Validation ==========

/**
 * Check if a name is valid (lowercase alphanumeric + underscore, 1-32 chars)
 */
export function isValidName(name: string): boolean {
  return NAME_REGEX.test(name);
}

/**
 * Normalize a name (lowercase, trim, remove .zkey suffix)
 */
export function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim();
  if (normalized.endsWith(".zkey")) {
    normalized = normalized.slice(0, -5);
  }
  return normalized;
}

/**
 * Format a name with .zkey suffix
 */
export function formatZkeyName(name: string): string {
  return `${normalizeName(name)}.zkey`;
}

/**
 * Get validation error for a name, or null if valid
 */
export function getNameValidationError(name: string): string | null {
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

// ========== Hashing ==========

/**
 * Hash a name using SHA256 (matches on-chain)
 */
export function hashName(name: string): Uint8Array {
  const normalized = normalizeName(name);
  if (!isValidName(normalized)) {
    throw new Error(
      `Invalid name "${name}". Must be 1-32 lowercase letters, numbers, or underscores.`
    );
  }
  const encoder = new TextEncoder();
  return sha256(encoder.encode(normalized));
}

// ========== PDA Derivation ==========

/**
 * Derive the PDA address for a name registry
 *
 * @param name - The name to look up (with or without .zkey suffix)
 * @param programId - The zVault program ID (defaults to devnet)
 * @returns [pda, bump] tuple
 */
export function deriveNameRegistryPDA(
  name: string,
  programId: string = ZVAULT_PROGRAM_ID
): { pda: Uint8Array; bump: number; nameHash: Uint8Array } {
  const nameHash = hashName(name);

  // Manual PDA derivation (platform-agnostic)
  // In practice, use PublicKey.findProgramAddressSync on Solana
  // This returns the hash for SDK consumers to use with their preferred library

  return {
    pda: new Uint8Array(32), // Placeholder - actual PDA derived by caller
    bump: 0,
    nameHash,
  };
}

// ========== On-chain Parsing ==========

/**
 * Parse a NameRegistry account data
 *
 * Layout (180 bytes):
 * - discriminator (1 byte) = 0x09
 * - bump (1 byte)
 * - name_hash (32 bytes)
 * - owner (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (33 bytes)
 * - created_at (8 bytes, i64 LE)
 * - updated_at (8 bytes, i64 LE)
 * - _reserved (32 bytes)
 *
 * @param data - Raw account data
 * @param name - Optional name to set in the result
 * @returns Parsed entry or null if invalid
 */
export function parseNameRegistry(
  data: Uint8Array,
  name?: string
): NameRegistryEntry | null {
  if (data.length < NAME_REGISTRY_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== NAME_REGISTRY_DISCRIMINATOR) {
    return null;
  }

  let offset = 2; // Skip discriminator and bump

  const nameHash = data.slice(offset, offset + 32);
  offset += 32;

  const owner = data.slice(offset, offset + 32);
  offset += 32;

  const spendingPubKey = data.slice(offset, offset + 33);
  offset += 33;

  const viewingPubKey = data.slice(offset, offset + 33);
  offset += 33;

  // Parse timestamps (i64 LE)
  const createdAtBytes = data.slice(offset, offset + 8);
  offset += 8;
  const updatedAtBytes = data.slice(offset, offset + 8);

  const createdAtView = new DataView(createdAtBytes.buffer, createdAtBytes.byteOffset, 8);
  const updatedAtView = new DataView(updatedAtBytes.buffer, updatedAtBytes.byteOffset, 8);

  const createdAt = new Date(Number(createdAtView.getBigInt64(0, true)) * 1000);
  const updatedAt = new Date(Number(updatedAtView.getBigInt64(0, true)) * 1000);

  return {
    name: name ? normalizeName(name) : "",
    nameHash,
    owner,
    spendingPubKey,
    viewingPubKey,
    createdAt,
    updatedAt,
  };
}

// ========== High-level Lookup ==========

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
export async function lookupZkeyName(
  connection: {
    getAccountInfo: (
      pubkey: { toBytes(): Uint8Array }
    ) => Promise<{ data: Uint8Array } | null>;
  },
  name: string,
  programId: string = ZVAULT_PROGRAM_ID
): Promise<ZkeyStealthAddress | null> {
  const normalized = normalizeName(name);
  const error = getNameValidationError(normalized);
  if (error) {
    return null;
  }

  try {
    const nameHash = hashName(normalized);

    // Caller must provide a way to derive PDA and fetch account
    // This is a platform-agnostic interface
    const { PublicKey } = await import("@solana/web3.js");

    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(NAME_REGISTRY_SEED), Buffer.from(nameHash)],
      new PublicKey(programId)
    );

    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) {
      return null;
    }

    const entry = parseNameRegistry(new Uint8Array(accountInfo.data), normalized);
    if (!entry) {
      return null;
    }

    // Combine spending + viewing into stealth meta-address (33 + 33 = 66 bytes)
    const stealthMetaAddress = new Uint8Array(66);
    stealthMetaAddress.set(entry.spendingPubKey, 0);
    stealthMetaAddress.set(entry.viewingPubKey, 33);

    return {
      name: normalized,
      spendingPubKey: entry.spendingPubKey,
      viewingPubKey: entry.viewingPubKey,
      stealthMetaAddress,
      stealthMetaAddressHex: Buffer.from(stealthMetaAddress).toString("hex"),
    };
  } catch (err) {
    console.error("Failed to lookup .zkey name:", err);
    return null;
  }
}

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
export async function lookupZkeyNameWithPDA(
  getAccountInfo: () => Promise<{ data: Uint8Array } | null>,
  name: string
): Promise<ZkeyStealthAddress | null> {
  const normalized = normalizeName(name);

  try {
    const accountInfo = await getAccountInfo();
    if (!accountInfo) {
      return null;
    }

    const entry = parseNameRegistry(new Uint8Array(accountInfo.data), normalized);
    if (!entry) {
      return null;
    }

    const stealthMetaAddress = new Uint8Array(66);
    stealthMetaAddress.set(entry.spendingPubKey, 0);
    stealthMetaAddress.set(entry.viewingPubKey, 33);

    return {
      name: normalized,
      spendingPubKey: entry.spendingPubKey,
      viewingPubKey: entry.viewingPubKey,
      stealthMetaAddress,
      stealthMetaAddressHex: Buffer.from(stealthMetaAddress).toString("hex"),
    };
  } catch (err) {
    console.error("Failed to lookup .zkey name:", err);
    return null;
  }
}

// ========== Instruction Data Builders ==========

/**
 * Build instruction data for REGISTER_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 17
 * - name_len (1 byte)
 * - name (name_len bytes)
 * - name_hash (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (33 bytes)
 */
export function buildRegisterNameData(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array
): Uint8Array {
  const normalized = normalizeName(name);
  const error = getNameValidationError(normalized);
  if (error) {
    throw new Error(error);
  }

  if (spendingPubKey.length !== 33) {
    throw new Error("Spending public key must be 33 bytes (compressed Grumpkin)");
  }
  if (viewingPubKey.length !== 33) {
    throw new Error("Viewing public key must be 33 bytes (compressed Grumpkin)");
  }

  const nameBytes = new TextEncoder().encode(normalized);
  const nameHash = hashName(normalized);

  // Total size: 1 + 1 + nameLen + 32 + 33 + 33
  const data = new Uint8Array(1 + 1 + nameBytes.length + 32 + 33 + 33);
  let offset = 0;

  // Discriminator
  data[offset++] = 17; // REGISTER_NAME

  // Name length and name
  data[offset++] = nameBytes.length;
  data.set(nameBytes, offset);
  offset += nameBytes.length;

  // Name hash
  data.set(nameHash, offset);
  offset += 32;

  // Spending pubkey
  data.set(spendingPubKey, offset);
  offset += 33;

  // Viewing pubkey
  data.set(viewingPubKey, offset);

  return data;
}

/**
 * Build instruction data for UPDATE_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 18
 * - name_hash (32 bytes)
 * - spending_pubkey (33 bytes)
 * - viewing_pubkey (33 bytes)
 */
export function buildUpdateNameData(
  name: string,
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array
): Uint8Array {
  const nameHash = hashName(name);

  if (spendingPubKey.length !== 33) {
    throw new Error("Spending public key must be 33 bytes");
  }
  if (viewingPubKey.length !== 33) {
    throw new Error("Viewing public key must be 33 bytes");
  }

  const data = new Uint8Array(1 + 32 + 33 + 33);
  let offset = 0;

  data[offset++] = 18; // UPDATE_NAME
  data.set(nameHash, offset);
  offset += 32;
  data.set(spendingPubKey, offset);
  offset += 33;
  data.set(viewingPubKey, offset);

  return data;
}

/**
 * Build instruction data for TRANSFER_NAME
 *
 * Layout:
 * - discriminator (1 byte) = 19
 * - name_hash (32 bytes)
 */
export function buildTransferNameData(name: string): Uint8Array {
  const nameHash = hashName(name);

  const data = new Uint8Array(1 + 32);
  data[0] = 19; // TRANSFER_NAME
  data.set(nameHash, 1);

  return data;
}
