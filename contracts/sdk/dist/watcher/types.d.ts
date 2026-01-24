/**
 * Deposit Watcher Types
 *
 * Platform-agnostic types for watching Bitcoin deposits and
 * tracking their confirmation status.
 */
/**
 * Status of a pending deposit
 */
export type DepositStatus = "waiting" | "detected" | "confirming" | "confirmed" | "verifying" | "verified" | "claimed" | "failed";
/**
 * A pending deposit being watched
 */
export interface PendingDeposit {
    id: string;
    taprootAddress: string;
    nullifier: string;
    secret: string;
    amount: bigint;
    claimLink: string;
    status: DepositStatus;
    confirmations: number;
    requiredConfirmations: number;
    txid?: string;
    vout?: number;
    detectedAmount?: number;
    blockHeight?: number;
    blockHash?: string;
    leafIndex?: number;
    commitment?: string;
    createdAt: number;
    detectedAt?: number;
    confirmedAt?: number;
    verifiedAt?: number;
    claimedAt?: number;
    error?: string;
    lastErrorAt?: number;
}
/**
 * Callbacks for deposit watcher events
 */
export interface WatcherCallbacks {
    /**
     * Called when a transaction is first detected in mempool
     */
    onDetected?: (deposit: PendingDeposit) => void;
    /**
     * Called on each confirmation update
     */
    onConfirming?: (deposit: PendingDeposit, confirmations: number) => void;
    /**
     * Called when required confirmations are reached
     */
    onConfirmed?: (deposit: PendingDeposit) => void;
    /**
     * Called when deposit is verified on Solana
     */
    onVerified?: (deposit: PendingDeposit) => void;
    /**
     * Called when sbBTC is claimed
     */
    onClaimed?: (deposit: PendingDeposit) => void;
    /**
     * Called on any error
     */
    onError?: (deposit: PendingDeposit, error: Error) => void;
    /**
     * Called on any status change
     */
    onStatusChange?: (deposit: PendingDeposit, oldStatus: DepositStatus, newStatus: DepositStatus) => void;
}
/**
 * Storage adapter interface for platform-specific storage
 */
export interface StorageAdapter {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}
/**
 * Configuration for the deposit watcher
 */
export interface WatcherConfig {
    /**
     * Network for Esplora API
     */
    network?: "mainnet" | "testnet" | "testnet4" | "signet";
    /**
     * Custom Esplora API URL (overrides network)
     */
    esploraUrl?: string;
    /**
     * WebSocket URL for mempool.space
     */
    wsUrl?: string;
    /**
     * Number of confirmations required (default: 6)
     */
    requiredConfirmations?: number;
    /**
     * Polling interval for confirmation checks (ms, default: 30000)
     */
    confirmationPollInterval?: number;
    /**
     * Storage key prefix (default: 'sbbtc_')
     */
    storageKeyPrefix?: string;
    /**
     * Enable auto-verification on Solana when confirmed (default: true)
     */
    autoVerify?: boolean;
    /**
     * Enable WebSocket for real-time transaction detection (default: true)
     */
    useWebSocket?: boolean;
    /**
     * Polling interval when WebSocket is disabled (ms, default: 10000)
     */
    pollingInterval?: number;
}
/**
 * Default configuration values
 */
export declare const DEFAULT_WATCHER_CONFIG: Required<WatcherConfig>;
/**
 * WebSocket message types from mempool.space
 */
export interface MempoolWsMessage {
    "address-transactions"?: MempoolAddressTransaction[];
    "track-address"?: string;
    [key: string]: unknown;
}
export interface MempoolAddressTransaction {
    txid: string;
    version: number;
    locktime: number;
    vin: Array<{
        txid: string;
        vout: number;
        prevout: {
            scriptpubkey: string;
            scriptpubkey_asm: string;
            scriptpubkey_type: string;
            scriptpubkey_address?: string;
            value: number;
        } | null;
        scriptsig: string;
        scriptsig_asm: string;
        witness?: string[];
        is_coinbase: boolean;
        sequence: number;
    }>;
    vout: Array<{
        scriptpubkey: string;
        scriptpubkey_asm: string;
        scriptpubkey_type: string;
        scriptpubkey_address?: string;
        value: number;
    }>;
    size: number;
    weight: number;
    fee: number;
    status: {
        confirmed: boolean;
        block_height?: number;
        block_hash?: string;
        block_time?: number;
    };
}
/**
 * Serialized deposit for storage
 */
export interface SerializedDeposit {
    id: string;
    taprootAddress: string;
    nullifier: string;
    secret: string;
    amount: string;
    claimLink: string;
    status: DepositStatus;
    confirmations: number;
    requiredConfirmations: number;
    txid?: string;
    vout?: number;
    detectedAmount?: number;
    blockHeight?: number;
    blockHash?: string;
    leafIndex?: number;
    commitment?: string;
    createdAt: number;
    detectedAt?: number;
    confirmedAt?: number;
    verifiedAt?: number;
    claimedAt?: number;
    error?: string;
    lastErrorAt?: number;
}
/**
 * Convert PendingDeposit to serializable format
 */
export declare function serializeDeposit(deposit: PendingDeposit): SerializedDeposit;
/**
 * Convert serialized deposit back to PendingDeposit
 */
export declare function deserializeDeposit(data: SerializedDeposit): PendingDeposit;
/**
 * Generate a unique ID for a deposit
 */
export declare function generateDepositId(): string;
