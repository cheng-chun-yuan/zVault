export type OperationType = 'deposit' | 'transfer' | 'split' | 'claim';
export interface HistoryNode {
    id: string;
    parentId: string | null;
    operation: OperationType;
    timestamp: number;
    data: any;
    proof: Uint8Array;
    recursiveProof?: Uint8Array;
}
export interface HistoryChain {
    nodes: Map<string, HistoryNode>;
    heads: Set<string>;
}
/**
 * Interface for generating recursive proofs.
 * In a production environment, this would verify the previous proof inside a ZK circuit.
 */
export interface ProofAggregator {
    aggregate(prevProof: Uint8Array | undefined, currentProof: Uint8Array, publicInputs: any): Promise<Uint8Array>;
    verify(proof: Uint8Array): Promise<boolean>;
}
/**
 * Mocks a recursive prover for demonstration.
 * Real implementation would use Nova / Halo2 / Groth16 recursive verification.
 */
export declare class MockRecursiveProver implements ProofAggregator {
    aggregate(prevProof: Uint8Array | undefined, currentProof: Uint8Array, publicInputs: any): Promise<Uint8Array>;
    verify(proof: Uint8Array): Promise<boolean>;
}
/**
 * Manages local transaction history and audit chains.
 */
export declare class HistoryManager {
    private chain;
    private aggregator;
    constructor(aggregator?: ProofAggregator);
    /**
     * Add a new event to the history
     */
    addEvent(operation: OperationType, data: any, proof: Uint8Array, parentId?: string | null): Promise<string>;
    /**
     * Get the full lineage for a specific head (audit trail)
     */
    getAuditTrail(headId: string): HistoryNode[];
    /**
     * Export the recursive proof for a specific head
     */
    getAuditProof(headId: string): Uint8Array | undefined;
    /**
     * Serialize history to JSON (for local storage)
     */
    toJSON(): string;
    /**
     * Load history from JSON
     */
    loadJSON(json: string): void;
}
