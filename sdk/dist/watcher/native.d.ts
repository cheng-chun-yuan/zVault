/**
 * React Native / Expo Deposit Watcher
 *
 * React Native implementation using:
 * - AsyncStorage for persistence
 * - Built-in WebSocket for real-time transaction detection
 *
 * Note: This module requires @react-native-async-storage/async-storage
 * to be installed in your React Native/Expo project.
 */
import { BaseDepositWatcher } from "./base";
import { WatcherCallbacks, WatcherConfig } from "./types";
interface AsyncStorageStatic {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}
/**
 * Set the AsyncStorage instance for React Native
 *
 * Must be called before creating a NativeDepositWatcher.
 *
 * @example
 * ```typescript
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { setAsyncStorage, createNativeWatcher } from '@zvault/sdk/watcher/native';
 *
 * setAsyncStorage(AsyncStorage);
 *
 * const watcher = createNativeWatcher({
 *   onDetected: (deposit) => console.log('Detected!'),
 * });
 * ```
 */
export declare function setAsyncStorage(storage: AsyncStorageStatic): void;
/**
 * React Native deposit watcher
 *
 * Features:
 * - Real-time transaction detection via mempool.space WebSocket
 * - Automatic persistence to AsyncStorage
 * - Background reconnection
 * - Confirmation tracking
 */
export declare class NativeDepositWatcher extends BaseDepositWatcher {
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
 * Create a React Native deposit watcher instance
 *
 * Note: You must call setAsyncStorage() with your AsyncStorage instance
 * before calling init() on the watcher.
 *
 * @param callbacks - Event callbacks
 * @param config - Watcher configuration
 * @returns NativeDepositWatcher instance
 *
 * @example
 * ```typescript
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { setAsyncStorage, createNativeWatcher } from '@zvault/sdk/watcher/native';
 *
 * setAsyncStorage(AsyncStorage);
 *
 * const watcher = createNativeWatcher({
 *   onDetected: (deposit) => {
 *     console.log('Deposit detected!', deposit.txid);
 *   },
 *   onConfirming: (deposit, confirmations) => {
 *     console.log(`Confirmations: ${confirmations}/${deposit.requiredConfirmations}`);
 *   },
 *   onConfirmed: (deposit) => {
 *     console.log('Ready to verify!');
 *   },
 * });
 *
 * await watcher.init();
 *
 * const deposit = await watcher.createDeposit(100_000n);
 * console.log('Send BTC to:', deposit.taprootAddress);
 * console.log('Share this link:', deposit.claimLink);
 * ```
 */
export declare function createNativeWatcher(callbacks?: WatcherCallbacks, config?: Partial<WatcherConfig>): NativeDepositWatcher;
export {};
