/**
 * Stealth address utilities for ZVault
 *
 * Dual-key ECDH with X25519 (viewing) + Grumpkin (spending)
 *
 * Format (131 bytes on-chain - simplified):
 * - ephemeral_view_pub (32 bytes) - X25519 for off-chain scanning
 * - ephemeral_spend_pub (33 bytes) - Grumpkin for in-circuit ECDH
 * - amount_sats (8 bytes) - Verified BTC amount from SPV proof
 * - commitment (32 bytes) - Poseidon2 hash for Merkle tree
 * - leaf_index (8 bytes) - Position in Merkle tree
 * - created_at (8 bytes) - Timestamp
 *
 * Key Separation Properties:
 * - Viewing key can scan and decrypt but CANNOT derive nullifier
 * - Spending key required for nullifier derivation and proof generation
 * - Sender cannot spend (wrong ECDH → wrong commitment → not in tree)
 *
 * SECURITY NOTES:
 * - Commitment is computed using Poseidon2 (matches Noir circuits)
 * - Amount encryption removed (public on Bitcoin blockchain anyway)
 * - Random value removed (ephemeral key uniqueness is sufficient)
 *
 * KNOWN LIMITATION - CROSS-CHAIN CORRELATION:
 * The ephemeral_view_pub appears on BOTH Bitcoin (in OP_RETURN) and Solana
 * (in StealthAnnouncement). This creates a 1:1 linkage between the chains.
 * To mitigate: Use fresh ephemeral keys for each deposit and consider
 * additional privacy layers like mixers or delayed reveals.
 */
/** StealthAnnouncement account size (131 bytes) */
export declare const STEALTH_ANNOUNCEMENT_SIZE = 131;
/** Discriminator for StealthAnnouncement */
export declare const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 8;
import { type GrumpkinPoint } from "./grumpkin";
import type { StealthMetaAddress, ZVaultKeys, WalletSignerAdapter } from "./keys";
/**
 * Type guard to distinguish between WalletSignerAdapter and ZVaultKeys
 */
export declare function isWalletAdapter(source: unknown): source is WalletSignerAdapter;
/**
 * Stealth Deposit with dual-key ECDH (SIMPLIFIED FORMAT)
 *
 * Uses X25519 for fast off-chain scanning and Grumpkin for in-circuit spending proofs.
 *
 * SECURITY IMPROVEMENTS:
 * - Removed encrypted_amount: BTC amount is public on Bitcoin blockchain anyway
 * - Removed encrypted_random: Fresh ephemeral keys provide sufficient uniqueness
 * - Commitment uses Poseidon2 (matches Noir circuits exactly)
 */
export interface StealthDeposit {
    /** X25519 ephemeral public key (32 bytes) - for viewing/scanning */
    ephemeralViewPub: Uint8Array;
    /** Grumpkin ephemeral public key (33 bytes compressed) - for spending proofs */
    ephemeralSpendPub: Uint8Array;
    /** Amount in satoshis (stored directly - no encryption needed) */
    amountSats: bigint;
    /** Commitment for Merkle tree (32 bytes) - Poseidon2(notePubKey, amount) */
    commitment: Uint8Array;
    /** Unix timestamp when created */
    createdAt: number;
}
/**
 * Scanned note from announcement (viewing key can decrypt)
 *
 * SIMPLIFIED: random field removed - ephemeral key uniqueness is sufficient
 */
export interface ScannedNote {
    /** Amount in satoshis (from verified BTC transaction) */
    amount: bigint;
    /** Grumpkin ephemeral public key (needed for spending) */
    ephemeralSpendPub: GrumpkinPoint;
    /** Leaf index in Merkle tree */
    leafIndex: number;
    /** Original announcement commitment */
    commitment: Uint8Array;
}
/**
 * Prepared claim inputs for ZK proof (requires spending key)
 *
 * SIMPLIFIED: random field removed - commitment is Poseidon2(notePubKey, amount)
 */
export interface ClaimInputs {
    spendingPrivKey: bigint;
    ephemeralSpendPub: GrumpkinPoint;
    amount: bigint;
    leafIndex: number;
    merklePath: bigint[];
    merkleIndices: number[];
    merkleRoot: bigint;
    nullifier: bigint;
    amountPub: bigint;
}
/**
 * Size of StealthAnnouncement account on-chain (SIMPLIFIED FORMAT)
 *
 * Layout (131 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_view_pub (32 bytes)
 * - ephemeral_spend_pub (33 bytes)
 * - amount_sats (8 bytes) - verified from BTC tx, stored directly
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * SAVINGS: 24 bytes (from 155) by removing encrypted_amount and encrypted_random
 */
/**
 * Parsed stealth announcement from on-chain data (SIMPLIFIED)
 */
export interface OnChainStealthAnnouncement {
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
    createdAt: number;
}
/**
 * Create a stealth deposit with dual-key ECDH
 *
 * Generates two ephemeral keypairs:
 * - X25519: For viewing/scanning (fast off-chain ECDH)
 * - Grumpkin: For spending proofs (efficient in-circuit ECDH)
 *
 * SIMPLIFIED FORMAT:
 * - No encrypted_amount: BTC amount is public on Bitcoin blockchain
 * - No encrypted_random: Fresh ephemeral keys provide uniqueness
 * - Commitment uses Poseidon2: commitment = Poseidon2(notePubKey, amount)
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys (recipient's keys)
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export declare function createStealthDeposit(recipientMeta: StealthMetaAddress, amountSats: bigint): Promise<StealthDeposit>;
/**
 * Scan announcements using viewing key only
 *
 * SIMPLIFIED FORMAT:
 * - Amount is stored directly (not encrypted)
 * - No random field to decrypt
 * - Viewing key validates ownership via ECDH + commitment verification
 *
 * This function can see amounts but CANNOT:
 * - Derive the nullifier (requires spending key)
 * - Generate spending proofs
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes (ready for claim preparation)
 */
export declare function scanAnnouncements(source: WalletSignerAdapter | ZVaultKeys, announcements: {
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
}[]): Promise<ScannedNote[]>;
/**
 * Prepare claim inputs for ZK proof generation
 *
 * CRITICAL: This function requires the spending private key.
 * The nullifier is derived from (spendingPrivKey, leafIndex).
 * Only the legitimate recipient can compute a valid nullifier.
 *
 * Why sender cannot claim:
 * - Sender knows ephemeral_priv and shared_secret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Wrong spendingPrivKey → wrong ECDH → wrong commitment → not in tree
 *
 * SIMPLIFIED FORMAT:
 * - Uses Poseidon2 for all hashing (matches Noir circuits)
 * - Single nullifier hash (removed double-hashing)
 * - No random field needed
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
 * Parse a StealthAnnouncement account data (SIMPLIFIED FORMAT)
 *
 * Layout (131 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_view_pub (32 bytes)
 * - ephemeral_spend_pub (33 bytes)
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
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    amountSats: bigint;
    commitment: Uint8Array;
    leafIndex: number;
};
