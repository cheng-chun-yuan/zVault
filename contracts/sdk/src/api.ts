/**
 * ZVault Simplified API
 *
 * 6 main user-facing functions:
 * - deposit: Generate deposit credentials (taproot address + claim link)
 * - withdraw: Request BTC withdrawal (burn sbBTC)
 * - privateClaim: Claim sbBTC tokens with ZK proof
 * - privateSplit: Split one commitment into two outputs
 * - sendLink: Create global claim link (anyone with URL can claim)
 * - sendStealth: Send to specific recipient via stealth ECDH
 *
 * @module api
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { generateNote, type Note, formatBtc } from "./note";
import { deriveTaprootAddress } from "./taproot";
import { createClaimLink, parseClaimLink } from "./claim-link";
import {
  generateClaimProof,
  generateSplitProof,
  generatePartialWithdrawProof,
  type NoirProof,
} from "./proof";
import {
  createStealthDeposit,
  createStealthDepositForSolana,
  type StealthDeposit,
} from "./stealth";
import { createMerkleProof, type MerkleProof, TREE_DEPTH, ZERO_VALUE } from "./merkle";
import { bigintToBytes } from "./crypto";
import { prepareVerifyDeposit } from "./chadbuffer";

// ============================================================================
// Types
// ============================================================================

/**
 * Result from deposit() - credentials needed to receive BTC
 */
export interface DepositResult {
  /** Note containing secrets (save this!) */
  note: Note;
  /** Bitcoin address to send BTC to */
  taprootAddress: string;
  /** Shareable claim link (contains secrets) */
  claimLink: string;
  /** Human-readable amount */
  displayAmount: string;
}

/**
 * Result from withdraw()
 */
export interface WithdrawResult {
  /** Transaction signature */
  signature: string;
  /** Amount being withdrawn in satoshis */
  withdrawAmount: bigint;
  /** Change note (if partial withdraw) */
  changeNote?: Note;
  /** Change claim link (if partial withdraw) */
  changeClaimLink?: string;
}

/**
 * Result from privateClaim()
 */
export interface ClaimResult {
  /** Transaction signature */
  signature: string;
  /** Amount claimed in satoshis */
  amount: bigint;
  /** Recipient address */
  recipient: PublicKey;
}

/**
 * Result from privateSplit()
 */
export interface SplitResult {
  /** Transaction signature */
  signature: string;
  /** First output note */
  output1: Note;
  /** Second output note */
  output2: Note;
  /** Nullifier hash of spent input */
  inputNullifierHash: Uint8Array;
}

/**
 * Result from sendStealth()
 */
export interface StealthResult {
  /** Transaction signature */
  signature: string;
  /** Ephemeral public key (for recipient to scan) */
  ephemeralPubKey: Uint8Array;
  /** Leaf index in commitment tree */
  leafIndex: number;
}

/**
 * Client configuration
 */
export interface ApiClientConfig {
  connection: Connection;
  programId: PublicKey;
  payer?: Keypair;
}

// ============================================================================
// Constants
// ============================================================================

/** Default program ID (Solana Devnet) */
export const DEFAULT_PROGRAM_ID = new PublicKey(
  "AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf"
);

/** Instruction discriminators */
const INSTRUCTION = {
  SPLIT_COMMITMENT: 4,
  REQUEST_REDEMPTION: 5,
  VERIFY_DEPOSIT: 8,
  CLAIM: 9,
  ANNOUNCE_STEALTH: 12,
} as const;

// ============================================================================
// PDA Derivation Helpers
// ============================================================================

function derivePoolStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool_state")], programId);
}

function deriveCommitmentTreePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], programId);
}

function deriveNullifierRecordPDA(
  programId: PublicKey,
  nullifierHash: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    programId
  );
}

function deriveStealthAnnouncementPDA(
  programId: PublicKey,
  commitment: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stealth"), commitment],
    programId
  );
}

// ============================================================================
// 1. DEPOSIT
// ============================================================================

/**
 * Generate deposit credentials
 *
 * Creates a new note with random secrets, derives a taproot address for
 * receiving BTC, and creates a claim link for later claiming.
 *
 * **Flow:**
 * 1. Generate random nullifier + secret
 * 2. Derive taproot address from commitment
 * 3. Create claim link with encoded secrets
 * 4. User sends BTC to taproot address externally
 * 5. Later: call verifyDeposit to add commitment to on-chain tree
 *
 * @param amountSats - Amount in satoshis
 * @param network - Bitcoin network (mainnet/testnet)
 * @param baseUrl - Base URL for claim link
 * @returns Deposit credentials
 *
 * @example
 * ```typescript
 * const result = await deposit(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', result.taprootAddress);
 * console.log('Save this link:', result.claimLink);
 * ```
 */
export async function deposit(
  amountSats: bigint,
  network: "mainnet" | "testnet" = "testnet",
  baseUrl?: string
): Promise<DepositResult> {
  // Generate note with random secrets
  const note = generateNote(amountSats);

  // For taproot derivation, use XOR of nullifier/secret as placeholder commitment
  // In production, compute actual Poseidon2 hash via helper circuit
  const placeholderCommitment = bigintToBytes(
    (note.nullifier ^ note.secret) % (2n ** 256n)
  );

  // Derive taproot address
  const { address: taprootAddress } = await deriveTaprootAddress(
    placeholderCommitment,
    network
  );

  // Create claim link
  const claimLink = createClaimLink(note, baseUrl);

  return {
    note,
    taprootAddress,
    claimLink,
    displayAmount: formatBtc(amountSats),
  };
}

// ============================================================================
// 2. WITHDRAW
// ============================================================================

/**
 * Request BTC withdrawal (burn sbBTC)
 *
 * Generates a partial_withdraw ZK proof and submits REQUEST_REDEMPTION instruction.
 * Burns sbBTC tokens and creates a redemption request for the relayer to fulfill.
 *
 * **Flow:**
 * 1. Generate partial_withdraw proof
 * 2. Call REQUEST_REDEMPTION instruction
 * 3. Program verifies proof, burns sbBTC, creates RedemptionRequest PDA
 * 4. If partial: adds change commitment to tree
 * 5. Relayer monitors and sends BTC (external)
 *
 * @param config - Client configuration
 * @param note - Note to withdraw from
 * @param btcAddress - Bitcoin address to receive withdrawal
 * @param withdrawAmount - Amount to withdraw (defaults to full amount)
 * @param merkleProof - Merkle proof for the commitment
 * @returns Withdrawal result
 *
 * @example
 * ```typescript
 * // Full withdrawal
 * const result = await withdraw(config, myNote, 'bc1q...');
 *
 * // Partial withdrawal (50%)
 * const result = await withdraw(config, myNote, 'bc1q...', myNote.amount / 2n);
 * ```
 */
export async function withdraw(
  config: ApiClientConfig,
  note: Note,
  btcAddress: string,
  withdrawAmount?: bigint,
  merkleProof?: MerkleProof
): Promise<WithdrawResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for withdraw");
  }

  const actualWithdrawAmount = withdrawAmount ?? note.amount;
  const isPartialWithdraw = actualWithdrawAmount < note.amount;

  // Hash BTC address for recipient field
  const encoder = new TextEncoder();
  const recipientBytes = new Uint8Array(32);
  const btcAddressBytes = encoder.encode(btcAddress);
  recipientBytes.set(btcAddressBytes.slice(0, Math.min(32, btcAddressBytes.length)));

  let changeNote: Note | undefined;
  let proof: NoirProof;

  if (isPartialWithdraw) {
    // Generate change note for remaining amount
    const changeAmount = note.amount - actualWithdrawAmount;
    changeNote = generateNote(changeAmount);

    // Generate partial withdraw proof
    const mp = merkleProof ?? createEmptyMerkleProofForNote();
    proof = await generatePartialWithdrawProof(
      note,
      actualWithdrawAmount,
      changeNote,
      mp,
      recipientBytes
    );
  } else {
    // Full withdrawal - use partial_withdraw with zero change
    changeNote = generateNote(0n);
    const mp = merkleProof ?? createEmptyMerkleProofForNote();
    proof = await generatePartialWithdrawProof(
      note,
      actualWithdrawAmount,
      changeNote,
      mp,
      recipientBytes
    );
    changeNote = undefined; // No change for full withdrawal
  }

  // Build instruction data
  const data = buildRequestRedemptionData(
    proof,
    actualWithdrawAmount,
    recipientBytes,
    changeNote?.commitmentBytes
  );

  // Derive PDAs
  const [poolState] = derivePoolStatePDA(config.programId);
  const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = deriveNullifierRecordPDA(
    config.programId,
    note.nullifierHashBytes
  );

  // Build transaction
  const ix = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierRecord, isSigner: false, isWritable: true },
      { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  const signature = await config.connection.sendTransaction(tx, [config.payer]);
  await config.connection.confirmTransaction(signature);

  return {
    signature,
    withdrawAmount: actualWithdrawAmount,
    changeNote,
    changeClaimLink: changeNote ? createClaimLink(changeNote) : undefined,
  };
}

// ============================================================================
// 3. PRIVATE_CLAIM
// ============================================================================

/**
 * Claim sbBTC tokens with ZK proof
 *
 * Parses claim link (or uses provided note), generates a claim proof,
 * and mints sbBTC tokens to the user's wallet.
 *
 * **Flow:**
 * 1. Parse claim link to recover note (if link provided)
 * 2. Get merkle proof for commitment
 * 3. Generate claim ZK proof
 * 4. Call CLAIM instruction
 * 5. Program verifies proof, mints sbBTC
 *
 * @param config - Client configuration
 * @param claimLinkOrNote - Claim link URL or Note object
 * @param merkleProof - Merkle proof for the commitment
 * @returns Claim result
 *
 * @example
 * ```typescript
 * // Claim from link
 * const result = await privateClaim(config, 'https://sbbtc.app/claim?note=...');
 *
 * // Claim from note
 * const result = await privateClaim(config, myNote);
 * ```
 */
export async function privateClaim(
  config: ApiClientConfig,
  claimLinkOrNote: string | Note,
  merkleProof?: MerkleProof
): Promise<ClaimResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for claim");
  }

  // Parse note from link or use directly
  let note: Note;
  if (typeof claimLinkOrNote === "string") {
    const parsed = parseClaimLink(claimLinkOrNote);
    if (!parsed) {
      throw new Error("Invalid claim link");
    }
    note = parsed;
  } else {
    note = claimLinkOrNote;
  }

  // Use provided merkle proof or create empty one
  const mp = merkleProof ?? createEmptyMerkleProofForNote();

  // Generate ZK proof
  const proof = await generateClaimProof(note, mp);

  // Build instruction data
  const data = buildClaimData(proof, note.amount);

  // Derive PDAs
  const [poolState] = derivePoolStatePDA(config.programId);
  const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = deriveNullifierRecordPDA(
    config.programId,
    note.nullifierHashBytes
  );

  // Build transaction
  const ix = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: false },
      { pubkey: nullifierRecord, isSigner: false, isWritable: true },
      { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  const signature = await config.connection.sendTransaction(tx, [config.payer]);
  await config.connection.confirmTransaction(signature);

  return {
    signature,
    amount: note.amount,
    recipient: config.payer.publicKey,
  };
}

// ============================================================================
// 4. PRIVATE_SPLIT
// ============================================================================

/**
 * Split one commitment into two outputs
 *
 * Generates a split proof and adds two new commitments to the tree
 * while spending the input commitment.
 *
 * **Flow:**
 * 1. Generate two output notes
 * 2. Generate split ZK proof
 * 3. Call SPLIT_COMMITMENT instruction
 * 4. Program verifies proof, nullifies input, adds outputs
 *
 * @param config - Client configuration
 * @param inputNote - Note to split
 * @param amount1 - Amount for first output
 * @param merkleProof - Merkle proof for input commitment
 * @returns Split result with two output notes
 *
 * @example
 * ```typescript
 * // Split 1 BTC into 0.3 + 0.7
 * const { output1, output2 } = await privateSplit(config, myNote, 30_000_000n);
 *
 * // Send 0.3 to Alice via stealth
 * await sendStealth(config, output1, alicePubKey);
 *
 * // Keep 0.7 as claim link
 * const myLink = sendLink(output2);
 * ```
 */
export async function privateSplit(
  config: ApiClientConfig,
  inputNote: Note,
  amount1: bigint,
  merkleProof?: MerkleProof
): Promise<SplitResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for split");
  }

  const amount2 = inputNote.amount - amount1;

  if (amount1 <= 0n || amount2 <= 0n) {
    throw new Error("Both output amounts must be positive");
  }

  // Generate output notes
  const output1 = generateNote(amount1);
  const output2 = generateNote(amount2);

  // Use provided merkle proof or create empty one
  const mp = merkleProof ?? createEmptyMerkleProofForNote();

  // Generate split proof
  const proof = await generateSplitProof(inputNote, output1, output2, mp);

  // Build instruction data
  const data = buildSplitData(proof, output1.commitmentBytes, output2.commitmentBytes);

  // Derive PDAs
  const [poolState] = derivePoolStatePDA(config.programId);
  const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = deriveNullifierRecordPDA(
    config.programId,
    inputNote.nullifierHashBytes
  );

  // Build transaction
  const ix = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierRecord, isSigner: false, isWritable: true },
      { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  const signature = await config.connection.sendTransaction(tx, [config.payer]);
  await config.connection.confirmTransaction(signature);

  return {
    signature,
    output1,
    output2,
    inputNullifierHash: inputNote.nullifierHashBytes,
  };
}

// ============================================================================
// 5. SEND_LINK (Claim Link Mode)
// ============================================================================

/**
 * Create a global claim link
 *
 * Encodes a note into a shareable URL. Anyone with the link can claim.
 * This is purely client-side - no on-chain transaction.
 *
 * **Use case:** Share funds directly via messaging, email, QR code.
 *
 * @param note - Note to create link for
 * @param baseUrl - Base URL for the link
 * @returns Claim link URL
 *
 * @example
 * ```typescript
 * const link = sendLink(myNote);
 * // => "https://sbbtc.app/claim?note=eyJhbW91bnQ..."
 *
 * // Share link with recipient
 * // Recipient calls: await privateClaim(config, link);
 * ```
 */
export function sendLink(note: Note, baseUrl?: string): string {
  return createClaimLink(note, baseUrl);
}

// ============================================================================
// 6. SEND_STEALTH (ECDH Mode)
// ============================================================================

/**
 * Send to specific recipient via stealth address (ECDH)
 *
 * Creates an on-chain stealth announcement that only the recipient
 * can discover by scanning with their view key.
 *
 * **Flow:**
 * 1. ECDH key exchange: ephemeral keypair + recipient pubkey
 * 2. Derive note secrets from shared secret
 * 3. Create on-chain StealthAnnouncement
 * 4. Recipient scans announcements with view key
 * 5. Recipient claims with recovered note
 *
 * @param config - Client configuration
 * @param note - Note to send (commitment should already be in tree)
 * @param recipientPubKey - Recipient's X25519 public key (32 bytes)
 * @param leafIndex - Leaf index in commitment tree
 * @returns Stealth result
 *
 * @example
 * ```typescript
 * // Send to Alice's stealth address
 * const result = await sendStealth(config, myNote, aliceX25519PubKey);
 *
 * // Alice scans and claims
 * const found = scanAnnouncements(aliceViewKey, alicePubKey, announcements);
 * const recovered = createNoteFromSecrets(found[0].nullifier, found[0].secret, found[0].amount);
 * await privateClaim(config, recovered);
 * ```
 */
export async function sendStealth(
  config: ApiClientConfig,
  note: Note,
  recipientPubKey: Uint8Array,
  leafIndex: number = 0
): Promise<StealthResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for stealth send");
  }

  // Create stealth deposit data
  const stealthDeposit = createStealthDeposit(recipientPubKey, note.amount);

  // Build instruction data (84 bytes)
  // ephemeral_pubkey (32) + commitment (32) + recipient_hint (4) + encrypted_amount (8) + leaf_index (8)
  const data = new Uint8Array(1 + 84);
  data[0] = INSTRUCTION.ANNOUNCE_STEALTH;
  data.set(stealthDeposit.ephemeralPubKey, 1);
  data.set(note.commitmentBytes, 33);
  data.set(stealthDeposit.recipientHint, 65);
  data.set(stealthDeposit.encryptedAmount, 69);
  const leafIndexView = new DataView(data.buffer, 77, 8);
  leafIndexView.setBigUint64(0, BigInt(leafIndex), true);

  // Derive stealth announcement PDA
  const [stealthAnnouncement] = deriveStealthAnnouncementPDA(
    config.programId,
    note.commitmentBytes
  );

  // Build transaction
  const ix = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  const signature = await config.connection.sendTransaction(tx, [config.payer]);
  await config.connection.confirmTransaction(signature);

  return {
    signature,
    ephemeralPubKey: stealthDeposit.ephemeralPubKey,
    leafIndex,
  };
}

/**
 * Send to Solana recipient via stealth address
 *
 * Convenience function that converts a Solana Ed25519 public key
 * to X25519 before creating the stealth announcement.
 */
export async function sendStealthToSolana(
  config: ApiClientConfig,
  note: Note,
  recipientSolanaPubKey: Uint8Array,
  leafIndex: number = 0
): Promise<StealthResult> {
  const stealthDeposit = createStealthDepositForSolana(
    recipientSolanaPubKey,
    note.amount
  );

  // Re-use sendStealth logic with converted key
  // The stealth deposit already uses the converted key internally
  if (!config.payer) {
    throw new Error("Payer keypair required for stealth send");
  }

  const data = new Uint8Array(1 + 84);
  data[0] = INSTRUCTION.ANNOUNCE_STEALTH;
  data.set(stealthDeposit.ephemeralPubKey, 1);
  data.set(note.commitmentBytes, 33);
  data.set(stealthDeposit.recipientHint, 65);
  data.set(stealthDeposit.encryptedAmount, 69);
  const leafIndexView = new DataView(data.buffer, 77, 8);
  leafIndexView.setBigUint64(0, BigInt(leafIndex), true);

  const [stealthAnnouncement] = deriveStealthAnnouncementPDA(
    config.programId,
    note.commitmentBytes
  );

  const ix = new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  const signature = await config.connection.sendTransaction(tx, [config.payer]);
  await config.connection.confirmTransaction(signature);

  return {
    signature,
    ephemeralPubKey: stealthDeposit.ephemeralPubKey,
    leafIndex,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create empty merkle proof (for testing/demo)
 */
function createEmptyMerkleProofForNote(): MerkleProof {
  return {
    pathElements: Array(TREE_DEPTH)
      .fill(null)
      .map(() => new Uint8Array(ZERO_VALUE)),
    pathIndices: Array(TREE_DEPTH).fill(0),
    leafIndex: 0,
    root: new Uint8Array(ZERO_VALUE),
  };
}

/**
 * Build claim instruction data
 */
function buildClaimData(proof: NoirProof, amount: bigint): Uint8Array {
  // Format: discriminator (1) + proof_len (4) + proof + amount (8)
  const proofBytes = proof.proof;
  const data = new Uint8Array(1 + 4 + proofBytes.length + 8);
  const view = new DataView(data.buffer);

  data[0] = INSTRUCTION.CLAIM;
  view.setUint32(1, proofBytes.length, true);
  data.set(proofBytes, 5);
  view.setBigUint64(5 + proofBytes.length, amount, true);

  return data;
}

/**
 * Build split instruction data
 */
function buildSplitData(
  proof: NoirProof,
  outputCommitment1: Uint8Array,
  outputCommitment2: Uint8Array
): Uint8Array {
  // Format: discriminator (1) + proof_len (4) + proof + output1 (32) + output2 (32)
  const proofBytes = proof.proof;
  const data = new Uint8Array(1 + 4 + proofBytes.length + 64);
  const view = new DataView(data.buffer);

  data[0] = INSTRUCTION.SPLIT_COMMITMENT;
  view.setUint32(1, proofBytes.length, true);
  data.set(proofBytes, 5);
  data.set(outputCommitment1, 5 + proofBytes.length);
  data.set(outputCommitment2, 5 + proofBytes.length + 32);

  return data;
}

/**
 * Build request redemption instruction data
 */
function buildRequestRedemptionData(
  proof: NoirProof,
  withdrawAmount: bigint,
  recipient: Uint8Array,
  changeCommitment?: Uint8Array
): Uint8Array {
  const proofBytes = proof.proof;
  const hasChange = changeCommitment !== undefined;

  // Format: discriminator (1) + proof_len (4) + proof + amount (8) + recipient (32) + has_change (1) + [change_commitment (32)]
  const dataLen = 1 + 4 + proofBytes.length + 8 + 32 + 1 + (hasChange ? 32 : 0);
  const data = new Uint8Array(dataLen);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION.REQUEST_REDEMPTION;
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;
  view.setBigUint64(offset, withdrawAmount, true);
  offset += 8;
  data.set(recipient, offset);
  offset += 32;
  data[offset++] = hasChange ? 1 : 0;
  if (hasChange && changeCommitment) {
    data.set(changeCommitment, offset);
  }

  return data;
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { generateNote, createNoteFromSecrets, deriveNote, deriveNotes, estimateSeedStrength } from "./note";
export { parseClaimLink } from "./claim-link";
export {
  scanAnnouncements,
  scanAnnouncementsWithSolana,
  generateStealthKeys,
  solanaKeyToX25519,
  solanaPubKeyToX25519,
} from "./stealth";
export type { Note } from "./note";
export type { MerkleProof } from "./merkle";
export type { StealthKeys, StealthDeposit } from "./stealth";
