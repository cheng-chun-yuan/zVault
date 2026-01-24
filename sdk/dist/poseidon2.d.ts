/**
 * Poseidon2 Hash - BN254 compatible with Noir circuits
 *
 * Uses @zkpassport/poseidon2 which matches Noir's Poseidon2 exactly.
 */
import { poseidon2Hash as zkPoseidon2 } from "@zkpassport/poseidon2";
export declare const poseidon2Hash: typeof zkPoseidon2;
export declare const poseidon2HashSync: typeof zkPoseidon2;
export declare const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** Derive note public key from ECDH shared secret */
export declare const deriveNotePubKey: (sharedX: bigint, sharedY: bigint) => bigint;
/** Compute commitment for Merkle tree */
export declare const computeCommitment: (notePubKey: bigint, amount: bigint, random?: bigint) => bigint;
/** Compute nullifier from spending key and leaf index */
export declare const computeNullifier: (spendingPriv: bigint, leafIndex: bigint) => bigint;
/** Hash nullifier for double-spend prevention */
export declare const hashNullifier: (nullifier: bigint) => bigint;
/** Compute note from nullifier and secret (legacy) */
export declare const computeNote: (nullifier: bigint, secret: bigint) => bigint;
/** @deprecated Use computeCommitment */
export declare const computeCommitmentLegacy: (nullifier: bigint, secret: bigint, amount: bigint) => bigint;
/** @deprecated Use computeNullifier */
export declare const computeNullifierHashLegacy: (nullifier: bigint) => bigint;
export declare const initPoseidon2Sync: () => Promise<void>;
