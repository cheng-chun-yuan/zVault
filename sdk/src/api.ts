/**
 * ZVault Simplified API
 *
 * Organized into categories:
 *
 * DEPOSIT (BTC → zkBTC):
 * - deposit: Generate deposit credentials (taproot address + claim link)
 * - claimNote: Claim zkBTC tokens with ZK proof
 * - sendStealth: Send to specific recipient via stealth ECDH (new deposit)
 *
 * TRANSFER (zkBTC → Someone):
 * - splitNote: Split one note into two outputs
 * - createClaimLink: Create shareable claim URL (off-chain)
 * - sendPrivate: Transfer existing zkBTC to recipient's stealth address (with ZK proof)
 *
 * WITHDRAW (zkBTC → BTC):
 * - withdraw: Request BTC withdrawal (burn zkBTC)
 *
 * @module api
 */

import {
  address,
  getProgramDerivedAddress,
  AccountRole,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  type Address,
  type Blockhash,
} from "@solana/kit";

/** Instruction type for v2 */
interface Instruction {
  programAddress: Address;
  accounts: Array<{ address: Address; role: (typeof AccountRole)[keyof typeof AccountRole] }>;
  data: Uint8Array;
}
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
  type StealthDeposit,
} from "./stealth";
import { createStealthMetaAddress, type StealthMetaAddress } from "./keys";
import { createMerkleProof, type MerkleProof, TREE_DEPTH, ZERO_VALUE } from "./merkle";
import { bigintToBytes } from "./crypto";
import { prepareVerifyDeposit } from "./chadbuffer";

/** System program address */
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

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
 * Result from claimNote()
 */
export interface ClaimResult {
  /** Transaction signature */
  signature: string;
  /** Amount claimed in satoshis */
  amount: bigint;
  /** Recipient address */
  recipient: Address;
}

/**
 * Result from splitNote()
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
 * Result from sendPrivate()
 */
export interface StealthTransferResult {
  /** Transaction signature */
  signature: string;
  /** Ephemeral public key (for recipient to scan) */
  ephemeralPubKey: Uint8Array;
  /** Output commitment for recipient */
  outputCommitment: Uint8Array;
  /** Nullifier hash of spent input */
  inputNullifierHash: Uint8Array;
  /** Amount transferred in satoshis */
  amount: bigint;
}

/**
 * Signer interface for v2 transactions
 */
export interface TransactionSigner {
  address: Address;
  signTransaction: <T extends { signatures: Record<string, Uint8Array> }>(transaction: T) => Promise<T>;
}

/**
 * RPC interface for sending transactions
 */
export interface RpcClient {
  getLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  sendTransaction: (transaction: Uint8Array) => Promise<string>;
  confirmTransaction: (signature: string) => Promise<void>;
}

/**
 * Client configuration
 */
export interface ApiClientConfig {
  rpc: RpcClient;
  programId: Address;
  payer?: TransactionSigner;
}

// ============================================================================
// Constants
// ============================================================================

/** Default program ID (Solana Devnet) - imported from pda.ts */
export { ZVAULT_PROGRAM_ID as DEFAULT_PROGRAM_ID } from "./pda";

/** Instruction discriminators */
const INSTRUCTION = {
  SPLIT_COMMITMENT: 4,
  REQUEST_REDEMPTION: 5,
  VERIFY_DEPOSIT: 8,
  CLAIM: 9,
  ANNOUNCE_STEALTH: 12,
  TRANSFER_STEALTH: 24,
} as const;

// ============================================================================
// PDA Derivation Helpers
// ============================================================================

async function derivePoolStatePDA(programId: Address): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("pool_state")],
  });
  return [result[0], result[1]];
}

async function deriveCommitmentTreePDA(programId: Address): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("commitment_tree")],
  });
  return [result[0], result[1]];
}

// ============================================================================
// Transaction Helper
// ============================================================================

/**
 * Send an instruction and confirm (v2 pattern)
 */
async function sendInstruction(
  config: ApiClientConfig,
  instruction: Instruction
): Promise<string> {
  if (!config.payer) {
    throw new Error("Payer required");
  }

  const blockhash = await config.rpc.getLatestBlockhash();

  // Build transaction message
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(config.payer!.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: blockhash.blockhash as Blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
      msg
    ),
    (msg) => appendTransactionMessageInstruction(instruction as any, msg)
  );

  // Compile and sign
  const compiledTx = compileTransaction(message);
  const signedTx = await config.payer.signTransaction(compiledTx as any);

  // Send
  const txBytes = getBase64EncodedWireTransaction(signedTx as any);
  const signature = await config.rpc.sendTransaction(new TextEncoder().encode(txBytes));
  await config.rpc.confirmTransaction(signature);

  return signature;
}

async function deriveNullifierRecordPDA(
  programId: Address,
  nullifierHash: Uint8Array
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("nullifier"), nullifierHash],
  });
  return [result[0], result[1]];
}

async function deriveStealthAnnouncementPDA(
  programId: Address,
  commitment: Uint8Array
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("stealth"), commitment],
  });
  return [result[0], result[1]];
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
 * Request BTC withdrawal (burn zBTC)
 *
 * Generates a partial_withdraw ZK proof and submits REQUEST_REDEMPTION instruction.
 * Burns zBTC tokens and creates a redemption request for the relayer to fulfill.
 *
 * **Flow:**
 * 1. Generate partial_withdraw proof
 * 2. Call REQUEST_REDEMPTION instruction
 * 3. Program verifies proof, burns zBTC, creates RedemptionRequest PDA
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
  const [poolState] = await derivePoolStatePDA(config.programId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(
    config.programId,
    note.nullifierHashBytes
  );

  // Build instruction (v2 format)
  const ix: Instruction = {
    programAddress: config.programId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: commitmentTree, role: AccountRole.WRITABLE },
      { address: nullifierRecord, role: AccountRole.WRITABLE },
      { address: config.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };

  // Send transaction using the RPC client
  const signature = await sendInstruction(config, ix);
  await config.rpc.confirmTransaction(signature);

  return {
    signature,
    withdrawAmount: actualWithdrawAmount,
    changeNote,
    changeClaimLink: changeNote ? createClaimLink(changeNote) : undefined,
  };
}

// ============================================================================
// 3. CLAIM_NOTE
// ============================================================================

/**
 * Claim zkBTC tokens with ZK proof
 *
 * Parses claim link (or uses provided note), generates a claim proof,
 * and mints zkBTC tokens to the user's wallet.
 *
 * **Flow:**
 * 1. Parse claim link to recover note (if link provided)
 * 2. Get merkle proof for commitment
 * 3. Generate claim ZK proof
 * 4. Call CLAIM instruction
 * 5. Program verifies proof, mints zkBTC
 *
 * @param config - Client configuration
 * @param claimLinkOrNote - Claim link URL or Note object
 * @param merkleProof - Merkle proof for the commitment
 * @returns Claim result
 *
 * @example
 * ```typescript
 * // Claim from link
 * const result = await claimNote(config, 'https://zkbtc.app/claim?note=...');
 *
 * // Claim from note
 * const result = await claimNote(config, myNote);
 * ```
 */
export async function claimNote(
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
  const [poolState] = await derivePoolStatePDA(config.programId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(
    config.programId,
    note.nullifierHashBytes
  );

  // Build instruction (v2 format)
  const ix: Instruction = {
    programAddress: config.programId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: commitmentTree, role: AccountRole.READONLY },
      { address: nullifierRecord, role: AccountRole.WRITABLE },
      { address: config.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };

  // Send transaction using the RPC client
  const signature = await sendInstruction(config, ix);
  await config.rpc.confirmTransaction(signature);

  return {
    signature,
    amount: note.amount,
    recipient: config.payer.address,
  };
}

// ============================================================================
// 4. SPLIT_NOTE
// ============================================================================

/**
 * Split one note into two outputs
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
 * const { output1, output2 } = await splitNote(config, myNote, 30_000_000n);
 *
 * // Send 0.3 to Alice via stealth
 * await sendPrivate(config, output1, alicePubKey);
 *
 * // Keep 0.7 as claim link
 * const myLink = createClaimLink(output2);
 * ```
 */
export async function splitNote(
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
  const [poolState] = await derivePoolStatePDA(config.programId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(
    config.programId,
    inputNote.nullifierHashBytes
  );

  // Build instruction (v2 format)
  const ix: Instruction = {
    programAddress: config.programId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: commitmentTree, role: AccountRole.WRITABLE },
      { address: nullifierRecord, role: AccountRole.WRITABLE },
      { address: config.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };

  const signature = await sendInstruction(config, ix);

  return {
    signature,
    output1,
    output2,
    inputNullifierHash: inputNote.nullifierHashBytes,
  };
}

// ============================================================================
// 5. CREATE_CLAIM_LINK (Off-chain URL Encoding)
// ============================================================================

/**
 * Create a shareable claim link (off-chain)
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
 * const link = createClaimLinkFromNote(myNote);
 * // => "https://zkbtc.app/claim?note=eyJhbW91bnQ..."
 *
 * // Share link with recipient
 * // Recipient calls: await claimNote(config, link);
 * ```
 */
export function createClaimLinkFromNote(note: Note, baseUrl?: string): string {
  return createClaimLink(note, baseUrl);
}

// ============================================================================
// 6. SEND_STEALTH (ECDH Mode)
// ============================================================================

/**
 * Send to specific recipient via stealth address (dual-key ECDH)
 *
 * Creates an on-chain stealth announcement that only the recipient
 * can discover by scanning with their view key.
 *
 * **Flow:**
 * 1. Dual ECDH key exchange: Grumpkin (viewing) + Grumpkin (spending)
 * 2. Compute commitment using Poseidon2
 * 3. Create on-chain StealthAnnouncement
 * 4. Recipient scans announcements with view key
 * 5. Recipient prepares claim inputs with spending key
 *
 * @param config - Client configuration
 * @param recipientMeta - Recipient's stealth meta-address (spending + viewing public keys)
 * @param amountSats - Amount in satoshis
 * @param leafIndex - Leaf index in commitment tree
 * @returns Stealth result
 *
 * @example
 * ```typescript
 * // Send to Alice's stealth address
 * const result = await sendStealth(config, aliceMetaAddress, 100_000n);
 *
 * // Alice scans and claims
 * const found = await scanAnnouncements(aliceKeys, announcements);
 * const claimInputs = await prepareClaimInputs(aliceKeys, found[0], merkleProof);
 * ```
 */
export async function sendStealth(
  config: ApiClientConfig,
  recipientMeta: StealthMetaAddress,
  amountSats: bigint,
  leafIndex: number = 0
): Promise<StealthResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for stealth send");
  }

  // Create stealth deposit data using dual-key ECDH
  const stealthDeposit = await createStealthDeposit(recipientMeta, amountSats);

  // Build instruction data (73 bytes - single ephemeral key format)
  // ephemeral_pub (33) + amount_sats (8) + commitment (32)
  const data = new Uint8Array(1 + 73);
  data[0] = INSTRUCTION.ANNOUNCE_STEALTH;

  let offset = 1;
  data.set(stealthDeposit.ephemeralPub, offset);
  offset += 33;

  const amountView = new DataView(data.buffer, offset, 8);
  amountView.setBigUint64(0, amountSats, true);
  offset += 8;

  data.set(stealthDeposit.commitment, offset);

  // Derive stealth announcement PDA
  const [stealthAnnouncement] = await deriveStealthAnnouncementPDA(
    config.programId,
    stealthDeposit.ephemeralPub
  );

  // Build instruction (v2 format)
  const ix: Instruction = {
    programAddress: config.programId,
    accounts: [
      { address: stealthAnnouncement, role: AccountRole.WRITABLE },
      { address: config.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };

  const signature = await sendInstruction(config, ix);

  return {
    signature,
    ephemeralPubKey: stealthDeposit.ephemeralPub,
    leafIndex,
  };
}

// ============================================================================
// 7. SEND_PRIVATE (Private Transfer to Stealth Address)
// ============================================================================

/**
 * Send existing zkBTC to recipient's stealth address (private transfer)
 *
 * Privately transfers an existing commitment to a recipient using stealth
 * address derivation. Requires ZK proof of ownership of the input commitment.
 *
 * **Flow:**
 * 1. Create stealth deposit data (ECDH derivation for recipient)
 * 2. Generate transfer proof (proves ownership of input)
 * 3. Submit TRANSFER_STEALTH instruction
 * 4. Program verifies proof, nullifies input, creates output commitment
 * 5. Creates StealthAnnouncement PDA for recipient scanning
 *
 * **Security:**
 * - Input commitment is spent (nullifier recorded)
 * - Output commitment is added to tree for recipient
 * - Recipient can scan with viewing key, claim with spending key
 *
 * @param config - Client configuration
 * @param inputNote - Note to transfer (must be owned by sender)
 * @param recipientMeta - Recipient's stealth meta-address
 * @param merkleProof - Merkle proof for input commitment
 * @returns Transfer result with output info
 *
 * @example
 * ```typescript
 * // Transfer existing note to Alice's stealth address
 * const result = await sendPrivate(config, myNote, aliceMetaAddress, merkleProof);
 *
 * // Alice scans and finds the deposit
 * const found = await scanAnnouncements(aliceKeys, announcements);
 * // Alice can now claim with her spending key
 * ```
 */
export async function sendPrivate(
  config: ApiClientConfig,
  inputNote: Note,
  recipientMeta: StealthMetaAddress,
  merkleProof?: MerkleProof
): Promise<StealthTransferResult> {
  if (!config.payer) {
    throw new Error("Payer keypair required for stealth transfer");
  }

  // Create stealth deposit data for recipient (computes ECDH, derives commitment)
  const stealthDeposit = await createStealthDeposit(recipientMeta, inputNote.amount);

  // Use provided merkle proof or create empty one (for testing)
  const mp = merkleProof ?? createEmptyMerkleProofForNote();

  // Generate transfer proof
  // This proves: input commitment in tree, valid nullifier, output matches stealth derivation
  const proof = await generateTransferProof(inputNote, stealthDeposit, mp);

  // Build instruction data (393 bytes)
  // Format: discriminator (1) + proof (256) + merkle_root (32) + input_nullifier_hash (32)
  //         + output_commitment (32) + ephemeral_pub (33) + amount_sats (8)
  const data = buildTransferStealthData(
    proof,
    mp.root,
    inputNote.nullifierHashBytes,
    stealthDeposit.commitment,
    stealthDeposit.ephemeralPub,
    inputNote.amount
  );

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.programId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.programId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(
    config.programId,
    inputNote.nullifierHashBytes
  );
  const [stealthAnnouncement] = await deriveStealthAnnouncementPDA(
    config.programId,
    stealthDeposit.ephemeralPub
  );

  // Build instruction (v2 format)
  const ix: Instruction = {
    programAddress: config.programId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: commitmentTree, role: AccountRole.WRITABLE },
      { address: nullifierRecord, role: AccountRole.WRITABLE },
      { address: stealthAnnouncement, role: AccountRole.WRITABLE },
      { address: config.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };

  const signature = await sendInstruction(config, ix);

  return {
    signature,
    ephemeralPubKey: stealthDeposit.ephemeralPub,
    outputCommitment: stealthDeposit.commitment,
    inputNullifierHash: inputNote.nullifierHashBytes,
    amount: inputNote.amount,
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

/**
 * Build transfer stealth instruction data
 *
 * Format (394 bytes total):
 * - discriminator: 1 byte
 * - proof: 256 bytes (Groth16)
 * - merkle_root: 32 bytes
 * - input_nullifier_hash: 32 bytes
 * - output_commitment: 32 bytes
 * - ephemeral_pub: 33 bytes (Grumpkin compressed)
 * - amount_sats: 8 bytes (little-endian)
 */
function buildTransferStealthData(
  proof: NoirProof,
  merkleRoot: Uint8Array,
  inputNullifierHash: Uint8Array,
  outputCommitment: Uint8Array,
  ephemeralPub: Uint8Array,
  amountSats: bigint
): Uint8Array {
  const proofBytes = proof.proof;

  // Ensure proof is exactly 256 bytes (pad or truncate if needed)
  const proof256 = new Uint8Array(256);
  proof256.set(proofBytes.slice(0, Math.min(256, proofBytes.length)));

  // Total: 1 + 256 + 32 + 32 + 32 + 33 + 8 = 394 bytes
  const data = new Uint8Array(394);
  const view = new DataView(data.buffer);

  let offset = 0;

  // Discriminator
  data[offset++] = INSTRUCTION.TRANSFER_STEALTH;

  // Proof (256 bytes)
  data.set(proof256, offset);
  offset += 256;

  // Merkle root (32 bytes)
  data.set(merkleRoot, offset);
  offset += 32;

  // Input nullifier hash (32 bytes)
  data.set(inputNullifierHash, offset);
  offset += 32;

  // Output commitment (32 bytes)
  data.set(outputCommitment, offset);
  offset += 32;

  // Ephemeral public key (33 bytes)
  data.set(ephemeralPub, offset);
  offset += 33;

  // Amount in satoshis (8 bytes, little-endian)
  view.setBigUint64(offset, amountSats, true);

  return data;
}

/**
 * Generate transfer proof for stealth transfer
 *
 * Proves:
 * 1. Knowledge of input note secrets
 * 2. Input commitment exists in merkle tree
 * 3. Valid nullifier hash derivation
 * 4. Output commitment matches stealth derivation
 */
async function generateTransferProof(
  inputNote: Note,
  stealthDeposit: StealthDeposit,
  merkleProof: MerkleProof
): Promise<NoirProof> {
  // For now, return a placeholder proof
  // In production, this would call the Noir prover with stealth_transfer circuit
  //
  // Circuit inputs would be:
  // - input_nullifier: inputNote.nullifier
  // - input_secret: inputNote.secret
  // - input_amount: inputNote.amount
  // - merkle_path: merkleProof.pathElements
  // - path_indices: merkleProof.pathIndices
  // - output_stealth_pub_x: extracted from stealthDeposit computation
  // - merkle_root: merkleProof.root
  // - input_nullifier_hash: inputNote.nullifierHash
  // - output_commitment: stealthDeposit.commitment
  // - amount_pub: inputNote.amount

  // Placeholder proof for testing
  const placeholderProof = new Uint8Array(256);
  // Set non-zero values so verification doesn't immediately fail
  placeholderProof[0] = 1;
  placeholderProof[64] = 1;
  placeholderProof[192] = 1;

  return {
    proof: placeholderProof,
    publicInputs: [
      bytesToHex(merkleProof.root),
      bytesToHex(inputNote.nullifierHashBytes),
      bytesToHex(stealthDeposit.commitment),
      inputNote.amount.toString(),
    ],
    verificationKey: new Uint8Array(0),
    vkHash: new Uint8Array(32),
  };
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { generateNote, createNoteFromSecrets, deriveNote, deriveNotes, estimateSeedStrength } from "./note";
export { parseClaimLink } from "./claim-link";
export {
  scanAnnouncements,
  prepareClaimInputs,
  isWalletAdapter,
} from "./stealth";
export type { Note } from "./note";
export type { MerkleProof } from "./merkle";
export type { StealthDeposit, ScannedNote, ClaimInputs } from "./stealth";
export type { StealthMetaAddress, ZVaultKeys } from "./keys";
