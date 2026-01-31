/**
 * Proof Relay Module
 *
 * Handles relaying ZK proofs via ChadBuffer for large proof support.
 * Used by backend relayer service to submit transactions on behalf of users.
 *
 * Flow:
 * 1. User generates proof client-side
 * 2. User sends proof + params to backend
 * 3. Backend uses this module to:
 *    a. Create ChadBuffer account
 *    b. Upload proof in chunks
 *    c. Build and submit transaction (buffer mode)
 *    d. Close ChadBuffer and reclaim rent
 *
 * @module relay
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getConfig, TOKEN_2022_PROGRAM_ID, ATA_PROGRAM_ID } from "./config";

// =============================================================================
// ATA Helpers (avoid @solana/spl-token dependency)
// =============================================================================

const TOKEN_2022_PROGRAM = new PublicKey(TOKEN_2022_PROGRAM_ID);
const ATA_PROGRAM = new PublicKey(ATA_PROGRAM_ID);

function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  );
  return ata;
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]), // 0 = Create instruction
  });
}

// =============================================================================
// Constants
// =============================================================================

/** Get ChadBuffer program ID from current config */
function getChadBufferProgramId(): PublicKey {
  return new PublicKey(getConfig().chadbufferProgramId);
}

/** ChadBuffer program ID (legacy export for backwards compatibility) */
export const CHADBUFFER_PROGRAM_ID = new PublicKey("CHADufvk3AGLCVG1Pk76xUHZJZjEAj1YLNCgDA1P4YX9");

/** ChadBuffer authority offset (first 32 bytes) */
const CHADBUFFER_AUTHORITY_SIZE = 32;

/** Maximum chunk size for uploading
 * Overhead: signature (64) + msg header (3) + 2 account keys (66) + ix header (4) + disc (1) + u24 offset (3) = 141 bytes
 * Using 176 bytes for safety margin: 1232 - 176 = 1056 bytes max
 */
const MAX_CHUNK_SIZE = 1056;

/** ChadBuffer instruction discriminators (from ChadBuffer lib.rs) */
const CHADBUFFER_INIT = 0;    // Create/Init with initial data
const CHADBUFFER_ASSIGN = 1;  // Transfer authority
const CHADBUFFER_WRITE = 2;   // Write at offset
const CHADBUFFER_CLOSE = 3;   // Close buffer and reclaim lamports

/** zVault instruction discriminators */
const SPEND_PARTIAL_PUBLIC = 10;
const SPEND_SPLIT = 4;
const PROOF_SOURCE_BUFFER = 1;

// =============================================================================
// Types
// =============================================================================

/** Parameters for spend_partial_public relay */
export interface RelaySpendPartialPublicParams {
  /** UltraHonk proof bytes */
  proof: Uint8Array;
  /** Merkle root (32 bytes) */
  root: Uint8Array;
  /** Nullifier hash (32 bytes) */
  nullifierHash: Uint8Array;
  /** Public amount in sats */
  publicAmountSats: bigint;
  /** Change commitment (32 bytes) */
  changeCommitment: Uint8Array;
  /** Recipient Solana address */
  recipient: PublicKey;
  /** VK hash (32 bytes) */
  vkHash: Uint8Array;
}

/** Parameters for spend_split relay */
export interface RelaySpendSplitParams {
  /** UltraHonk proof bytes */
  proof: Uint8Array;
  /** Merkle root (32 bytes) */
  root: Uint8Array;
  /** Nullifier hash (32 bytes) */
  nullifierHash: Uint8Array;
  /** Output commitment 1 (32 bytes) */
  outputCommitment1: Uint8Array;
  /** Output commitment 2 (32 bytes) */
  outputCommitment2: Uint8Array;
  /** VK hash (32 bytes) */
  vkHash: Uint8Array;
}

/** Result of relay operation */
export interface RelayResult {
  /** Transaction signature */
  signature: string;
  /** ChadBuffer address used */
  bufferAddress: string;
  /** Whether buffer was closed and rent reclaimed */
  bufferClosed: boolean;
}

// =============================================================================
// PDA Derivation
// =============================================================================

function derivePoolStatePDA(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId)[0];
}

function deriveCommitmentTreePDA(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], programId)[0];
}

function deriveNullifierPDA(programId: PublicKey, nullifierHash: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    programId
  )[0];
}

function deriveZbtcMintPDA(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("zbtc_mint")], programId)[0];
}

// =============================================================================
// ChadBuffer Operations
// =============================================================================

/**
 * Create a ChadBuffer account for storing proof data
 */
export async function createChadBuffer(
  connection: Connection,
  payer: Keypair,
  proofSize: number
): Promise<{ keypair: Keypair; createTx: Transaction }> {
  const bufferKeypair = Keypair.generate();
  const bufferSize = CHADBUFFER_AUTHORITY_SIZE + proofSize;

  const rentExemption = await connection.getMinimumBalanceForRentExemption(bufferSize);
  const { blockhash } = await connection.getLatestBlockhash();

  const createIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: bufferKeypair.publicKey,
    lamports: rentExemption,
    space: bufferSize,
    programId: getChadBufferProgramId(),
  });

  const initIx = new TransactionInstruction({
    programId: getChadBufferProgramId(),
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([CHADBUFFER_INIT]),
  });

  const tx = new Transaction();
  tx.add(createIx, initIx);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;

  return { keypair: bufferKeypair, createTx: tx };
}

/**
 * Upload proof to ChadBuffer in chunks
 */
export async function uploadProofToBuffer(
  connection: Connection,
  payer: Keypair,
  bufferPubkey: PublicKey,
  proof: Uint8Array,
  onProgress?: (uploaded: number, total: number) => void
): Promise<string[]> {
  const signatures: string[] = [];
  let offset = 0;

  while (offset < proof.length) {
    const chunkSize = Math.min(MAX_CHUNK_SIZE, proof.length - offset);
    const chunk = proof.slice(offset, offset + chunkSize);

    // ChadBuffer Write instruction: discriminator(1) + u24_offset(3) + data
    const writeData = Buffer.alloc(1 + 3 + chunk.length);
    writeData[0] = CHADBUFFER_WRITE;
    // Write u24 offset (little-endian, 3 bytes)
    writeData[1] = offset & 0xff;
    writeData[2] = (offset >> 8) & 0xff;
    writeData[3] = (offset >> 16) & 0xff;
    Buffer.from(chunk).copy(writeData, 4);

    const writeIx = new TransactionInstruction({
      programId: getChadBufferProgramId(),
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: bufferPubkey, isSigner: false, isWritable: true },
      ],
      data: writeData,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.add(writeIx);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    signatures.push(sig);

    offset += chunkSize;
    onProgress?.(offset, proof.length);
  }

  return signatures;
}

/**
 * Close ChadBuffer and reclaim rent
 */
export async function closeChadBuffer(
  connection: Connection,
  payer: Keypair,
  bufferPubkey: PublicKey
): Promise<string> {
  const closeIx = new TransactionInstruction({
    programId: getChadBufferProgramId(),
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([CHADBUFFER_CLOSE]),
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(closeIx);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;

  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
}

// =============================================================================
// Relay Functions
// =============================================================================

/**
 * Relay a spend_partial_public transaction
 *
 * Full flow:
 * 1. Create ChadBuffer
 * 2. Upload proof in chunks
 * 3. Submit zVault transaction (buffer mode)
 * 4. Close buffer and reclaim rent
 */
export async function relaySpendPartialPublic(
  connection: Connection,
  relayer: Keypair,
  params: RelaySpendPartialPublicParams,
  onProgress?: (stage: string, progress?: number) => void
): Promise<RelayResult> {
  const config = getConfig();
  const zvaultProgram = new PublicKey(config.zvaultProgramId);
  const ultrahonkVerifier = new PublicKey(config.ultrahonkVerifierProgramId);

  onProgress?.("Creating buffer...");

  // 1. Create ChadBuffer
  const { keypair: bufferKeypair, createTx } = await createChadBuffer(
    connection,
    relayer,
    params.proof.length
  );

  await sendAndConfirmTransaction(connection, createTx, [relayer, bufferKeypair], {
    commitment: "confirmed",
  });

  onProgress?.("Uploading proof...", 0);

  // 2. Upload proof in chunks
  await uploadProofToBuffer(
    connection,
    relayer,
    bufferKeypair.publicKey,
    params.proof,
    (uploaded, total) => onProgress?.("Uploading proof...", (uploaded / total) * 100)
  );

  onProgress?.("Building transaction...");

  // 3. Build and submit zVault transaction
  const poolState = derivePoolStatePDA(zvaultProgram);
  const commitmentTree = deriveCommitmentTreePDA(zvaultProgram);
  const nullifierPDA = deriveNullifierPDA(zvaultProgram, params.nullifierHash);
  const zbtcMint = deriveZbtcMintPDA(zvaultProgram);
  const poolVault = getAssociatedTokenAddressSync(zbtcMint, poolState, true, TOKEN_2022_PROGRAM);
  const recipientAta = getAssociatedTokenAddressSync(
    zbtcMint,
    params.recipient,
    false,
    TOKEN_2022_PROGRAM
  );

  // Build instruction data (buffer mode)
  const ixData = Buffer.alloc(1 + 1 + 32 + 32 + 8 + 32 + 32 + 32);
  let offset = 0;
  ixData[offset++] = SPEND_PARTIAL_PUBLIC;
  ixData[offset++] = PROOF_SOURCE_BUFFER;
  Buffer.from(params.root).copy(ixData, offset); offset += 32;
  Buffer.from(params.nullifierHash).copy(ixData, offset); offset += 32;
  ixData.writeBigUInt64LE(params.publicAmountSats, offset); offset += 8;
  Buffer.from(params.changeCommitment).copy(ixData, offset); offset += 32;
  params.recipient.toBuffer().copy(ixData, offset); offset += 32;
  Buffer.from(params.vkHash).copy(ixData, offset);

  // Check if recipient ATA exists, create if needed
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  const instructions: TransactionInstruction[] = [];

  // Add compute budget for ZK verification
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  );

  if (!recipientAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        relayer.publicKey,
        recipientAta,
        params.recipient,
        zbtcMint,
        TOKEN_2022_PROGRAM
      )
    );
  }

  instructions.push(
    new TransactionInstruction({
      programId: zvaultProgram,
      keys: [
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: commitmentTree, isSigner: false, isWritable: true },
        { pubkey: nullifierPDA, isSigner: false, isWritable: true },
        { pubkey: zbtcMint, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ultrahonkVerifier, isSigner: false, isWritable: false },
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: false },
      ],
      data: ixData,
    })
  );

  onProgress?.("Submitting transaction...");

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = blockhash;

  const signature = await sendAndConfirmTransaction(connection, tx, [relayer], {
    commitment: "confirmed",
  });

  onProgress?.("Closing buffer...");

  // 4. Close buffer and reclaim rent
  let bufferClosed = false;
  try {
    await closeChadBuffer(connection, relayer, bufferKeypair.publicKey);
    bufferClosed = true;
  } catch (e) {
    console.warn("Failed to close buffer:", e);
  }

  onProgress?.("Done!");

  return {
    signature,
    bufferAddress: bufferKeypair.publicKey.toBase58(),
    bufferClosed,
  };
}

/**
 * Relay a spend_split transaction
 */
export async function relaySpendSplit(
  connection: Connection,
  relayer: Keypair,
  params: RelaySpendSplitParams,
  onProgress?: (stage: string, progress?: number) => void
): Promise<RelayResult> {
  const config = getConfig();
  const zvaultProgram = new PublicKey(config.zvaultProgramId);
  const ultrahonkVerifier = new PublicKey(config.ultrahonkVerifierProgramId);

  onProgress?.("Creating buffer...");

  // 1. Create ChadBuffer
  const { keypair: bufferKeypair, createTx } = await createChadBuffer(
    connection,
    relayer,
    params.proof.length
  );

  await sendAndConfirmTransaction(connection, createTx, [relayer, bufferKeypair], {
    commitment: "confirmed",
  });

  onProgress?.("Uploading proof...", 0);

  // 2. Upload proof in chunks
  await uploadProofToBuffer(
    connection,
    relayer,
    bufferKeypair.publicKey,
    params.proof,
    (uploaded, total) => onProgress?.("Uploading proof...", (uploaded / total) * 100)
  );

  onProgress?.("Building transaction...");

  // 3. Build and submit zVault transaction
  const poolState = derivePoolStatePDA(zvaultProgram);
  const commitmentTree = deriveCommitmentTreePDA(zvaultProgram);
  const nullifierPDA = deriveNullifierPDA(zvaultProgram, params.nullifierHash);

  // Build instruction data (buffer mode)
  const ixData = Buffer.alloc(1 + 1 + 32 + 32 + 32 + 32 + 32);
  let offset = 0;
  ixData[offset++] = SPEND_SPLIT;
  ixData[offset++] = PROOF_SOURCE_BUFFER;
  Buffer.from(params.root).copy(ixData, offset); offset += 32;
  Buffer.from(params.nullifierHash).copy(ixData, offset); offset += 32;
  Buffer.from(params.outputCommitment1).copy(ixData, offset); offset += 32;
  Buffer.from(params.outputCommitment2).copy(ixData, offset); offset += 32;
  Buffer.from(params.vkHash).copy(ixData, offset);

  const instructions: TransactionInstruction[] = [];

  // Add compute budget for ZK verification
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })
  );

  instructions.push(
    new TransactionInstruction({
      programId: zvaultProgram,
      keys: [
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: commitmentTree, isSigner: false, isWritable: true },
        { pubkey: nullifierPDA, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ultrahonkVerifier, isSigner: false, isWritable: false },
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: false },
      ],
      data: ixData,
    })
  );

  onProgress?.("Submitting transaction...");

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = blockhash;

  const signature = await sendAndConfirmTransaction(connection, tx, [relayer], {
    commitment: "confirmed",
  });

  onProgress?.("Closing buffer...");

  // 4. Close buffer and reclaim rent
  let bufferClosed = false;
  try {
    await closeChadBuffer(connection, relayer, bufferKeypair.publicKey);
    bufferClosed = true;
  } catch (e) {
    console.warn("Failed to close buffer:", e);
  }

  onProgress?.("Done!");

  return {
    signature,
    bufferAddress: bufferKeypair.publicKey.toBase58(),
    bufferClosed,
  };
}
