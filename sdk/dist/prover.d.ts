/**
 * WASM-based Noir Proof Generator for ZVault
 *
 * Universal prover that works in both Browser and Node.js environments.
 * Uses UltraHonk proofs via @aztec/bb.js with lazy loading.
 */
export interface MerkleProofInput {
    siblings: bigint[];
    indices: number[];
}
export interface ProofData {
    proof: Uint8Array;
    publicInputs: string[];
    verificationKey?: Uint8Array;
}
export type CircuitType = "claim" | "transfer" | "split" | "partial_withdraw";
/**
 * Set the base path for circuit artifacts
 *
 * @example Browser: setCircuitPath("/circuits/noir")
 * @example Node.js: setCircuitPath("../sdk/circuits")
 */
export declare function setCircuitPath(path: string): void;
/**
 * Get the current circuit base path
 */
export declare function getCircuitPath(): string;
/**
 * Initialize the prover (preloads WASM modules)
 *
 * Call this early in your app to reduce latency on first proof generation.
 */
export declare function initProver(): Promise<void>;
/**
 * Check if prover is available in current environment
 */
export declare function isProverAvailable(): Promise<boolean>;
/**
 * Claim proof inputs
 */
export interface ClaimInputs {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    merkleRoot: bigint;
    merkleProof: MerkleProofInput;
}
/**
 * Generate a claim proof
 *
 * Proves knowledge of (nullifier, secret) for commitment in Merkle tree.
 */
export declare function generateClaimProof(inputs: ClaimInputs): Promise<ProofData>;
/**
 * Split proof inputs
 */
export interface SplitInputs {
    inputNullifier: bigint;
    inputSecret: bigint;
    inputAmount: bigint;
    merkleRoot: bigint;
    merkleProof: MerkleProofInput;
    output1Nullifier: bigint;
    output1Secret: bigint;
    output1Amount: bigint;
    output2Nullifier: bigint;
    output2Secret: bigint;
    output2Amount: bigint;
}
/**
 * Generate a split proof
 *
 * 1-in-2-out: Spends input commitment, creates two output commitments.
 * Note: Split circuit uses 20-level tree (merkleProof.siblings must have 20 elements)
 */
export declare function generateSplitProof(inputs: SplitInputs): Promise<ProofData>;
/**
 * Transfer proof inputs
 */
export interface TransferInputs {
    inputNullifier: bigint;
    inputSecret: bigint;
    amount: bigint;
    merkleRoot: bigint;
    merkleProof: MerkleProofInput;
    outputNullifier: bigint;
    outputSecret: bigint;
}
/**
 * Generate a transfer proof
 *
 * 1-in-1-out: Spends input commitment, creates new output commitment with same amount.
 */
export declare function generateTransferProof(inputs: TransferInputs): Promise<ProofData>;
/**
 * Withdraw proof inputs
 */
export interface WithdrawInputs {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
    merkleRoot: bigint;
    merkleProof: MerkleProofInput;
    withdrawAmount: bigint;
    changeNullifier: bigint;
    changeSecret: bigint;
    changeAmount: bigint;
    recipient: bigint;
}
/**
 * Generate a partial withdraw proof
 *
 * Withdraw any amount with change returned as a new commitment.
 */
export declare function generateWithdrawProof(inputs: WithdrawInputs): Promise<ProofData>;
/**
 * Verify a proof locally using the backend
 */
export declare function verifyProof(circuitType: CircuitType, proof: ProofData): Promise<boolean>;
/**
 * Check if a specific circuit artifact exists
 */
export declare function circuitExists(circuitType: CircuitType): Promise<boolean>;
/**
 * Convert proof to raw bytes for on-chain submission
 */
export declare function proofToBytes(proof: ProofData): Uint8Array;
/**
 * Cleanup all cached resources
 *
 * Call this when done with proof generation to free memory.
 */
export declare function cleanup(): Promise<void>;
