/**
 * Base Deposit Watcher
 *
 * Abstract base class for watching Bitcoin deposits.
 * Platform-specific implementations (Web, React Native) extend this class
 * and provide their own WebSocket and storage implementations.
 */
import { EsploraClient } from "../core/esplora";
import { PendingDeposit, WatcherCallbacks, WatcherConfig, StorageAdapter, DepositStatus, MempoolAddressTransaction } from "./types";
/**
 * Abstract base class for deposit watching
 *
 * Extend this class and implement:
 * - connectWebSocket()
 * - disconnectWebSocket()
 * - subscribeToAddress(address)
 */
export declare abstract class BaseDepositWatcher {
    protected deposits: Map<string, PendingDeposit>;
    protected addressToDepositId: Map<string, string>;
    protected esplora: EsploraClient;
    protected callbacks: WatcherCallbacks;
    protected storage: StorageAdapter;
    protected config: Required<WatcherConfig>;
    protected confirmationInterval?: ReturnType<typeof setInterval>;
    protected pollingInterval?: ReturnType<typeof setInterval>;
    protected initialized: boolean;
    constructor(storage: StorageAdapter, callbacks?: WatcherCallbacks, config?: Partial<WatcherConfig>);
    /**
     * Connect to WebSocket for real-time transaction notifications
     */
    abstract connectWebSocket(): void;
    /**
     * Disconnect WebSocket
     */
    abstract disconnectWebSocket(): void;
    /**
     * Subscribe to address for transaction notifications
     */
    protected abstract subscribeToAddress(address: string): void;
    /**
     * Initialize the watcher
     * - Load persisted deposits from storage
     * - Connect WebSocket (if enabled)
     * - Start confirmation checker
     */
    init(): Promise<void>;
    /**
     * Clean up resources
     */
    destroy(): void;
    protected loadFromStorage(): Promise<void>;
    protected saveToStorage(): Promise<void>;
    /**
     * Create a new deposit to watch
     *
     * @param amount - Amount in satoshis
     * @param baseUrl - Base URL for claim links (optional)
     * @returns The pending deposit with taproot address and claim link
     */
    createDeposit(amount: bigint, baseUrl?: string): Promise<PendingDeposit>;
    /**
     * Watch an existing deposit (from claim link)
     */
    watchDeposit(deposit: PendingDeposit): Promise<void>;
    /**
     * Get a deposit by ID
     */
    getDeposit(id: string): PendingDeposit | undefined;
    /**
     * Get a deposit by taproot address
     */
    getDepositByAddress(address: string): PendingDeposit | undefined;
    /**
     * Get all deposits
     */
    getAllDeposits(): PendingDeposit[];
    /**
     * Get deposits by status
     */
    getDepositsByStatus(status: DepositStatus): PendingDeposit[];
    /**
     * Remove a deposit from tracking
     */
    removeDeposit(id: string): Promise<void>;
    /**
     * Update deposit status with callback notifications
     */
    protected updateStatus(deposit: PendingDeposit, newStatus: DepositStatus): void;
    /**
     * Mark deposit as having an error
     */
    protected setError(deposit: PendingDeposit, error: Error): void;
    /**
     * Handle incoming transaction notifications (from WebSocket or polling)
     */
    protected handleTransactions(txs: MempoolAddressTransaction[]): void;
    protected startConfirmationChecker(): void;
    protected checkConfirmations(): Promise<void>;
    protected startPolling(): void;
    protected pollAddresses(): Promise<void>;
    /**
     * Manually mark a deposit as verified (called after Solana verification)
     */
    markVerified(id: string, leafIndex: number): Promise<void>;
    /**
     * Manually mark a deposit as claimed
     */
    markClaimed(id: string): Promise<void>;
    /**
     * Force refresh a deposit's status from the blockchain
     */
    refreshDeposit(id: string): Promise<PendingDeposit | undefined>;
}
