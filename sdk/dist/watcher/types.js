/**
 * Deposit Watcher Types
 *
 * Platform-agnostic types for watching Bitcoin deposits and
 * tracking their confirmation status.
 */
/**
 * Default configuration values
 */
export const DEFAULT_WATCHER_CONFIG = {
    network: "testnet",
    esploraUrl: "https://mempool.space/testnet/api",
    wsUrl: "wss://mempool.space/testnet/api/v1/ws",
    requiredConfirmations: 6,
    confirmationPollInterval: 30000,
    storageKeyPrefix: "sbbtc_",
    autoVerify: true,
    useWebSocket: true,
    pollingInterval: 10000,
};
/**
 * Convert PendingDeposit to serializable format
 */
export function serializeDeposit(deposit) {
    return {
        ...deposit,
        amount: deposit.amount.toString(),
    };
}
/**
 * Convert serialized deposit back to PendingDeposit
 */
export function deserializeDeposit(data) {
    return {
        ...data,
        amount: BigInt(data.amount),
    };
}
/**
 * Generate a unique ID for a deposit
 */
export function generateDepositId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `dep_${timestamp}_${random}`;
}
