/**
 * Demo Instructions for Mock Deposits
 *
 * These instructions allow adding commitments to the on-chain tree
 * without requiring actual BTC deposits. For demo/showcase only.
 *
 * Uses platform-agnostic data builders from @zvault/sdk.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ZVAULT_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, derivezBTCMintPDA } from "./instructions";
import { getPriorityFeeInstructions } from "@/lib/helius";
import {
  buildAddDemoNoteData,
  buildAddDemoStealthData,
  getPoolStatePDASeeds,
  getCommitmentTreePDASeeds,
  getStealthAnnouncementPDASeeds,
  DEMO_INSTRUCTION,
} from "@zvault/sdk";

// Re-export for backwards compatibility
export { DEMO_INSTRUCTION };

/**
 * Derive Pool State PDA
 */
export function derivePoolStatePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  const { seeds } = getPoolStatePDASeeds();
  return PublicKey.findProgramAddressSync(
    seeds.map(s => Buffer.from(s)),
    programId
  );
}

/**
 * Derive Commitment Tree PDA
 */
export function deriveCommitmentTreePDA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  const { seeds } = getCommitmentTreePDASeeds();
  return PublicKey.findProgramAddressSync(
    seeds.map(s => Buffer.from(s)),
    programId
  );
}

/**
 * Derive Stealth Announcement PDA
 */
export function deriveStealthAnnouncementPDA(
  ephemeralPub: Uint8Array,
  programId: PublicKey = ZVAULT_PROGRAM_ID
): [PublicKey, number] {
  const { seeds } = getStealthAnnouncementPDASeeds(ephemeralPub);
  return PublicKey.findProgramAddressSync(
    seeds.map(s => Buffer.from(s)),
    programId
  );
}

/**
 * Derive Pool Vault (Associated Token Account for Pool PDA)
 * This is where zBTC tokens are held for the shielded pool
 */
export function derivePoolVaultATA(
  programId: PublicKey = ZVAULT_PROGRAM_ID
): PublicKey {
  const [poolState] = derivePoolStatePDA(programId);
  const [zbtcMint] = derivezBTCMintPDA(programId);

  // Pool vault is the ATA of the pool PDA for the zBTC mint
  return getAssociatedTokenAddressSync(
    zbtcMint,
    poolState,
    true, // allowOwnerOffCurve = true for PDA owners
    TOKEN_2022_PROGRAM_ID
  );
}

export interface AddDemoNoteParams {
  /** User's public key (payer) */
  payer: PublicKey;
  /** 32-byte secret (contract derives nullifier and commitment) */
  secret: Uint8Array;
}

/**
 * Build ADD_DEMO_NOTE instruction
 *
 * Takes a secret (32 bytes), the contract derives nullifier and commitment.
 * Adds the commitment to the on-chain tree for claiming.
 * Also mints zBTC to the pool vault so users can claim.
 */
export function buildAddDemoNoteInstruction(
  params: AddDemoNoteParams
): TransactionInstruction {
  const { payer, secret } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [zbtcMint] = derivezBTCMintPDA();
  const poolVault = derivePoolVaultATA();

  // Use SDK's data builder
  const data = buildAddDemoNoteData(secret);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
      // Token accounts for minting zBTC to pool vault
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ZVAULT_PROGRAM_ID,
    data: Buffer.from(data),
  });
}

export interface AddDemoStealthParams {
  /** User's public key (payer) */
  payer: PublicKey;
  /** 33-byte ephemeral public key (compressed Grumpkin) */
  ephemeralPub: Uint8Array;
  /** 32-byte commitment */
  commitment: Uint8Array;
  /** Amount in satoshis */
  amountSats: bigint;
}

/**
 * Build ADD_DEMO_STEALTH instruction
 *
 * Adds commitment to tree AND creates stealth announcement.
 * This allows the recipient to scan and discover the deposit.
 * Uses single ephemeral key pattern (EIP-5564 style).
 * Also mints zBTC to the pool vault so users can claim.
 */
export function buildAddDemoStealthInstruction(
  params: AddDemoStealthParams
): TransactionInstruction {
  const { payer, ephemeralPub, commitment, amountSats } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [stealthAnnouncement] = deriveStealthAnnouncementPDA(ephemeralPub);
  const [zbtcMint] = derivezBTCMintPDA();
  const poolVault = derivePoolVaultATA();

  // Use SDK's data builder
  const data = buildAddDemoStealthData(ephemeralPub, commitment, amountSats);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Token accounts for minting zBTC to pool vault
      { pubkey: zbtcMint, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ZVAULT_PROGRAM_ID,
    data: Buffer.from(data),
  });
}

/**
 * Build and return ADD_DEMO_NOTE transaction
 */
export async function buildAddDemoNoteTransaction(
  connection: Connection,
  params: AddDemoNoteParams
): Promise<Transaction> {
  const instruction = buildAddDemoNoteInstruction(params);

  // Get priority fee instructions
  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
  transaction.add(instruction);
  transaction.feePayer = params.payer;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

/**
 * Build and return ADD_DEMO_STEALTH transaction
 */
export async function buildAddDemoStealthTransaction(
  connection: Connection,
  params: AddDemoStealthParams
): Promise<Transaction> {
  const instruction = buildAddDemoStealthInstruction(params);

  // Get priority fee instructions
  const priorityFeeIxs = await getPriorityFeeInstructions([
    ZVAULT_PROGRAM_ID.toBase58(),
  ]);

  const transaction = new Transaction();
  transaction.add(...priorityFeeIxs);
  transaction.add(instruction);
  transaction.feePayer = params.payer;

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}
