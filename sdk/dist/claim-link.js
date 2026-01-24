/**
 * Claim link utilities for zVault
 *
 * Claim links encode the note secrets (nullifier + secret + amount)
 * in a URL-safe format that can be shared with recipients.
 *
 * SECURITY: Claim links are bearer instruments - anyone with the link can claim!
 */
import { deserializeNote } from "./note";
// Base URL for claim links (configurable)
const DEFAULT_BASE_URL = "https://sbbtc.app";
/**
 * Create a claim link from a note
 *
 * @param note - Note to encode
 * @param baseUrl - Base URL for the link
 * @returns Full claim link URL
 */
export function createClaimLink(note, baseUrl = DEFAULT_BASE_URL) {
    const data = {
        v: 1,
        n: bigintToBase64(note.nullifier),
        s: bigintToBase64(note.secret),
        a: note.amount.toString(),
    };
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${baseUrl}/claim?note=${encoded}`;
}
/**
 * Parse a claim link and extract the note data
 *
 * @param link - Claim link URL or just the encoded note parameter
 * @returns Note data or null if invalid
 */
export function parseClaimLink(link) {
    try {
        // Extract note parameter from URL
        let encoded;
        if (link.includes("?note=")) {
            const url = new URL(link);
            encoded = url.searchParams.get("note") || "";
        }
        else if (link.includes("note=")) {
            encoded = link.split("note=")[1].split("&")[0];
        }
        else {
            // Assume raw encoded data
            encoded = link;
        }
        if (!encoded)
            return null;
        // Decode
        const json = Buffer.from(encoded, "base64url").toString("utf8");
        const data = JSON.parse(json);
        // Validate version
        if (data.v !== 1) {
            console.warn(`Unknown claim link version: ${data.v}`);
        }
        // Reconstruct note
        const note = deserializeNote({
            nullifier: base64ToBigint(data.n).toString(),
            secret: base64ToBigint(data.s).toString(),
            amount: data.a,
        });
        return note;
    }
    catch (error) {
        console.error("Failed to parse claim link:", error);
        return null;
    }
}
/**
 * Validate a claim link format without fully parsing
 *
 * @param link - Claim link to validate
 * @returns true if format is valid
 */
export function isValidClaimLinkFormat(link) {
    try {
        let encoded;
        if (link.includes("note=")) {
            const match = link.match(/note=([A-Za-z0-9_-]+)/);
            encoded = match?.[1] || "";
        }
        else {
            encoded = link;
        }
        if (!encoded || encoded.length < 10)
            return false;
        const json = Buffer.from(encoded, "base64url").toString("utf8");
        const data = JSON.parse(json);
        return (typeof data.v === "number" &&
            typeof data.n === "string" &&
            typeof data.s === "string" &&
            typeof data.a === "string");
    }
    catch {
        return false;
    }
}
/**
 * Create a shortened claim link (for display)
 *
 * @param link - Full claim link
 * @param maxLength - Maximum display length
 * @returns Shortened link for display
 */
export function shortenClaimLink(link, maxLength = 40) {
    if (link.length <= maxLength)
        return link;
    const start = link.slice(0, 20);
    const end = link.slice(-10);
    return `${start}...${end}`;
}
/**
 * Generate a claim link with optional password protection
 * (Note: This is a placeholder - full implementation would use encryption)
 *
 * @param note - Note to encode
 * @param password - Optional password for protection
 * @param baseUrl - Base URL for the link
 * @returns Claim link (password-protected if password provided)
 */
export function createProtectedClaimLink(note, password, baseUrl = DEFAULT_BASE_URL) {
    if (!password) {
        return createClaimLink(note, baseUrl);
    }
    // For now, just mark as protected
    // Full implementation would encrypt the note data with the password
    const data = {
        v: 1,
        n: bigintToBase64(note.nullifier),
        s: bigintToBase64(note.secret),
        a: note.amount.toString(),
        p: true, // Protected flag
    };
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${baseUrl}/claim?note=${encoded}`;
}
/**
 * Convert bigint to base64 string
 */
function bigintToBase64(value) {
    const hex = value.toString(16).padStart(64, "0");
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return Buffer.from(bytes).toString("base64url");
}
/**
 * Convert base64 string to bigint
 */
function base64ToBigint(base64) {
    const bytes = Buffer.from(base64, "base64url");
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}
/**
 * Extract amount from claim link without full parsing
 * Useful for display purposes
 */
export function extractAmountFromClaimLink(link) {
    try {
        let encoded;
        if (link.includes("note=")) {
            const match = link.match(/note=([A-Za-z0-9_-]+)/);
            encoded = match?.[1] || "";
        }
        else {
            encoded = link;
        }
        if (!encoded)
            return null;
        const json = Buffer.from(encoded, "base64url").toString("utf8");
        const data = JSON.parse(json);
        return BigInt(data.a);
    }
    catch {
        return null;
    }
}
export function encodeClaimLink(seedOrNullifier, secret) {
    // New format: single seed string
    if (secret === undefined && typeof seedOrNullifier === "string") {
        // URL-encode the seed phrase
        return encodeURIComponent(seedOrNullifier);
    }
    // Legacy format: nullifier + secret (for backwards compatibility)
    const data = {
        n: seedOrNullifier.toString(),
        s: secret.toString(),
    };
    const json = JSON.stringify(data);
    const base64 = typeof btoa !== "undefined"
        ? btoa(json)
        : Buffer.from(json).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * Decode a claim link - supports both seed format and legacy format
 *
 * @param encoded - Encoded claim link data
 * @returns Seed string, or { nullifier, secret } for legacy format, or null if invalid
 */
export function decodeClaimLink(encoded) {
    // First, try legacy format (base64 JSON with { n, s })
    // This needs to be checked first because base64 strings can look like seed phrases
    try {
        let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        while (base64.length % 4) {
            base64 += "=";
        }
        const json = typeof atob !== "undefined"
            ? atob(base64)
            : Buffer.from(base64, "base64").toString("utf8");
        const data = JSON.parse(json);
        if (data.n !== undefined && data.s !== undefined) {
            return { nullifier: data.n, secret: data.s };
        }
    }
    catch {
        // Not legacy format, try seed format
    }
    // Try URL-decode (new seed format)
    try {
        const decoded = decodeURIComponent(encoded);
        // If it's a readable seed phrase (contains letters/words), return it
        if (/^[a-zA-Z0-9]/.test(decoded) && !decoded.startsWith("{")) {
            return decoded;
        }
    }
    catch {
        // Not URL-encoded
    }
    return null;
}
/**
 * Generate a complete claim URL with base64-encoded note
 *
 * @param baseUrl - Base URL (e.g., "https://example.com/claim")
 * @param nullifier - Nullifier value
 * @param secret - Secret value
 * @returns Full claim URL
 */
export function generateClaimUrl(baseUrl, nullifier, secret) {
    const encoded = encodeClaimLink(nullifier, secret);
    return `${baseUrl}?note=${encoded}`;
}
/**
 * Parse claim URL - supports multiple formats:
 * - Seed: ?note=<url-encoded-seed>
 * - Base64: ?note=<base64> (legacy)
 * - Legacy: ?n=<nullifier>&s=<secret>
 *
 * @param url - URL string or URLSearchParams
 * @returns Seed string, or { nullifier, secret } for legacy, or null if invalid
 */
export function parseClaimUrl(url) {
    let params;
    if (typeof url === "string") {
        // Extract query string if full URL provided
        if (url.includes("?")) {
            params = new URLSearchParams(url.split("?")[1]);
        }
        else {
            params = new URLSearchParams(url);
        }
    }
    else {
        params = url;
    }
    // Try note param (seed or base64 format)
    const note = params.get("note");
    if (note) {
        return decodeClaimLink(note);
    }
    // Fall back to legacy format
    const n = params.get("n");
    const s = params.get("s");
    if (n && s) {
        return { nullifier: n, secret: s };
    }
    return null;
}
