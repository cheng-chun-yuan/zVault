/**
 * Esplora Client - Platform-agnostic HTTP client for Bitcoin blockchain queries
 *
 * Uses standard fetch API (works in browser, Node.js 18+, React Native)
 * Supports mempool.space API for testnet/mainnet
 */
const NETWORK_URLS = {
    mainnet: "https://mempool.space/api",
    testnet: "https://mempool.space/testnet/api",
    testnet4: "https://mempool.space/testnet4/api",
    signet: "https://mempool.space/signet/api",
};
export class EsploraClient {
    constructor(networkOrUrl = "testnet", customBaseUrl) {
        if (customBaseUrl) {
            this.baseUrl = customBaseUrl.replace(/\/$/, "");
            this.network = networkOrUrl;
        }
        else if (networkOrUrl in NETWORK_URLS) {
            this.network = networkOrUrl;
            this.baseUrl = NETWORK_URLS[this.network];
        }
        else {
            // Assume it's a custom URL
            this.baseUrl = networkOrUrl.replace(/\/$/, "");
            this.network = "testnet";
        }
    }
    async fetch(endpoint) {
        const url = `${this.baseUrl}${endpoint}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Esplora API error: ${res.status} ${res.statusText}`);
        }
        const contentType = res.headers.get("content-type");
        if (contentType?.includes("application/json")) {
            return res.json();
        }
        // For text responses (like block height)
        const text = await res.text();
        return text;
    }
    // =========================================================================
    // Address endpoints
    // =========================================================================
    async getAddress(address) {
        return this.fetch(`/address/${address}`);
    }
    async getAddressTxs(address, lastSeenTxid) {
        const endpoint = lastSeenTxid
            ? `/address/${address}/txs/chain/${lastSeenTxid}`
            : `/address/${address}/txs`;
        return this.fetch(endpoint);
    }
    async getAddressTxsMempool(address) {
        return this.fetch(`/address/${address}/txs/mempool`);
    }
    async getAddressUtxos(address) {
        return this.fetch(`/address/${address}/utxo`);
    }
    // =========================================================================
    // Transaction endpoints
    // =========================================================================
    async getTransaction(txid) {
        return this.fetch(`/tx/${txid}`);
    }
    async getTxStatus(txid) {
        return this.fetch(`/tx/${txid}/status`);
    }
    async getTxHex(txid) {
        return this.fetch(`/tx/${txid}/hex`);
    }
    async getTxRaw(txid) {
        const hex = await this.getTxHex(txid);
        return hexToBytes(hex);
    }
    async getTxMerkleProof(txid) {
        return this.fetch(`/tx/${txid}/merkle-proof`);
    }
    async getTxOutspend(txid, vout) {
        return this.fetch(`/tx/${txid}/outspend/${vout}`);
    }
    // =========================================================================
    // Block endpoints
    // =========================================================================
    async getBlockHeight() {
        const height = await this.fetch("/blocks/tip/height");
        return parseInt(height, 10);
    }
    async getBlockHash(height) {
        return this.fetch(`/block-height/${height}`);
    }
    async getBlockHeader(hash) {
        return this.fetch(`/block/${hash}/header`);
    }
    async getBlockTxids(hash) {
        return this.fetch(`/block/${hash}/txids`);
    }
    // =========================================================================
    // Helper methods
    // =========================================================================
    async getConfirmations(txid) {
        const status = await this.getTxStatus(txid);
        if (!status.confirmed || status.block_height === undefined) {
            return 0;
        }
        const tipHeight = await this.getBlockHeight();
        return tipHeight - status.block_height + 1;
    }
    async waitForTransaction(address, timeoutMs = 600000, pollIntervalMs = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            // Check mempool first
            const mempoolTxs = await this.getAddressTxsMempool(address);
            if (mempoolTxs.length > 0) {
                return mempoolTxs[0];
            }
            // Check confirmed
            const confirmedTxs = await this.getAddressTxs(address);
            if (confirmedTxs.length > 0) {
                return confirmedTxs[0];
            }
            await sleep(pollIntervalMs);
        }
        return null;
    }
    async waitForConfirmations(txid, requiredConfirmations = 6, timeoutMs = 3600000, pollIntervalMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const confirmations = await this.getConfirmations(txid);
            if (confirmations >= requiredConfirmations) {
                return confirmations;
            }
            await sleep(pollIntervalMs);
        }
        return await this.getConfirmations(txid);
    }
    /**
     * Find a deposit to a specific address matching the expected amount
     */
    async findDeposit(address, expectedAmount) {
        // Check mempool first
        const mempoolTxs = await this.getAddressTxsMempool(address);
        for (const tx of mempoolTxs) {
            const result = this.findMatchingOutput(tx, address, expectedAmount);
            if (result)
                return result;
        }
        // Check confirmed transactions
        const confirmedTxs = await this.getAddressTxs(address);
        for (const tx of confirmedTxs) {
            const result = this.findMatchingOutput(tx, address, expectedAmount);
            if (result)
                return result;
        }
        return null;
    }
    findMatchingOutput(tx, address, expectedAmount) {
        for (let i = 0; i < tx.vout.length; i++) {
            const output = tx.vout[i];
            if (output.scriptpubkey_address === address) {
                if (expectedAmount === undefined ||
                    BigInt(output.value) === expectedAmount) {
                    return { tx, vout: i, amount: output.value };
                }
            }
        }
        return null;
    }
    getNetwork() {
        return this.network;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
}
// =========================================================================
// Utility functions
// =========================================================================
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Default client for testnet
export const esploraTestnet = new EsploraClient("testnet");
export const esploraMainnet = new EsploraClient("mainnet");
