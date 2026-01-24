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
import { type DepositResult, type WithdrawResult, type ClaimResult as ApiClaimResultType, type SplitResult as ApiSplitResultType, type StealthResult, type StealthMetaAddress } from "./api";
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
 * const client = createClient(connection);
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
    constructor(connection: Connection, programId?: PublicKey);
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
     */
    deposit(amountSats: bigint, network?: "mainnet" | "testnet", baseUrl?: string): Promise<DepositResult>;
    /**
     * 2. WITHDRAW - Request BTC withdrawal
     *
     * Burns sbBTC and creates redemption request. Relayer will send BTC.
     */
    withdraw(note: Note, btcAddress: string, withdrawAmount?: bigint): Promise<WithdrawResult>;
    /**
     * 3. PRIVATE_CLAIM - Claim sbBTC with ZK proof
     *
     * Claims sbBTC tokens to wallet using ZK proof of commitment ownership.
     */
    privateClaim(claimLinkOrNote: string | Note): Promise<ApiClaimResultType>;
    /**
     * 4. PRIVATE_SPLIT - Split one commitment into two
     *
     * Splits an input commitment into two outputs.
     */
    privateSplit(inputNote: Note, amount1: bigint): Promise<ApiSplitResultType>;
    /**
     * 5. SEND_LINK - Create global claim link (off-chain)
     */
    sendLink(note: Note, baseUrl?: string): string;
    /**
     * 6. SEND_STEALTH - Send to specific recipient via dual-key ECDH
     */
    sendStealth(recipientMeta: StealthMetaAddress, amountSats: bigint, leafIndex?: number): Promise<StealthResult>;
    derivePoolStatePDA(): [PublicKey, number];
    deriveLightClientPDA(): [PublicKey, number];
    deriveCommitmentTreePDA(): [PublicKey, number];
    deriveBlockHeaderPDA(height: number): [PublicKey, number];
    deriveDepositRecordPDA(txid: Uint8Array): [PublicKey, number];
    deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number];
    deriveStealthAnnouncementPDA(commitment: bigint): [PublicKey, number];
    /**
     * Restore deposit credentials from a claim link
     */
    restoreFromClaimLink(link: string): Promise<DepositCredentials | null>;
    validateBtcAddress(address: string): boolean;
    validateClaimLink(link: string): boolean;
    insertCommitment(commitment: Uint8Array): number;
    getMerkleRoot(): Uint8Array;
    getLeafCount(): number;
    private generateMerkleProofForNote;
    private findLeafIndex;
    private generateMerkleProof;
    private arraysEqual;
}
/**
 * Create a new ZVault client (Solana Devnet)
 */
export declare function createClient(connection: Connection): ZVaultClient;
export type { DepositResult, WithdrawResult, StealthResult, } from "./api";
export type { ClaimResult as ApiClaimResult } from "./api";
export type { SplitResult as ApiSplitResult } from "./api";
