/**
 * Stealth Announcement Parsing
 *
 * On-chain data parsing and circuit packing utilities.
 */

import {
  bigintToBytes,
  bytesToBigint,
} from "../crypto";
import {
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  type OnChainStealthAnnouncement,
  type AnnouncementScanFormat,
} from "./types";

// ========== On-chain Parsing ==========

/**
 * Parse a StealthAnnouncement account data (single ephemeral key)
 *
 * Layout (91 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - encrypted_amount (8 bytes) - XOR encrypted with shared secret
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * Note: The amount is encrypted and can only be decrypted by the recipient
 * using their viewing key. Use scanAnnouncements() to decrypt.
 */
export function parseStealthAnnouncement(
  data: Uint8Array
): OnChainStealthAnnouncement | null {
  if (data.length < STEALTH_ANNOUNCEMENT_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== STEALTH_ANNOUNCEMENT_DISCRIMINATOR) {
    return null;
  }

  let offset = 2; // Skip discriminator and bump

  const ephemeralPub = data.slice(offset, offset + 33);
  offset += 33;

  // Parse encrypted_amount (8 bytes, raw - will be decrypted by recipient)
  const encryptedAmount = data.slice(offset, offset + 8);
  offset += 8;

  const commitment = data.slice(offset, offset + 32);
  offset += 32;

  // Parse leaf_index (8 bytes, LE) with overflow check
  const leafIndexView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const leafIndexBigInt = leafIndexView.getBigUint64(0, true);
  // Check for overflow - leaf index should fit in safe integer range
  if (leafIndexBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Leaf index overflow - value exceeds safe integer range");
  }
  const leafIndex = Number(leafIndexBigInt);
  offset += 8;

  // Parse created_at (8 bytes, LE) with overflow check
  const createdAtView = new DataView(
    data.buffer,
    data.byteOffset + offset,
    8
  );
  const createdAtBigInt = createdAtView.getBigInt64(0, true);
  // Clamp timestamp to safe range (negative timestamps are invalid)
  const maxSafeTimestamp = BigInt(Number.MAX_SAFE_INTEGER);
  const createdAt = createdAtBigInt < 0n ? 0 :
    createdAtBigInt > maxSafeTimestamp ? Number.MAX_SAFE_INTEGER :
    Number(createdAtBigInt);

  return {
    ephemeralPub,
    encryptedAmount,
    commitment,
    leafIndex,
    createdAt,
  };
}

/**
 * Convert on-chain announcement to format expected by scanAnnouncements
 */
export function announcementToScanFormat(
  announcement: OnChainStealthAnnouncement
): AnnouncementScanFormat {
  return {
    ephemeralPub: announcement.ephemeralPub,
    encryptedAmount: announcement.encryptedAmount,
    commitment: announcement.commitment,
    leafIndex: announcement.leafIndex,
  };
}

// ========== Circuit Packing Utilities ==========

/**
 * Extract y-coordinate sign from compressed Grumpkin pubkey
 *
 * Compressed format: prefix byte (0x02 for even y, 0x03 for odd y) + 32-byte x
 *
 * @param compressedPub - 33-byte compressed Grumpkin pubkey
 * @returns true if y is odd (prefix 0x03), false if y is even (prefix 0x02)
 */
export function extractYSign(compressedPub: Uint8Array): boolean {
  if (compressedPub.length !== 33) {
    throw new Error("Compressed pubkey must be 33 bytes");
  }
  const prefix = compressedPub[0];
  if (prefix === 0x02) return false; // y is even
  if (prefix === 0x03) return true;  // y is odd
  throw new Error(`Invalid compressed pubkey prefix: 0x${prefix.toString(16)}`);
}

/**
 * Extract x-coordinate from compressed Grumpkin pubkey
 *
 * @param compressedPub - 33-byte compressed Grumpkin pubkey
 * @returns x-coordinate as bigint
 */
export function extractX(compressedPub: Uint8Array): bigint {
  if (compressedPub.length !== 33) {
    throw new Error("Compressed pubkey must be 33 bytes");
  }
  return bytesToBigint(compressedPub.slice(1, 33));
}

/**
 * Pack encrypted amount and y_sign into a single Field element
 *
 * Layout: bits 0-63 = encrypted amount (little-endian), bit 64 = y_sign
 *
 * @param encryptedAmount - 8-byte XOR encrypted amount
 * @param ySign - true if y is odd, false if y is even
 * @returns Packed value as bigint
 */
export function packEncryptedAmountWithSign(encryptedAmount: Uint8Array, ySign: boolean): bigint {
  if (encryptedAmount.length !== 8) {
    throw new Error("Encrypted amount must be 8 bytes");
  }

  // Convert encrypted amount to bigint (little-endian)
  let amount = 0n;
  for (let i = 7; i >= 0; i--) {
    amount = (amount << 8n) | BigInt(encryptedAmount[i]);
  }

  // Set bit 64 if y is odd
  if (ySign) {
    amount |= (1n << 64n);
  }

  return amount;
}

/**
 * Unpack encrypted amount and y_sign from packed Field element
 *
 * @param packed - Packed value (bits 0-63 = encrypted amount, bit 64 = y_sign)
 * @returns Object with encryptedAmount (8 bytes) and ySign (boolean)
 */
export function unpackEncryptedAmountWithSign(packed: bigint): { encryptedAmount: Uint8Array; ySign: boolean } {
  const ySign = (packed & (1n << 64n)) !== 0n;
  const amount = packed & ((1n << 64n) - 1n);

  // Convert to 8-byte little-endian
  const encryptedAmount = new Uint8Array(8);
  let temp = amount;
  for (let i = 0; i < 8; i++) {
    encryptedAmount[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }

  return { encryptedAmount, ySign };
}

/**
 * Reconstruct compressed pubkey from x-coordinate and y_sign
 *
 * @param x - x-coordinate as bigint
 * @param ySign - true if y is odd (use 0x03), false if y is even (use 0x02)
 * @returns 33-byte compressed Grumpkin pubkey
 */
export function reconstructCompressedPub(x: bigint, ySign: boolean): Uint8Array {
  const compressed = new Uint8Array(33);
  compressed[0] = ySign ? 0x03 : 0x02;
  const xBytes = bigintToBytes(x);
  compressed.set(xBytes, 1);
  return compressed;
}

/**
 * Convert StealthOutputData to circuit-ready format
 *
 * Extracts ephemeral pubkey x-coordinate and packs encrypted amount with y_sign.
 * This format is used as circuit public inputs for relayer-safe stealth announcements.
 *
 * @param output - Stealth output data from createStealthOutput()
 * @returns Circuit-ready ephemeralPubX and encryptedAmountWithSign
 */
export function packStealthOutputForCircuit(output: {
  ephemeralPub: Uint8Array;
  encryptedAmount: Uint8Array;
}): { ephemeralPubX: bigint; encryptedAmountWithSign: bigint } {
  const ephemeralPubX = extractX(output.ephemeralPub);
  const ySign = extractYSign(output.ephemeralPub);
  const encryptedAmountWithSign = packEncryptedAmountWithSign(output.encryptedAmount, ySign);

  return {
    ephemeralPubX,
    encryptedAmountWithSign,
  };
}
