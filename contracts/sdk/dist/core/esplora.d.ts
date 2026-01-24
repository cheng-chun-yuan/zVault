/**
 * Esplora Client - Platform-agnostic HTTP client for Bitcoin blockchain queries
 *
 * Uses standard fetch API (works in browser, Node.js 18+, React Native)
 * Supports mempool.space API for testnet/mainnet
 */
export interface EsploraTransaction {
    txid: string;
    version: number;
    locktime: number;
    vin: EsploraVin[];
    vout: EsploraVout[];
    size: number;
    weight: number;
    fee: number;
    status: EsploraStatus;
}
export interface EsploraVin {
    txid: string;
    vout: number;
    prevout: EsploraVout | null;
    scriptsig: string;
    scriptsig_asm: string;
    witness?: string[];
    is_coinbase: boolean;
    sequence: number;
}
export interface EsploraVout {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
}
export interface EsploraStatus {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
}
export interface EsploraAddressInfo {
    address: string;
    chain_stats: {
        funded_txo_count: number;
        funded_txo_sum: number;
        spent_txo_count: number;
        spent_txo_sum: number;
        tx_count: number;
    };
    mempool_stats: {
        funded_txo_count: number;
        funded_txo_sum: number;
        spent_txo_count: number;
        spent_txo_sum: number;
        tx_count: number;
    };
}
export interface EsploraUtxo {
    txid: string;
    vout: number;
    status: EsploraStatus;
    value: number;
}
export interface EsploraMerkleProof {
    block_height: number;
    merkle: string[];
    pos: number;
}
export type EsploraNetwork = "mainnet" | "testnet" | "testnet4" | "signet";
export declare class EsploraClient {
    private baseUrl;
    private network;
    constructor(networkOrUrl?: EsploraNetwork | string, customBaseUrl?: string);
    private fetch;
    getAddress(address: string): Promise<EsploraAddressInfo>;
    getAddressTxs(address: string, lastSeenTxid?: string): Promise<EsploraTransaction[]>;
    getAddressTxsMempool(address: string): Promise<EsploraTransaction[]>;
    getAddressUtxos(address: string): Promise<EsploraUtxo[]>;
    getTransaction(txid: string): Promise<EsploraTransaction>;
    getTxStatus(txid: string): Promise<EsploraStatus>;
    getTxHex(txid: string): Promise<string>;
    getTxRaw(txid: string): Promise<Uint8Array>;
    getTxMerkleProof(txid: string): Promise<EsploraMerkleProof>;
    getTxOutspend(txid: string, vout: number): Promise<{
        spent: boolean;
        txid?: string;
        vin?: number;
        status?: EsploraStatus;
    }>;
    getBlockHeight(): Promise<number>;
    getBlockHash(height: number): Promise<string>;
    getBlockHeader(hash: string): Promise<string>;
    getBlockTxids(hash: string): Promise<string[]>;
    getConfirmations(txid: string): Promise<number>;
    waitForTransaction(address: string, timeoutMs?: number, pollIntervalMs?: number): Promise<EsploraTransaction | null>;
    waitForConfirmations(txid: string, requiredConfirmations?: number, timeoutMs?: number, pollIntervalMs?: number): Promise<number>;
    /**
     * Find a deposit to a specific address matching the expected amount
     */
    findDeposit(address: string, expectedAmount?: bigint): Promise<{
        tx: EsploraTransaction;
        vout: number;
        amount: number;
    } | null>;
    private findMatchingOutput;
    getNetwork(): EsploraNetwork;
    getBaseUrl(): string;
}
export declare const esploraTestnet: EsploraClient;
export declare const esploraMainnet: EsploraClient;
