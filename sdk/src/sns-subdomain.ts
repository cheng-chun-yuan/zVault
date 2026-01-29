/**
 * SNS (Solana Name Service) Subdomain Integration for zVault
 *
 * Enables registration of .zkey.sol subdomains that point to stealth addresses.
 * Example: alice.zkey.sol → Stealth Meta-Address
 *
 * Benefits:
 * - Leverages existing SNS ecosystem (150+ apps)
 * - Free on devnet (only gas fees)
 * - Cross-chain compatible (MetaMask integration)
 *
 * @module sns-subdomain
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { StealthMetaAddress } from "./keys";

// =============================================================================
// Constants
// =============================================================================

/** SNS Program ID (same for devnet and mainnet) */
export const SNS_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX"
);

/** SNS Root Domain Account */
const ROOT_DOMAIN_ACCOUNT = new PublicKey(
  "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx"
);

/** Parent domain for zVault subdomains */
const ZKEY_PARENT_DOMAIN = "zkey";

/** Devnet-specific constants */
export const DEVNET_SNS_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX"
);

/** Hash prefix for SNS domain names */
const HASH_PREFIX = "SPL Name Service";

// =============================================================================
// Types
// =============================================================================

export interface SnsSubdomainConfig {
  /** Solana connection */
  connection: Connection;
  /** Parent domain (default: "zkey") */
  parentDomain?: string;
  /** Network (devnet/mainnet) */
  network?: "devnet" | "mainnet";
}

export interface SubdomainRegistration {
  /** Subdomain name (e.g., "alice" for alice.zkey.sol) */
  name: string;
  /** Owner's public key */
  owner: PublicKey;
  /** Stealth meta-address to store */
  stealthAddress: StealthMetaAddress;
}

export interface ResolvedSubdomain {
  /** Full domain name (e.g., alice.zkey.sol) */
  fullName: string;
  /** Owner public key */
  owner: PublicKey;
  /** Stealth meta-address */
  stealthAddress: StealthMetaAddress;
  /** Domain account public key */
  domainKey: PublicKey;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Hash a domain name using SNS hashing scheme
 */
function hashDomainName(name: string): Uint8Array {
  const input = HASH_PREFIX + name;
  return sha256(new TextEncoder().encode(input));
}

/**
 * Derive the domain account key from a domain name
 */
async function getDomainKey(
  name: string,
  parentKey?: PublicKey
): Promise<[PublicKey, number]> {
  const hashedName = hashDomainName(name);
  const seeds = parentKey
    ? [hashedName, parentKey.toBytes()]
    : [hashedName];

  return PublicKey.findProgramAddressSync(
    [Buffer.from(hashedName), parentKey?.toBuffer() ?? ROOT_DOMAIN_ACCOUNT.toBuffer()],
    SNS_PROGRAM_ID
  );
}

/**
 * Derive the parent domain key for zkey.sol
 */
async function getParentDomainKey(
  parentDomain: string = ZKEY_PARENT_DOMAIN
): Promise<[PublicKey, number]> {
  return getDomainKey(parentDomain, ROOT_DOMAIN_ACCOUNT);
}

/**
 * Encode stealth meta-address for storage (66 bytes)
 */
function encodeStealthAddress(meta: StealthMetaAddress): Uint8Array {
  const data = new Uint8Array(66);
  data.set(meta.spendingPubKey, 0);
  data.set(meta.viewingPubKey, 33);
  return data;
}

/**
 * Decode stealth meta-address from storage
 */
function decodeStealthAddress(data: Uint8Array): StealthMetaAddress | null {
  if (data.length < 66) return null;
  return {
    spendingPubKey: data.slice(0, 33),
    viewingPubKey: data.slice(33, 66),
  };
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Create instruction to register a subdomain with stealth address
 *
 * Creates `alice.zkey.sol` pointing to the user's stealth meta-address.
 *
 * **Cost on devnet**: Only gas fees (~0.00001 SOL)
 * **Cost on mainnet**: Gas + 5% fee to parent domain owner
 *
 * @param config - SNS configuration
 * @param registration - Subdomain registration details
 * @returns Transaction instruction for registration
 *
 * @example
 * ```typescript
 * const ix = await createSubdomainInstruction(
 *   { connection },
 *   {
 *     name: "alice",
 *     owner: wallet.publicKey,
 *     stealthAddress: myStealthMeta,
 *   }
 * );
 * ```
 */
export async function createSubdomainInstruction(
  config: SnsSubdomainConfig,
  registration: SubdomainRegistration
): Promise<TransactionInstruction[]> {
  const parentDomain = config.parentDomain ?? ZKEY_PARENT_DOMAIN;
  const name = registration.name.toLowerCase().replace(/\.zkey\.sol$/, "");

  // Validate name
  if (!isValidSubdomainName(name)) {
    throw new Error(
      `Invalid subdomain name: "${name}". Must be 1-32 lowercase alphanumeric characters.`
    );
  }

  // Get parent domain key
  const [parentKey] = await getParentDomainKey(parentDomain);

  // Get subdomain key
  const [subdomainKey] = await getDomainKey(name, parentKey);

  // Encode stealth address data
  const stealthData = encodeStealthAddress(registration.stealthAddress);

  // Space needed: 96 bytes (header) + 66 bytes (stealth address)
  const space = 96 + 66;

  // Calculate rent
  const lamports = await config.connection.getMinimumBalanceForRentExemption(space);

  // Build create subdomain instruction
  // SNS instruction format: [discriminator, name_length, name, space]
  const nameBytes = new TextEncoder().encode(name);
  const instructionData = Buffer.alloc(1 + 4 + nameBytes.length + 4 + stealthData.length);
  let offset = 0;

  // Discriminator for create subdomain (1)
  instructionData.writeUInt8(1, offset);
  offset += 1;

  // Name length (4 bytes LE)
  instructionData.writeUInt32LE(nameBytes.length, offset);
  offset += 4;

  // Name bytes
  instructionData.set(nameBytes, offset);
  offset += nameBytes.length;

  // Space (4 bytes LE)
  instructionData.writeUInt32LE(space, offset);
  offset += 4;

  // Stealth address data
  instructionData.set(stealthData, offset);

  const createSubdomainIx = new TransactionInstruction({
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: registration.owner, isSigner: true, isWritable: true },
      { pubkey: subdomainKey, isSigner: false, isWritable: true },
      { pubkey: parentKey, isSigner: false, isWritable: true },
      { pubkey: SNS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: SNS_PROGRAM_ID,
    data: instructionData,
  });

  return [createSubdomainIx];
}

/**
 * Resolve a subdomain to its stealth address
 *
 * @param config - SNS configuration
 * @param name - Subdomain name (e.g., "alice" or "alice.zkey.sol")
 * @returns Resolved subdomain with stealth address, or null if not found
 *
 * @example
 * ```typescript
 * const result = await resolveSubdomain({ connection }, "alice");
 * if (result) {
 *   console.log("Stealth address:", result.stealthAddress);
 * }
 * ```
 */
export async function resolveSubdomain(
  config: SnsSubdomainConfig,
  name: string
): Promise<ResolvedSubdomain | null> {
  const parentDomain = config.parentDomain ?? ZKEY_PARENT_DOMAIN;
  const cleanName = name.toLowerCase().replace(/\.zkey\.sol$/, "");

  try {
    // Get parent domain key
    const [parentKey] = await getParentDomainKey(parentDomain);

    // Get subdomain key
    const [subdomainKey] = await getDomainKey(cleanName, parentKey);

    // Fetch account data
    const accountInfo = await config.connection.getAccountInfo(subdomainKey);
    if (!accountInfo) {
      return null;
    }

    // Parse account data
    // SNS account format: [header (96 bytes), data]
    const data = accountInfo.data;
    if (data.length < 96 + 66) {
      return null;
    }

    // Extract owner from header (offset 32, 32 bytes)
    const owner = new PublicKey(data.slice(32, 64));

    // Extract stealth address from data section
    const stealthData = data.slice(96, 96 + 66);
    const stealthAddress = decodeStealthAddress(stealthData);
    if (!stealthAddress) {
      return null;
    }

    return {
      fullName: `${cleanName}.${parentDomain}.sol`,
      owner,
      stealthAddress,
      domainKey: subdomainKey,
    };
  } catch (error) {
    console.error("Failed to resolve subdomain:", error);
    return null;
  }
}

/**
 * Check if a subdomain is available
 *
 * @param config - SNS configuration
 * @param name - Subdomain name to check
 * @returns true if available, false if taken
 */
export async function isSubdomainAvailable(
  config: SnsSubdomainConfig,
  name: string
): Promise<boolean> {
  const resolved = await resolveSubdomain(config, name);
  return resolved === null;
}

/**
 * Validate a subdomain name
 *
 * Rules:
 * - 1-32 characters
 * - Lowercase alphanumeric only (a-z, 0-9)
 * - No special characters, spaces, or uppercase
 */
export function isValidSubdomainName(name: string): boolean {
  if (name.length < 1 || name.length > 32) return false;
  return /^[a-z0-9]+$/.test(name);
}

/**
 * Format a full subdomain name
 *
 * @param name - Base name (e.g., "alice")
 * @param parentDomain - Parent domain (default: "zkey")
 * @returns Full name (e.g., "alice.zkey.sol")
 */
export function formatSubdomainName(
  name: string,
  parentDomain: string = ZKEY_PARENT_DOMAIN
): string {
  const clean = name.toLowerCase().replace(/\.zkey\.sol$/, "").replace(/\.sol$/, "");
  return `${clean}.${parentDomain}.sol`;
}

// =============================================================================
// High-Level API (Convenience Functions)
// =============================================================================

/**
 * Register a .zkey.sol subdomain with stealth address
 *
 * High-level function that handles the full registration flow.
 *
 * @param connection - Solana connection
 * @param name - Subdomain name (e.g., "alice")
 * @param owner - Owner's public key
 * @param stealthAddress - Stealth meta-address to associate
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 *
 * @example
 * ```typescript
 * const sig = await registerZkeySubdomain(
 *   connection,
 *   "alice",
 *   wallet.publicKey,
 *   myStealthMeta,
 *   wallet.signTransaction
 * );
 * console.log("Registered alice.zkey.sol:", sig);
 * ```
 */
export async function registerZkeySubdomain(
  connection: Connection,
  name: string,
  owner: PublicKey,
  stealthAddress: StealthMetaAddress,
  signTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  // Check availability
  const available = await isSubdomainAvailable({ connection }, name);
  if (!available) {
    throw new Error(`Subdomain "${name}.zkey.sol" is already taken`);
  }

  // Create instructions
  const instructions = await createSubdomainInstruction(
    { connection },
    { name, owner, stealthAddress }
  );

  // Build transaction
  const tx = new Transaction();
  tx.add(...instructions);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // Sign and send
  const signedTx = await signTransaction(tx);
  const signature = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(signature);

  return signature;
}

/**
 * Lookup a .zkey.sol subdomain and return the stealth address
 *
 * @param connection - Solana connection
 * @param name - Subdomain name (e.g., "alice" or "alice.zkey.sol")
 * @returns Stealth meta-address or null if not found
 *
 * @example
 * ```typescript
 * const stealth = await lookupZkeySubdomain(connection, "alice");
 * if (stealth) {
 *   const deposit = await createStealthDeposit(stealth, 100_000n);
 * }
 * ```
 */
export async function lookupZkeySubdomain(
  connection: Connection,
  name: string
): Promise<StealthMetaAddress | null> {
  const resolved = await resolveSubdomain({ connection }, name);
  return resolved?.stealthAddress ?? null;
}

// =============================================================================
// Exports
// =============================================================================

export {
  ZKEY_PARENT_DOMAIN,
  hashDomainName,
  getDomainKey,
  getParentDomainKey,
  encodeStealthAddress,
  decodeStealthAddress,
};
