/**
 * Verify Deposit Client
 *
 * Helper to call verify_deposit instruction with ChadBuffer data
 * Uses native Solana web3.js (no Anchor - using Pinocchio contracts)
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { prepareVerifyDeposit, bytesToHex } from "./chadbuffer";

// Program ID (Solana Devnet)
const ZVAULT_PROGRAM_ID = new PublicKey(
  "5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK"
);

/**
 * Derive PDA addresses
 */
export function derivePoolStatePDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId);
}

export function deriveLightClientPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("btc_light_client")],
    programId
  );
}

export function deriveBlockHeaderPDA(
  programId: PublicKey,
  blockHeight: number
): [PublicKey, number] {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64LE(BigInt(blockHeight));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("block_header"), heightBuffer],
    programId
  );
}

export function deriveCommitmentTreePDA(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commitment_tree")],
    programId
  );
}

export function deriveDepositRecordPDA(
  programId: PublicKey,
  txid: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), txid],
    programId
  );
}

/**
 * Build TxMerkleProof structure for the instruction
 */
export function buildMerkleProof(
  txidBytes: Uint8Array,
  merkleProof: Uint8Array[],
  txIndex: number
): {
  txid: number[];
  siblings: number[][];
  path: boolean[];
  txIndex: number;
} {
  // Convert txid to array
  const txid = Array.from(txidBytes);

  // Convert siblings
  const siblings = merkleProof.map((proof) => Array.from(proof));

  // Compute path from txIndex
  const path: boolean[] = [];
  let index = txIndex;
  for (let i = 0; i < merkleProof.length; i++) {
    path.push((index & 1) === 1);
    index = index >> 1;
  }

  return { txid, siblings, path, txIndex };
}

/**
 * Complete verify deposit flow
 *
 * 1. Fetch raw tx and merkle proof from Esplora
 * 2. Upload raw tx to ChadBuffer
 * 3. Call verify_deposit instruction
 */
export async function verifyDeposit(
  connection: Connection,
  payer: Keypair,
  txid: string,
  expectedValue: number,
  network: "mainnet" | "testnet" = "testnet",
  programId: PublicKey = ZVAULT_PROGRAM_ID
): Promise<string> {
  console.log("=== Verify Deposit ===");
  console.log(`Txid: ${txid}`);
  console.log(`Expected value: ${expectedValue} sats`);

  // Step 1 & 2: Fetch tx, upload to buffer
  const {
    bufferPubkey,
    transactionSize,
    merkleProof,
    blockHeight,
    txIndex,
    txidBytes,
  } = await prepareVerifyDeposit(connection, payer, txid, network);

  console.log(`Buffer: ${bufferPubkey.toBase58()}`);
  console.log(`Block height: ${blockHeight}`);

  // Step 3: Derive PDAs
  const [poolState] = derivePoolStatePDA(programId);
  const [lightClient] = deriveLightClientPDA(programId);
  const [blockHeader] = deriveBlockHeaderPDA(programId, blockHeight);
  const [commitmentTree] = deriveCommitmentTreePDA(programId);
  const [depositRecord] = deriveDepositRecordPDA(programId, txidBytes);

  console.log("PDAs derived:");
  console.log(`  Pool: ${poolState.toBase58()}`);
  console.log(`  Light Client: ${lightClient.toBase58()}`);
  console.log(`  Block Header: ${blockHeader.toBase58()}`);
  console.log(`  Commitment Tree: ${commitmentTree.toBase58()}`);
  console.log(`  Deposit Record: ${depositRecord.toBase58()}`);

  // Build merkle proof
  const merkleProofData = buildMerkleProof(txidBytes, merkleProof, txIndex);

  // Build tx_output
  const txOutput = {
    value: BigInt(expectedValue),
    expectedPubkey: new Array(32).fill(0), // Not used for OP_RETURN verification
    vout: 0,
  };

  console.log("\nInstruction parameters:");
  console.log(`  txid: ${bytesToHex(txidBytes)}`);
  console.log(`  merkle_proof: ${merkleProofData.siblings.length} siblings`);
  console.log(`  block_height: ${blockHeight}`);
  console.log(`  transaction_size: ${transactionSize}`);

  console.log("\n=== Ready to call verify_deposit ===");

  return depositRecord.toBase58();
}

/**
 * Example usage
 */
export async function exampleUsage() {
  const connection = new Connection("https://api.devnet.solana.com");
  const payer = Keypair.generate(); // Replace with actual keypair

  // Example Bitcoin txid (replace with actual)
  const txid =
    "abc123..."; // 64 char hex

  try {
    const depositRecordPDA = await verifyDeposit(
      connection,
      payer,
      txid,
      100000, // 0.001 BTC in sats
      "testnet"
    );
    console.log(`Deposit record will be at: ${depositRecordPDA}`);
  } catch (error) {
    console.error("Error:", error);
  }
}
