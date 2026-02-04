/**
 * Stealth Amount Encryption
 *
 * Amount encryption/decryption using ECDH shared secrets.
 * Uses XOR encryption with SHA256-derived keys.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import {
  scalarToBytes,
  type GrumpkinPoint,
} from "../crypto";

// ========== Amount Encryption Helpers ==========

/**
 * Derive encryption key from ECDH shared secret
 *
 * Uses SHA256 of the shared secret's x-coordinate to derive an 8-byte key.
 * Both sender and recipient can compute this from their respective keys:
 * - Sender: sha256(ECDH(ephemeralPriv, viewingPub).x)
 * - Recipient: sha256(ECDH(viewingPriv, ephemeralPub).x)
 */
export function deriveAmountEncryptionKey(sharedSecret: GrumpkinPoint): Uint8Array {
  const sharedSecretBytes = scalarToBytes(sharedSecret.x);
  const hash = sha256(sharedSecretBytes);
  return hash.slice(0, 8); // First 8 bytes as encryption key
}

/**
 * Encrypt amount using XOR with derived key
 *
 * @param amount - Amount in satoshis (bigint)
 * @param sharedSecret - ECDH shared secret point
 * @returns 8 bytes of encrypted amount
 */
export function encryptAmount(amount: bigint, sharedSecret: GrumpkinPoint): Uint8Array {
  const key = deriveAmountEncryptionKey(sharedSecret);
  const amountBytes = new Uint8Array(8);

  // Convert amount to little-endian bytes
  let temp = amount;
  for (let i = 0; i < 8; i++) {
    amountBytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }

  // XOR with key
  const encrypted = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    encrypted[i] = amountBytes[i] ^ key[i];
  }

  return encrypted;
}

/**
 * Decrypt amount using XOR with derived key
 *
 * @param encryptedAmount - 8 bytes of encrypted amount
 * @param sharedSecret - ECDH shared secret point
 * @returns Decrypted amount in satoshis (bigint)
 */
export function decryptAmount(encryptedAmount: Uint8Array, sharedSecret: GrumpkinPoint): bigint {
  const key = deriveAmountEncryptionKey(sharedSecret);

  // XOR with key to decrypt
  const decrypted = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    decrypted[i] = encryptedAmount[i] ^ key[i];
  }

  // Convert little-endian bytes to bigint
  let amount = 0n;
  for (let i = 7; i >= 0; i--) {
    amount = (amount << 8n) | BigInt(decrypted[i]);
  }

  return amount;
}
