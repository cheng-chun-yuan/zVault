"use strict";
/**
 * Cryptographic utilities for zVault
 *
 * Note: This SDK uses Noir circuits with Poseidon2 hashing.
 * Hash computations that must match the circuits should be done
 * via the Noir circuits themselves or via noir_js execution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BN254_FIELD_PRIME = void 0;
exports.poseidonHash2 = poseidonHash2;
exports.poseidonHash1 = poseidonHash1;
exports.randomFieldElement = randomFieldElement;
exports.bigintToBytes = bigintToBytes;
exports.bytesToBigint = bytesToBigint;
exports.hexToBytes = hexToBytes;
exports.bytesToHex = bytesToHex;
exports.sha256Hash = sha256Hash;
exports.doubleSha256 = doubleSha256;
exports.taggedHash = taggedHash;
const sha256_1 = require("@noble/hashes/sha256");
// BN254 field prime (used by Noir)
exports.BN254_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Poseidon2 hash computation placeholder
 *
 * IMPORTANT: For hashes that must match Noir circuit values,
 * use the Noir circuits directly via nargo execute or noir_js.
 *
 * This function is provided for interface compatibility but
 * will throw an error - use executeNoirHash() instead.
 *
 * @deprecated Use executeNoirHash() or pass raw inputs to Noir circuits
 */
async function poseidonHash2(a, b) {
    throw new Error("poseidonHash2 is not available in the SDK. " +
        "Noir uses Poseidon2 which differs from circomlibjs Poseidon. " +
        "For matching hashes, use the Noir circuits via nargo execute.");
}
/**
 * Poseidon1 hash computation placeholder
 *
 * @deprecated Use executeNoirHash() or pass raw inputs to Noir circuits
 */
async function poseidonHash1(a) {
    throw new Error("poseidonHash1 is not available in the SDK. " +
        "Noir uses Poseidon2 which differs from circomlibjs Poseidon. " +
        "For matching hashes, use the Noir circuits via nargo execute.");
}
/**
 * Generate a random field element (< BN254 prime)
 */
function randomFieldElement() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBigint(bytes) % exports.BN254_FIELD_PRIME;
}
/**
 * Convert bigint to 32-byte Uint8Array (big-endian)
 */
function bigintToBytes(value) {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp = temp >> 8n;
    }
    return bytes;
}
/**
 * Convert Uint8Array to bigint (big-endian)
 */
function bytesToBigint(bytes) {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}
/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
    }
    return bytes;
}
/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/**
 * SHA-256 hash using @noble/hashes
 */
function sha256Hash(data) {
    return (0, sha256_1.sha256)(data);
}
/**
 * Double SHA256 hash (Bitcoin standard)
 */
function doubleSha256(data) {
    return (0, sha256_1.sha256)((0, sha256_1.sha256)(data));
}
/**
 * Tagged hash as used in BIP-340/341 (Taproot)
 * H_tag(x) = SHA256(SHA256(tag) || SHA256(tag) || x)
 */
function taggedHash(tag, data) {
    const encoder = new TextEncoder();
    const tagBytes = encoder.encode(tag);
    const tagHash = (0, sha256_1.sha256)(tagBytes);
    // Concatenate: SHA256(tag) || SHA256(tag) || data
    const combined = new Uint8Array(64 + data.length);
    combined.set(tagHash, 0);
    combined.set(tagHash, 32);
    combined.set(data, 64);
    return (0, sha256_1.sha256)(combined);
}
