/**
 * Demo Instructions for Mock Stealth Deposits
 *
 * Allows adding stealth commitments to the on-chain tree
 * without requiring actual BTC deposits. For demo/showcase only.
 *
 * Uses @zvault/sdk for instruction data building.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getPriorityFeeInstructions } from "@/lib/helius";
import {
  buildAddDemoStealthData,
  getPoolStatePDASeeds,
  getCommitmentTreePDASeeds,
  getStealthAnnouncementPDASeeds,
  DEMO_INSTRUCTION,
  ZVAULT_PROGRAM_ID as SDK_ZVAULT_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as SDK_TOKEN_2022_PROGRAM_ID,
  DEVNET_CONFIG,
} from "@zvault/sdk";

// =============================================================================
// Constants from SDK
// =============================================================================

const ZVAULT_PROGRAM_ID = new PublicKey(SDK_ZVAULT_PROGRAM_ID);
const TOKEN_2022_PROGRAM_ID = new PublicKey(SDK_TOKEN_2022_PROGRAM_ID);
const ZBTC_MINT_ADDRESS = new PublicKey(DEVNET_CONFIG.zbtcMint);

// Re-export for consumers
export { DEMO_INSTRUCTION };

// =============================================================================
// PDA Derivation (using SDK seeds)
// =============================================================================

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
 * Get zBTC Mint address
 */
export function derivezBTCMintPDA(): [PublicKey, number] {
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
// Demo Instruction Builder
// =============================================================================

export interface AddDemoStealthParams {
  payer: PublicKey;
  ephemeralPub: Uint8Array;
  commitment: Uint8Array;
  encryptedAmount: Uint8Array;
}

/**
 * Build ADD_DEMO_STEALTH instruction
 */
export function buildAddDemoStealthInstruction(
  params: AddDemoStealthParams
): TransactionInstruction {
  const { payer, ephemeralPub, commitment, encryptedAmount } = params;

  const [poolState] = derivePoolStatePDA();
  const [commitmentTree] = deriveCommitmentTreePDA();
  const [stealthAnnouncement] = deriveStealthAnnouncementPDA(ephemeralPub);
  const poolVault = derivePoolVaultATA();

  // Use SDK's data builder
  const data = buildAddDemoStealthData(ephemeralPub, commitment, encryptedAmount);

  return new TransactionInstruction({
    keys: [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: commitmentTree, isSigner: false, isWritable: true },
      { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ZBTC_MINT_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: poolVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ZVAULT_PROGRAM_ID,
    data: Buffer.from(data),
  });
}

/**
 * Build ADD_DEMO_STEALTH transaction with Helius priority fees
 */
export async function buildAddDemoStealthTransaction(
  connection: Connection,
  params: AddDemoStealthParams
): Promise<Transaction> {
  const instruction = buildAddDemoStealthInstruction(params);

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
