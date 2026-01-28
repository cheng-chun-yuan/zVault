/**
 * Verify Deposit Client
 *
 * Helper to call verify_deposit instruction with ChadBuffer data
 * Uses @solana/kit (v2) - no Anchor, using Pinocchio contracts
 */

import {
  address,
  getProgramDerivedAddress,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  type Address,
  type Rpc,
  type RpcSubscriptions,
  type KeyPairSigner,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { prepareVerifyDeposit, bytesToHex } from "./chadbuffer";
import { ZVAULT_PROGRAM_ID } from "./pda";

/**
 * Derive PDA addresses (async v2 pattern)
 */
export async function derivePoolStatePDA(programId: Address): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    seeds: [new TextEncoder().encode("pool")],
    programAddress: programId,
  });
  return [result[0], result[1]];
}

export async function deriveLightClientPDA(programId: Address): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    seeds: [new TextEncoder().encode("btc_light_client")],
    programAddress: programId,
  });
  return [result[0], result[1]];
}

export async function deriveBlockHeaderPDA(
  programId: Address,
  blockHeight: number
): Promise<[Address, number]> {
  const heightBuffer = new Uint8Array(8);
  const view = new DataView(heightBuffer.buffer);
  view.setBigUint64(0, BigInt(blockHeight), true); // little-endian
  const result = await getProgramDerivedAddress({
    seeds: [new TextEncoder().encode("block_header"), heightBuffer],
    programAddress: programId,
  });
  return [result[0], result[1]];
}

export async function deriveCommitmentTreePDA(
  programId: Address
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    seeds: [new TextEncoder().encode("commitment_tree")],
    programAddress: programId,
  });
  return [result[0], result[1]];
}

export async function deriveDepositRecordPDA(
  programId: Address,
  txid: Uint8Array
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    seeds: [new TextEncoder().encode("deposit"), txid],
    programAddress: programId,
  });
  return [result[0], result[1]];
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
 *
 * @param rpc - Solana RPC client from @solana/kit
 * @param rpcSubscriptions - Solana RPC subscriptions client from @solana/kit
 * @param payer - KeyPairSigner from @solana/kit
 * @param txid - Bitcoin transaction ID
 * @param expectedValue - Expected value in satoshis
 * @param network - Bitcoin network ("mainnet" | "testnet")
 * @param programId - zVault program ID
 */
export async function verifyDeposit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  txid: string,
  expectedValue: number,
  network: "mainnet" | "testnet" = "testnet",
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<Address> {
  console.log("=== Verify Deposit ===");
  console.log(`Txid: ${txid}`);
  console.log(`Expected value: ${expectedValue} sats`);

  // Step 1 & 2: Fetch tx, upload to buffer
  const {
    bufferAddress,
    transactionSize,
    merkleProof,
    blockHeight,
    txIndex,
    txidBytes,
  } = await prepareVerifyDeposit(rpc, rpcSubscriptions, payer, txid, network);

  console.log(`Buffer: ${bufferAddress}`);
  console.log(`Block height: ${blockHeight}`);

  // Step 3: Derive PDAs (now async)
  const [poolState] = await derivePoolStatePDA(programId);
  const [lightClient] = await deriveLightClientPDA(programId);
  const [blockHeader] = await deriveBlockHeaderPDA(programId, blockHeight);
  const [commitmentTree] = await deriveCommitmentTreePDA(programId);
  const [depositRecord] = await deriveDepositRecordPDA(programId, txidBytes);

  console.log("PDAs derived:");
  console.log(`  Pool: ${poolState}`);
  console.log(`  Light Client: ${lightClient}`);
  console.log(`  Block Header: ${blockHeader}`);
  console.log(`  Commitment Tree: ${commitmentTree}`);
  console.log(`  Deposit Record: ${depositRecord}`);

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

  return depositRecord;
}

/**
 * Example usage
 */
export async function exampleUsage() {
  // Create RPC client and subscriptions using @solana/kit
  const rpc = createSolanaRpc("https://api.devnet.solana.com");
  const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.devnet.solana.com");

  // Generate a new keypair signer (replace with actual keypair in production)
  const payer = await generateKeyPairSigner();

  // Example Bitcoin txid (replace with actual)
  const txid = "abc123..."; // 64 char hex

  try {
    const depositRecordPDA = await verifyDeposit(
      rpc,
      rpcSubscriptions,
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
