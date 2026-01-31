/**
 * Proof Relay API
 *
 * Relays ZK proofs for privacy-preserving transactions.
 * Uploads proofs to ChadBuffer and submits transactions so users
 * don't need to expose their addresses on-chain.
 *
 * Uses @zvault/sdk for consistent PDA derivation and constants.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import {
  CHADBUFFER_PROGRAM_ID as SDK_CHADBUFFER_PROGRAM_ID,
  DEVNET_CONFIG,
  INSTRUCTION_DISCRIMINATORS,
  hexToBytes,
} from "@zvault/sdk";

// Import PDA functions from instructions.ts (single source of truth)
import {
  ZVAULT_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ZBTC_MINT_ADDRESS,
  ULTRAHONK_VERIFIER_PROGRAM_ID,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveNullifierPDA,
  derivePoolVaultATA,
} from "@/lib/solana/instructions";

// ChadBuffer program ID (devnet)
const CHADBUFFER_PROGRAM_ID = new PublicKey(SDK_CHADBUFFER_PROGRAM_ID);

// Instruction discriminators from SDK
const SPEND_PARTIAL_PUBLIC = INSTRUCTION_DISCRIMINATORS.SPEND_PARTIAL_PUBLIC;
const SPEND_SPLIT = INSTRUCTION_DISCRIMINATORS.SPEND_SPLIT;
const PROOF_SOURCE_BUFFER = 1;

// ChadBuffer instructions
const CHADBUFFER_INIT = 0;
const CHADBUFFER_WRITE = 1;

interface RelayRequest {
  type: "spend_partial_public" | "spend_split";
  proof: string; // hex
  root: string; // hex
  nullifierHash: string; // hex
  vkHash: string; // hex
  // For spend_partial_public
  publicAmount?: string;
  changeCommitment?: string;
  recipient?: string;
  // For spend_split
  outputCommitment1?: string;
  outputCommitment2?: string;
}

// Load relayer keypair from environment
function getRelayerKeypair(): Keypair {
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("RELAYER_PRIVATE_KEY not set");
  }

  // Support both base58 and JSON array formats
  try {
    // Try base58 first
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    // Try JSON array
    const bytes = JSON.parse(privateKey);
    return Keypair.fromSecretKey(new Uint8Array(bytes));
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: RelayRequest = await request.json();

    // Validate request
    if (!body.type || !body.proof || !body.root || !body.nullifierHash || !body.vkHash) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
      "confirmed"
    );

    const relayer = getRelayerKeypair();
    const proofBytes = hexToBytes(body.proof);
    const rootBytes = hexToBytes(body.root);
    const nullifierHashBytes = hexToBytes(body.nullifierHash);
    const vkHashBytes = hexToBytes(body.vkHash);

    // 1. Create ChadBuffer account and upload proof
    const bufferKeypair = Keypair.generate();
    const bufferSize = 32 + proofBytes.length; // 32 bytes authority + proof

    const rentExemption = await connection.getMinimumBalanceForRentExemption(bufferSize);

    // Create buffer account
    const createBufferIx = SystemProgram.createAccount({
      fromPubkey: relayer.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: rentExemption,
      space: bufferSize,
      programId: CHADBUFFER_PROGRAM_ID,
    });

    // Initialize ChadBuffer
    const initBufferIx = new TransactionInstruction({
      programId: CHADBUFFER_PROGRAM_ID,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([CHADBUFFER_INIT]),
    });

    // Write proof to ChadBuffer
    const writeData = Buffer.alloc(1 + 4 + proofBytes.length);
    writeData[0] = CHADBUFFER_WRITE;
    writeData.writeUInt32LE(0, 1); // offset = 0
    Buffer.from(proofBytes).copy(writeData, 5);

    const writeBufferIx = new TransactionInstruction({
      programId: CHADBUFFER_PROGRAM_ID,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
      ],
      data: writeData,
    });

    // 2. Build zVault instruction based on type
    let zVaultIx: TransactionInstruction;

    if (body.type === "spend_partial_public") {
      if (!body.publicAmount || !body.changeCommitment || !body.recipient) {
        return NextResponse.json(
          { success: false, error: "Missing spend_partial_public fields" },
          { status: 400 }
        );
      }

      const publicAmount = BigInt(body.publicAmount);
      const changeCommitmentBytes = hexToBytes(body.changeCommitment);
      const recipientPubkey = new PublicKey(body.recipient);

      // Build instruction data (buffer mode)
      const ixData = Buffer.alloc(1 + 1 + 32 + 32 + 8 + 32 + 32 + 32);
      let offset = 0;
      ixData[offset++] = SPEND_PARTIAL_PUBLIC;
      ixData[offset++] = PROOF_SOURCE_BUFFER;
      Buffer.from(rootBytes).copy(ixData, offset); offset += 32;
      Buffer.from(nullifierHashBytes).copy(ixData, offset); offset += 32;
      ixData.writeBigUInt64LE(publicAmount, offset); offset += 8;
      Buffer.from(changeCommitmentBytes).copy(ixData, offset); offset += 32;
      recipientPubkey.toBuffer().copy(ixData, offset); offset += 32;
      Buffer.from(vkHashBytes).copy(ixData, offset);

      // Build accounts using consolidated PDA functions
      const [poolState] = derivePoolStatePDA();
      const [commitmentTree] = deriveCommitmentTreePDA();
      const [nullifierPDA] = deriveNullifierPDA(nullifierHashBytes);
      const poolVault = derivePoolVaultATA();
      const recipientAta = getAssociatedTokenAddressSync(ZBTC_MINT_ADDRESS, recipientPubkey, false, TOKEN_2022_PROGRAM_ID);

      zVaultIx = new TransactionInstruction({
        programId: ZVAULT_PROGRAM_ID,
        keys: [
          { pubkey: poolState, isSigner: false, isWritable: true },
          { pubkey: commitmentTree, isSigner: false, isWritable: true },
          { pubkey: nullifierPDA, isSigner: false, isWritable: true },
          { pubkey: ZBTC_MINT_ADDRESS, isSigner: false, isWritable: true },
          { pubkey: poolVault, isSigner: false, isWritable: true },
          { pubkey: recipientAta, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: ULTRAHONK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: false },
        ],
        data: ixData,
      });
    } else if (body.type === "spend_split") {
      if (!body.outputCommitment1 || !body.outputCommitment2) {
        return NextResponse.json(
          { success: false, error: "Missing spend_split fields" },
          { status: 400 }
        );
      }

      const output1Bytes = hexToBytes(body.outputCommitment1);
      const output2Bytes = hexToBytes(body.outputCommitment2);

      // Build instruction data (buffer mode)
      const ixData = Buffer.alloc(1 + 1 + 32 + 32 + 32 + 32 + 32);
      let offset = 0;
      ixData[offset++] = SPEND_SPLIT;
      ixData[offset++] = PROOF_SOURCE_BUFFER;
      Buffer.from(rootBytes).copy(ixData, offset); offset += 32;
      Buffer.from(nullifierHashBytes).copy(ixData, offset); offset += 32;
      Buffer.from(output1Bytes).copy(ixData, offset); offset += 32;
      Buffer.from(output2Bytes).copy(ixData, offset); offset += 32;
      Buffer.from(vkHashBytes).copy(ixData, offset);

      // Build accounts using consolidated PDA functions
      const [poolState] = derivePoolStatePDA();
      const [commitmentTree] = deriveCommitmentTreePDA();
      const [nullifierPDA] = deriveNullifierPDA(nullifierHashBytes);

      zVaultIx = new TransactionInstruction({
        programId: ZVAULT_PROGRAM_ID,
        keys: [
          { pubkey: poolState, isSigner: false, isWritable: true },
          { pubkey: commitmentTree, isSigner: false, isWritable: true },
          { pubkey: nullifierPDA, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: ULTRAHONK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: false },
        ],
        data: ixData,
      });
    } else {
      return NextResponse.json(
        { success: false, error: `Unknown type: ${body.type}` },
        { status: 400 }
      );
    }

    // 3. Build and send transaction
    const { blockhash } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.add(createBufferIx, initBufferIx, writeBufferIx, zVaultIx);
    tx.feePayer = relayer.publicKey;
    tx.recentBlockhash = blockhash;

    // Sign with both relayer and buffer keypair
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [relayer, bufferKeypair],
      { commitment: "confirmed" }
    );

    return NextResponse.json({
      success: true,
      signature,
      bufferAddress: bufferKeypair.publicKey.toBase58(),
    });
  } catch (error) {
    console.error("[Relay] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
