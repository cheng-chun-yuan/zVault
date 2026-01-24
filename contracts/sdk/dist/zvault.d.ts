/**
 * ZVault Client - Main SDK Entry Point
 *
 * Provides high-level APIs for the complete zVault flow:
 *
 * ## 6 Main Functions
 * 1. deposit() - Generate deposit credentials (taproot address + claim link)
 * 2. withdraw() - Request BTC withdrawal (burn sbBTC)
 * 3. privateClaim() - Claim sbBTC tokens with ZK proof
 * 4. privateSplit() - Split one commitment into two outputs
 * 5. sendLink() - Create global claim link (off-chain)
 * 6. sendStealth() - Send to specific recipient via stealth ECDH
 *
 * Note: This SDK uses Noir circuits with Poseidon2 hashing for ZK proofs.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { type Note } from "./note";
import { type MerkleProof } from "./merkle";
import { type NoirProof } from "./proof";
import { HistoryManager } from "./history";
import { type DepositResult, type WithdrawResult, type ClaimResult as ApiClaimResultType, type SplitResult as ApiSplitResultType, type StealthResult } from "./api";
export declare const ZVAULT_PROGRAM_ID: PublicKey;
/**
 * Deposit credentials returned after generating a deposit
 */
export interface DepositCredentials {
    note: Note;
    taprootAddress: string;
    claimLink: string;
    displayAmount: string;
}
/**
 * Claim result
 */
export interface ClaimResult {
    signature: string;
    amount: bigint;
    recipient: PublicKey;
}
/**
 * Split result
 */
export interface SplitResult {
    signature: string;
    output1: {
        note: Note;
        claimLink: string;
    };
    output2: {
        note: Note;
        claimLink: string;
    };
}
/**
 * ZVault SDK Client
 *
 * Provides high-level APIs for all zVault operations.
 *
 * ## Quick Start
 * ```typescript
 * const client = createClient(connection, 'devnet');
 * client.setPayer(myKeypair);
 *
 * // Generate deposit credentials
 * const deposit = await client.deposit(100_000n);
 * console.log('Send BTC to:', deposit.taprootAddress);
 *
 * // Later: claim sbBTC
 * const result = await client.privateClaim(deposit.claimLink);
 * ```
 */
export declare class ZVaultClient {
    private connection;
    private programId;
    private merkleState;
    private payer?;
    historyManager?: HistoryManager;
    constructor(connection: Connection, programId?: PublicKey, historyManager?: HistoryManager);
    /**
     * Set the payer keypair for transactions
     */
    setPayer(payer: Keypair): void;
    /**
     * Get API client config for use with api.ts functions
     */
    private getApiConfig;
    /**
     * 1. DEPOSIT - Generate deposit credentials
     *
     * Creates new secrets, derives taproot address, and creates claim link.
     * User should send BTC to the taproot address externally.
     *
     * @param amountSats - Amount in satoshis
     * @param network - Bitcoin network
     * @param baseUrl - Base URL for claim link
     */
    deposit(amountSats: bigint, network?: "mainnet" | "testnet", baseUrl?: string): Promise<DepositResult>;
    /**
     * 2. WITHDRAW - Request BTC withdrawal
     *
     * Burns sbBTC and creates redemption request. Relayer will send BTC.
     *
     * @param note - Note to withdraw from
     * @param btcAddress - Bitcoin address to receive withdrawal
     * @param withdrawAmount - Amount to withdraw (defaults to full)
     */
    withdraw(note: Note, btcAddress: string, withdrawAmount?: bigint): Promise<WithdrawResult>;
    /**
     * 3. PRIVATE_CLAIM - Claim sbBTC with ZK proof
     *
     * Claims sbBTC tokens to wallet using ZK proof of commitment ownership.
     *
     * @param claimLinkOrNote - Claim link URL or Note object
     */
    privateClaim(claimLinkOrNote: string | Note): Promise<ApiClaimResultType>;
    /**
     * 4. PRIVATE_SPLIT - Split one commitment into two
     *
     * Splits an input commitment into two outputs. Returns both notes
     * for the user to distribute via sendLink or sendStealth.
     *
     * @param inputNote - Note to split
     * @param amount1 - Amount for first output
     */
    privateSplit(inputNote: Note, amount1: bigint): Promise<ApiSplitResultType>;
    /**
     * 5. SEND_LINK - Create global claim link
     *
     * Creates a shareable URL that anyone can use to claim.
     * No on-chain transaction - purely client-side.
     *
     * @param note - Note to create link for
     * @param baseUrl - Base URL for the link
     */
    sendLink(note: Note, baseUrl?: string): string;
    /**
     * 6. SEND_STEALTH - Send to specific recipient via ECDH
     *
     * Creates on-chain stealth announcement. Only recipient can claim.
     *
     * @param note - Note to send
     * @param recipientPubKey - Recipient's X25519 public key
     * @param leafIndex - Leaf index in tree
     */
    sendStealth(note: Note, recipientPubKey: Uint8Array, leafIndex?: number): Promise<StealthResult>;
    /**
     * Send to Solana recipient via stealth address
     */
    sendStealthToSolana(note: Note, recipientSolanaPubKey: Uint8Array, leafIndex?: number): Promise<StealthResult>;
    /**
     * Generate merkle proof for a note (helper)
     */
    private generateMerkleProofForNote;
    /**
     * Derive pool state PDA
     */
    derivePoolStatePDA(): [PublicKey, number];
    /**
     * Derive light client PDA
     */
    deriveLightClientPDA(): [PublicKey, number];
    /**
     * Derive commitment tree PDA
     */
    deriveCommitmentTreePDA(): [PublicKey, number];
    /**
     * Derive block header PDA
     */
    deriveBlockHeaderPDA(height: number): [PublicKey, number];
    /**
     * Derive deposit record PDA
     */
    deriveDepositRecordPDA(txid: Uint8Array): [PublicKey, number];
    /**
     * Derive nullifier record PDA
     */
    deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number];
    /**
     * Derive stealth announcement PDA
     */
    deriveStealthAnnouncementPDA(commitment: bigint): [PublicKey, number];
    /**
     * Generate deposit credentials
     *
     * Creates new secrets for a note. The commitment and nullifier hash
     * will be computed by the Noir circuit during proof generation.
     *
     * @param amountSats - Amount in satoshis
     * @param network - Bitcoin network
     * @param baseUrl - Base URL for claim link
     */
    generateDeposit(amountSats: bigint, network?: "mainnet" | "testnet", baseUrl?: string): Promise<DepositCredentials>;
    /**
     * Restore deposit credentials from a claim link
     */
    restoreFromClaimLink(link: string): Promise<DepositCredentials | null>;
    /**
     * Generate a claim proof for a note
     *
     * Call this after the deposit has been verified on-chain.
     * The proof can then be submitted to the claim instruction.
     */
    generateClaimProof(note: Note): Promise<{
        proof: NoirProof;
        merkleProof: MerkleProof;
        amount: bigint;
    }>;
    /**
     * Find leaf index for a commitment
     */
    private findLeafIndex;
    /**
     * Generate a Merkle proof for a leaf index
     * Note: This is a simplified implementation. In production,
     * query the on-chain Merkle tree for accurate proofs.
     */
    private generateMerkleProof;
    /**
     * Generate a split - divide one note into two
     *
     * @param inputNote - Note to split
     * @param amount1 - Amount for first output
     * @param amount2 - Amount for second output (auto-calculated if not provided)
     */
    generateSplit(inputNote: Note, amount1: bigint, amount2?: bigint): Promise<{
        output1: Note;
        output2: Note;
        claimLink1: string;
        claimLink2: string;
        proof: NoirProof;
        inputNullifierHash: Uint8Array;
    }>;
    /**
     * Generate a transfer (commitment refresh)
     *
     * Creates a new note with new secrets but same amount.
     * Useful for privacy enhancement.
     */
    generateTransfer(inputNote: Note): Promise<{
        outputNote: Note;
        claimLink: string;
        proof: NoirProof;
        inputNullifierHash: Uint8Array;
    }>;
    /**
     * Validate a BTC address
     */
    validateBtcAddress(address: string): boolean;
    /**
     * Check if claim link is valid
     */
    validateClaimLink(link: string): Promise<boolean>;
    /**
     * Insert commitment into local Merkle state
     * (Should be synced with on-chain state)
     */
    insertCommitment(commitment: Uint8Array): number;
    /**
     * Get current Merkle root
     */
    getMerkleRoot(): Uint8Array;
    /**
     * Get leaf count
     */
    getLeafCount(): number;
    private arraysEqual;
}
/**
 * Create a new ZVault client (Solana Devnet)
 */
export declare function createClient(connection: Connection, historyManager?: HistoryManager): ZVaultClient;
export type { DepositResult, WithdrawResult, StealthResult, } from "./api";
export type { ClaimResult as ApiClaimResult } from "./api";
export type { SplitResult as ApiSplitResult } from "./api";
