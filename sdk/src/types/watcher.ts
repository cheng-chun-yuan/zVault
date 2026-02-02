/**
 * Watcher Types
 *
 * Type definitions for deposit watching operations in zVault.
 *
 * @module types/watcher
 */

// ==========================================================================
// Deposit Status Types
// ==========================================================================

/**
 * Status of a pending deposit
 */
export type DepositStatus =
  | "waiting" // Waiting for BTC transaction
  | "detected" // Transaction detected in mempool
  | "confirming" // Transaction confirmed, waiting for more confirmations
  | "confirmed" // Required confirmations reached
  | "verifying" // Verifying on Solana
  | "verified" // Verified on Solana, ready to claim
  | "claimed" // zBTC claimed
  | "failed"; // Something went wrong

/**
 * A pending deposit being watched
 */
export interface PendingDeposit {
  /** Unique identifier */
  id: string;
  /** Bitcoin address to watch */
  taprootAddress: string;

  /** Hex-encoded nullifier */
  nullifier: string;
  /** Hex-encoded secret */
  secret: string;
  /** Expected amount in satoshis */
  amount: bigint;

  /** Claim link for sharing */
  claimLink: string;

  /** Current status */
  status: DepositStatus;
  /** Current confirmations */
  confirmations: number;
  /** Required confirmations */
  requiredConfirmations: number;

  /** Transaction ID (populated after detection) */
  txid?: string;
  /** Output index (populated after detection) */
  vout?: number;
  /** Actual amount received in satoshis (populated after detection) */
  detectedAmount?: number;
  /** Block height (populated after confirmation) */
  blockHeight?: number;
  /** Block hash (populated after confirmation) */
  blockHash?: string;

  /** Leaf index in Merkle tree (populated after verification) */
  leafIndex?: number;
  /** Hex-encoded commitment (populated after verification) */
  commitment?: string;

  /** Timestamps */
  createdAt: number;
  detectedAt?: number;
  confirmedAt?: number;
  verifiedAt?: number;
  claimedAt?: number;

  /** Error message (if status is "failed") */
  error?: string;
  /** Last error timestamp */
  lastErrorAt?: number;
}

// ==========================================================================
// Watcher Callbacks
// ==========================================================================

/**
 * Callbacks for deposit watcher events
 */
export interface WatcherCallbacks {
  /** Called when a transaction is first detected in mempool */
  onDetected?: (deposit: PendingDeposit) => void;

  /** Called on each confirmation update */
  onConfirming?: (deposit: PendingDeposit, confirmations: number) => void;

  /** Called when required confirmations are reached */
  onConfirmed?: (deposit: PendingDeposit) => void;

  /** Called when deposit is verified on Solana */
  onVerified?: (deposit: PendingDeposit) => void;

  /** Called when zBTC is claimed */
  onClaimed?: (deposit: PendingDeposit) => void;

  /** Called on any error */
  onError?: (deposit: PendingDeposit, error: Error) => void;

  /** Called on any status change */
  onStatusChange?: (
    deposit: PendingDeposit,
    oldStatus: DepositStatus,
    newStatus: DepositStatus
  ) => void;
}

// ==========================================================================
// Storage Adapter
// ==========================================================================

/**
 * Storage adapter interface for platform-specific storage
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// ==========================================================================
// Watcher Configuration
// ==========================================================================

/**
 * Configuration for the deposit watcher
 */
export interface WatcherConfig {
  /** Network for Esplora API */
  network?: "mainnet" | "testnet" | "testnet4" | "signet";

  /** Custom Esplora API URL (overrides network) */
  esploraUrl?: string;

  /** WebSocket URL for mempool.space */
  wsUrl?: string;

  /** Number of confirmations required (default: 6) */
  requiredConfirmations?: number;

  /** Polling interval for confirmation checks (ms, default: 30000) */
  confirmationPollInterval?: number;

  /** Storage key prefix (default: 'zkbtc_') */
  storageKeyPrefix?: string;

  /** Enable auto-verification on Solana when confirmed (default: true) */
  autoVerify?: boolean;

  /** Enable WebSocket for real-time transaction detection (default: true) */
  useWebSocket?: boolean;

  /** Polling interval when WebSocket is disabled (ms, default: 10000) */
  pollingInterval?: number;
}

// ==========================================================================
// Serialization Types
// ==========================================================================

/**
 * Serialized deposit for storage
 */
export interface SerializedDeposit {
  id: string;
  taprootAddress: string;
  nullifier: string;
  secret: string;
  amount: string; // bigint as string
  claimLink: string;
  status: DepositStatus;
  confirmations: number;
  requiredConfirmations: number;
  txid?: string;
  vout?: number;
  detectedAmount?: number;
  blockHeight?: number;
  blockHash?: string;
  leafIndex?: number;
  commitment?: string;
  createdAt: number;
  detectedAt?: number;
  confirmedAt?: number;
  verifiedAt?: number;
  claimedAt?: number;
  error?: string;
  lastErrorAt?: number;
}

// ==========================================================================
// WebSocket Types
// ==========================================================================

/**
 * WebSocket message types from mempool.space
 */
export interface MempoolWsMessage {
  "address-transactions"?: MempoolAddressTransaction[];
  "track-address"?: string;
  [key: string]: unknown;
}

/**
 * Mempool address transaction
 */
export interface MempoolAddressTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address?: string;
      value: number;
    } | null;
    scriptsig: string;
    scriptsig_asm: string;
    witness?: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}
