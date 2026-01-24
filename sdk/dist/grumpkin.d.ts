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
export declare const GRUMPKIN_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export declare const GRUMPKIN_ORDER = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export declare const GRUMPKIN_B = -17n;
export declare const GRUMPKIN_GENERATOR: {
    x: bigint;
    y: bigint;
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
export declare const GRUMPKIN_INFINITY: GrumpkinPoint;
/**
 * Check if a point is the point at infinity
 */
export declare function isInfinity(point: GrumpkinPoint): boolean;
/**
 * Verify a point is on the Grumpkin curve
 */
export declare function isOnCurve(point: GrumpkinPoint): boolean;
/**
 * Point addition on Grumpkin curve (CONSTANT-TIME)
 *
 * SECURITY: This implementation is constant-time to prevent timing side-channel attacks.
 * All branches execute the same operations regardless of input values.
 */
export declare function pointAdd(p1: GrumpkinPoint, p2: GrumpkinPoint): GrumpkinPoint;
/**
 * Point doubling on Grumpkin curve
 */
export declare function pointDouble(point: GrumpkinPoint): GrumpkinPoint;
/**
 * Scalar multiplication using Montgomery ladder (CONSTANT-TIME)
 *
 * SECURITY: Uses Montgomery ladder algorithm which is constant-time.
 * All iterations perform the same operations regardless of the scalar bits.
 * This prevents timing side-channel attacks that could leak the private key.
 *
 * Returns scalar * point
 */
export declare function pointMul(scalar: bigint, point: GrumpkinPoint): GrumpkinPoint;
/**
 * Negate a point (flip y coordinate)
 */
export declare function pointNegate(point: GrumpkinPoint): GrumpkinPoint;
/**
 * Derive a Grumpkin scalar from bytes (reduces modulo curve order)
 */
export declare function scalarFromBytes(bytes: Uint8Array): bigint;
/**
 * Convert a bigint scalar to 32 bytes (big-endian)
 */
export declare function scalarToBytes(scalar: bigint): Uint8Array;
/**
 * Convert a point to bytes (uncompressed: 64 bytes, x || y)
 */
export declare function pointToBytes(point: GrumpkinPoint): Uint8Array;
/**
 * Convert a point to compressed bytes (33 bytes: sign byte || x)
 */
export declare function pointToCompressedBytes(point: GrumpkinPoint): Uint8Array;
/**
 * Convert bytes to a point (uncompressed: 64 bytes)
 */
export declare function pointFromBytes(bytes: Uint8Array): GrumpkinPoint;
/**
 * Convert compressed bytes to a point (33 bytes)
 */
export declare function pointFromCompressedBytes(bytes: Uint8Array): GrumpkinPoint;
/**
 * Generate a random Grumpkin keypair
 */
export declare function generateKeyPair(): {
    privKey: bigint;
    pubKey: GrumpkinPoint;
};
/**
 * Derive a Grumpkin keypair from a seed (deterministic)
 */
export declare function deriveKeyPairFromSeed(seed: Uint8Array): {
    privKey: bigint;
    pubKey: GrumpkinPoint;
};
/**
 * Perform ECDH key exchange
 * Returns the shared point (use x-coordinate as shared secret)
 */
export declare function ecdh(privKey: bigint, pubKey: GrumpkinPoint): GrumpkinPoint;
/**
 * Derive a shared secret from ECDH (returns x-coordinate as bytes)
 */
export declare function ecdhSharedSecret(privKey: bigint, pubKey: GrumpkinPoint): Uint8Array;
/**
 * Convert public key to bytes for public sharing
 */
export declare function pubKeyToBytes(pubKey: GrumpkinPoint): Uint8Array;
/**
 * Convert bytes back to public key
 */
export declare function pubKeyFromBytes(bytes: Uint8Array): GrumpkinPoint;
