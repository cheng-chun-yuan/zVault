/**
 * Proof Relay API
 *
 * Relays ZK proofs for privacy-preserving transactions.
 * Uploads proofs to ChadBuffer and submits transactions so users
 * don't need to expose their addresses on-chain.
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
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

// ChadBuffer program ID (devnet)
const CHADBUFFER_PROGRAM_ID = new PublicKey("CHADufvk3AGLCVG1Pk76xUHZJZjEAj1YLNCgDA1P4YX9");

// zVault program ID (devnet)
const ZVAULT_PROGRAM_ID = new PublicKey("5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK");

// UltraHonk verifier program ID
const ULTRAHONK_VERIFIER_ID = new PublicKey("FEWxbQXHsEqYqp67LScB3RggQ3DctfuFi35X2fqZWvDi");

// Instruction discriminators
const SPEND_PARTIAL_PUBLIC = 10;
const SPEND_SPLIT = 4;
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

// Derive PDAs
function derivePoolStatePDA(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], ZVAULT_PROGRAM_ID)[0];
}

function deriveCommitmentTreePDA(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], ZVAULT_PROGRAM_ID)[0];
}

function deriveNullifierPDA(nullifierHash: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    ZVAULT_PROGRAM_ID
  )[0];
}

function deriveZbtcMintPDA(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("zbtc_mint")], ZVAULT_PROGRAM_ID)[0];
}

// Convert hex to bytes
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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

      // Build accounts
      const poolState = derivePoolStatePDA();
      const commitmentTree = deriveCommitmentTreePDA();
      const nullifierPDA = deriveNullifierPDA(nullifierHashBytes);
      const zbtcMint = deriveZbtcMintPDA();
      const poolVault = getAssociatedTokenAddressSync(zbtcMint, poolState, true, TOKEN_2022_PROGRAM_ID);
      const recipientAta = getAssociatedTokenAddressSync(zbtcMint, recipientPubkey, false, TOKEN_2022_PROGRAM_ID);

      zVaultIx = new TransactionInstruction({
        programId: ZVAULT_PROGRAM_ID,
        keys: [
          { pubkey: poolState, isSigner: false, isWritable: true },
          { pubkey: commitmentTree, isSigner: false, isWritable: true },
          { pubkey: nullifierPDA, isSigner: false, isWritable: true },
          { pubkey: zbtcMint, isSigner: false, isWritable: true },
          { pubkey: poolVault, isSigner: false, isWritable: true },
          { pubkey: recipientAta, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: ULTRAHONK_VERIFIER_ID, isSigner: false, isWritable: false },
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

      // Build accounts
      const poolState = derivePoolStatePDA();
      const commitmentTree = deriveCommitmentTreePDA();
      const nullifierPDA = deriveNullifierPDA(nullifierHashBytes);

      zVaultIx = new TransactionInstruction({
        programId: ZVAULT_PROGRAM_ID,
        keys: [
          { pubkey: poolState, isSigner: false, isWritable: true },
          { pubkey: commitmentTree, isSigner: false, isWritable: true },
          { pubkey: nullifierPDA, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: ULTRAHONK_VERIFIER_ID, isSigner: false, isWritable: false },
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
