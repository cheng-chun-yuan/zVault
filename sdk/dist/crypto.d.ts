/**
 * Cryptographic utilities for zVault
 *
 * Note: This SDK uses Noir circuits with Poseidon2 hashing.
 * Hash computations that must match the circuits should be done
 * via the Noir circuits themselves or via noir_js execution.
 */
export declare const BN254_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Generate a random field element (< BN254 prime)
 */
export declare function randomFieldElement(): bigint;
/**
 * Convert bigint to 32-byte Uint8Array (big-endian)
 */
export declare function bigintToBytes(value: bigint): Uint8Array;
/**
 * Convert Uint8Array to bigint (big-endian)
 */
export declare function bytesToBigint(bytes: Uint8Array): bigint;
/**
 * Convert hex string to Uint8Array
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Convert Uint8Array to hex string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * SHA-256 hash using @noble/hashes
 */
export declare function sha256Hash(data: Uint8Array): Uint8Array;
/**
 * Double SHA256 hash (Bitcoin standard)
 */
export declare function doubleSha256(data: Uint8Array): Uint8Array;
/**
 * Tagged hash as used in BIP-340/341 (Taproot)
 * H_tag(x) = SHA256(SHA256(tag) || SHA256(tag) || x)
 */
export declare function taggedHash(tag: string, data: Uint8Array): Uint8Array;
