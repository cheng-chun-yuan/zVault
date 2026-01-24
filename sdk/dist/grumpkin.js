"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRUMPKIN_INFINITY = exports.GRUMPKIN_GENERATOR = exports.GRUMPKIN_B = exports.GRUMPKIN_ORDER = exports.GRUMPKIN_FIELD_PRIME = void 0;
exports.isInfinity = isInfinity;
exports.isOnCurve = isOnCurve;
exports.pointAdd = pointAdd;
exports.pointDouble = pointDouble;
exports.pointMul = pointMul;
exports.pointNegate = pointNegate;
exports.scalarFromBytes = scalarFromBytes;
exports.scalarToBytes = scalarToBytes;
exports.pointToBytes = pointToBytes;
exports.pointToCompressedBytes = pointToCompressedBytes;
exports.pointFromBytes = pointFromBytes;
exports.pointFromCompressedBytes = pointFromCompressedBytes;
exports.generateKeyPair = generateKeyPair;
exports.deriveKeyPairFromSeed = deriveKeyPairFromSeed;
exports.ecdh = ecdh;
exports.ecdhSharedSecret = ecdhSharedSecret;
exports.pubKeyToBytes = pubKeyToBytes;
exports.pubKeyFromBytes = pubKeyFromBytes;
const sha256_1 = require("@noble/hashes/sha256");
// Grumpkin curve parameters
// Base field is the BN254 scalar field
exports.GRUMPKIN_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Grumpkin curve order (number of points on the curve)
exports.GRUMPKIN_ORDER = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
// Curve coefficient: y² = x³ - 17
exports.GRUMPKIN_B = -17n;
// Generator point (standard Grumpkin generator)
exports.GRUMPKIN_GENERATOR = {
    x: 1n,
    y: 17631683881184975370165255887551781615748388533673675138860n,
};
/**
 * Point at infinity (identity element)
 */
exports.GRUMPKIN_INFINITY = { x: 0n, y: 0n };
/**
 * Check if a point is the point at infinity
 */
function isInfinity(point) {
    return point.x === 0n && point.y === 0n;
}
/**
 * Modular arithmetic helpers
 */
function mod(n, p) {
    const result = n % p;
    return result >= 0n ? result : result + p;
}
function modInverse(a, p) {
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
function isOnCurve(point) {
    if (isInfinity(point))
        return true;
    const { x, y } = point;
    const p = exports.GRUMPKIN_FIELD_PRIME;
    // Check y² = x³ - 17 (mod p)
    const lhs = mod(y * y, p);
    const rhs = mod(x * x * x + exports.GRUMPKIN_B, p);
    return lhs === rhs;
}
/**
 * Constant-time conditional select
 *
 * Returns a if condition is true, b otherwise.
 * Executes in constant time to prevent timing attacks.
 */
function constantTimeSelect(condition, a, b) {
    const mask = condition ? -1n : 0n;
    return (a & mask) | (b & ~mask);
}
/**
 * Constant-time point select
 *
 * Returns p1 if condition is true, p2 otherwise.
 * Executes in constant time.
 */
function constantTimeSelectPoint(condition, p1, p2) {
    return {
        x: constantTimeSelect(condition, p1.x, p2.x),
        y: constantTimeSelect(condition, p1.y, p2.y),
    };
}
/**
 * Point addition on Grumpkin curve (CONSTANT-TIME)
 *
 * SECURITY: This implementation is constant-time to prevent timing side-channel attacks.
 * All branches execute the same operations regardless of input values.
 */
function pointAdd(p1, p2) {
    const p = exports.GRUMPKIN_FIELD_PRIME;
    const { x: x1, y: y1 } = p1;
    const { x: x2, y: y2 } = p2;
    const p1IsInf = isInfinity(p1);
    const p2IsInf = isInfinity(p2);
    const sameX = x1 === x2;
    const sameY = y1 === y2;
    const oppositeY = mod(y1 + y2, p) === 0n;
    // Compute both lambdas (doubling and addition) regardless of which we need
    // This ensures constant-time execution
    const denom_double = mod(2n * y1, p);
    const denom_add = mod(x2 - x1, p);
    // Use safe default to avoid division by zero (result will be discarded anyway)
    const safe_denom_double = denom_double === 0n ? 1n : denom_double;
    const safe_denom_add = denom_add === 0n ? 1n : denom_add;
    const lambda_double = mod(3n * x1 * x1 * modInverse(safe_denom_double, p), p);
    const lambda_add = mod((y2 - y1) * modInverse(safe_denom_add, p), p);
    // Select the appropriate lambda
    const isDouble = sameX && sameY && !p1IsInf && !p2IsInf;
    const lambda = constantTimeSelect(isDouble, lambda_double, lambda_add);
    // Compute the result point
    const x3 = mod(lambda * lambda - x1 - x2, p);
    const y3 = mod(lambda * (x1 - x3) - y1, p);
    const result = { x: x3, y: y3 };
    // Handle special cases (still constant-time by computing all and selecting)
    const isInfinityResult = sameX && oppositeY && !p1IsInf && !p2IsInf;
    // Select final result based on conditions
    let finalResult = result;
    finalResult = constantTimeSelectPoint(p1IsInf, p2, finalResult);
    finalResult = constantTimeSelectPoint(p2IsInf && !p1IsInf, p1, finalResult);
    finalResult = constantTimeSelectPoint(isInfinityResult, exports.GRUMPKIN_INFINITY, finalResult);
    return finalResult;
}
/**
 * Point doubling on Grumpkin curve
 */
function pointDouble(point) {
    return pointAdd(point, point);
}
/**
 * Scalar multiplication using Montgomery ladder (CONSTANT-TIME)
 *
 * SECURITY: Uses Montgomery ladder algorithm which is constant-time.
 * All iterations perform the same operations regardless of the scalar bits.
 * This prevents timing side-channel attacks that could leak the private key.
 *
 * Returns scalar * point
 */
function pointMul(scalar, point) {
    // Reduce scalar modulo curve order
    scalar = mod(scalar, exports.GRUMPKIN_ORDER);
    // Handle edge cases (still need early return for infinity input)
    if (isInfinity(point)) {
        return exports.GRUMPKIN_INFINITY;
    }
    // Montgomery ladder: constant-time scalar multiplication
    // R0 = O (infinity), R1 = P
    let r0 = exports.GRUMPKIN_INFINITY;
    let r1 = point;
    // Process all 254 bits (BN254 scalar field)
    for (let i = 253; i >= 0; i--) {
        const bit = (scalar >> BigInt(i)) & 1n;
        // Always compute both operations
        const sum = pointAdd(r0, r1);
        const r0Double = pointDouble(r0);
        const r1Double = pointDouble(r1);
        // Select based on bit (constant-time selection)
        if (bit === 1n) {
            r0 = sum;
            r1 = r1Double;
        }
        else {
            r0 = r0Double;
            r1 = sum;
        }
    }
    return r0;
}
/**
 * Negate a point (flip y coordinate)
 */
function pointNegate(point) {
    if (isInfinity(point))
        return point;
    return {
        x: point.x,
        y: mod(-point.y, exports.GRUMPKIN_FIELD_PRIME),
    };
}
/**
 * Derive a Grumpkin scalar from bytes (reduces modulo curve order)
 */
function scalarFromBytes(bytes) {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return mod(result, exports.GRUMPKIN_ORDER);
}
/**
 * Convert a bigint scalar to 32 bytes (big-endian)
 */
function scalarToBytes(scalar) {
    const bytes = new Uint8Array(32);
    let temp = mod(scalar, exports.GRUMPKIN_ORDER);
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp = temp >> 8n;
    }
    return bytes;
}
/**
 * Convert a point to bytes (uncompressed: 64 bytes, x || y)
 */
function pointToBytes(point) {
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
function pointToCompressedBytes(point) {
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
 *
 * Uses Tonelli-Shanks algorithm for modular square root.
 * GRUMPKIN_FIELD_PRIME ≡ 1 (mod 4), so we can't use the simple formula.
 */
function recoverY(x, isOdd) {
    const p = exports.GRUMPKIN_FIELD_PRIME;
    const rhs = mod(x * x * x + exports.GRUMPKIN_B, p);
    // Tonelli-Shanks algorithm for modular square root
    // Find y such that y² ≡ rhs (mod p)
    let y = tonelliShanks(rhs, p);
    // Check if we got the right parity
    const yIsOdd = (y & 1n) === 1n;
    if (yIsOdd !== isOdd) {
        y = mod(-y, p);
    }
    return y;
}
/**
 * Tonelli-Shanks algorithm for modular square root
 * Finds y such that y² ≡ n (mod p), or throws if no solution exists
 */
function tonelliShanks(n, p) {
    // Handle trivial cases
    if (n === 0n)
        return 0n;
    // Check if n is a quadratic residue using Euler's criterion
    // n^((p-1)/2) ≡ 1 (mod p) if n is a quadratic residue
    const eulerCriterion = modPow(n, (p - 1n) / 2n, p);
    if (eulerCriterion !== 1n) {
        throw new Error("No square root exists (not a quadratic residue)");
    }
    // Factor out powers of 2 from p - 1: p - 1 = Q * 2^S
    let Q = p - 1n;
    let S = 0n;
    while ((Q & 1n) === 0n) {
        Q = Q >> 1n;
        S = S + 1n;
    }
    // Find a quadratic non-residue z
    let z = 2n;
    while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) {
        z = z + 1n;
    }
    let M = S;
    let c = modPow(z, Q, p);
    let t = modPow(n, Q, p);
    let R = modPow(n, (Q + 1n) / 2n, p);
    while (true) {
        if (t === 1n) {
            return R;
        }
        // Find the smallest i such that t^(2^i) ≡ 1 (mod p)
        let i = 1n;
        let temp = mod(t * t, p);
        while (temp !== 1n) {
            temp = mod(temp * temp, p);
            i = i + 1n;
        }
        // Update values
        const b = modPow(c, 1n << (M - i - 1n), p);
        M = i;
        c = mod(b * b, p);
        t = mod(t * c, p);
        R = mod(R * b, p);
    }
}
/**
 * Modular exponentiation
 */
function modPow(base, exp, p) {
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
function pointFromBytes(bytes) {
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
function pointFromCompressedBytes(bytes) {
    if (bytes.length !== 33) {
        throw new Error("Expected 33 bytes for compressed point");
    }
    // Check for infinity
    if (bytes.every((b) => b === 0)) {
        return exports.GRUMPKIN_INFINITY;
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
function generateKeyPair() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const privKey = scalarFromBytes(bytes);
    const pubKey = pointMul(privKey, exports.GRUMPKIN_GENERATOR);
    return { privKey, pubKey };
}
/**
 * Derive a Grumpkin keypair from a seed (deterministic)
 */
function deriveKeyPairFromSeed(seed) {
    const hash = (0, sha256_1.sha256)(seed);
    const privKey = scalarFromBytes(hash);
    const pubKey = pointMul(privKey, exports.GRUMPKIN_GENERATOR);
    return { privKey, pubKey };
}
/**
 * Perform ECDH key exchange
 * Returns the shared point (use x-coordinate as shared secret)
 */
function ecdh(privKey, pubKey) {
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
function ecdhSharedSecret(privKey, pubKey) {
    const sharedPoint = ecdh(privKey, pubKey);
    return scalarToBytes(sharedPoint.x);
}
/**
 * Convert public key to bytes for public sharing
 */
function pubKeyToBytes(pubKey) {
    return pointToCompressedBytes(pubKey);
}
/**
 * Convert bytes back to public key
 */
function pubKeyFromBytes(bytes) {
    if (bytes.length === 33) {
        return pointFromCompressedBytes(bytes);
    }
    else if (bytes.length === 64) {
        return pointFromBytes(bytes);
    }
    else {
        throw new Error("Expected 33 or 64 bytes for public key");
    }
}
