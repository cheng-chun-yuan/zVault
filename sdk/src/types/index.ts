/**
 * ZVault SDK Types
 *
 * Centralized type definitions for the zVault SDK.
 * Re-exports all types from individual modules.
 *
 * @module types
 */

// =============================================================================
// Configuration Types
// =============================================================================

export type {
  ZVaultSDKConfig,
  ResolvedConfig,
  NetworkConfig,
  NetworkType,
  BitcoinNetwork,
  VKHashes,
} from "./config";

// =============================================================================
// Note Types
// =============================================================================

export type {
  Note,
  SerializedNote,
  NoteData,
  StealthNote,
  SerializedStealthNote,
} from "./note";

// =============================================================================
// Key Types
// =============================================================================

export type {
  ZVaultKeys,
  StealthMetaAddress,
  SerializedStealthMetaAddress,
  DelegatedViewKey,
  WalletSignerAdapter,
  ViewOnlyKeyBundle,
} from "./keys";

export { ViewPermissions } from "./keys";

// =============================================================================
// Stealth Types
// =============================================================================

export type {
  StealthDeposit,
  ScannedNote,
  StealthClaimInputs,
  OnChainStealthAnnouncement,
  ViewOnlyKeys,
  ViewOnlyScannedNote,
  StealthOutputData,
  StealthOutputWithKeys,
  CircuitStealthOutput,
} from "../stealth/index";

// =============================================================================
// Pool Types
// =============================================================================

export type {
  PoolOperationStep,
  PoolOperationStatus,
  PoolOperationProgressCallback,
  StealthPoolPosition,
  ScannedPoolPosition,
  StealthPoolClaimInputs,
  SerializedStealthPoolPosition,
  YieldPoolConfig,
  DepositToPoolResult,
  WithdrawFromPoolResult,
  ClaimPoolYieldResult,
  CompoundYieldResult,
  OnChainStealthPoolAnnouncement,
  UnifiedCommitmentInput,
} from "./pool";

// =============================================================================
// Bitcoin Types
// =============================================================================

export type {
  EsploraTransaction,
  EsploraVin,
  EsploraVout,
  EsploraStatus,
  EsploraAddressInfo,
  EsploraUtxo,
  EsploraMerkleProof,
  EsploraNetwork,
  SPVProofData,
  BitcoinDeposit,
  BitcoinNetworkConfig,
} from "./bitcoin";

// =============================================================================
// Solana Types
// =============================================================================

export type {
  Instruction,
  ProofSource,
  ClaimInstructionOptions,
  SplitInstructionOptions,
  SpendPartialPublicInstructionOptions,
  PoolDepositInstructionOptions,
  PoolWithdrawInstructionOptions,
  PoolClaimYieldInstructionOptions,
  RedemptionRequestInstructionOptions,
} from "./solana";

export {
  INSTRUCTION_DISCRIMINATORS,
  VERIFIER_DISCRIMINATORS,
} from "./solana";

// =============================================================================
// Prover Types
// =============================================================================

export type {
  MerkleProofInput,
  ProofData,
  CircuitType,
  ClaimInputs,
  SpendSplitInputs,
  SpendPartialPublicInputs,
  PoolDepositInputs,
  PoolWithdrawInputs,
  PoolClaimYieldInputs,
} from "./prover";

// =============================================================================
// Merkle Types
// =============================================================================

export type {
  MerkleProof,
  NoirMerkleProof,
  OnChainMerkleProof,
  MerkleTreeConfig,
  CommitmentTreeState,
} from "./merkle";

// =============================================================================
// Watcher Types
// =============================================================================

export type {
  DepositStatus,
  PendingDeposit,
  WatcherCallbacks,
  StorageAdapter,
  WatcherConfig,
  SerializedDeposit,
  MempoolWsMessage,
  MempoolAddressTransaction,
} from "./watcher";
