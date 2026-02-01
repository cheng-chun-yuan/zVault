/**
 * ZVault Instruction Builders
 *
 * Low-level instruction building for ZVault operations.
 * Uses instruction introspection - verifier IX must precede zVault IX in same TX.
 *
 * @module instructions
 */

import {
  address,
  AccountRole,
  type Address,
} from "@solana/kit";

import { getConfig, TOKEN_2022_PROGRAM_ID } from "./config";
import { CHADBUFFER_PROGRAM_ID } from "./chadbuffer";
import { BN254_FIELD_PRIME, bytesToBigint, bigintToBytes } from "./crypto";

/** System program address */
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

/** Instructions sysvar address */
const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");

// =============================================================================
// Types
// =============================================================================

/** Instruction type for v2 */
export interface Instruction {
  programAddress: Address;
  accounts: Array<{ address: Address; role: (typeof AccountRole)[keyof typeof AccountRole] }>;
  data: Uint8Array;
}

/** Proof source for legacy instructions (claim, pool operations) */
export type ProofSource = "inline" | "buffer";

/** Claim instruction options */
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

/** Split instruction options */
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

/** SpendPartialPublic instruction options */
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

/** Pool deposit instruction options */
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

/** Pool withdraw instruction options */
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

/** Pool claim yield instruction options */
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

// =============================================================================
// Constants
// =============================================================================

/** Instruction discriminators */
const INSTRUCTION = {
  SPEND_SPLIT: 4,
  REQUEST_REDEMPTION: 5,
  CLAIM: 9,
  SPEND_PARTIAL_PUBLIC: 10,
  DEPOSIT_TO_POOL: 31,
  WITHDRAW_FROM_POOL: 32,
  CLAIM_POOL_YIELD: 33,
} as const;

/** Export instruction discriminators for consumers */
export const INSTRUCTION_DISCRIMINATORS = INSTRUCTION;


// =============================================================================
// Utilities
// =============================================================================

/**
 * Simple base58 decoding for addresses
 */
function bs58Decode(str: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
  }

  let num = BigInt(0);
  for (const char of str) {
    const val = ALPHABET_MAP.get(char);
    if (val === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    num = num * BigInt(58) + BigInt(val);
  }

  // Count leading zeros
  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") {
      leadingZeros++;
    } else {
      break;
    }
  }

  // Convert to bytes
  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  // Add leading zeros
  for (let i = 0; i < leadingZeros; i++) {
    bytes.unshift(0);
  }

  // Ensure 32 bytes for Solana addresses
  while (bytes.length < 32) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * Convert Address to bytes
 */
function addressToBytes(addr: Address): Uint8Array {
  return bs58Decode(addr.toString());
}

// =============================================================================
// Claim Instruction Builder
// =============================================================================

/**
 * Build claim instruction data (UltraHonk - supports buffer mode)
 *
 * ## Inline Mode (proof_source=0)
 * - proof_source: u8 (0)
 * - proof_len: u32 (LE)
 * - proof: [u8; proof_len]
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - amount_sats: u64 (LE)
 * - recipient: [u8; 32]
 * - vk_hash: [u8; 32]
 *
 * ## Buffer Mode (proof_source=1)
 * - proof_source: u8 (1)
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - amount_sats: u64 (LE)
 * - recipient: [u8; 32]
 * - vk_hash: [u8; 32]
 */
export function buildClaimInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  amountSats: bigint;
  recipient: Address;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, amountSats, recipient, vkHash } = options;
  const recipientBytes = addressToBytes(recipient);

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline format: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION.CLAIM;

    // Proof source (inline = 0)
    data[offset++] = 0;

    // Proof length (4 bytes, LE)
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;

    // Proof bytes
    data.set(proofBytes, offset);
    offset += proofBytes.length;

    // Root (32 bytes)
    data.set(root, offset);
    offset += 32;

    // Nullifier hash (32 bytes)
    data.set(nullifierHash, offset);
    offset += 32;

    // Amount (8 bytes, LE)
    view.setBigUint64(offset, amountSats, true);
    offset += 8;

    // Recipient (32 bytes)
    data.set(recipientBytes, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);

    return data;
  } else {
    // Buffer format: discriminator(1) + proof_source(1) + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION.CLAIM;

    // Proof source (buffer = 1)
    data[offset++] = 1;

    // Root (32 bytes)
    data.set(root, offset);
    offset += 32;

    // Nullifier hash (32 bytes)
    data.set(nullifierHash, offset);
    offset += 32;

    // Amount (8 bytes, LE)
    view.setBigUint64(offset, amountSats, true);
    offset += 8;

    // Recipient (32 bytes)
    data.set(recipientBytes, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);

    return data;
  }
}

/**
 * Build a complete claim instruction
 */
export function buildClaimInstruction(options: ClaimInstructionOptions): Instruction {
  const config = getConfig();

  // Build instruction data
  const data = buildClaimInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    amountSats: options.amountSats,
    recipient: options.recipient,
    vkHash: options.vkHash,
  });

  // Build accounts list
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
  ];

  // Add proof buffer account for buffer mode
  if (options.proofSource === "buffer") {
    if (!options.bufferAddress) {
      throw new Error("bufferAddress required for buffer mode");
    }
    accounts.push({ address: options.bufferAddress, role: AccountRole.READONLY });
  }

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// Split Instruction Builder
// =============================================================================

/**
 * Build split instruction data
 *
 * Format: disc(1) + root(32) + nullifier(32) + out1(32) + out2(32)
 *         + vk_hash(32) + eph1_x(32) + enc1(32) + eph2_x(32) + enc2(32)
 */
export function buildSplitInstructionData(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  vkHash: Uint8Array;
  output1EphemeralPubX: Uint8Array;
  output1EncryptedAmountWithSign: Uint8Array;
  output2EphemeralPubX: Uint8Array;
  output2EncryptedAmountWithSign: Uint8Array;
}): Uint8Array {
  const { root, nullifierHash, outputCommitment1, outputCommitment2, vkHash, output1EphemeralPubX, output1EncryptedAmountWithSign, output2EphemeralPubX, output2EncryptedAmountWithSign } = options;

  const totalSize = 1 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32;
  const data = new Uint8Array(totalSize);

  let offset = 0;
  data[offset++] = INSTRUCTION.SPEND_SPLIT;

  data.set(root, offset); offset += 32;
  data.set(nullifierHash, offset); offset += 32;
  data.set(outputCommitment1, offset); offset += 32;
  data.set(outputCommitment2, offset); offset += 32;
  data.set(vkHash, offset); offset += 32;
  data.set(output1EphemeralPubX, offset); offset += 32;
  data.set(output1EncryptedAmountWithSign, offset); offset += 32;
  data.set(output2EphemeralPubX, offset); offset += 32;
  data.set(output2EncryptedAmountWithSign, offset);

  return data;
}

/**
 * Build a complete split instruction
 *
 * Contract uses instruction introspection - verifier IX must precede this in same TX.
 */
export function buildSplitInstruction(options: SplitInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildSplitInstructionData({
    root: options.root,
    nullifierHash: options.nullifierHash,
    outputCommitment1: options.outputCommitment1,
    outputCommitment2: options.outputCommitment2,
    vkHash: options.vkHash,
    output1EphemeralPubX: options.output1EphemeralPubX,
    output1EncryptedAmountWithSign: options.output1EncryptedAmountWithSign,
    output2EphemeralPubX: options.output2EphemeralPubX,
    output2EncryptedAmountWithSign: options.output2EncryptedAmountWithSign,
  });

  // Build accounts list (10 accounts total)
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
    { address: options.accounts.stealthAnnouncement1, role: AccountRole.WRITABLE },
    { address: options.accounts.stealthAnnouncement2, role: AccountRole.WRITABLE },
    { address: options.bufferAddress, role: AccountRole.READONLY },
    { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// SpendPartialPublic Instruction Builder
// =============================================================================

/**
 * Build spend_partial_public instruction data
 *
 * Format: disc(1) + root(32) + nullifier(32) + amount(8)
 *         + change(32) + recipient(32) + vk_hash(32) + ephPubX(32) + encAmount(32)
 */
export function buildSpendPartialPublicInstructionData(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  publicAmountSats: bigint;
  changeCommitment: Uint8Array;
  recipient: Address;
  vkHash: Uint8Array;
  changeEphemeralPubX: Uint8Array;
  changeEncryptedAmountWithSign: Uint8Array;
}): Uint8Array {
  const { root, nullifierHash, publicAmountSats, changeCommitment, recipient, vkHash, changeEphemeralPubX, changeEncryptedAmountWithSign } = options;
  const recipientBytes = addressToBytes(recipient);

  const totalSize = 1 + 32 + 32 + 8 + 32 + 32 + 32 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION.SPEND_PARTIAL_PUBLIC;

  data.set(root, offset); offset += 32;
  data.set(nullifierHash, offset); offset += 32;
  view.setBigUint64(offset, publicAmountSats, true); offset += 8;
  data.set(changeCommitment, offset); offset += 32;
  data.set(recipientBytes, offset); offset += 32;
  data.set(vkHash, offset); offset += 32;
  data.set(changeEphemeralPubX, offset); offset += 32;
  data.set(changeEncryptedAmountWithSign, offset);

  return data;
}

/**
 * Build a complete spend_partial_public instruction
 *
 * Contract uses instruction introspection - verifier IX must precede this in same TX.
 */
export function buildSpendPartialPublicInstruction(options: SpendPartialPublicInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildSpendPartialPublicInstructionData({
    root: options.root,
    nullifierHash: options.nullifierHash,
    publicAmountSats: options.publicAmountSats,
    changeCommitment: options.changeCommitment,
    recipient: options.recipient,
    vkHash: options.vkHash,
    changeEphemeralPubX: options.changeEphemeralPubX,
    changeEncryptedAmountWithSign: options.changeEncryptedAmountWithSign,
  });

  // Build accounts list (13 accounts total)
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
    { address: options.accounts.stealthAnnouncementChange, role: AccountRole.WRITABLE },
    { address: options.bufferAddress, role: AccountRole.READONLY },
    { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// Pool Deposit Instruction Builder
// =============================================================================

/**
 * Build pool deposit instruction data (UltraHonk - supports buffer mode)
 */
export function buildPoolDepositInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  poolCommitment: Uint8Array;
  amountSats: bigint;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, poolCommitment, amountSats, vkHash } = options;

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) + pool_commitment(32) + amount(8) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 32 + 8 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.DEPOSIT_TO_POOL;
    data[offset++] = 0;
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;
    data.set(proofBytes, offset);
    offset += proofBytes.length;
    data.set(root, offset);
    offset += 32;
    data.set(nullifierHash, offset);
    offset += 32;
    data.set(poolCommitment, offset);
    offset += 32;
    view.setBigUint64(offset, amountSats, true);
    offset += 8;
    data.set(vkHash, offset);

    return data;
  } else {
    // Buffer: discriminator(1) + proof_source(1) + root(32) + nullifier(32) + pool_commitment(32) + amount(8) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 32 + 8 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.DEPOSIT_TO_POOL;
    data[offset++] = 1;
    data.set(root, offset);
    offset += 32;
    data.set(nullifierHash, offset);
    offset += 32;
    data.set(poolCommitment, offset);
    offset += 32;
    view.setBigUint64(offset, amountSats, true);
    offset += 8;
    data.set(vkHash, offset);

    return data;
  }
}

/**
 * Build a complete pool deposit instruction
 */
export function buildPoolDepositInstruction(options: PoolDepositInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolDepositInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    poolCommitment: options.poolCommitment,
    amountSats: options.amountSats,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
  ];

  if (options.proofSource === "buffer") {
    if (!options.bufferAddress) {
      throw new Error("bufferAddress required for buffer mode");
    }
    accounts.push({ address: options.bufferAddress, role: AccountRole.READONLY });
  }

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// Pool Withdraw Instruction Builder
// =============================================================================

/**
 * Build pool withdraw instruction data (UltraHonk - supports buffer mode)
 */
export function buildPoolWithdrawInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  poolRoot: Uint8Array;
  poolNullifierHash: Uint8Array;
  amountSats: bigint;
  outputCommitment: Uint8Array;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, poolRoot, poolNullifierHash, amountSats, outputCommitment, vkHash } = options;

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline: discriminator(1) + proof_source(1) + proof_len(4) + proof + pool_root(32) + pool_nullifier(32) + amount(8) + output_commitment(32) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.WITHDRAW_FROM_POOL;
    data[offset++] = 0;
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;
    data.set(proofBytes, offset);
    offset += proofBytes.length;
    data.set(poolRoot, offset);
    offset += 32;
    data.set(poolNullifierHash, offset);
    offset += 32;
    view.setBigUint64(offset, amountSats, true);
    offset += 8;
    data.set(outputCommitment, offset);
    offset += 32;
    data.set(vkHash, offset);

    return data;
  } else {
    // Buffer: discriminator(1) + proof_source(1) + pool_root(32) + pool_nullifier(32) + amount(8) + output_commitment(32) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.WITHDRAW_FROM_POOL;
    data[offset++] = 1;
    data.set(poolRoot, offset);
    offset += 32;
    data.set(poolNullifierHash, offset);
    offset += 32;
    view.setBigUint64(offset, amountSats, true);
    offset += 8;
    data.set(outputCommitment, offset);
    offset += 32;
    data.set(vkHash, offset);

    return data;
  }
}

/**
 * Build a complete pool withdraw instruction
 */
export function buildPoolWithdrawInstruction(options: PoolWithdrawInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolWithdrawInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    poolRoot: options.poolRoot,
    poolNullifierHash: options.poolNullifierHash,
    amountSats: options.amountSats,
    outputCommitment: options.outputCommitment,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
  ];

  if (options.proofSource === "buffer") {
    if (!options.bufferAddress) {
      throw new Error("bufferAddress required for buffer mode");
    }
    accounts.push({ address: options.bufferAddress, role: AccountRole.READONLY });
  }

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// Pool Claim Yield Instruction Builder
// =============================================================================

/**
 * Build pool claim yield instruction data (UltraHonk - supports buffer mode)
 */
export function buildPoolClaimYieldInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  poolRoot: Uint8Array;
  poolNullifierHash: Uint8Array;
  newPoolCommitment: Uint8Array;
  yieldAmountSats: bigint;
  recipient: Address;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, poolRoot, poolNullifierHash, newPoolCommitment, yieldAmountSats, recipient, vkHash } = options;
  const recipientBytes = addressToBytes(recipient);

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline: discriminator(1) + proof_source(1) + proof_len(4) + proof + pool_root(32) + pool_nullifier(32) + new_commitment(32) + yield_amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.CLAIM_POOL_YIELD;
    data[offset++] = 0;
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;
    data.set(proofBytes, offset);
    offset += proofBytes.length;
    data.set(poolRoot, offset);
    offset += 32;
    data.set(poolNullifierHash, offset);
    offset += 32;
    data.set(newPoolCommitment, offset);
    offset += 32;
    view.setBigUint64(offset, yieldAmountSats, true);
    offset += 8;
    data.set(recipientBytes, offset);
    offset += 32;
    data.set(vkHash, offset);

    return data;
  } else {
    // Buffer: discriminator(1) + proof_source(1) + pool_root(32) + pool_nullifier(32) + new_commitment(32) + yield_amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.CLAIM_POOL_YIELD;
    data[offset++] = 1;
    data.set(poolRoot, offset);
    offset += 32;
    data.set(poolNullifierHash, offset);
    offset += 32;
    data.set(newPoolCommitment, offset);
    offset += 32;
    view.setBigUint64(offset, yieldAmountSats, true);
    offset += 8;
    data.set(recipientBytes, offset);
    offset += 32;
    data.set(vkHash, offset);

    return data;
  }
}

/**
 * Build a complete pool claim yield instruction
 */
export function buildPoolClaimYieldInstruction(options: PoolClaimYieldInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolClaimYieldInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    poolRoot: options.poolRoot,
    poolNullifierHash: options.poolNullifierHash,
    newPoolCommitment: options.newPoolCommitment,
    yieldAmountSats: options.yieldAmountSats,
    recipient: options.recipient,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.READONLY },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
  ];

  if (options.proofSource === "buffer") {
    if (!options.bufferAddress) {
      throw new Error("bufferAddress required for buffer mode");
    }
    accounts.push({ address: options.bufferAddress, role: AccountRole.READONLY });
  }

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// UltraHonk Verifier Instruction Builder
// =============================================================================

/** UltraHonk verifier instruction discriminators */
const VERIFIER_INSTRUCTION = {
  VERIFY: 0,
  VERIFY_WITH_VK_ACCOUNT: 1,
  INIT_VK: 2,
  VERIFY_FROM_BUFFER: 3,
} as const;

/**
 * Build VERIFY_FROM_BUFFER instruction for UltraHonk verifier
 *
 * This instruction must be called BEFORE the zVault instruction in the same TX.
 * The zVault instruction uses instruction introspection to verify this was called.
 *
 * Format: [discriminator(1)] [pi_count(4)] [public_inputs(N*32)] [vk_hash(32)]
 */
export function buildVerifyFromBufferInstruction(options: {
  bufferAddress: Address;
  publicInputs: Uint8Array[];
  vkHash: Uint8Array;
}): Instruction {
  const config = getConfig();

  const { bufferAddress, publicInputs, vkHash } = options;
  const piCount = publicInputs.length;
  const totalSize = 1 + 4 + piCount * 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = VERIFIER_INSTRUCTION.VERIFY_FROM_BUFFER;

  // Public inputs count (little-endian)
  view.setUint32(offset, piCount, true);
  offset += 4;

  // Public inputs
  for (const pi of publicInputs) {
    if (pi.length !== 32) {
      throw new Error(`Public input must be 32 bytes, got ${pi.length}`);
    }
    data.set(pi, offset);
    offset += 32;
  }

  // VK hash
  data.set(vkHash, offset);

  return {
    programAddress: config.ultrahonkVerifierProgramId,
    accounts: [{ address: bufferAddress, role: AccountRole.READONLY }],
    data,
  };
}

/**
 * Build public inputs array for spend_partial_public verifier call
 *
 * Order must match circuit: [root, nullifier_hash, public_amount, change_commitment,
 *                           recipient, ephemeral_pub_x, encrypted_amount_with_sign]
 *
 * IMPORTANT: Recipient must be reduced modulo BN254_FIELD_PRIME to match what the prover uses.
 * The Noir circuit represents public keys as field elements, which are always < BN254_FIELD_PRIME.
 */
export function buildPartialPublicVerifierInputs(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  publicAmountSats: bigint;
  changeCommitment: Uint8Array;
  recipient: Address;
  changeEphemeralPubX: Uint8Array;
  changeEncryptedAmountWithSign: Uint8Array;
}): Uint8Array[] {
  // Reduce recipient modulo BN254_FIELD_PRIME to match circuit's field element representation
  // This is critical: the prover reduces the recipient the same way in api.ts
  const recipientRaw = addressToBytes(options.recipient);
  const recipientReduced = bytesToBigint(recipientRaw) % BN254_FIELD_PRIME;
  const recipientBytes = bigintToBytes(recipientReduced);

  // Encode amount as 32-byte field element (big-endian)
  const amountBytes = new Uint8Array(32);
  const amountHex = options.publicAmountSats.toString(16).padStart(16, "0");
  for (let i = 0; i < 8; i++) {
    amountBytes[24 + i] = parseInt(amountHex.slice(i * 2, i * 2 + 2), 16);
  }

  return [
    options.root,
    options.nullifierHash,
    amountBytes,
    options.changeCommitment,
    recipientBytes,
    options.changeEphemeralPubX,
    options.changeEncryptedAmountWithSign,
  ];
}

/**
 * Build public inputs array for spend_split verifier call
 *
 * Order must match circuit: [root, nullifier_hash, out1, out2, eph1_x, enc1, eph2_x, enc2]
 */
export function buildSplitVerifierInputs(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  output1EphemeralPubX: Uint8Array;
  output1EncryptedAmountWithSign: Uint8Array;
  output2EphemeralPubX: Uint8Array;
  output2EncryptedAmountWithSign: Uint8Array;
}): Uint8Array[] {
  return [
    options.root,
    options.nullifierHash,
    options.outputCommitment1,
    options.outputCommitment2,
    options.output1EphemeralPubX,
    options.output1EncryptedAmountWithSign,
    options.output2EphemeralPubX,
    options.output2EncryptedAmountWithSign,
  ];
}

// =============================================================================
// Redemption Request Instruction Builder
// =============================================================================

/**
 * Build instruction data for REQUEST_REDEMPTION
 *
 * Burns zBTC and creates a RedemptionRequest PDA that the
 * backend redemption processor will pick up.
 *
 * Layout:
 * - discriminator (1 byte) = 5
 * - amount_sats (8 bytes, LE)
 * - btc_address_len (1 byte)
 * - btc_address (variable, max 62 bytes)
 *
 * @param amountSats - Amount to redeem in satoshis
 * @param btcAddress - Bitcoin address for withdrawal (max 62 bytes)
 */
export function buildRedemptionRequestInstructionData(
  amountSats: bigint,
  btcAddress: string
): Uint8Array {
  const btcAddrBytes = new TextEncoder().encode(btcAddress);
  if (btcAddrBytes.length > 62) {
    throw new Error("BTC address too long (max 62 bytes)");
  }

  // Layout: discriminator(1) + amount(8) + addr_len(1) + addr
  const totalLen = 1 + 8 + 1 + btcAddrBytes.length;
  const data = new Uint8Array(totalLen);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION.REQUEST_REDEMPTION;

  view.setBigUint64(offset, amountSats, true);
  offset += 8;

  data[offset++] = btcAddrBytes.length;
  data.set(btcAddrBytes, offset);

  return data;
}

/** Redemption request instruction options */
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

/**
 * Build a complete redemption request instruction
 */
export function buildRedemptionRequestInstruction(
  options: RedemptionRequestInstructionOptions
): Instruction {
  const config = getConfig();

  const data = buildRedemptionRequestInstructionData(
    options.amountSats,
    options.btcAddress
  );

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.userTokenAccount, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Bigint to 32-byte Uint8Array (big-endian)
 */
export function bigintTo32Bytes(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * 32-byte Uint8Array to bigint (big-endian)
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new Error("Expected 32 bytes");
  }
  let hex = "0x";
  for (let i = 0; i < 32; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

/**
 * Check if a proof is too large for inline mode (needs buffer)
 *
 * UltraHonk proofs are typically 8-16KB, but Solana transactions
 * are limited to ~1232 bytes. The caller should calculate available
 * space based on their specific transaction structure.
 *
 * @param proofBytes - Proof data
 * @param availableSpace - Max bytes available for proof in transaction
 */
export function needsBuffer(proofBytes: Uint8Array, availableSpace: number = 900): boolean {
  return proofBytes.length > availableSpace;
}

/**
 * Calculate available space for inline proof given transaction overhead
 *
 * Solana TX limit is 1232 bytes. Overhead includes:
 * - Signatures: 64 bytes each
 * - Message header: ~3 bytes
 * - Accounts: ~32 bytes each
 * - Instruction data header: ~4 bytes
 * - Fixed instruction data (discriminator, proof_source, hashes, etc.)
 */
export function calculateAvailableProofSpace(options: {
  numSigners?: number;
  numAccounts?: number;
  fixedDataSize?: number;
}): number {
  const TX_LIMIT = 1232;
  const { numSigners = 1, numAccounts = 10, fixedDataSize = 150 } = options;

  // Approximate overhead
  const signaturesSize = numSigners * 64;
  const messageHeader = 3;
  const accountsSize = numAccounts * 32;
  const instructionHeader = 4;

  const overhead = signaturesSize + messageHeader + accountsSize + instructionHeader + fixedDataSize;
  return Math.max(0, TX_LIMIT - overhead);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
