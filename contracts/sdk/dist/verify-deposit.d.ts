/**
 * Verify Deposit Client
 *
 * Helper to call verify_deposit instruction with ChadBuffer data
 * Uses native Solana web3.js (no Anchor - using Pinocchio contracts)
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
/**
 * Derive PDA addresses
 */
export declare function derivePoolStatePDA(programId: PublicKey): [PublicKey, number];
export declare function deriveLightClientPDA(programId: PublicKey): [PublicKey, number];
export declare function deriveBlockHeaderPDA(programId: PublicKey, blockHeight: number): [PublicKey, number];
export declare function deriveCommitmentTreePDA(programId: PublicKey): [PublicKey, number];
export declare function deriveDepositRecordPDA(programId: PublicKey, txid: Uint8Array): [PublicKey, number];
/**
 * Build TxMerkleProof structure for the instruction
 */
export declare function buildMerkleProof(txidBytes: Uint8Array, merkleProof: Uint8Array[], txIndex: number): {
    txid: number[];
    siblings: number[][];
    path: boolean[];
    txIndex: number;
};
/**
 * Complete verify deposit flow
 *
 * 1. Fetch raw tx and merkle proof from Esplora
 * 2. Upload raw tx to ChadBuffer
 * 3. Call verify_deposit instruction
 */
export declare function verifyDeposit(connection: Connection, payer: Keypair, txid: string, expectedValue: number, network?: "mainnet" | "testnet", programId?: PublicKey): Promise<string>;
/**
 * Example usage
 */
export declare function exampleUsage(): Promise<void>;
