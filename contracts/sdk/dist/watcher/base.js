"use strict";
/**
 * Base Deposit Watcher
 *
 * Abstract base class for watching Bitcoin deposits.
 * Platform-specific implementations (Web, React Native) extend this class
 * and provide their own WebSocket and storage implementations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseDepositWatcher = void 0;
const esplora_1 = require("../core/esplora");
const types_1 = require("./types");
const note_1 = require("../note");
const taproot_1 = require("../taproot");
const claim_link_1 = require("../claim-link");
const crypto_1 = require("../crypto");
/**
 * Abstract base class for deposit watching
 *
 * Extend this class and implement:
 * - connectWebSocket()
 * - disconnectWebSocket()
 * - subscribeToAddress(address)
 */
class BaseDepositWatcher {
    constructor(storage, callbacks = {}, config = {}) {
        this.deposits = new Map();
        this.addressToDepositId = new Map();
        this.initialized = false;
        this.storage = storage;
        this.callbacks = callbacks;
        this.config = { ...types_1.DEFAULT_WATCHER_CONFIG, ...config };
        this.esplora = new esplora_1.EsploraClient(this.config.network, this.config.esploraUrl);
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    /**
     * Initialize the watcher
     * - Load persisted deposits from storage
     * - Connect WebSocket (if enabled)
     * - Start confirmation checker
     */
    async init() {
        if (this.initialized)
            return;
        // Initialize Poseidon (needed for commitment computation)
        await (0, note_1.initPoseidon)();
        // Load persisted deposits
        await this.loadFromStorage();
        // Connect WebSocket for real-time updates
        if (this.config.useWebSocket) {
            this.connectWebSocket();
        }
        else {
            // Fall back to polling
            this.startPolling();
        }
        // Start periodic confirmation checker
        this.startConfirmationChecker();
        this.initialized = true;
    }
    /**
     * Clean up resources
     */
    destroy() {
        this.disconnectWebSocket();
        if (this.confirmationInterval) {
            clearInterval(this.confirmationInterval);
            this.confirmationInterval = undefined;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = undefined;
        }
        this.initialized = false;
    }
    // =========================================================================
    // Storage
    // =========================================================================
    async loadFromStorage() {
        const key = `${this.config.storageKeyPrefix}deposits`;
        const data = await this.storage.get(key);
        if (data) {
            try {
                const serialized = JSON.parse(data);
                for (const s of serialized) {
                    const deposit = (0, types_1.deserializeDeposit)(s);
                    this.deposits.set(deposit.id, deposit);
                    this.addressToDepositId.set(deposit.taprootAddress, deposit.id);
                }
            }
            catch (err) {
                console.error("Failed to load deposits from storage:", err);
            }
        }
    }
    async saveToStorage() {
        const key = `${this.config.storageKeyPrefix}deposits`;
        const serialized = Array.from(this.deposits.values()).map(types_1.serializeDeposit);
        await this.storage.set(key, JSON.stringify(serialized));
    }
    // =========================================================================
    // Deposit Management
    // =========================================================================
    /**
     * Create a new deposit to watch
     *
     * @param amount - Amount in satoshis
     * @param baseUrl - Base URL for claim links (optional)
     * @returns The pending deposit with taproot address and claim link
     */
    async createDeposit(amount, baseUrl) {
        // Generate note with random secrets
        const note = (0, note_1.generateNote)(amount);
        // For taproot derivation, use XOR of nullifier/secret as placeholder commitment
        // In production, compute actual Poseidon2 hash via helper circuit or backend
        const placeholderCommitment = (0, crypto_1.bigintToBytes)((note.nullifier ^ note.secret) % (2n ** 256n));
        // Derive taproot address from commitment
        const network = this.config.network === "mainnet" ? "mainnet" : "testnet";
        const { address } = await (0, taproot_1.deriveTaprootAddress)(placeholderCommitment, network);
        // Create claim link
        const claimLink = (0, claim_link_1.createClaimLink)(note, baseUrl);
        // Create pending deposit record
        const deposit = {
            id: (0, types_1.generateDepositId)(),
            taprootAddress: address,
            nullifier: (0, crypto_1.bytesToHex)(note.nullifierBytes),
            secret: (0, crypto_1.bytesToHex)(note.secretBytes),
            amount,
            claimLink,
            status: "waiting",
            confirmations: 0,
            requiredConfirmations: this.config.requiredConfirmations,
            commitment: (0, crypto_1.bytesToHex)(placeholderCommitment),
            createdAt: Date.now(),
        };
        // Store and subscribe
        this.deposits.set(deposit.id, deposit);
        this.addressToDepositId.set(deposit.taprootAddress, deposit.id);
        await this.saveToStorage();
        // Subscribe to address for real-time updates
        this.subscribeToAddress(deposit.taprootAddress);
        return deposit;
    }
    /**
     * Watch an existing deposit (from claim link)
     */
    async watchDeposit(deposit) {
        this.deposits.set(deposit.id, deposit);
        this.addressToDepositId.set(deposit.taprootAddress, deposit.id);
        await this.saveToStorage();
        this.subscribeToAddress(deposit.taprootAddress);
    }
    /**
     * Get a deposit by ID
     */
    getDeposit(id) {
        return this.deposits.get(id);
    }
    /**
     * Get a deposit by taproot address
     */
    getDepositByAddress(address) {
        const id = this.addressToDepositId.get(address);
        return id ? this.deposits.get(id) : undefined;
    }
    /**
     * Get all deposits
     */
    getAllDeposits() {
        return Array.from(this.deposits.values());
    }
    /**
     * Get deposits by status
     */
    getDepositsByStatus(status) {
        return this.getAllDeposits().filter((d) => d.status === status);
    }
    /**
     * Remove a deposit from tracking
     */
    async removeDeposit(id) {
        const deposit = this.deposits.get(id);
        if (deposit) {
            this.addressToDepositId.delete(deposit.taprootAddress);
            this.deposits.delete(id);
            await this.saveToStorage();
        }
    }
    // =========================================================================
    // Status Updates
    // =========================================================================
    /**
     * Update deposit status with callback notifications
     */
    updateStatus(deposit, newStatus) {
        const oldStatus = deposit.status;
        if (oldStatus === newStatus)
            return;
        deposit.status = newStatus;
        // Notify status change
        this.callbacks.onStatusChange?.(deposit, oldStatus, newStatus);
        // Notify specific status callbacks
        switch (newStatus) {
            case "detected":
                deposit.detectedAt = Date.now();
                this.callbacks.onDetected?.(deposit);
                break;
            case "confirmed":
                deposit.confirmedAt = Date.now();
                this.callbacks.onConfirmed?.(deposit);
                break;
            case "verified":
                deposit.verifiedAt = Date.now();
                this.callbacks.onVerified?.(deposit);
                break;
            case "claimed":
                deposit.claimedAt = Date.now();
                this.callbacks.onClaimed?.(deposit);
                break;
            case "failed":
                deposit.lastErrorAt = Date.now();
                break;
        }
    }
    /**
     * Mark deposit as having an error
     */
    setError(deposit, error) {
        deposit.error = error.message;
        deposit.lastErrorAt = Date.now();
        this.callbacks.onError?.(deposit, error);
    }
    // =========================================================================
    // Transaction Handling
    // =========================================================================
    /**
     * Handle incoming transaction notifications (from WebSocket or polling)
     */
    handleTransactions(txs) {
        for (const tx of txs) {
            for (let voutIndex = 0; voutIndex < tx.vout.length; voutIndex++) {
                const vout = tx.vout[voutIndex];
                const address = vout.scriptpubkey_address;
                if (!address)
                    continue;
                const depositId = this.addressToDepositId.get(address);
                if (!depositId)
                    continue;
                const deposit = this.deposits.get(depositId);
                if (!deposit)
                    continue;
                // Skip if already detected
                if (deposit.txid)
                    continue;
                // Update deposit with transaction details
                deposit.txid = tx.txid;
                deposit.vout = voutIndex;
                deposit.detectedAmount = vout.value;
                if (tx.status.confirmed) {
                    deposit.blockHeight = tx.status.block_height;
                    deposit.blockHash = tx.status.block_hash;
                }
                this.updateStatus(deposit, "detected");
                this.saveToStorage();
            }
        }
    }
    // =========================================================================
    // Confirmation Checking
    // =========================================================================
    startConfirmationChecker() {
        this.confirmationInterval = setInterval(() => this.checkConfirmations(), this.config.confirmationPollInterval);
    }
    async checkConfirmations() {
        for (const deposit of this.deposits.values()) {
            // Skip deposits that are already confirmed, verified, or claimed
            if (deposit.status === "confirmed" ||
                deposit.status === "verified" ||
                deposit.status === "claimed" ||
                deposit.status === "failed") {
                continue;
            }
            // Skip deposits without a txid
            if (!deposit.txid)
                continue;
            try {
                const confirmations = await this.esplora.getConfirmations(deposit.txid);
                const previousConfirmations = deposit.confirmations;
                deposit.confirmations = confirmations;
                // Notify on confirmation progress
                if (confirmations > previousConfirmations && confirmations > 0) {
                    if (deposit.status !== "confirming") {
                        this.updateStatus(deposit, "confirming");
                    }
                    this.callbacks.onConfirming?.(deposit, confirmations);
                }
                // Check if confirmed
                if (confirmations >= deposit.requiredConfirmations) {
                    this.updateStatus(deposit, "confirmed");
                    await this.saveToStorage();
                    // Auto-verify on Solana if enabled
                    if (this.config.autoVerify) {
                        // Note: Actual verification requires Solana connection
                        // This will be handled by the React hook or user code
                    }
                }
            }
            catch (err) {
                console.error(`Failed to check confirmations for ${deposit.txid}:`, err);
            }
        }
    }
    // =========================================================================
    // Polling (fallback when WebSocket not available)
    // =========================================================================
    startPolling() {
        this.pollingInterval = setInterval(() => this.pollAddresses(), this.config.pollingInterval);
    }
    async pollAddresses() {
        for (const deposit of this.deposits.values()) {
            // Only poll for waiting or detected deposits
            if (deposit.status !== "waiting" && deposit.status !== "detected") {
                continue;
            }
            try {
                // Check mempool first
                const mempoolTxs = await this.esplora.getAddressTxs(deposit.taprootAddress);
                if (mempoolTxs.length > 0) {
                    // Convert to our format and handle
                    const converted = mempoolTxs.map((tx) => ({
                        txid: tx.txid,
                        version: tx.version,
                        locktime: tx.locktime,
                        vin: tx.vin.map((vin) => ({
                            txid: vin.txid,
                            vout: vin.vout,
                            prevout: vin.prevout
                                ? {
                                    scriptpubkey: vin.prevout.scriptpubkey,
                                    scriptpubkey_asm: vin.prevout.scriptpubkey_asm,
                                    scriptpubkey_type: vin.prevout.scriptpubkey_type,
                                    scriptpubkey_address: vin.prevout.scriptpubkey_address,
                                    value: vin.prevout.value,
                                }
                                : null,
                            scriptsig: vin.scriptsig,
                            scriptsig_asm: vin.scriptsig_asm,
                            witness: vin.witness,
                            is_coinbase: vin.is_coinbase,
                            sequence: vin.sequence,
                        })),
                        vout: tx.vout.map((vout) => ({
                            scriptpubkey: vout.scriptpubkey,
                            scriptpubkey_asm: vout.scriptpubkey_asm,
                            scriptpubkey_type: vout.scriptpubkey_type,
                            scriptpubkey_address: vout.scriptpubkey_address,
                            value: vout.value,
                        })),
                        size: tx.size,
                        weight: tx.weight,
                        fee: tx.fee,
                        status: tx.status,
                    }));
                    this.handleTransactions(converted);
                }
            }
            catch (err) {
                console.error(`Failed to poll address ${deposit.taprootAddress}:`, err);
            }
        }
    }
    // =========================================================================
    // Manual operations
    // =========================================================================
    /**
     * Manually mark a deposit as verified (called after Solana verification)
     */
    async markVerified(id, leafIndex) {
        const deposit = this.deposits.get(id);
        if (deposit) {
            deposit.leafIndex = leafIndex;
            this.updateStatus(deposit, "verified");
            await this.saveToStorage();
        }
    }
    /**
     * Manually mark a deposit as claimed
     */
    async markClaimed(id) {
        const deposit = this.deposits.get(id);
        if (deposit) {
            this.updateStatus(deposit, "claimed");
            await this.saveToStorage();
        }
    }
    /**
     * Force refresh a deposit's status from the blockchain
     */
    async refreshDeposit(id) {
        const deposit = this.deposits.get(id);
        if (!deposit)
            return undefined;
        try {
            // Check for transactions
            const txs = await this.esplora.getAddressTxs(deposit.taprootAddress);
            if (txs.length > 0 && !deposit.txid) {
                // Find matching output
                for (const tx of txs) {
                    for (let i = 0; i < tx.vout.length; i++) {
                        if (tx.vout[i].scriptpubkey_address === deposit.taprootAddress) {
                            deposit.txid = tx.txid;
                            deposit.vout = i;
                            deposit.detectedAmount = tx.vout[i].value;
                            if (tx.status.confirmed) {
                                deposit.blockHeight = tx.status.block_height;
                                deposit.blockHash = tx.status.block_hash;
                            }
                            this.updateStatus(deposit, "detected");
                            break;
                        }
                    }
                    if (deposit.txid)
                        break;
                }
            }
            // Update confirmations
            if (deposit.txid) {
                deposit.confirmations = await this.esplora.getConfirmations(deposit.txid);
                if (deposit.confirmations >= deposit.requiredConfirmations) {
                    if (deposit.status !== "confirmed" && deposit.status !== "verified" && deposit.status !== "claimed") {
                        this.updateStatus(deposit, "confirmed");
                    }
                }
                else if (deposit.confirmations > 0) {
                    if (deposit.status !== "confirming") {
                        this.updateStatus(deposit, "confirming");
                    }
                }
            }
            await this.saveToStorage();
            return deposit;
        }
        catch (err) {
            console.error(`Failed to refresh deposit ${id}:`, err);
            return deposit;
        }
    }
}
exports.BaseDepositWatcher = BaseDepositWatcher;
