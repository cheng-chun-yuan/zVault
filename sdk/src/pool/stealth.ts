/**
 * Stealth Key Derivation (EIP-5564/DKSAP Pattern)
 *
 * Internal utilities for deriving stealth keys used in the yield pool.
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
import { STEALTH_KEY_DOMAIN } from "./constants";

/**
 * Derive stealth scalar from shared secret
 *
 * stealthScalar = hash(sharedSecret || domain) mod order
 */
export function deriveStealthScalar(sharedSecret: GrumpkinPoint): bigint {
  const sharedBytes = pointToCompressedBytes(sharedSecret);
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
 */
export function deriveStealthPrivKey(
  spendingPriv: bigint,
  sharedSecret: GrumpkinPoint
): bigint {
  const scalar = deriveStealthScalar(sharedSecret);
  return (spendingPriv + scalar) % GRUMPKIN_ORDER;
}
