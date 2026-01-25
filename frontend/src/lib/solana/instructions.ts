/**
 * Solana Transaction Builders
 *
 * Build transactions for zVault Pinocchio program.
 * Instructions: VERIFY_DEPOSIT, CLAIM, SPLIT, REQUEST_REDEMPTION
 *
 * Program uses discriminators (first byte) to identify instruction type.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";

// =============================================================================
// Constants
// =============================================================================

/** zVault Program ID (Solana Devnet) */
export const ZVAULT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "BDH9iTYp2nBptboCcSmTn7GTkzYTzaMr7MMG5D5sXXRp"
);

/** BTC Light Client Program ID */
export const BTC_LIGHT_CLIENT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BTC_LIGHT_CLIENT || "8qntLj65faXiqMKcQypyJ389Yq6MBU5X7AB5qsLnvKgy"
);

/** Token-2022 Program ID */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Instruction discriminators */
export const INSTRUCTION_DISCRIMINATORS = {
  VERIFY_DEPOSIT: 8,
  CLAIM: 9,
  SPLIT_COMMITMENT: 4,
  REQUEST_REDEMPTION: 5,
  ANNOUNCE_STEALTH: 12,
} as const;

// =============================================================================
// PDA Derivation
// =============================================================================

/**
 * Derive Pool State PDA
 */
export function derivePoolStatePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId);
}

/**
 * Derive Commitment Tree PDA
 */
export function deriveCommitmentTreePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commitment_tree")],
    programId
  );
}

/**
 * Derive Deposit Record PDA from Bitcoin txid
 */
export function deriveDepositRecordPDA(
  txidBytes: Uint8Array,
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), txidBytes],
    programId
  );
}

/**
 * Derive Nullifier PDA (to check if claimed)
 */
export function deriveNullifierPDA(
  nullifierHash: Uint8Array,
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    programId
  );
}

/**
 * Derive Light Client PDA
 */
export function deriveLightClientPDA(
  programId: PublicKey = BTC_LIGHT_CLIENT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("btc_light_client")],
    programId
  );
}

/**
 * Derive Block Header PDA
 */
export function deriveBlockHeaderPDA(
  blockHeight: number,
  programId: PublicKey = BTC_LIGHT_CLIENT_PROGRAM_ID
): [PublicKey, number] {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64LE(BigInt(blockHeight));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("block_header"), heightBuffer],
    programId
  );
}

/**
 * Derive zBTC Mint PDA
 * Note: Seed string "sbbtc_mint" is kept for deployed contract compatibility
 */
export function derivezBTCMintPDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sbbtc_mint")],
    programId
  );
}

// =============================================================================
// Instruction Data Builders
// =============================================================================

/**
 * Build instruction data for CLAIM
 *
 * @param zkProof - Groth16 proof bytes (typically 256 bytes)
 * @param nullifierHash - 32-byte nullifier hash
 * @param commitment - 32-byte commitment
 * @param merkleRoot - 32-byte merkle root
 * @param amountSats - Amount in satoshis (8 bytes LE)
 */
export function buildClaimInstructionData(
  zkProof: Uint8Array,
  nullifierHash: Uint8Array,
  commitment: Uint8Array,
  merkleRoot: Uint8Array,
  amountSats: bigint
): Uint8Array {
  // Layout: discriminator(1) + proof_len(4) + proof + nullifier_hash(32) + commitment(32) + root(32) + amount(8)
  const proofLen = zkProof.length;
  const totalLen = 1 + 4 + proofLen + 32 + 32 + 32 + 8;

  const data = new Uint8Array(totalLen);
  let offset = 0;

  // Discriminator
  data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM;

  // Proof length (4 bytes LE)
  const lenView = new DataView(data.buffer, offset);
  lenView.setUint32(0, proofLen, true);
  offset += 4;

  // ZK Proof
  data.set(zkProof, offset);
  offset += proofLen;

  // Nullifier hash
  data.set(nullifierHash, offset);
  offset += 32;

  // Commitment
  data.set(commitment, offset);
  offset += 32;

  // Merkle root
  data.set(merkleRoot, offset);
  offset += 32;

  // Amount (8 bytes LE)
  const amountView = new DataView(data.buffer, offset);
  amountView.setBigUint64(0, amountSats, true);

  return data;
}

/**
 * Build instruction data for SPLIT_COMMITMENT
 *
 * @param zkProof - Groth16 proof bytes
 * @param inputNullifierHash - 32-byte input nullifier hash
 * @param outputCommitment1 - 32-byte first output commitment
 * @param outputCommitment2 - 32-byte second output commitment
 * @param merkleRoot - 32-byte merkle root
 */
export function buildSplitInstructionData(
  zkProof: Uint8Array,
  inputNullifierHash: Uint8Array,
  outputCommitment1: Uint8Array,
  outputCommitment2: Uint8Array,
  merkleRoot: Uint8Array
): Uint8Array {
  const proofLen = zkProof.length;
  const totalLen = 1 + 4 + proofLen + 32 + 32 + 32 + 32;

  const data = new Uint8Array(totalLen);
  let offset = 0;

  data[offset++] = INSTRUCTION_DISCRIMINATORS.SPLIT_COMMITMENT;

  const lenView = new DataView(data.buffer, offset);
  lenView.setUint32(0, proofLen, true);
  offset += 4;

  data.set(zkProof, offset);
  offset += proofLen;

  data.set(inputNullifierHash, offset);
  offset += 32;

  data.set(outputCommitment1, offset);
  offset += 32;

  data.set(outputCommitment2, offset);
  offset += 32;

  data.set(merkleRoot, offset);

  return data;
}

/**
 * Build instruction data for REQUEST_REDEMPTION
 *
 * @param amountSats - Amount to redeem
 * @param btcAddress - Bitcoin address for withdrawal (max 62 bytes)
 */
export function buildRedemptionRequestData(
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

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.REQUEST_REDEMPTION;

  const amountView = new DataView(data.buffer, offset);
  amountView.setBigUint64(0, amountSats, true);
  offset += 8;

  data[offset++] = btcAddrBytes.length;
  data.set(btcAddrBytes, offset);

  return data;
}

// =============================================================================
// Transaction Builders
// =============================================================================

export interface ClaimParams {
  /** User's Solana public key (payer and recipient) */
  userPubkey: PublicKey;
  /** ZK proof bytes */
  zkProof: Uint8Array;
  /** Nullifier hash (32 bytes) */
  nullifierHash: Uint8Array;
  /** Commitment (32 bytes) */
  commitment: Uint8Array;
  /** Current Merkle root (32 bytes) */
  merkleRoot: Uint8Array;
  /** Amount in satoshis */
  amountSats: bigint;
  /** User's zBTC token account */
  userTokenAccount: PublicKey;
}

/**
 * Build CLAIM transaction
 *
 * Claims zBTC tokens by proving knowledge of nullifier + secret
 * for a previously recorded deposit commitment.
 */
export async function buildClaimTransaction(
  connection: Connection,
  params: ClaimParams
): Promise<Transaction> {
  const {
    userPubkey,
    zkProof,
    nullifierHash,
    commitment,
    merkleRoot,
    amountSats,
    userTokenAccount,
  } = params;

  // Derive PDAs
  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [nullifierPDA] = deriveNullifierPDA(nullifierHash);
  const [zbtcMint] = derivezBTCMintPDA();

  // Build instruction data
  const instructionData = buildClaimInstructionData(
    zkProof,
    nullifierHash,
    commitment,
    merkleRoot,
    amountSats
  );

  // Build instruction
  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierPDA, isSigner: false, isWritable: true },
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  // Build transaction
  const transaction = new Transaction();
  transaction.add(instruction);
  transaction.feePayer = userPubkey;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

export interface SplitParams {
  userPubkey: PublicKey;
  zkProof: Uint8Array;
  inputNullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  merkleRoot: Uint8Array;
}

/**
 * Build SPLIT transaction
 *
 * Splits one commitment into two output commitments.
 * Used for partial withdrawals or sending.
 */
export async function buildSplitTransaction(
  connection: Connection,
  params: SplitParams
): Promise<Transaction> {
  const {
    userPubkey,
    zkProof,
    inputNullifierHash,
    outputCommitment1,
    outputCommitment2,
    merkleRoot,
  } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [nullifierPDA] = deriveNullifierPDA(inputNullifierHash);

  const instructionData = buildSplitInstructionData(
    zkProof,
    inputNullifierHash,
    outputCommitment1,
    outputCommitment2,
    merkleRoot
  );

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierPDA, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const transaction = new Transaction();
  transaction.add(instruction);
  transaction.feePayer = userPubkey;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

export interface RedeemParams {
  userPubkey: PublicKey;
  userTokenAccount: PublicKey;
  amountSats: bigint;
  btcAddress: string;
}

/**
 * Build REQUEST_REDEMPTION transaction
 *
 * Burns zBTC and creates a RedemptionRequest PDA that the
 * backend redemption processor will pick up.
 */
export async function buildRedeemTransaction(
  connection: Connection,
  params: RedeemParams
): Promise<Transaction> {
  const { userPubkey, userTokenAccount, amountSats, btcAddress } = params;

  const [poolState] = derivePoolStatePDA();
  const [zbtcMint] = derivezBTCMintPDA();

  const instructionData = buildRedemptionRequestData(amountSats, btcAddress);

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const transaction = new Transaction();
  transaction.add(instruction);
  transaction.feePayer = userPubkey;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get user's zBTC token account (creates if needed)
 */
export async function getOrCreateTokenAccount(
  connection: Connection,
  userPubkey: PublicKey
): Promise<PublicKey> {
  const [zbtcMint] = derivezBTCMintPDA();

  // Derive associated token account
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const tokenAccount = getAssociatedTokenAddressSync(
    zbtcMint,
    userPubkey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  return tokenAccount;
}

/**
 * Check if a nullifier has been used (claimed)
 */
export async function isNullifierUsed(
  connection: Connection,
  nullifierHash: Uint8Array
): Promise<boolean> {
  const [nullifierPDA] = deriveNullifierPDA(nullifierHash);

  try {
    const account = await connection.getAccountInfo(nullifierPDA);
    return account !== null;
  } catch {
    return false;
  }
}

/**
 * Get current Merkle root from commitment tree
 */
export async function getMerkleRoot(
  connection: Connection
): Promise<Uint8Array | null> {
  const [commitmentTree] = deriveCommitmentTreePDA();

  try {
    const account = await connection.getAccountInfo(commitmentTree);
    if (!account) return null;

    // Root is at offset 8 (after discriminator), 32 bytes
    // This depends on the actual account layout
    return account.data.slice(8, 40);
  } catch {
    return null;
  }
}

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
