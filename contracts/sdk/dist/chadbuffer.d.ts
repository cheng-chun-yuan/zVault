/**
 * ChadBuffer Client
 *
 * Helper functions to upload Bitcoin transaction data to ChadBuffer
 * for SPV verification on Solana.
 *
 * Networks: Bitcoin Testnet3, Solana Devnet
 *
 * Reference: https://github.com/deanmlittle/chadbuffer
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
export declare const CHADBUFFER_PROGRAM_ID: PublicKey;
/**
 * Upload raw Bitcoin transaction to ChadBuffer
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param rawTx - Raw Bitcoin transaction bytes
 * @param seed - Optional seed for buffer PDA derivation
 * @returns Buffer public key
 */
export declare function uploadTransactionToBuffer(connection: Connection, payer: Keypair, rawTx: Uint8Array, seed?: Uint8Array): Promise<PublicKey>;
/**
 * Close buffer and reclaim rent
 */
export declare function closeBuffer(connection: Connection, payer: Keypair, bufferPubkey: PublicKey, recipient?: PublicKey): Promise<string>;
/**
 * Read buffer data
 */
export declare function readBufferData(connection: Connection, bufferPubkey: PublicKey): Promise<{
    authority: PublicKey;
    data: Uint8Array;
}>;
/**
 * Fetch raw Bitcoin transaction from Esplora/Blockstream API
 */
export declare function fetchRawTransaction(txid: string, network?: "mainnet" | "testnet"): Promise<Uint8Array>;
/**
 * Fetch merkle proof from Esplora/Blockstream API
 */
export declare function fetchMerkleProof(txid: string, network?: "mainnet" | "testnet"): Promise<{
    blockHeight: number;
    merkleProof: Uint8Array[];
    txIndex: number;
}>;
/**
 * Convert Uint8Array to hex string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Complete flow: Fetch tx, upload to buffer, return verification data
 */
export declare function prepareVerifyDeposit(connection: Connection, payer: Keypair, txid: string, network?: "mainnet" | "testnet"): Promise<{
    bufferPubkey: PublicKey;
    transactionSize: number;
    merkleProof: Uint8Array[];
    blockHeight: number;
    txIndex: number;
    txidBytes: Uint8Array;
}>;
