/**
 * Stealth Key Derivation
 *
 * EIP-5564/DKSAP stealth key derivation functions.
 * Derives stealth public and private keys from ECDH shared secrets.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import {
  pointToCompressedBytes,
  scalarFromBytes,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_ORDER,
  type GrumpkinPoint,
} from "../crypto";

/**
 * Domain separator for stealth key derivation
 */
const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-stealth-v1");

/**
 * Derive stealth scalar from shared secret (EIP-5564 pattern)
 *
 * stealthScalar = hash(sharedSecret || domain) mod order
 *
 * @param sharedSecret - ECDH shared secret point
 * @returns Scalar for stealth key derivation
 */
export function deriveStealthScalar(sharedSecret: GrumpkinPoint): bigint {
  // Serialize shared secret point
  const sharedBytes = pointToCompressedBytes(sharedSecret);

  // Hash with domain separator
  const hashInput = new Uint8Array(sharedBytes.length + STEALTH_KEY_DOMAIN.length);
  hashInput.set(sharedBytes, 0);
  hashInput.set(STEALTH_KEY_DOMAIN, sharedBytes.length);

  const hash = sha256(hashInput);
  return scalarFromBytes(hash);
}

/**
 * Derive stealth public key (EIP-5564 pattern)
 *
 * stealthPub = spendingPub + hash(sharedSecret) * G
 *
 * @param spendingPub - Recipient's spending public key
 * @param sharedSecret - ECDH shared secret point
 * @returns Derived stealth public key
 */
export function deriveStealthPubKey(
  spendingPub: GrumpkinPoint,
  sharedSecret: GrumpkinPoint
): GrumpkinPoint {
  const scalar = deriveStealthScalar(sharedSecret);
  const scalarPoint = pointMul(scalar, GRUMPKIN_GENERATOR);
  return pointAdd(spendingPub, scalarPoint);
}

/**
 * Derive stealth private key (EIP-5564 pattern)
 *
 * stealthPriv = spendingPriv + hash(sharedSecret)
 *
 * @param spendingPriv - Recipient's spending private key
 * @param sharedSecret - ECDH shared secret point
 * @returns Derived stealth private key
 */
export function deriveStealthPrivKey(
  spendingPriv: bigint,
  sharedSecret: GrumpkinPoint
): bigint {
  const scalar = deriveStealthScalar(sharedSecret);
  // Add scalars modulo curve order
  return (spendingPriv + scalar) % GRUMPKIN_ORDER;
}
