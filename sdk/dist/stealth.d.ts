/**
 * Stealth address utilities for ZVault
 *
 * EIP-5564/DKSAP Pattern (Single Ephemeral Grumpkin Key):
 *
 * Stealth Deposit Flow:
 * ```
 * Sender:
 *   1. ephemeral = random Grumpkin keypair
 *   2. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 *   3. stealthPub = spendingPub + hash(sharedSecret) * G
 *   4. commitment = Poseidon2(stealthPub.x, amount)
 *
 * Recipient (viewing key - can detect):
 *   1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 *   2. stealthPub = spendingPub + hash(sharedSecret) * G
 *   3. Verify: commitment == Poseidon2(stealthPub.x, amount)
 *
 * Recipient (spending key - can claim):
 *   1. stealthPriv = spendingPriv + hash(sharedSecret)
 *   2. nullifier = Poseidon2(stealthPriv, leafIndex)
 * ```
 *
 * Format (98 bytes on-chain):
 * - ephemeral_pub (33 bytes) - Single Grumpkin key for ECDH
 * - amount_sats (8 bytes) - Verified BTC amount from SPV proof
 * - commitment (32 bytes) - Poseidon2 hash for Merkle tree
 * - leaf_index (8 bytes) - Position in Merkle tree
 * - created_at (8 bytes) - Timestamp
 *
 * Security Properties:
 * - Viewing key can detect deposits but CANNOT derive stealthPriv (ECDLP)
 * - Spending key required for stealthPriv and nullifier derivation
 * - Single ephemeral key is standard (EIP-5564, Umbra, Railgun pattern)
 */
/** StealthAnnouncement account size (98 bytes - single ephemeral key) */
export declare const STEALTH_ANNOUNCEMENT_SIZE = 98;
/** Discriminator for StealthAnnouncement */
export declare const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 8;
import { type GrumpkinPoint } from "./grumpkin";
import type { StealthMetaAddress, ZVaultKeys, WalletSignerAdapter } from "./keys";
/**
 * Type guard to distinguish between WalletSignerAdapter and ZVaultKeys
 */
export declare function isWalletAdapter(source: unknown): source is WalletSignerAdapter;
/**
 * Stealth Deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Uses single Grumpkin ephemeral key for ECDH stealth address derivation.
 *
 * Stealth key derivation:
 * - sharedSecret = ECDH(ephemeral.priv, viewingPub)
 * - stealthPub = spendingPub + hash(sharedSecret) * G
 * - commitment = Poseidon2(stealthPub.x, amount)
 */
export interface StealthDeposit {
    /** Single Grumpkin ephemeral public key (33 bytes compressed) */
    ephemeralPub: Uint8Array;
    /** Amount in satoshis (stored directly - no encryption needed) */
    amountSats: bigint;
    /** Commitment for Merkle tree (32 bytes) - Poseidon2(stealthPub.x, amount) */
    commitment: Uint8Array;
    /** Unix timestamp when created */
    createdAt: number;
}
/**
 * Scanned note from announcement (viewing key can detect)
 *
 * Viewing key can compute stealthPub but CANNOT derive stealthPriv.
 */
export interface ScannedNote {
    /** Amount in satoshis (from verified BTC transaction) */
    amount: bigint;
    /** Grumpkin ephemeral public key (needed for shared secret) */
    ephemeralPub: GrumpkinPoint;
    /** Computed stealth public key */
    stealthPub: GrumpkinPoint;
    /** Leaf index in Merkle tree */
    leafIndex: number;
    /** Original announcement commitment */
    commitment: Uint8Array;
}
/**
 * Prepared claim inputs for ZK proof (requires spending key)
 *
 * Uses EIP-5564/DKSAP stealth key derivation:
 * - stealthPriv = spendingPriv + hash(sharedSecret)
 * - nullifier = Poseidon2(stealthPriv, leafIndex)
 */
export interface ClaimInputs {
    stealthPrivKey: bigint;
    amount: bigint;
    leafIndex: number;
    merklePath: bigint[];
    merkleIndices: number[];
    merkleRoot: bigint;
    nullifier: bigint;
    amountPub: bigint;
}
/**
 * Size of StealthAnnouncement account on-chain (single ephemeral key)
 *
 * Layout (98 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - amount_sats (8 bytes) - verified from BTC tx
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * SAVINGS: 33 bytes from previous dual-key format (131 → 98)
 */
/**
 * Parsed stealth announcement from on-chain data
 */
export interface OnChainStealthAnnouncement {
    ephemeralPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
    createdAt: number;
}
/**
 * Create a stealth deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Generates ONE ephemeral Grumpkin keypair and derives stealth address:
 * 1. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. commitment = Poseidon2(stealthPub.x, amount)
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export declare function createStealthDeposit(recipientMeta: StealthMetaAddress, amountSats: bigint): Promise<StealthDeposit>;
/**
 * Scan announcements using viewing key only (EIP-5564/DKSAP pattern)
 *
 * For each announcement, computes:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. Verifies: commitment == Poseidon2(stealthPub.x, amount)
 *
 * This function can DETECT deposits but CANNOT:
 * - Derive stealthPriv (requires spending key)
 * - Generate nullifier or spending proofs
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes (ready for claim preparation)
 */
export declare function scanAnnouncements(source: WalletSignerAdapter | ZVaultKeys, announcements: {
    ephemeralPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
}[]): Promise<ScannedNote[]>;
/**
 * Prepare claim inputs for ZK proof generation (EIP-5564/DKSAP pattern)
 *
 * CRITICAL: This function requires the spending private key.
 *
 * Derivation:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)  [already computed in scanning]
 * 2. stealthPriv = spendingPriv + hash(sharedSecret)
 * 3. nullifier = Poseidon2(stealthPriv, leafIndex)
 *
 * Why sender cannot claim:
 * - Sender knows ephemeralPriv and can compute sharedSecret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Cannot derive stealthPriv without spendingPrivKey (ECDLP)
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param note - Scanned note from scanning phase
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir claim circuit
 */
export declare function prepareClaimInputs(source: WalletSignerAdapter | ZVaultKeys, note: ScannedNote, merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
}): Promise<ClaimInputs>;
/**
 * Parse a StealthAnnouncement account data (single ephemeral key)
 *
 * Layout (98 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_pub (33 bytes) - Single Grumpkin key
 * - amount_sats (8 bytes) - verified BTC amount
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 */
export declare function parseStealthAnnouncement(data: Uint8Array): OnChainStealthAnnouncement | null;
/**
 * Convert on-chain announcement to format expected by scanAnnouncements
 */
export declare function announcementToScanFormat(announcement: OnChainStealthAnnouncement): {
    ephemeralPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
};
