/**
 * ZK Proof generation utilities for zVault
 *
 * Uses Noir UltraHonk proofs for all circuits:
 * - Claim (direct minting)
 * - Transfer (commitment refresh)
 * - Split (1-in-2-out)
 * - Partial Withdraw (withdraw with change)
 */
import type { Note } from "./note";
import type { MerkleProof } from "./merkle";
/**
 * Noir UltraHonk proof structure
 */
export interface NoirProof {
    /** Raw proof bytes (~16KB) */
    proof: Uint8Array;
    /** Public inputs as hex strings */
    publicInputs: string[];
    /** Verification key bytes */
    verificationKey: Uint8Array;
    /** Verification key hash (32 bytes) */
    vkHash: Uint8Array;
}
/**
 * Circuit types available
 */
export type CircuitType = "claim" | "transfer" | "split" | "partial_withdraw";
/**
 * Get the path to noir circuits directory
 */
export declare function getNoirCircuitsDir(): string;
/**
 * Check if nargo is available
 */
export declare function isNargoAvailable(): boolean;
/**
 * Check if bb CLI is available
 */
export declare function isBbAvailable(): boolean;
/**
 * Check if proof generation is available
 */
export declare function isProofGenerationAvailable(): boolean;
/**
 * Generate a Noir proof for a circuit
 *
 * @param circuitType - The type of circuit to prove
 * @param inputs - Input values for the circuit
 * @returns The generated proof
 */
export declare function generateProof(circuitType: CircuitType, inputs: Record<string, string | string[]>): Promise<NoirProof>;
/**
 * Verify a Noir proof using bb CLI
 */
export declare function verifyProof(circuitType: CircuitType, proof: NoirProof): Promise<boolean>;
/**
 * Generate a claim proof
 *
 * Proves:
 * - Knowledge of (nullifier, secret) for commitment
 * - Commitment exists in Merkle tree at given root
 * - Outputs correct nullifier hash
 */
export declare function generateClaimProof(note: Note, merkleProof: MerkleProof): Promise<NoirProof>;
/**
 * Generate a transfer proof (commitment refresh)
 *
 * 1-in-1-out: Spends input commitment, creates new output commitment
 * with same amount but new secrets
 */
export declare function generateTransferProof(inputNote: Note, outputNote: Note, merkleProof: MerkleProof): Promise<NoirProof>;
/**
 * Generate a split proof
 *
 * 1-in-2-out: Spends input commitment, creates two output commitments
 * Individual output amounts are private (only conservation proven)
 */
export declare function generateSplitProof(inputNote: Note, output1Note: Note, output2Note: Note, merkleProof: MerkleProof): Promise<NoirProof>;
/**
 * Generate a partial withdraw proof
 *
 * Withdraw any amount with change returned as a new commitment
 */
export declare function generatePartialWithdrawProof(inputNote: Note, withdrawAmount: bigint, changeNote: Note, merkleProof: MerkleProof, recipient: Uint8Array): Promise<NoirProof>;
/**
 * Serialize NoirProof for transport/storage
 */
export declare function serializeProof(proof: NoirProof): Uint8Array;
/**
 * Deserialize NoirProof from bytes
 */
export declare function deserializeProof(data: Uint8Array): NoirProof;
