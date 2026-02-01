/**
 * ZVault Instruction Builders
 *
 * Low-level instruction building for ZVault operations.
 * Supports both inline proofs and ChadBuffer references.
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

/** System program address */
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

// =============================================================================
// Types
// =============================================================================

/** Instruction type for v2 */
export interface Instruction {
  programAddress: Address;
  accounts: Array<{ address: Address; role: (typeof AccountRole)[keyof typeof AccountRole] }>;
  data: Uint8Array;
}

/** Proof source indicator */
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
  /** First output commitment */
  outputCommitment1: Uint8Array;
  /** Second output commitment */
  outputCommitment2: Uint8Array;
  /** VK hash */
  vkHash: Uint8Array;
  /** Grumpkin ephemeral pubkey for first output stealth announcement (33 bytes compressed) */
  ephemeralPub1: Uint8Array;
  /** XOR encrypted first output amount (8 bytes) */
  encryptedAmount1: Uint8Array;
  /** Grumpkin ephemeral pubkey for second output stealth announcement (33 bytes compressed) */
  ephemeralPub2: Uint8Array;
  /** XOR encrypted second output amount (8 bytes) */
  encryptedAmount2: Uint8Array;
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
  /** Public output amount in sats */
  publicAmountSats: bigint;
  /** Change commitment */
  changeCommitment: Uint8Array;
  /** Recipient address */
  recipient: Address;
  /** VK hash */
  vkHash: Uint8Array;
  /** Grumpkin ephemeral pubkey for change output stealth announcement (33 bytes compressed) */
  ephemeralPubChange: Uint8Array;
  /** XOR encrypted change amount (8 bytes) */
  encryptedAmountChange: Uint8Array;
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

/** Proof source byte values */
const PROOF_SOURCE = {
  INLINE: 0,
  BUFFER: 1,
} as const;

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
    data[offset++] = PROOF_SOURCE.INLINE;

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
    data[offset++] = PROOF_SOURCE.BUFFER;

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
 * Build split instruction data (UltraHonk - supports buffer mode)
 *
 * ## Inline Mode (proof_source=0)
 * - proof_source: u8 (0)
 * - proof_len: u32 (LE)
 * - proof: [u8; proof_len]
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - output_commitment_1: [u8; 32]
 * - output_commitment_2: [u8; 32]
 * - vk_hash: [u8; 32]
 * - ephemeral_pub_1: [u8; 33]
 * - encrypted_amount_1: [u8; 8]
 * - ephemeral_pub_2: [u8; 33]
 * - encrypted_amount_2: [u8; 8]
 *
 * ## Buffer Mode (proof_source=1)
 * - proof_source: u8 (1)
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - output_commitment_1: [u8; 32]
 * - output_commitment_2: [u8; 32]
 * - vk_hash: [u8; 32]
 * - ephemeral_pub_1: [u8; 33]
 * - encrypted_amount_1: [u8; 8]
 * - ephemeral_pub_2: [u8; 33]
 * - encrypted_amount_2: [u8; 8]
 */
export function buildSplitInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  vkHash: Uint8Array;
  ephemeralPub1: Uint8Array;
  encryptedAmount1: Uint8Array;
  ephemeralPub2: Uint8Array;
  encryptedAmount2: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, outputCommitment1, outputCommitment2, vkHash, ephemeralPub1, encryptedAmount1, ephemeralPub2, encryptedAmount2 } = options;

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline format: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) + ephemeral_pub_1(33) + encrypted_amount_1(8) + ephemeral_pub_2(33) + encrypted_amount_2(8)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 32 + 32 + 32 + 33 + 8 + 33 + 8;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION.SPEND_SPLIT;

    // Proof source (inline = 0)
    data[offset++] = PROOF_SOURCE.INLINE;

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

    // Output commitment 1 (32 bytes)
    data.set(outputCommitment1, offset);
    offset += 32;

    // Output commitment 2 (32 bytes)
    data.set(outputCommitment2, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);
    offset += 32;

    // Ephemeral pub 1 (33 bytes)
    data.set(ephemeralPub1, offset);
    offset += 33;

    // Encrypted amount 1 (8 bytes)
    data.set(encryptedAmount1, offset);
    offset += 8;

    // Ephemeral pub 2 (33 bytes)
    data.set(ephemeralPub2, offset);
    offset += 33;

    // Encrypted amount 2 (8 bytes)
    data.set(encryptedAmount2, offset);

    return data;
  } else {
    // Buffer format: discriminator(1) + proof_source(1) + root(32) + nullifier(32) + out1(32) + out2(32) + vk_hash(32) + ephemeral_pub_1(33) + encrypted_amount_1(8) + ephemeral_pub_2(33) + encrypted_amount_2(8)
    const totalSize = 1 + 1 + 32 + 32 + 32 + 32 + 32 + 33 + 8 + 33 + 8;
    const data = new Uint8Array(totalSize);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION.SPEND_SPLIT;

    // Proof source (buffer = 1)
    data[offset++] = PROOF_SOURCE.BUFFER;

    // Root (32 bytes)
    data.set(root, offset);
    offset += 32;

    // Nullifier hash (32 bytes)
    data.set(nullifierHash, offset);
    offset += 32;

    // Output commitment 1 (32 bytes)
    data.set(outputCommitment1, offset);
    offset += 32;

    // Output commitment 2 (32 bytes)
    data.set(outputCommitment2, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);
    offset += 32;

    // Ephemeral pub 1 (33 bytes)
    data.set(ephemeralPub1, offset);
    offset += 33;

    // Encrypted amount 1 (8 bytes)
    data.set(encryptedAmount1, offset);
    offset += 8;

    // Ephemeral pub 2 (33 bytes)
    data.set(ephemeralPub2, offset);
    offset += 33;

    // Encrypted amount 2 (8 bytes)
    data.set(encryptedAmount2, offset);

    return data;
  }
}

/**
 * Build a complete split instruction
 */
export function buildSplitInstruction(options: SplitInstructionOptions): Instruction {
  const config = getConfig();

  // Build instruction data
  const data = buildSplitInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    outputCommitment1: options.outputCommitment1,
    outputCommitment2: options.outputCommitment2,
    vkHash: options.vkHash,
    ephemeralPub1: options.ephemeralPub1,
    encryptedAmount1: options.encryptedAmount1,
    ephemeralPub2: options.ephemeralPub2,
    encryptedAmount2: options.encryptedAmount2,
  });

  // Build accounts list (updated to include stealth announcement accounts)
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    { address: config.ultrahonkVerifierProgramId, role: AccountRole.READONLY },
    { address: options.accounts.stealthAnnouncement1, role: AccountRole.WRITABLE },
    { address: options.accounts.stealthAnnouncement2, role: AccountRole.WRITABLE },
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
// SpendPartialPublic Instruction Builder
// =============================================================================

/**
 * Build spend_partial_public instruction data (UltraHonk proof)
 *
 * Allows spending a shielded note with partial public output (reveal some amount)
 * and keeping remainder in a new shielded commitment.
 *
 * Supports both inline and buffer modes:
 * - Inline (proof_source=0): proof included in instruction data
 * - Buffer (proof_source=1): proof read from ChadBuffer account
 *
 * Contract format (inline):
 *   discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) +
 *   public_amount(8) + change_commitment(32) + recipient(32) + vk_hash(32) +
 *   ephemeral_pub_change(33) + encrypted_amount_change(8)
 *
 * Contract format (buffer):
 *   discriminator(1) + proof_source(1) + root(32) + nullifier(32) +
 *   public_amount(8) + change_commitment(32) + recipient(32) + vk_hash(32) +
 *   ephemeral_pub_change(33) + encrypted_amount_change(8)
 */
export function buildSpendPartialPublicInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  publicAmountSats: bigint;
  changeCommitment: Uint8Array;
  recipient: Address;
  vkHash: Uint8Array;
  ephemeralPubChange: Uint8Array;
  encryptedAmountChange: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, publicAmountSats, changeCommitment, recipient, vkHash, ephemeralPubChange, encryptedAmountChange } = options;
  const recipientBytes = addressToBytes(recipient);

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline mode: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) +
    // public_amount(8) + change_commitment(32) + recipient(32) + vk_hash(32) + ephemeral_pub_change(33) + encrypted_amount_change(8)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32 + 32 + 33 + 8;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.SPEND_PARTIAL_PUBLIC;
    data[offset++] = PROOF_SOURCE.INLINE;
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;
    data.set(proofBytes, offset);
    offset += proofBytes.length;
    data.set(root, offset);
    offset += 32;
    data.set(nullifierHash, offset);
    offset += 32;
    view.setBigUint64(offset, publicAmountSats, true);
    offset += 8;
    data.set(changeCommitment, offset);
    offset += 32;
    data.set(recipientBytes, offset);
    offset += 32;
    data.set(vkHash, offset);
    offset += 32;
    data.set(ephemeralPubChange, offset);
    offset += 33;
    data.set(encryptedAmountChange, offset);

    return data;
  } else {
    // Buffer mode: discriminator(1) + proof_source(1) + root(32) + nullifier(32) +
    // public_amount(8) + change_commitment(32) + recipient(32) + vk_hash(32) + ephemeral_pub_change(33) + encrypted_amount_change(8)
    const totalSize = 1 + 1 + 32 + 32 + 8 + 32 + 32 + 32 + 33 + 8;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION.SPEND_PARTIAL_PUBLIC;
    data[offset++] = PROOF_SOURCE.BUFFER;
    data.set(root, offset);
    offset += 32;
    data.set(nullifierHash, offset);
    offset += 32;
    view.setBigUint64(offset, publicAmountSats, true);
    offset += 8;
    data.set(changeCommitment, offset);
    offset += 32;
    data.set(recipientBytes, offset);
    offset += 32;
    data.set(vkHash, offset);
    offset += 32;
    data.set(ephemeralPubChange, offset);
    offset += 33;
    data.set(encryptedAmountChange, offset);

    return data;
  }
}

/**
 * Build a complete spend_partial_public instruction
 */
export function buildSpendPartialPublicInstruction(options: SpendPartialPublicInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildSpendPartialPublicInstructionData({
    proofSource: options.proofSource,
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    publicAmountSats: options.publicAmountSats,
    changeCommitment: options.changeCommitment,
    recipient: options.recipient,
    vkHash: options.vkHash,
    ephemeralPubChange: options.ephemeralPubChange,
    encryptedAmountChange: options.encryptedAmountChange,
  });

  // Build accounts list (updated to include stealth announcement account for change)
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
    data[offset++] = PROOF_SOURCE.INLINE;
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
    data[offset++] = PROOF_SOURCE.BUFFER;
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
    data[offset++] = PROOF_SOURCE.INLINE;
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
    data[offset++] = PROOF_SOURCE.BUFFER;
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
    data[offset++] = PROOF_SOURCE.INLINE;
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
    data[offset++] = PROOF_SOURCE.BUFFER;
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
