/**
 * Bitcoin Types
 *
 * Type definitions for Bitcoin-related operations in zVault.
 *
 * @module types/bitcoin
 */

// ==========================================================================
// Esplora API Types
// ==========================================================================

/**
 * Esplora transaction structure
 */
export interface EsploraTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  size: number;
  weight: number;
  fee: number;
  status: EsploraStatus;
}

/**
 * Esplora transaction input
 */
export interface EsploraVin {
  txid: string;
  vout: number;
  prevout: EsploraVout | null;
  scriptsig: string;
  scriptsig_asm: string;
  witness?: string[];
  is_coinbase: boolean;
  sequence: number;
}

/**
 * Esplora transaction output
 */
export interface EsploraVout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

/**
 * Esplora transaction status
 */
export interface EsploraStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

/**
 * Esplora address info
 */
export interface EsploraAddressInfo {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

/**
 * Esplora UTXO
 */
export interface EsploraUtxo {
  txid: string;
  vout: number;
  status: EsploraStatus;
  value: number;
}

/**
 * Esplora Merkle proof
 */
export interface EsploraMerkleProof {
  block_height: number;
  merkle: string[];
  pos: number;
}

/**
 * Esplora network types
 */
export type EsploraNetwork = "mainnet" | "testnet" | "testnet4" | "signet";

// ==========================================================================
// SPV Proof Types
// ==========================================================================

/**
 * SPV proof data for Bitcoin transaction verification
 */
export interface SPVProofData {
  /** Raw transaction bytes */
  txBytes: Uint8Array;
  /** Merkle proof for transaction inclusion */
  merkleProof: string[];
  /** Position in Merkle tree */
  txIndex: number;
  /** Block height */
  blockHeight: number;
  /** Block header (80 bytes) */
  blockHeader: Uint8Array;
}

// ==========================================================================
// Deposit Types
// ==========================================================================

/**
 * Bitcoin deposit information
 */
export interface BitcoinDeposit {
  /** Bitcoin transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Amount in satoshis */
  amount: bigint;
  /** Taproot address */
  taprootAddress: string;
  /** Number of confirmations */
  confirmations: number;
  /** Block height (if confirmed) */
  blockHeight?: number;
}

// ==========================================================================
// Network Configuration
// ==========================================================================

/**
 * Bitcoin network configuration
 */
export interface BitcoinNetworkConfig {
  /** Network name */
  network: EsploraNetwork;
  /** Esplora API base URL */
  esploraUrl: string;
  /** WebSocket URL for mempool.space */
  wsUrl?: string;
  /** Required confirmations for deposits */
  requiredConfirmations: number;
}
