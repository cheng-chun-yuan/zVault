/**
 * Sunspot Groth16 Verifier Account Management
 *
 * Utilities for creating and managing VK (Verification Key) accounts
 * in the Sunspot Groth16 verifier program.
 *
 * @module verifier-accounts
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { address, type Address, AccountRole } from "@solana/kit";
import { VERIFIER_DISCRIMINATORS } from "./instructions/types";
import type { Instruction } from "./instructions/types";
import type { CircuitType } from "./prover/sunspot";

/**
 * Build INIT_VK instruction for Sunspot Groth16 verifier
 *
 * This initializes a VK account with the verification key bytes.
 * The VK account must be pre-created with enough space.
 *
 * Accounts: [vk_account (WRITABLE), authority (SIGNER), system_program]
 * Data: [discriminator(1)] + VK bytes
 */
export function buildInitVkInstruction(options: {
  verifierProgramId: Address;
  vkAddress: Address;
  authority: Address;
  vkBytes: Uint8Array;
}): Instruction {
  const { verifierProgramId, vkAddress, authority, vkBytes } = options;

  // Data format: [discriminator] + VK bytes
  const data = new Uint8Array(1 + vkBytes.length);
  data[0] = VERIFIER_DISCRIMINATORS.INIT_VK;
  data.set(vkBytes, 1);

  const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

  return {
    programAddress: verifierProgramId,
    accounts: [
      { address: vkAddress, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}

/** WRITE_VK_CHUNK discriminator */
const WRITE_VK_CHUNK_DISCRIMINATOR = 4;

/**
 * Create and initialize a VK account for a circuit using legacy web3.js
 *
 * This creates a new account owned by the verifier program, funds it for rent exemption,
 * and writes the VK bytes in chunks using WRITE_VK_CHUNK instruction.
 *
 * @param connection - Solana connection
 * @param payer - Payer keypair (pays for account creation)
 * @param vkKeypair - Keypair for the new VK account
 * @param verifierProgramId - Sunspot Groth16 verifier program ID
 * @param vkBytes - Raw verification key bytes
 * @returns Transaction signature
 */
export async function createAndInitializeVkAccount(
  connection: Connection,
  payer: Keypair,
  vkKeypair: Keypair,
  verifierProgramId: PublicKey,
  vkBytes: Uint8Array
): Promise<string> {
  const vkSize = vkBytes.length;
  const rentLamports = await connection.getMinimumBalanceForRentExemption(vkSize);

  console.log(`[VK] Creating VK account: ${vkKeypair.publicKey.toBase58()}`);
  console.log(`[VK] VK size: ${vkSize} bytes, rent: ${rentLamports / 1e9} SOL`);

  // Step 1: Create account owned by verifier program
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: vkKeypair.publicKey,
    lamports: rentLamports,
    space: vkSize,
    programId: verifierProgramId,
  });

  const createTx = new Transaction().add(createAccountIx);
  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, vkKeypair], {
    commitment: "confirmed",
  });
  console.log(`[VK] Account created: ${createSig.slice(0, 16)}...`);

  // Step 2: Write VK bytes in chunks using WRITE_VK_CHUNK instruction
  // Chunk size: ~900 bytes to fit in TX (leaving room for accounts, signatures, etc.)
  const CHUNK_SIZE = 900;
  const totalChunks = Math.ceil(vkBytes.length / CHUNK_SIZE);
  console.log(`[VK] Writing VK in ${totalChunks} chunks...`);

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * CHUNK_SIZE;
    const chunk = vkBytes.slice(offset, offset + CHUNK_SIZE);

    // WRITE_VK_CHUNK instruction: [discriminator(1)][offset(4 LE)][chunk_data]
    const offsetBytes = new Uint8Array(4);
    new DataView(offsetBytes.buffer).setUint32(0, offset, true);

    const writeVkChunkIx = new TransactionInstruction({
      programId: verifierProgramId,
      keys: [
        { pubkey: vkKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([
        Buffer.from([WRITE_VK_CHUNK_DISCRIMINATOR]),
        Buffer.from(offsetBytes),
        Buffer.from(chunk),
      ]),
    });

    const writeTx = new Transaction().add(writeVkChunkIx);
    try {
      const writeSig = await sendAndConfirmTransaction(connection, writeTx, [payer], {
        commitment: "confirmed",
      });
      const progress = Math.round(((i + 1) / totalChunks) * 100);
      console.log(`[VK] Chunk ${i + 1}/${totalChunks} (${progress}%): ${writeSig.slice(0, 12)}...`);
    } catch (e: any) {
      console.log(`[VK] Write chunk ${i + 1} failed: ${e.message}`);
      throw e;
    }
  }

  console.log(`[VK] VK account initialized successfully`);
  return createSig;
}

/**
 * Check if a VK account exists and is initialized
 */
export async function isVkAccountInitialized(
  connection: Connection,
  vkAddress: PublicKey,
  verifierProgramId: PublicKey
): Promise<boolean> {
  try {
    const accountInfo = await connection.getAccountInfo(vkAddress);
    if (!accountInfo) return false;
    return accountInfo.owner.equals(verifierProgramId);
  } catch {
    return false;
  }
}

/**
 * Cache of initialized VK accounts (circuit type -> keypair)
 */
const vkAccountCache = new Map<CircuitType, Keypair>();

/**
 * Get cached VK keypair for a circuit type
 */
export function getCachedVkKeypair(circuitType: CircuitType): Keypair | undefined {
  return vkAccountCache.get(circuitType);
}

/**
 * Set cached VK keypair
 */
export function setCachedVkKeypair(circuitType: CircuitType, keypair: Keypair): void {
  vkAccountCache.set(circuitType, keypair);
}

/**
 * Get or create VK account for a circuit
 *
 * This checks if a VK account already exists in cache, otherwise creates one.
 */
export async function getOrCreateVkAccount(
  connection: Connection,
  payer: Keypair,
  verifierProgramId: PublicKey,
  circuitType: CircuitType,
  getVkBytes: () => Promise<Uint8Array>
): Promise<{ address: PublicKey; keypair: Keypair }> {
  // Check cache first
  let vkKeypair = getCachedVkKeypair(circuitType);

  if (vkKeypair) {
    // Verify it still exists on-chain
    const exists = await isVkAccountInitialized(connection, vkKeypair.publicKey, verifierProgramId);
    if (exists) {
      console.log(`[VK] Using cached VK account for ${circuitType}: ${vkKeypair.publicKey.toBase58()}`);
      return { address: vkKeypair.publicKey, keypair: vkKeypair };
    }
  }

  // Create new VK account
  vkKeypair = Keypair.generate();
  const vkBytes = await getVkBytes();

  await createAndInitializeVkAccount(
    connection,
    payer,
    vkKeypair,
    verifierProgramId,
    vkBytes
  );

  setCachedVkKeypair(circuitType, vkKeypair);
  return { address: vkKeypair.publicKey, keypair: vkKeypair };
}
