"use strict";
/**
 * Deposit Watcher Types
 *
 * Platform-agnostic types for watching Bitcoin deposits and
 * tracking their confirmation status.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WATCHER_CONFIG = void 0;
exports.serializeDeposit = serializeDeposit;
exports.deserializeDeposit = deserializeDeposit;
exports.generateDepositId = generateDepositId;
/**
 * Default configuration values
 */
exports.DEFAULT_WATCHER_CONFIG = {
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
function serializeDeposit(deposit) {
    return {
        ...deposit,
        amount: deposit.amount.toString(),
    };
}
/**
 * Convert serialized deposit back to PendingDeposit
 */
function deserializeDeposit(data) {
    return {
        ...data,
        amount: BigInt(data.amount),
    };
}
/**
 * Generate a unique ID for a deposit
 */
function generateDepositId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `dep_${timestamp}_${random}`;
}
