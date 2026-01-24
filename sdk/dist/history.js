import { bytesToHex } from "./crypto";
// ========== Implementation ==========
/**
 * Mocks a recursive prover for demonstration.
 * Real implementation would use Nova / Halo2 / Groth16 recursive verification.
 */
export class MockRecursiveProver {
    async aggregate(prevProof, currentProof, publicInputs) {
        // Simulating aggregation by concatenating hashes or similar
        // In real ZK, this is a computation heavy proof generation
        const combined = new Uint8Array(currentProof.length + (prevProof ? prevProof.length : 0));
        if (prevProof) {
            combined.set(prevProof, 0);
            combined.set(currentProof, prevProof.length);
        }
        else {
            combined.set(currentProof, 0);
        }
        return combined;
    }
    async verify(proof) {
        return proof.length > 0;
    }
}
/**
 * Manages local transaction history and audit chains.
 */
export class HistoryManager {
    constructor(aggregator = new MockRecursiveProver()) {
        this.chain = {
            nodes: new Map(),
            heads: new Set(),
        };
        this.aggregator = aggregator;
    }
    /**
     * Add a new event to the history
     */
    async addEvent(operation, data, proof, parentId = null) {
        const timestamp = Date.now();
        // Get parent proof for recursion
        let prevRecursiveProof;
        if (parentId) {
            const parent = this.chain.nodes.get(parentId);
            if (!parent)
                throw new Error(`Parent node ${parentId} not found`);
            prevRecursiveProof = parent.recursiveProof;
            this.chain.heads.delete(parentId);
        }
        // Generate recursive proof (aggregating history)
        const recursiveProof = await this.aggregator.aggregate(prevRecursiveProof, proof, data);
        // Create node ID (simple random for now, ideally hash of content)
        const id = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
        const node = {
            id,
            parentId,
            operation,
            timestamp,
            data,
            proof,
            recursiveProof,
        };
        this.chain.nodes.set(id, node);
        this.chain.heads.add(id);
        return id;
    }
    /**
     * Get the full lineage for a specific head (audit trail)
     */
    getAuditTrail(headId) {
        const trail = [];
        let currentId = headId;
        while (currentId) {
            const node = this.chain.nodes.get(currentId);
            if (!node)
                break;
            trail.unshift(node); // Prepend to order from oldest to newest
            currentId = node.parentId;
        }
        return trail;
    }
    /**
     * Export the recursive proof for a specific head
     */
    getAuditProof(headId) {
        return this.chain.nodes.get(headId)?.recursiveProof;
    }
    /**
     * Serialize history to JSON (for local storage)
     */
    toJSON() {
        return JSON.stringify({
            nodes: Array.from(this.chain.nodes.entries()),
            heads: Array.from(this.chain.heads),
        }, (key, value) => {
            if (value instanceof Uint8Array) {
                return Array.from(value); // Serialize Uint8Array
            }
            return value;
        });
    }
    /**
     * Load history from JSON
     */
    loadJSON(json) {
        const data = JSON.parse(json);
        this.chain.nodes = new Map(data.nodes.map((entry) => {
            // Restore Uint8Arrays
            entry[1].proof = new Uint8Array(entry[1].proof);
            if (entry[1].recursiveProof) {
                entry[1].recursiveProof = new Uint8Array(entry[1].recursiveProof);
            }
            return entry;
        }));
        this.chain.heads = new Set(data.heads);
    }
}
