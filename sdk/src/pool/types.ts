/**
 * Yield Pool Types
 *
 * All interfaces and type definitions for the yield pool module.
 */

import type { GrumpkinPoint } from "../crypto";

// ==========================================================================
// Operation Status Types
// ==========================================================================

/**
 * Steps in a pool operation
 */
export type PoolOperationStep =
  | "preparing"
  | "generating_proof"
  | "building_tx"
  | "sending_tx"
  | "confirming"
  | "complete"
  | "error";

/**
 * Status update for pool operations
 */
export interface PoolOperationStatus {
  step: PoolOperationStep;
  message: string;
  progress?: number; // 0-100
  error?: string;
}

/**
 * Progress callback for pool operations
 */
export type PoolOperationProgressCallback = (status: PoolOperationStatus) => void;

// ==========================================================================
// Position Types
// ==========================================================================

/**
 * Stealth pool position (what user stores locally after deposit)
 *
 * Unlike note-based approach, user only needs to store ephemeral info.
 * Position can be rediscovered by scanning with viewing key.
 */
export interface StealthPoolPosition {
  /** Pool ID this position belongs to */
  poolId: Uint8Array;

  /** Ephemeral public key (33 bytes compressed) - stored on-chain */
  ephemeralPub: Uint8Array;

  /** Principal amount in satoshis */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Computed stealth public key point */
  stealthPub: GrumpkinPoint;

  /** Pool commitment: Poseidon(stealthPub.x, principal, depositEpoch) */
  commitment: bigint;

  /** Leaf index in pool commitment tree */
  leafIndex: number;

  /** Byte representations for on-chain use */
  commitmentBytes: Uint8Array;
}

/**
 * Scanned pool position (found by viewing key)
 *
 * Contains enough info for display but NOT for spending.
 * Spending requires deriving stealthPriv with spending key.
 */
export interface ScannedPoolPosition {
  /** Pool ID */
  poolId: Uint8Array;

  /** Ephemeral public key from announcement */
  ephemeralPub: GrumpkinPoint;

  /** Principal amount */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Computed stealth public key */
  stealthPub: GrumpkinPoint;

  /** Pool commitment */
  commitment: Uint8Array;

  /** Leaf index in tree */
  leafIndex: number;

  /** Created timestamp */
  createdAt: number;
}

/**
 * Prepared claim/withdraw inputs (requires spending key)
 */
export interface StealthPoolClaimInputs {
  /** Stealth private key (spendingPriv + hash(sharedSecret)) */
  stealthPrivKey: bigint;

  /** Principal amount */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Leaf index */
  leafIndex: number;

  /** Merkle proof elements */
  merklePath: bigint[];

  /** Merkle path indices */
  merkleIndices: number[];

  /** Pool merkle root */
  merkleRoot: bigint;

  /** Nullifier: Poseidon(stealthPriv, leafIndex) */
  nullifier: bigint;

  /** Nullifier hash for on-chain */
  nullifierHash: bigint;
}

/**
 * Serializable pool position for storage
 */
export interface SerializedStealthPoolPosition {
  poolId: string;
  ephemeralPub: string;
  principal: string;
  depositEpoch: string;
  stealthPubX: string;
  stealthPubY: string;
  commitment: string;
  leafIndex: number;
}

// ==========================================================================
// Configuration Types
// ==========================================================================

/**
 * Yield pool configuration (on-chain state)
 */
export interface YieldPoolConfig {
  poolId: Uint8Array;
  yieldRateBps: number;
  epochDuration: number;
  currentEpoch: bigint;
  totalPrincipal: bigint;
  paused: boolean;
}

// ==========================================================================
// Result Types
// ==========================================================================

/**
 * Result from depositing to pool
 */
export interface DepositToPoolResult {
  position: StealthPoolPosition;
  signature?: string;
}

/**
 * Result from withdrawing from pool
 */
export interface WithdrawFromPoolResult {
  outputNote: import("../note").Note;
  yieldEarned: bigint;
  signature?: string;
}

/**
 * Result from claiming yield
 */
export interface ClaimPoolYieldResult {
  newPosition: StealthPoolPosition;
  yieldNote: import("../note").Note;
  yieldAmount: bigint;
  signature?: string;
}

/**
 * Result from compounding yield
 */
export interface CompoundYieldResult {
  newPosition: StealthPoolPosition;
  compoundedAmount: bigint;
  signature?: string;
}

// ==========================================================================
// On-Chain Types
// ==========================================================================

/**
 * On-chain stealth pool announcement
 */
export interface OnChainStealthPoolAnnouncement {
  poolId: Uint8Array;
  ephemeralPub: Uint8Array;
  principal: bigint;
  depositEpoch: bigint;
  poolCommitment: Uint8Array;
  leafIndex: number;
  createdAt: number;
}

// ==========================================================================
// Input Types
// ==========================================================================

/**
 * Unified commitment input for pool deposit (replaces Note)
 */
export interface UnifiedCommitmentInput {
  privKey: bigint;
  pubKeyX: bigint;
  amount: bigint;
  leafIndex: bigint;
}
