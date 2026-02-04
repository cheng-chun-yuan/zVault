/**
 * Solana Types
 *
 * Type definitions for Solana-related operations in zVault.
 *
 * @module types/solana
 */

import type { Address, AccountRole } from "@solana/kit";

// ==========================================================================
// Instruction Types
// ==========================================================================

/**
 * Instruction type for v2 (compatible with @solana/kit)
 */
export interface Instruction {
  programAddress: Address;
  accounts: Array<{ address: Address; role: (typeof AccountRole)[keyof typeof AccountRole] }>;
  data: Uint8Array;
}

/**
 * Proof source for legacy instructions (claim, pool operations)
 *
 * - "inline": Proof bytes included directly in instruction data
 * - "buffer": Proof stored in ChadBuffer account
 */
export type ProofSource = "inline" | "buffer";

// ==========================================================================
// Instruction Options
// ==========================================================================

/**
 * Claim instruction options
 */
export interface ClaimInstructionOptions {
  /** Proof source mode */
  proofSource: ProofSource;
  /** Proof bytes (required for inline mode) */
  proofBytes?: Uint8Array;
  /** ChadBuffer account address (required for buffer mode) */
  bufferAddress?: Address;
  /** Merkle root */
  root: Uint8Array;
  /** Nullifier hash */
  nullifierHash: Uint8Array;
  /** Amount in satoshis */
  amountSats: bigint;
  /** Recipient address */
  recipient: Address;
  /** VK hash */
  vkHash: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    commitmentTree: Address;
    nullifierRecord: Address;
    zbtcMint: Address;
    poolVault: Address;
    recipientAta: Address;
    user: Address;
  };
}

/**
 * Split instruction options
 */
export interface SplitInstructionOptions {
  /** ChadBuffer account address containing the proof */
  bufferAddress: Address;
  /** Merkle root */
  root: Uint8Array;
  /** Nullifier hash */
  nullifierHash: Uint8Array;
  /** First output commitment */
  outputCommitment1: Uint8Array;
  /** Second output commitment */
  outputCommitment2: Uint8Array;
  /** VK hash */
  vkHash: Uint8Array;
  /** Ephemeral pubkey x-coordinate for first output stealth announcement (32 bytes) */
  output1EphemeralPubX: Uint8Array;
  /** Packed encrypted amount with y_sign for first output (32 bytes) */
  output1EncryptedAmountWithSign: Uint8Array;
  /** Ephemeral pubkey x-coordinate for second output stealth announcement (32 bytes) */
  output2EphemeralPubX: Uint8Array;
  /** Packed encrypted amount with y_sign for second output (32 bytes) */
  output2EncryptedAmountWithSign: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    commitmentTree: Address;
    nullifierRecord: Address;
    user: Address;
    /** Stealth announcement PDA for first output */
    stealthAnnouncement1: Address;
    /** Stealth announcement PDA for second output */
    stealthAnnouncement2: Address;
  };
}

/**
 * SpendPartialPublic instruction options
 */
export interface SpendPartialPublicInstructionOptions {
  /** ChadBuffer account address containing the proof */
  bufferAddress: Address;
  /** Merkle root */
  root: Uint8Array;
  /** Nullifier hash */
  nullifierHash: Uint8Array;
  /** Public output amount in sats */
  publicAmountSats: bigint;
  /** Change commitment */
  changeCommitment: Uint8Array;
  /** Recipient address */
  recipient: Address;
  /** VK hash */
  vkHash: Uint8Array;
  /** Ephemeral pubkey x-coordinate for change stealth announcement (32 bytes) */
  changeEphemeralPubX: Uint8Array;
  /** Packed encrypted amount with y_sign (32 bytes) */
  changeEncryptedAmountWithSign: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    commitmentTree: Address;
    nullifierRecord: Address;
    zbtcMint: Address;
    poolVault: Address;
    recipientAta: Address;
    user: Address;
    /** Stealth announcement PDA for change output */
    stealthAnnouncementChange: Address;
  };
}

/**
 * Pool deposit instruction options
 */
export interface PoolDepositInstructionOptions {
  /** Proof source mode */
  proofSource: ProofSource;
  /** Proof bytes (required for inline mode) */
  proofBytes?: Uint8Array;
  /** ChadBuffer account address (required for buffer mode) */
  bufferAddress?: Address;
  /** Merkle root */
  root: Uint8Array;
  /** Nullifier hash */
  nullifierHash: Uint8Array;
  /** Pool commitment */
  poolCommitment: Uint8Array;
  /** Amount in sats */
  amountSats: bigint;
  /** VK hash */
  vkHash: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    commitmentTree: Address;
    nullifierRecord: Address;
    yieldPool: Address;
    poolCommitmentTree: Address;
    user: Address;
  };
}

/**
 * Pool withdraw instruction options
 */
export interface PoolWithdrawInstructionOptions {
  /** Proof source mode */
  proofSource: ProofSource;
  /** Proof bytes (required for inline mode) */
  proofBytes?: Uint8Array;
  /** ChadBuffer account address (required for buffer mode) */
  bufferAddress?: Address;
  /** Pool merkle root */
  poolRoot: Uint8Array;
  /** Pool nullifier hash */
  poolNullifierHash: Uint8Array;
  /** Amount to withdraw in sats */
  amountSats: bigint;
  /** Output commitment (change back to private) */
  outputCommitment: Uint8Array;
  /** VK hash */
  vkHash: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    commitmentTree: Address;
    yieldPool: Address;
    poolCommitmentTree: Address;
    poolNullifierRecord: Address;
    user: Address;
  };
}

/**
 * Pool claim yield instruction options
 */
export interface PoolClaimYieldInstructionOptions {
  /** Proof source mode */
  proofSource: ProofSource;
  /** Proof bytes (required for inline mode) */
  proofBytes?: Uint8Array;
  /** ChadBuffer account address (required for buffer mode) */
  bufferAddress?: Address;
  /** Pool merkle root */
  poolRoot: Uint8Array;
  /** Pool nullifier hash */
  poolNullifierHash: Uint8Array;
  /** New pool commitment (with principal only) */
  newPoolCommitment: Uint8Array;
  /** Yield amount in sats */
  yieldAmountSats: bigint;
  /** Recipient address */
  recipient: Address;
  /** VK hash */
  vkHash: Uint8Array;
  /** Account addresses */
  accounts: {
    poolState: Address;
    yieldPool: Address;
    poolCommitmentTree: Address;
    poolNullifierRecord: Address;
    zbtcMint: Address;
    poolVault: Address;
    recipientAta: Address;
    user: Address;
  };
}

/**
 * Redemption request instruction options
 */
export interface RedemptionRequestInstructionOptions {
  /** Amount to redeem in satoshis */
  amountSats: bigint;
  /** Bitcoin address for withdrawal */
  btcAddress: string;
  /** Account addresses */
  accounts: {
    poolState: Address;
    zbtcMint: Address;
    userTokenAccount: Address;
    user: Address;
  };
}

// ==========================================================================
// Constants
// ==========================================================================

/**
 * Instruction discriminators
 */
export const INSTRUCTION_DISCRIMINATORS = {
  SPEND_SPLIT: 4,
  REQUEST_REDEMPTION: 5,
  CLAIM: 9,
  SPEND_PARTIAL_PUBLIC: 10,
  DEPOSIT_TO_POOL: 31,
  WITHDRAW_FROM_POOL: 32,
  CLAIM_POOL_YIELD: 33,
} as const;

/**
 * UltraHonk verifier instruction discriminators
 */
export const VERIFIER_DISCRIMINATORS = {
  VERIFY: 0,
  VERIFY_WITH_VK_ACCOUNT: 1,
  INIT_VK: 2,
  VERIFY_FROM_BUFFER: 3,
} as const;
