/**
 * Solana Transaction Builders for zVault
 *
 * Thin wrapper around @zvault/sdk that adds:
 * - @solana/web3.js Transaction construction
 * - Helius priority fee optimization
 *
 * All instruction data building and PDA derivation comes from SDK.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { address } from "@solana/kit";
import { getPriorityFeeInstructions } from "@/lib/helius";

// =============================================================================
// Re-export from SDK (single source of truth)
// =============================================================================

import {
  DEVNET_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
  // Instruction data builders
  buildClaimInstructionData as sdkBuildClaimInstructionData,
  buildSplitInstructionData as sdkBuildSplitInstructionData,
  buildSpendPartialPublicInstructionData as sdkBuildSpendPartialPublicInstructionData,
  buildRedemptionRequestInstructionData as sdkBuildRedemptionRequestInstructionData,
  // PDA helpers
  PDA_SEEDS,
  // Utilities
  bigintTo32Bytes,
  hexToBytes,
  bytesToHex,
} from "@zvault/sdk";

// Re-export for consumers
export { INSTRUCTION_DISCRIMINATORS, bigintTo32Bytes, hexToBytes, bytesToHex };

// =============================================================================
// Constants - All from SDK config
// =============================================================================

/** zVault Program ID */
export const ZVAULT_PROGRAM_ID = new PublicKey(DEVNET_CONFIG.zvaultProgramId);

/** BTC Light Client Program ID */
export const BTC_LIGHT_CLIENT_PROGRAM_ID = new PublicKey(DEVNET_CONFIG.btcLightClientProgramId);

/** Token-2022 Program ID */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(DEVNET_CONFIG.token2022ProgramId);

/** zBTC Mint Address */
export const ZBTC_MINT_ADDRESS = new PublicKey(DEVNET_CONFIG.zbtcMint);

/** UltraHonk Verifier Program ID */
export const ULTRAHONK_VERIFIER_PROGRAM_ID = new PublicKey(DEVNET_CONFIG.ultrahonkVerifierProgramId);

// =============================================================================
// PDA Derivation (using SDK seeds)
// =============================================================================

/**
 * Derive Pool State PDA
 */
export function derivePoolStatePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.POOL_STATE)],
    programId
  );
}

/**
 * Derive Commitment Tree PDA
 */
export function deriveCommitmentTreePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.COMMITMENT_TREE)],
    programId
  );
}

/**
 * Derive Nullifier PDA
 */
export function deriveNullifierPDA(
  nullifierHash: Uint8Array,
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.NULLIFIER), nullifierHash],
    programId
  );
}

/**
 * Derive Deposit Record PDA
 */
export function deriveDepositRecordPDA(
  txidBytes: Uint8Array,
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.DEPOSIT), txidBytes],
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
    [Buffer.from(PDA_SEEDS.LIGHT_CLIENT)],
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
    [Buffer.from(PDA_SEEDS.BLOCK_HEADER), heightBuffer],
    programId
  );
}

/**
 * Get zBTC Mint address
 */
export function getzBTCMintAddress(): PublicKey {
  return ZBTC_MINT_ADDRESS;
}

/**
 * Derive zBTC Mint PDA (returns SDK config address)
 * @deprecated Use getzBTCMintAddress() instead
 */
export function derivezBTCMintPDA(
  _programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  return [ZBTC_MINT_ADDRESS, 0];
}

/**
 * Derive Pool Vault ATA
 */
export function derivePoolVaultATA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): PublicKey {
  const [poolState] = derivePoolStatePDA(programId);
  return getAssociatedTokenAddressSync(
    ZBTC_MINT_ADDRESS,
    poolState,
    true,
    TOKEN_2022_PROGRAM_ID
  );
}

// =============================================================================
// Transaction Builders (with Helius priority fees)
// =============================================================================

export interface ClaimParams {
  userPubkey: PublicKey;
  zkProof: Uint8Array;
  nullifierHash: Uint8Array;
  merkleRoot: Uint8Array;
  amountSats: bigint;
  userTokenAccount: PublicKey;
  vkHash: Uint8Array;
}

/**
 * Build CLAIM transaction with Helius priority fees
 */
export async function buildClaimTransaction(
  connection: Connection,
  params: ClaimParams
): Promise<Transaction> {
  const {
    userPubkey,
    zkProof,
    nullifierHash,
    merkleRoot,
    amountSats,
    userTokenAccount,
    vkHash,
  } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [nullifierPDA] = deriveNullifierPDA(nullifierHash);
  const poolVault = derivePoolVaultATA();

  // Use SDK instruction data builder
  const instructionData = sdkBuildClaimInstructionData({
    proofSource: "inline",
    proofBytes: zkProof,
    root: merkleRoot,
    nullifierHash,
    amountSats,
    recipient: address(userPubkey.toBase58()),
    vkHash,
  });

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: false },
      { pubkey: nullifierPDA, isSigner: false, isWritable: true },
      { pubkey: ZBTC_MINT_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ULTRAHONK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  // Helius priority fees for better tx landing
  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
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
  vkHash: Uint8Array;
}

/**
 * Build SPLIT transaction with Helius priority fees
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
    vkHash,
  } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [nullifierPDA] = deriveNullifierPDA(inputNullifierHash);

  // Use SDK instruction data builder
  const instructionData = sdkBuildSplitInstructionData({
    proofSource: "inline",
    proofBytes: zkProof,
    root: merkleRoot,
    nullifierHash: inputNullifierHash,
    outputCommitment1,
    outputCommitment2,
    vkHash,
  });

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierPDA, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ULTRAHONK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
  transaction.add(instruction);
  transaction.feePayer = userPubkey;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

export interface SpendPartialPublicParams {
  userPubkey: PublicKey;
  zkProof: Uint8Array;
  merkleRoot: Uint8Array;
  nullifierHash: Uint8Array;
  publicAmount: bigint;
  changeCommitment: Uint8Array;
  recipient: PublicKey;
  recipientTokenAccount: PublicKey;
  vkHash: Uint8Array;
}

/**
 * Build SPEND_PARTIAL_PUBLIC transaction with Helius priority fees
 */
export async function buildSpendPartialPublicTransaction(
  connection: Connection,
  params: SpendPartialPublicParams
): Promise<Transaction> {
  const {
    userPubkey,
    zkProof,
    merkleRoot,
    nullifierHash,
    publicAmount,
    changeCommitment,
    recipient,
    recipientTokenAccount,
    vkHash,
  } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [nullifierPDA] = deriveNullifierPDA(nullifierHash);
  const poolVault = derivePoolVaultATA();

  // Use SDK instruction data builder
  const instructionData = sdkBuildSpendPartialPublicInstructionData({
    proofSource: "inline",
    proofBytes: zkProof,
    root: merkleRoot,
    nullifierHash,
    publicAmountSats: publicAmount,
    changeCommitment,
    recipient: address(recipient.toBase58()),
    vkHash,
  });

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: nullifierPDA, isSigner: false, isWritable: true },
      { pubkey: ZBTC_MINT_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ULTRAHONK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
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
 * Build REQUEST_REDEMPTION transaction with Helius priority fees
 */
export async function buildRedeemTransaction(
  connection: Connection,
  params: RedeemParams
): Promise<Transaction> {
  const { userPubkey, userTokenAccount, amountSats, btcAddress } = params;

  const [poolState] = derivePoolStatePDA();

  // Use SDK instruction data builder
  const instructionData = sdkBuildRedemptionRequestInstructionData(amountSats, btcAddress);

  const instruction = new TransactionInstruction({
    programId: ZVAULT_PROGRAM_ID,
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: ZBTC_MINT_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(instructionData),
  });

  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
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
 * Get user's zBTC token account address
 */
export function getTokenAccountAddress(userPubkey: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    ZBTC_MINT_ADDRESS,
    userPubkey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
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
    return account.data.slice(8, 40);
  } catch {
    return null;
  }
}
