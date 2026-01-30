/**
 * Mempool.space API helpers for SPV verification
 *
 * Fetches block headers and merkle proofs for Bitcoin transactions
 */

const MEMPOOL_API_TESTNET = "https://mempool.space/testnet/api";
const MEMPOOL_API_MAINNET = "https://mempool.space/api";

export interface BlockHeader {
  height: number;
  hash: string;
  version: number;
  previousBlockHash: string;
  merkleRoot: string;
  timestamp: number;
  bits: number;
  nonce: number;
  // Raw 80-byte header in hex
  rawHeader: string;
}

export interface MerkleProof {
  blockHeight: number;
  blockHash: string;
  txIndex: number;
  merkleProof: string[]; // Array of 32-byte hashes in hex
}

export interface TransactionInfo {
  txid: string;
  confirmed: boolean;
  blockHeight?: number;
  blockHash?: string;
  blockTime?: number;
}

function getApiBase(network: "mainnet" | "testnet" = "testnet"): string {
  return network === "mainnet" ? MEMPOOL_API_MAINNET : MEMPOOL_API_TESTNET;
}

/**
 * Get transaction info including block hash
 */
export async function getTransactionInfo(
  txid: string,
  network: "mainnet" | "testnet" = "testnet"
): Promise<TransactionInfo> {
  const baseUrl = getApiBase(network);
  const response = await fetch(`${baseUrl}/tx/${txid}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch transaction: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    txid: data.txid,
    confirmed: data.status.confirmed,
    blockHeight: data.status.block_height,
    blockHash: data.status.block_hash,
    blockTime: data.status.block_time,
  };
}

/**
 * Get block header by hash
 */
export async function getBlockHeader(
  blockHash: string,
  network: "mainnet" | "testnet" = "testnet"
): Promise<BlockHeader> {
  const baseUrl = getApiBase(network);

  // Fetch block info
  const blockRes = await fetch(`${baseUrl}/block/${blockHash}`);
  if (!blockRes.ok) {
    throw new Error(`Failed to fetch block: ${blockRes.statusText}`);
  }
  const blockInfo = await blockRes.json();

  // Fetch raw header (80 bytes hex)
  const headerRes = await fetch(`${baseUrl}/block/${blockHash}/header`);
  if (!headerRes.ok) {
    throw new Error(`Failed to fetch block header: ${headerRes.statusText}`);
  }
  const rawHeader = await headerRes.text();

  return {
    height: blockInfo.height,
    hash: blockHash,
    version: blockInfo.version,
    previousBlockHash: blockInfo.previousblockhash,
    merkleRoot: blockInfo.merkle_root,
    timestamp: blockInfo.timestamp,
    bits: blockInfo.bits,
    nonce: blockInfo.nonce,
    rawHeader,
  };
}

/**
 * Get block header by height
 */
export async function getBlockHeaderByHeight(
  height: number,
  network: "mainnet" | "testnet" = "testnet"
): Promise<BlockHeader> {
  const baseUrl = getApiBase(network);

  // Get block hash at height
  const hashRes = await fetch(`${baseUrl}/block-height/${height}`);
  if (!hashRes.ok) {
    throw new Error(`Failed to get block hash at height ${height}`);
  }
  const blockHash = await hashRes.text();

  return getBlockHeader(blockHash, network);
}

/**
 * Get merkle proof for a transaction
 */
export async function getMerkleProof(
  txid: string,
  network: "mainnet" | "testnet" = "testnet"
): Promise<MerkleProof> {
  const baseUrl = getApiBase(network);

  const response = await fetch(`${baseUrl}/tx/${txid}/merkle-proof`);
  if (!response.ok) {
    throw new Error(`Failed to fetch merkle proof: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    blockHeight: data.block_height,
    blockHash: "", // Not provided by this endpoint, fetch separately if needed
    txIndex: data.pos,
    merkleProof: data.merkle,
  };
}

/**
 * Get current blockchain tip height
 */
export async function getTipHeight(
  network: "mainnet" | "testnet" = "testnet"
): Promise<number> {
  const baseUrl = getApiBase(network);

  const response = await fetch(`${baseUrl}/blocks/tip/height`);
  if (!response.ok) {
    throw new Error(`Failed to get tip height: ${response.statusText}`);
  }

  return parseInt(await response.text(), 10);
}

/**
 * Get all data needed for SPV verification
 */
export async function getSPVProofData(
  txid: string,
  network: "mainnet" | "testnet" = "testnet"
): Promise<{
  txInfo: TransactionInfo;
  blockHeader: BlockHeader;
  merkleProof: MerkleProof;
  confirmations: number;
}> {
  // Get transaction info
  const txInfo = await getTransactionInfo(txid, network);

  if (!txInfo.confirmed || !txInfo.blockHash) {
    throw new Error("Transaction not confirmed yet");
  }

  // Get block header
  const blockHeader = await getBlockHeader(txInfo.blockHash, network);

  // Get merkle proof
  const merkleProof = await getMerkleProof(txid, network);
  merkleProof.blockHash = txInfo.blockHash;

  // Get confirmations
  const tipHeight = await getTipHeight(network);
  const confirmations = tipHeight - txInfo.blockHeight! + 1;

  return {
    txInfo,
    blockHeader,
    merkleProof,
    confirmations,
  };
}

// Re-export byte conversion utilities from SDK (single source of truth)
export { hexToBytes, bytesToHex } from "@zvault/sdk";

/**
 * Reverse bytes (for Bitcoin internal byte order)
 */
export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const reversed = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    reversed[i] = bytes[bytes.length - 1 - i];
  }
  return reversed;
}
