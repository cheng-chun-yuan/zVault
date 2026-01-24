/**
 * Web Deposit Watcher
 *
 * Browser implementation using:
 * - localStorage for persistence
 * - WebSocket for real-time transaction detection
 */
import { BaseDepositWatcher } from "./base";
import { WatcherCallbacks, WatcherConfig } from "./types";
/**
 * Web-based deposit watcher for browsers
 *
 * Features:
 * - Real-time transaction detection via mempool.space WebSocket
 * - Automatic persistence to localStorage
 * - Reconnection on disconnect
 * - Confirmation tracking
 */
export declare class WebDepositWatcher extends BaseDepositWatcher {
    private ws;
    private reconnectTimeout?;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private baseReconnectDelay;
    constructor(callbacks?: WatcherCallbacks, config?: Partial<WatcherConfig>);
    connectWebSocket(): void;
    disconnectWebSocket(): void;
    protected subscribeToAddress(address: string): void;
    private scheduleReconnect;
    protected startPolling(): void;
}
/**
 * Create a web deposit watcher instance
 *
 * @param callbacks - Event callbacks
 * @param config - Watcher configuration
 * @returns WebDepositWatcher instance
 *
 * @example
 * ```typescript
 * const watcher = createWebWatcher({
 *   onDetected: (deposit) => console.log('Detected!', deposit.txid),
 *   onConfirmed: (deposit) => console.log('Confirmed!', deposit.confirmations),
 * });
 *
 * await watcher.init();
 * const deposit = await watcher.createDeposit(100_000n);
 * console.log('Send BTC to:', deposit.taprootAddress);
 * ```
 */
export declare function createWebWatcher(callbacks?: WatcherCallbacks, config?: Partial<WatcherConfig>): WebDepositWatcher;
