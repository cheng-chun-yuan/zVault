/**
 * Claim link utilities for zVault
 *
 * Claim links encode the note secrets (nullifier + secret + amount)
 * in a URL-safe format that can be shared with recipients.
 *
 * SECURITY: Claim links are bearer instruments - anyone with the link can claim!
 */
import { type Note } from "./note";
/**
 * Encoded claim link data
 */
export interface ClaimLinkData {
    v: number;
    n: string;
    s: string;
    a: string;
}
/**
 * Create a claim link from a note
 *
 * @param note - Note to encode
 * @param baseUrl - Base URL for the link
 * @returns Full claim link URL
 */
export declare function createClaimLink(note: Note, baseUrl?: string): string;
/**
 * Parse a claim link and extract the note data
 *
 * @param link - Claim link URL or just the encoded note parameter
 * @returns Note data or null if invalid
 */
export declare function parseClaimLink(link: string): Note | null;
/**
 * Validate a claim link format without fully parsing
 *
 * @param link - Claim link to validate
 * @returns true if format is valid
 */
export declare function isValidClaimLinkFormat(link: string): boolean;
/**
 * Create a shortened claim link (for display)
 *
 * @param link - Full claim link
 * @param maxLength - Maximum display length
 * @returns Shortened link for display
 */
export declare function shortenClaimLink(link: string, maxLength?: number): string;
/**
 * Generate a claim link with optional password protection
 * (Note: This is a placeholder - full implementation would use encryption)
 *
 * @param note - Note to encode
 * @param password - Optional password for protection
 * @param baseUrl - Base URL for the link
 * @returns Claim link (password-protected if password provided)
 */
export declare function createProtectedClaimLink(note: Note, password?: string, baseUrl?: string): string;
/**
 * Extract amount from claim link without full parsing
 * Useful for display purposes
 */
export declare function extractAmountFromClaimLink(link: string): bigint | null;
/**
 * Encode a seed phrase for use in claim links
 * Simply URL-encodes the seed - much shorter than encoding nullifier+secret!
 *
 * @param seed - Seed phrase (user's secret note)
 * @returns URL-safe encoded string
 */
export declare function encodeClaimLink(seed: string): string;
/**
 * Legacy: Encode nullifier + secret (for backwards compatibility)
 * @deprecated Use single seed parameter instead
 */
export declare function encodeClaimLink(nullifier: string | bigint, secret: string | bigint): string;
/**
 * Decode a claim link - supports both seed format and legacy format
 *
 * @param encoded - Encoded claim link data
 * @returns Seed string, or { nullifier, secret } for legacy format, or null if invalid
 */
export declare function decodeClaimLink(encoded: string): string | {
    nullifier: string;
    secret: string;
} | null;
/**
 * Generate a complete claim URL with base64-encoded note
 *
 * @param baseUrl - Base URL (e.g., "https://example.com/claim")
 * @param nullifier - Nullifier value
 * @param secret - Secret value
 * @returns Full claim URL
 */
export declare function generateClaimUrl(baseUrl: string, nullifier: string | bigint, secret: string | bigint): string;
/**
 * Parse claim URL - supports multiple formats:
 * - Seed: ?note=<url-encoded-seed>
 * - Base64: ?note=<base64> (legacy)
 * - Legacy: ?n=<nullifier>&s=<secret>
 *
 * @param url - URL string or URLSearchParams
 * @returns Seed string, or { nullifier, secret } for legacy, or null if invalid
 */
export declare function parseClaimUrl(url: string | URLSearchParams): string | {
    nullifier: string;
    secret: string;
} | null;
