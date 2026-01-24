/**
 * ZVault Simplified API
 *
 * 6 main user-facing functions:
 * - deposit: Generate deposit credentials (taproot address + claim link)
 * - withdraw: Request BTC withdrawal (burn sbBTC)
 * - privateClaim: Claim sbBTC tokens with ZK proof
 * - privateSplit: Split one commitment into two outputs
 * - sendLink: Create global claim link (anyone with URL can claim)
 * - sendStealth: Send to specific recipient via stealth ECDH
 *
 * @module api
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { type Note } from "./note";
import { type MerkleProof } from "./merkle";
/**
 * Result from deposit() - credentials needed to receive BTC
 */
export interface DepositResult {
    /** Note containing secrets (save this!) */
    note: Note;
    /** Bitcoin address to send BTC to */
    taprootAddress: string;
    /** Shareable claim link (contains secrets) */
    claimLink: string;
    /** Human-readable amount */
    displayAmount: string;
}
/**
 * Result from withdraw()
 */
export interface WithdrawResult {
    /** Transaction signature */
    signature: string;
    /** Amount being withdrawn in satoshis */
    withdrawAmount: bigint;
    /** Change note (if partial withdraw) */
    changeNote?: Note;
    /** Change claim link (if partial withdraw) */
    changeClaimLink?: string;
}
/**
 * Result from privateClaim()
 */
export interface ClaimResult {
    /** Transaction signature */
    signature: string;
    /** Amount claimed in satoshis */
    amount: bigint;
    /** Recipient address */
    recipient: PublicKey;
}
/**
 * Result from privateSplit()
 */
export interface SplitResult {
    /** Transaction signature */
    signature: string;
    /** First output note */
    output1: Note;
    /** Second output note */
    output2: Note;
    /** Nullifier hash of spent input */
    inputNullifierHash: Uint8Array;
}
/**
 * Result from sendStealth()
 */
export interface StealthResult {
    /** Transaction signature */
    signature: string;
    /** Ephemeral public key (for recipient to scan) */
    ephemeralPubKey: Uint8Array;
    /** Leaf index in commitment tree */
    leafIndex: number;
}
/**
 * Client configuration
 */
export interface ApiClientConfig {
    connection: Connection;
    programId: PublicKey;
    payer?: Keypair;
}
/** Default program ID (Solana Devnet) */
export declare const DEFAULT_PROGRAM_ID: PublicKey;
/**
 * Generate deposit credentials
 *
 * Creates a new note with random secrets, derives a taproot address for
 * receiving BTC, and creates a claim link for later claiming.
 *
 * **Flow:**
 * 1. Generate random nullifier + secret
 * 2. Derive taproot address from commitment
 * 3. Create claim link with encoded secrets
 * 4. User sends BTC to taproot address externally
 * 5. Later: call verifyDeposit to add commitment to on-chain tree
 *
 * @param amountSats - Amount in satoshis
 * @param network - Bitcoin network (mainnet/testnet)
 * @param baseUrl - Base URL for claim link
 * @returns Deposit credentials
 *
 * @example
 * ```typescript
 * const result = await deposit(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', result.taprootAddress);
 * console.log('Save this link:', result.claimLink);
 * ```
 */
export declare function deposit(amountSats: bigint, network?: "mainnet" | "testnet", baseUrl?: string): Promise<DepositResult>;
/**
 * Request BTC withdrawal (burn sbBTC)
 *
 * Generates a partial_withdraw ZK proof and submits REQUEST_REDEMPTION instruction.
 * Burns sbBTC tokens and creates a redemption request for the relayer to fulfill.
 *
 * **Flow:**
 * 1. Generate partial_withdraw proof
 * 2. Call REQUEST_REDEMPTION instruction
 * 3. Program verifies proof, burns sbBTC, creates RedemptionRequest PDA
 * 4. If partial: adds change commitment to tree
 * 5. Relayer monitors and sends BTC (external)
 *
 * @param config - Client configuration
 * @param note - Note to withdraw from
 * @param btcAddress - Bitcoin address to receive withdrawal
 * @param withdrawAmount - Amount to withdraw (defaults to full amount)
 * @param merkleProof - Merkle proof for the commitment
 * @returns Withdrawal result
 *
 * @example
 * ```typescript
 * // Full withdrawal
 * const result = await withdraw(config, myNote, 'bc1q...');
 *
 * // Partial withdrawal (50%)
 * const result = await withdraw(config, myNote, 'bc1q...', myNote.amount / 2n);
 * ```
 */
export declare function withdraw(config: ApiClientConfig, note: Note, btcAddress: string, withdrawAmount?: bigint, merkleProof?: MerkleProof): Promise<WithdrawResult>;
/**
 * Claim sbBTC tokens with ZK proof
 *
 * Parses claim link (or uses provided note), generates a claim proof,
 * and mints sbBTC tokens to the user's wallet.
 *
 * **Flow:**
 * 1. Parse claim link to recover note (if link provided)
 * 2. Get merkle proof for commitment
 * 3. Generate claim ZK proof
 * 4. Call CLAIM instruction
 * 5. Program verifies proof, mints sbBTC
 *
 * @param config - Client configuration
 * @param claimLinkOrNote - Claim link URL or Note object
 * @param merkleProof - Merkle proof for the commitment
 * @returns Claim result
 *
 * @example
 * ```typescript
 * // Claim from link
 * const result = await privateClaim(config, 'https://sbbtc.app/claim?note=...');
 *
 * // Claim from note
 * const result = await privateClaim(config, myNote);
 * ```
 */
export declare function privateClaim(config: ApiClientConfig, claimLinkOrNote: string | Note, merkleProof?: MerkleProof): Promise<ClaimResult>;
/**
 * Split one commitment into two outputs
 *
 * Generates a split proof and adds two new commitments to the tree
 * while spending the input commitment.
 *
 * **Flow:**
 * 1. Generate two output notes
 * 2. Generate split ZK proof
 * 3. Call SPLIT_COMMITMENT instruction
 * 4. Program verifies proof, nullifies input, adds outputs
 *
 * @param config - Client configuration
 * @param inputNote - Note to split
 * @param amount1 - Amount for first output
 * @param merkleProof - Merkle proof for input commitment
 * @returns Split result with two output notes
 *
 * @example
 * ```typescript
 * // Split 1 BTC into 0.3 + 0.7
 * const { output1, output2 } = await privateSplit(config, myNote, 30_000_000n);
 *
 * // Send 0.3 to Alice via stealth
 * await sendStealth(config, output1, alicePubKey);
 *
 * // Keep 0.7 as claim link
 * const myLink = sendLink(output2);
 * ```
 */
export declare function privateSplit(config: ApiClientConfig, inputNote: Note, amount1: bigint, merkleProof?: MerkleProof): Promise<SplitResult>;
/**
 * Create a global claim link
 *
 * Encodes a note into a shareable URL. Anyone with the link can claim.
 * This is purely client-side - no on-chain transaction.
 *
 * **Use case:** Share funds directly via messaging, email, QR code.
 *
 * @param note - Note to create link for
 * @param baseUrl - Base URL for the link
 * @returns Claim link URL
 *
 * @example
 * ```typescript
 * const link = sendLink(myNote);
 * // => "https://sbbtc.app/claim?note=eyJhbW91bnQ..."
 *
 * // Share link with recipient
 * // Recipient calls: await privateClaim(config, link);
 * ```
 */
export declare function sendLink(note: Note, baseUrl?: string): string;
/**
 * Send to specific recipient via stealth address (ECDH)
 *
 * Creates an on-chain stealth announcement that only the recipient
 * can discover by scanning with their view key.
 *
 * **Flow:**
 * 1. ECDH key exchange: ephemeral keypair + recipient pubkey
 * 2. Derive note secrets from shared secret
 * 3. Create on-chain StealthAnnouncement
 * 4. Recipient scans announcements with view key
 * 5. Recipient claims with recovered note
 *
 * @param config - Client configuration
 * @param note - Note to send (commitment should already be in tree)
 * @param recipientPubKey - Recipient's X25519 public key (32 bytes)
 * @param leafIndex - Leaf index in commitment tree
 * @returns Stealth result
 *
 * @example
 * ```typescript
 * // Send to Alice's stealth address
 * const result = await sendStealth(config, myNote, aliceX25519PubKey);
 *
 * // Alice scans and claims
 * const found = scanAnnouncements(aliceViewKey, alicePubKey, announcements);
 * const recovered = createNoteFromSecrets(found[0].nullifier, found[0].secret, found[0].amount);
 * await privateClaim(config, recovered);
 * ```
 */
export declare function sendStealth(config: ApiClientConfig, note: Note, recipientPubKey: Uint8Array, leafIndex?: number): Promise<StealthResult>;
/**
 * Send to Solana recipient via stealth address
 *
 * Convenience function that converts a Solana Ed25519 public key
 * to X25519 before creating the stealth announcement.
 */
export declare function sendStealthToSolana(config: ApiClientConfig, note: Note, recipientSolanaPubKey: Uint8Array, leafIndex?: number): Promise<StealthResult>;
export { generateNote, createNoteFromSecrets, deriveNote, deriveNotes, estimateSeedStrength } from "./note";
export { parseClaimLink } from "./claim-link";
export { scanAnnouncements, scanAnnouncementsWithSolana, generateStealthKeys, solanaKeyToX25519, solanaPubKeyToX25519, } from "./stealth";
export type { Note } from "./note";
export type { MerkleProof } from "./merkle";
export type { StealthKeys, StealthDeposit } from "./stealth";
