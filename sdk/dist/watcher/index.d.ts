/**
 * Deposit Watcher Module
 *
 * Watch Bitcoin deposits in real-time and track confirmation progress.
 *
 * Platform-specific implementations:
 * - Web: Uses localStorage + WebSocket
 * - React Native: Uses AsyncStorage + WebSocket
 */
export { DepositStatus, PendingDeposit, WatcherCallbacks, WatcherConfig, StorageAdapter, SerializedDeposit, MempoolWsMessage, MempoolAddressTransaction, DEFAULT_WATCHER_CONFIG, serializeDeposit, deserializeDeposit, generateDepositId, } from "./types";
export { BaseDepositWatcher } from "./base";
export { WebDepositWatcher, createWebWatcher } from "./web";
export { NativeDepositWatcher, createNativeWatcher, setAsyncStorage, } from "./native";
