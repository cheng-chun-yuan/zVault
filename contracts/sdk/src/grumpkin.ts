/**
 * Grumpkin Curve Operations for zVault
 *
 * Grumpkin is Noir's embedded curve - an elliptic curve defined over the BN254 scalar field.
 * This makes it extremely efficient for in-circuit ECDH operations (~2k constraints vs ~300k for X25519).
 *
 * Curve Parameters:
 * - Equation: y² = x³ - 17 (a = 0, b = -17)
 * - Base Field: BN254 scalar field (21888242871839275222246405745257275088548364400416034343698204186575808495617)
 * - Order: 21888242871839275222246405745257275088696311157297823662689037894645226208583
 *
 * @see https://hackmd.io/@aztec-network/grumpkin
 */

import { sha256 } from "@noble/hashes/sha256";

// Grumpkin curve parameters
// Base field is the BN254 scalar field
export const GRUMPKIN_FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Grumpkin curve order (number of points on the curve)
export const GRUMPKIN_ORDER =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// Curve coefficient: y² = x³ - 17
export const GRUMPKIN_B = -17n;

// Generator point (standard Grumpkin generator)
export const GRUMPKIN_GENERATOR = {
  x: 1n,
  y: 17631683881184975370165255887551781615748388533673675138860n,
};

/**
 * Point on the Grumpkin curve (affine coordinates)
 */
export interface GrumpkinPoint {
  x: bigint;
  y: bigint;
}

/**
 * Point at infinity (identity element)
 */
export const GRUMPKIN_INFINITY: GrumpkinPoint = { x: 0n, y: 0n };

/**
 * Check if a point is the point at infinity
 */
export function isInfinity(point: GrumpkinPoint): boolean {
  return point.x === 0n && point.y === 0n;
}

/**
 * Modular arithmetic helpers
 */
function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

function modInverse(a: bigint, p: bigint): bigint {
  let [old_r, r] = [a, p];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }

  return mod(old_s, p);
}

/**
 * Verify a point is on the Grumpkin curve
 */
export function isOnCurve(point: GrumpkinPoint): boolean {
  if (isInfinity(point)) return true;

  const { x, y } = point;
  const p = GRUMPKIN_FIELD_PRIME;

  // Check y² = x³ - 17 (mod p)
  const lhs = mod(y * y, p);
  const rhs = mod(x * x * x + GRUMPKIN_B, p);

  return lhs === rhs;
}

/**
 * Point addition on Grumpkin curve
 */
export function pointAdd(
  p1: GrumpkinPoint,
  p2: GrumpkinPoint
): GrumpkinPoint {
  const p = GRUMPKIN_FIELD_PRIME;

  if (isInfinity(p1)) return p2;
  if (isInfinity(p2)) return p1;

  const { x: x1, y: y1 } = p1;
  const { x: x2, y: y2 } = p2;

  // P + (-P) = O
  if (x1 === x2 && mod(y1 + y2, p) === 0n) {
    return GRUMPKIN_INFINITY;
  }

  let lambda: bigint;

  if (x1 === x2 && y1 === y2) {
    // Point doubling: λ = (3x₁² + a) / (2y₁), where a = 0 for Grumpkin
    lambda = mod(3n * x1 * x1 * modInverse(2n * y1, p), p);
  } else {
    // Point addition: λ = (y₂ - y₁) / (x₂ - x₁)
    lambda = mod((y2 - y1) * modInverse(mod(x2 - x1, p), p), p);
  }

  // x₃ = λ² - x₁ - x₂
  const x3 = mod(lambda * lambda - x1 - x2, p);
  // y₃ = λ(x₁ - x₃) - y₁
  const y3 = mod(lambda * (x1 - x3) - y1, p);

  return { x: x3, y: y3 };
}

/**
 * Point doubling on Grumpkin curve
 */
export function pointDouble(point: GrumpkinPoint): GrumpkinPoint {
  return pointAdd(point, point);
}

/**
 * Scalar multiplication using double-and-add algorithm
 * Returns scalar * point
 */
export function pointMul(scalar: bigint, point: GrumpkinPoint): GrumpkinPoint {
  // Reduce scalar modulo curve order
  scalar = mod(scalar, GRUMPKIN_ORDER);

  if (scalar === 0n || isInfinity(point)) {
    return GRUMPKIN_INFINITY;
  }

  let result = GRUMPKIN_INFINITY;
  let temp = point;

  while (scalar > 0n) {
    if (scalar & 1n) {
      result = pointAdd(result, temp);
    }
    temp = pointDouble(temp);
    scalar = scalar >> 1n;
  }

  return result;
}

/**
 * Negate a point (flip y coordinate)
 */
export function pointNegate(point: GrumpkinPoint): GrumpkinPoint {
  if (isInfinity(point)) return point;
  return {
    x: point.x,
    y: mod(-point.y, GRUMPKIN_FIELD_PRIME),
  };
}

/**
 * Derive a Grumpkin scalar from bytes (reduces modulo curve order)
 */
export function scalarFromBytes(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return mod(result, GRUMPKIN_ORDER);
}

/**
 * Convert a bigint scalar to 32 bytes (big-endian)
 */
export function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = mod(scalar, GRUMPKIN_ORDER);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return bytes;
}

/**
 * Convert a point to bytes (uncompressed: 64 bytes, x || y)
 */
export function pointToBytes(point: GrumpkinPoint): Uint8Array {
  const bytes = new Uint8Array(64);
  const xBytes = scalarToBytes(point.x);
  const yBytes = scalarToBytes(point.y);
  bytes.set(xBytes, 0);
  bytes.set(yBytes, 32);
  return bytes;
}

/**
 * Convert a point to compressed bytes (33 bytes: sign byte || x)
 */
export function pointToCompressedBytes(point: GrumpkinPoint): Uint8Array {
  if (isInfinity(point)) {
    return new Uint8Array(33); // All zeros for infinity
  }

  const bytes = new Uint8Array(33);
  // Sign byte: 0x02 if y is even, 0x03 if y is odd
  bytes[0] = (point.y & 1n) === 0n ? 0x02 : 0x03;

  const xBytes = scalarToBytes(point.x);
  bytes.set(xBytes, 1);
  return bytes;
}

/**
 * Recover y coordinate from x and sign
 * y² = x³ - 17
 */
function recoverY(x: bigint, isOdd: boolean): bigint {
  const p = GRUMPKIN_FIELD_PRIME;
  const rhs = mod(x * x * x + GRUMPKIN_B, p);

  // Tonelli-Shanks square root (simplified for this prime)
  // p ≡ 3 (mod 4), so sqrt(a) = a^((p+1)/4)
  const exp = (p + 1n) / 4n;
  let y = modPow(rhs, exp, p);

  // Check if we got the right parity
  const yIsOdd = (y & 1n) === 1n;
  if (yIsOdd !== isOdd) {
    y = mod(-y, p);
  }

  return y;
}

/**
 * Modular exponentiation
 */
function modPow(base: bigint, exp: bigint, p: bigint): bigint {
  let result = 1n;
  base = mod(base, p);

  while (exp > 0n) {
    if (exp & 1n) {
      result = mod(result * base, p);
    }
    exp = exp >> 1n;
    base = mod(base * base, p);
  }

  return result;
}

/**
 * Convert bytes to a point (uncompressed: 64 bytes)
 */
export function pointFromBytes(bytes: Uint8Array): GrumpkinPoint {
  if (bytes.length !== 64) {
    throw new Error("Expected 64 bytes for uncompressed point");
  }

  const x = scalarFromBytes(bytes.slice(0, 32));
  const y = scalarFromBytes(bytes.slice(32, 64));
  const point = { x, y };

  if (!isOnCurve(point)) {
    throw new Error("Point is not on the Grumpkin curve");
  }

  return point;
}

/**
 * Convert compressed bytes to a point (33 bytes)
 */
export function pointFromCompressedBytes(bytes: Uint8Array): GrumpkinPoint {
  if (bytes.length !== 33) {
    throw new Error("Expected 33 bytes for compressed point");
  }

  // Check for infinity
  if (bytes.every((b) => b === 0)) {
    return GRUMPKIN_INFINITY;
  }

  const sign = bytes[0];
  if (sign !== 0x02 && sign !== 0x03) {
    throw new Error("Invalid compression prefix");
  }

  const x = scalarFromBytes(bytes.slice(1, 33));
  const isOdd = sign === 0x03;
  const y = recoverY(x, isOdd);
  const point = { x, y };

  if (!isOnCurve(point)) {
    throw new Error("Point is not on the Grumpkin curve");
  }

  return point;
}

/**
 * Generate a random Grumpkin keypair
 */
export function generateKeyPair(): { privKey: bigint; pubKey: GrumpkinPoint } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const privKey = scalarFromBytes(bytes);
  const pubKey = pointMul(privKey, GRUMPKIN_GENERATOR);
  return { privKey, pubKey };
}

/**
 * Derive a Grumpkin keypair from a seed (deterministic)
 */
export function deriveKeyPairFromSeed(
  seed: Uint8Array
): { privKey: bigint; pubKey: GrumpkinPoint } {
  const hash = sha256(seed);
  const privKey = scalarFromBytes(hash);
  const pubKey = pointMul(privKey, GRUMPKIN_GENERATOR);
  return { privKey, pubKey };
}

/**
 * Perform ECDH key exchange
 * Returns the shared point (use x-coordinate as shared secret)
 */
export function ecdh(
  privKey: bigint,
  pubKey: GrumpkinPoint
): GrumpkinPoint {
  if (!isOnCurve(pubKey)) {
    throw new Error("Public key is not on the Grumpkin curve");
  }

  const sharedPoint = pointMul(privKey, pubKey);

  if (isInfinity(sharedPoint)) {
    throw new Error("ECDH resulted in point at infinity");
  }

  return sharedPoint;
}

/**
 * Derive a shared secret from ECDH (returns x-coordinate as bytes)
 */
export function ecdhSharedSecret(
  privKey: bigint,
  pubKey: GrumpkinPoint
): Uint8Array {
  const sharedPoint = ecdh(privKey, pubKey);
  return scalarToBytes(sharedPoint.x);
}

/**
 * Convert public key to bytes for public sharing
 */
export function pubKeyToBytes(pubKey: GrumpkinPoint): Uint8Array {
  return pointToCompressedBytes(pubKey);
}

/**
 * Convert bytes back to public key
 */
export function pubKeyFromBytes(bytes: Uint8Array): GrumpkinPoint {
  if (bytes.length === 33) {
    return pointFromCompressedBytes(bytes);
  } else if (bytes.length === 64) {
    return pointFromBytes(bytes);
  } else {
    throw new Error("Expected 33 or 64 bytes for public key");
  }
}
