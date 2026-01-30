/**
 * ZVault SDK
 *
 * Complete client library for interacting with the ZVault protocol.
 * Privacy-preserving BTC to Solana bridge using ZK proofs.
 *
 * Networks: Solana Devnet + Bitcoin Testnet3
 *
 * ## Function Categories
 *
 * ### DEPOSIT (BTC → zkBTC)
 * - **deposit**: Generate deposit credentials (taproot address + claim link)
 * - **claimNote**: Claim zkBTC tokens with ZK proof
 * - **claimPublic**: Claim zkBTC to public wallet (reveals amount)
 * - **claimPublicStealth**: Claim stealth note to public wallet
 *
 * ### TRANSFER (zkBTC → Someone)
 * - **splitNote**: Split one note into two outputs
 * - **createClaimLink**: Create shareable claim URL (off-chain)
 *
 * ### WITHDRAW (zkBTC → BTC)
 * - **withdraw**: Request BTC withdrawal (burn zkBTC)
 *
 * ## Quick Start
 * ```typescript
 * import { deposit, claimNote, claimPublic, splitNote, createClaimLink } from '@zvault/sdk';
 *
 * // 1. DEPOSIT: Generate credentials
 * const result = await deposit(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', result.taprootAddress);
 * console.log('Save this link:', result.claimLink);
 *
 * // 2. CLAIM: After BTC is confirmed
 * const claimed = await claimNote(config, result.claimLink);
 * // OR claim to public wallet:
 * const publicClaim = await claimPublic(config, result.claimLink);
 *
 * // 3. SPLIT: Divide into two outputs
 * const { output1, output2 } = await splitNote(config, result.note, 50_000n);
 *
 * // 4. SEND: Via claim link
 * const link = createClaimLink(output1);
 * ```
 */

// ==========================================================================
// Cryptographic utilities
// ==========================================================================

export {
  randomFieldElement,
  bigintToBytes,
  bytesToBigint,
  hexToBytes,
  bytesToHex,
  sha256Hash,
  doubleSha256,
  taggedHash,
  BN254_FIELD_PRIME,
} from "./crypto";

// Grumpkin curve operations (Noir's embedded curve for efficient in-circuit ECDH)
export {
  GRUMPKIN_FIELD_PRIME,
  GRUMPKIN_ORDER,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_INFINITY,
  pointAdd,
  pointDouble,
  pointMul,
  pointNegate,
  isOnCurve,
  isInfinity,
  scalarFromBytes,
  scalarToBytes,
  pointToBytes,
  pointFromBytes,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  pubKeyToBytes,
  pubKeyFromBytes,
  generateKeyPair as generateGrumpkinKeyPair,
  deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed,
  ecdh as grumpkinEcdh,
  ecdhSharedSecret as grumpkinEcdhSharedSecret,
  type GrumpkinPoint,
} from "./grumpkin";

// RAILGUN-style key derivation (Solana wallet -> spending/viewing keys)
export {
  deriveKeysFromWallet,
  deriveKeysFromSignature,
  deriveKeysFromSeed,
  SPENDING_KEY_DERIVATION_MESSAGE,
  createStealthMetaAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
  parseStealthMetaAddress,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  createDelegatedViewKey,
  serializeDelegatedViewKey,
  deserializeDelegatedViewKey,
  isDelegatedKeyValid,
  hasPermission,
  ViewPermissions,
  constantTimeCompare,
  clearKey,
  clearZVaultKeys,
  clearDelegatedViewKey,
  extractViewOnlyBundle,
  type ZVaultKeys,
  type StealthMetaAddress,
  type SerializedStealthMetaAddress,
  type DelegatedViewKey,
  type WalletSignerAdapter,
} from "./keys";

// Poseidon hash utilities (Circom-compatible - matches Noir + Solana)
export {
  poseidonHash,
  poseidonHashSync,
  initPoseidon,
  computeUnifiedCommitment,
  computeNullifier,
  hashNullifier,
  computePoolCommitment,
  BN254_SCALAR_FIELD,
} from "./poseidon";

// ==========================================================================
// Note (shielded commitment) utilities
// ==========================================================================

export {
  generateNote,
  createNoteFromSecrets,
  updateNoteWithHashes,
  serializeNote,
  deserializeNote,
  noteHasComputedHashes,
  formatBtc,
  parseBtc,
  // Deterministic derivation (HD-style)
  deriveNote,
  deriveNotes,
  deriveMasterKey,
  deriveNoteFromMaster,
  estimateSeedStrength,
  // Simple note creation
  createNote,
  isPoseidonReady,
  prepareWithdrawal,
  type Note,
  type SerializedNote,
  type NoteData,
  // Stealth note types (dual-key ECDH support)
  createStealthNote,
  updateStealthNoteWithHashes,
  serializeStealthNote,
  deserializeStealthNote,
  stealthNoteHasComputedHashes,
  type StealthNote,
  type SerializedStealthNote,
} from "./note";

// ==========================================================================
// Merkle tree utilities
// ==========================================================================

export {
  createMerkleProof,
  createMerkleProofFromBigints,
  proofToNoirFormat,
  proofToOnChainFormat,
  createEmptyMerkleProof,
  leafIndexToPathIndices,
  pathIndicesToLeafIndex,
  validateMerkleProofStructure,
  TREE_DEPTH,
  ROOT_HISTORY_SIZE,
  MAX_LEAVES,
  ZERO_VALUE,
  type MerkleProof,
} from "./merkle";

// ==========================================================================
// Taproot address utilities
// ==========================================================================

export {
  deriveTaprootAddress,
  verifyTaprootAddress,
  createP2TRScriptPubkey,
  parseP2TRScriptPubkey,
  isValidBitcoinAddress,
  getInternalKey,
  createCustomInternalKey,
} from "./taproot";

// ==========================================================================
// Claim link utilities
// ==========================================================================

export {
  createClaimLink,
  parseClaimLink,
  isValidClaimLinkFormat,
  shortenClaimLink,
  createProtectedClaimLink,
  extractAmountFromClaimLink,
  encodeClaimLink,
  decodeClaimLink,
  generateClaimUrl,
  parseClaimUrl,
  type ClaimLinkData,
} from "./claim-link";

// ==========================================================================
// ZK proof generation (Noir UltraHonk) - CLI/Node.js only
// ==========================================================================

export type { NoirProof } from "./proof";

// ==========================================================================
// WASM Prover (Browser + Node.js)
// ==========================================================================

export {
  initProver,
  isProverAvailable,
  // Unified Model proof generation
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,
  // Pool proof generation
  generatePoolDepositProof,
  generatePoolWithdrawProof,
  generatePoolClaimYieldProof,
  // Verification and utilities
  verifyProof as verifyProofWasm,
  setCircuitPath,
  getCircuitPath,
  circuitExists,
  proofToBytes,
  cleanup as cleanupProver,
  // Types
  type ProofData,
  type MerkleProofInput,
  type CircuitType,
  // Unified Model input types
  type ClaimInputs,
  type SpendSplitInputs,
  type SpendPartialPublicInputs,
  // Pool proof input types
  type PoolDepositInputs,
  type PoolWithdrawInputs,
  type PoolClaimYieldInputs,
} from "./prover";

// ==========================================================================
// ChadBuffer utilities (for large proof uploads)
// ==========================================================================

export {
  // Buffer upload operations
  uploadTransactionToBuffer,
  uploadProofToBuffer,
  closeBuffer,
  readBufferData,
  // Bitcoin SPV helpers
  fetchRawTransaction,
  fetchMerkleProof,
  prepareVerifyDeposit,
  buildMerkleProof,
  // Buffer utilities
  needsBuffer as bufferNeedsBuffer,
  getProofSource,
  calculateUploadTransactions,
  // Constants
  CHADBUFFER_PROGRAM_ID,
  AUTHORITY_SIZE,
  MAX_DATA_PER_WRITE,
  SOLANA_TX_SIZE_LIMIT,
  // Types
  type ProofUploadResult,
} from "./chadbuffer";

// ==========================================================================
// Configuration (SINGLE SOURCE OF TRUTH for addresses)
// ==========================================================================

export {
  // Network configuration
  getConfig,
  setConfig,
  createConfig,
  DEVNET_CONFIG,
  MAINNET_CONFIG,
  LOCALNET_CONFIG,
  // Program IDs
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  // Version info
  SDK_VERSION,
  DEPLOYMENT_INFO,
  // Types
  type NetworkConfig,
  type NetworkType,
} from "./config";

// ==========================================================================
// PDA Derivation (centralized module)
// ==========================================================================

export {
  ZVAULT_PROGRAM_ID,
  BTC_LIGHT_CLIENT_PROGRAM_ID,
  PDA_SEEDS,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveNullifierRecordPDA,
  deriveStealthAnnouncementPDA,
  deriveDepositRecordPDA,
  deriveLightClientPDA,
  deriveBlockHeaderPDA,
  deriveNameRegistryPDA,
  deriveYieldPoolPDA,
  derivePoolCommitmentTreePDA,
  derivePoolNullifierPDA,
  deriveStealthPoolAnnouncementPDA,
  commitmentToBytes,
} from "./pda";


// ==========================================================================
// Main SDK client types - Node.js only (requires proof generation)
// ==========================================================================

export type { DepositCredentials, ClaimResult, SplitResult } from "./zvault";

// ==========================================================================
// Stealth address utilities (EIP-5564/DKSAP single ephemeral key pattern)
// ==========================================================================

export {
  isWalletAdapter,
  createStealthDeposit,
  scanAnnouncements,
  scanAnnouncementsViewOnly,
  exportViewOnlyKeys,
  prepareClaimInputs,
  parseStealthAnnouncement,
  announcementToScanFormat,
  scanByZkeyName,
  resolveZkeyName,
  // Amount encryption (for advanced use cases)
  encryptAmount,
  decryptAmount,
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  type StealthDeposit,
  type ScannedNote,
  type ClaimInputs as StealthClaimInputs,
  type OnChainStealthAnnouncement,
  type ConnectionAdapter,
  type ViewOnlyKeys,
  type ViewOnlyScannedNote,
} from "./stealth";

// ==========================================================================
// Direct stealth deposit (combined BTC deposit + stealth announcement)
// ==========================================================================

export {
  prepareStealthDeposit,
  buildStealthOpReturn,
  parseStealthOpReturn,
  verifyStealthDeposit,
  // deriveStealthAnnouncementPDA exported from pda module
  STEALTH_OP_RETURN_SIZE,
  VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR,
  type PreparedStealthDeposit,
  type StealthDepositData,
  type ParsedStealthOpReturn,
  type GrumpkinKeyPair,
} from "./stealth-deposit";

// ==========================================================================
// Simplified API - Node.js only
// ==========================================================================
//
// DEPOSIT (BTC → zkBTC):
//   deposit, claimNote, claimPublic, claimPublicStealth
//
// TRANSFER (zkBTC → Someone):
//   splitNote
//
// WITHDRAW (zkBTC → BTC):
//   withdraw
//
// ==========================================================================

export {
  // Deposit functions
  depositToNote,
  claimNote,
  claimPublic,
  claimPublicStealth,
  // Transfer functions
  splitNote,
  // Withdraw function
  withdraw,
} from "./api";

export type {
  DepositResult,
  WithdrawResult,
  ClaimResult as ClaimNoteResult,
  ClaimPublicResult,
  ClaimPublicStealthResult,
  SplitResult as SplitNoteResult,
  ApiClientConfig,
} from "./api";

// ==========================================================================
// Core utilities (Platform-agnostic)
// ==========================================================================

export {
  EsploraClient,
  esploraTestnet,
  esploraMainnet,
  type EsploraTransaction,
  type EsploraVin,
  type EsploraVout,
  type EsploraStatus,
  type EsploraAddressInfo,
  type EsploraUtxo,
  type EsploraMerkleProof,
  type EsploraNetwork,
} from "./core/esplora";

// ==========================================================================
// Deposit Watcher (Real-time BTC deposit tracking)
// ==========================================================================

export {
  type DepositStatus,
  type PendingDeposit,
  type WatcherCallbacks,
  type WatcherConfig,
  type StorageAdapter,
  DEFAULT_WATCHER_CONFIG,
  serializeDeposit,
  deserializeDeposit,
  generateDepositId,
  BaseDepositWatcher,
  WebDepositWatcher,
  createWebWatcher,
  NativeDepositWatcher,
  createNativeWatcher,
  setAsyncStorage,
} from "./watcher";

// ==========================================================================
// React Hooks (Web + React Native)
// ==========================================================================

export {
  useDepositWatcher,
  useSingleDeposit,
  type UseDepositWatcherState,
  type UseDepositWatcherActions,
  type UseDepositWatcherReturn,
  type UseDepositWatcherOptions,
} from "./react";

// ==========================================================================
// Name Registry (.zkey.sol names)
// ==========================================================================

export {
  // Lookup functions
  lookupZkeyName,
  lookupZkeyNameWithPDA,
  parseNameRegistry,
  // Reverse lookup (SNS pattern)
  reverseLookupZkeyName,
  deriveReverseRegistryPDA,
  parseReverseRegistry,
  // Validation
  isValidName,
  normalizeName,
  formatZkeyName,
  getNameValidationError,
  hashName,
  // Instruction builders
  buildRegisterNameData,
  buildUpdateNameData,
  buildTransferNameData,
  // Constants
  MAX_NAME_LENGTH,
  NAME_REGISTRY_SEED,
  REVERSE_REGISTRY_SEED,
  NAME_REGISTRY_DISCRIMINATOR,
  REVERSE_REGISTRY_DISCRIMINATOR,
  NAME_REGISTRY_SIZE,
  REVERSE_REGISTRY_SIZE,
  // Types
  type NameRegistryEntry,
  type ZkeyStealthAddress,
} from "./name-registry";

// ==========================================================================
// Demo Instructions (Mock deposits for testing)
// ==========================================================================

export {
  // Instruction data builders
  buildAddDemoStealthData,
  buildAddDemoStealthDataFromParams,
  // PDA seed helpers
  getPoolStatePDASeeds,
  getCommitmentTreePDASeeds,
  getStealthAnnouncementPDASeeds,
  // Account meta helpers
  getDemoStealthAccountMetas,
  // Constants
  DEMO_INSTRUCTION,
  DEMO_SEEDS,
  // Types
  type AddDemoStealthParams,
  type PDASeed,
} from "./demo";

// ==========================================================================
// Commitment Tree (for merkle proof generation)
// ==========================================================================

export {
  // Note: TREE_DEPTH, ROOT_HISTORY_SIZE, MAX_LEAVES already exported from merkle.ts
  COMMITMENT_TREE_DISCRIMINATOR,
  parseCommitmentTreeData,
  isValidRoot,
  fetchCommitmentTree,
  getCommitmentIndex,
  saveCommitmentIndex,
  CommitmentTreeIndex,
  type CommitmentTreeState,
} from "./commitment-tree";

// ==========================================================================
// Yield Pool (zkEarn) - Stealth Address Based Privacy Yield
// ==========================================================================

export {
  // Stealth position creation
  createStealthPoolDeposit,
  createSelfStealthPoolDeposit,
  // Stealth position scanning (viewing key)
  scanPoolAnnouncements,
  // Claim preparation (spending key)
  prepareStealthPoolClaimInputs,
  // Position serialization
  serializePoolPosition,
  deserializePoolPosition,
  // Yield calculation
  calculateYield,
  calculateTotalValue,
  // Instruction data builders
  buildCreateYieldPoolData,
  buildDepositToPoolData,
  buildWithdrawFromPoolData,
  buildClaimPoolYieldData,
  buildCompoundYieldData,
  buildUpdateYieldRateData,
  buildHarvestYieldData,
  // PDA seeds
  getYieldPoolPDASeeds,
  getPoolCommitmentTreePDASeeds,
  getPoolNullifierPDASeeds,
  getStealthPoolAnnouncementPDASeeds,
  // Account parsing
  parseYieldPool,
  parseStealthPoolAnnouncement,
  // Circuit input preparation
  preparePoolDepositInputs,
  preparePoolWithdrawInputs,
  preparePoolClaimYieldInputs,
  // Formatting
  formatYieldRate,
  formatBtcAmount,
  formatEpochDuration,
  // Constants
  CREATE_YIELD_POOL_DISCRIMINATOR,
  DEPOSIT_TO_POOL_DISCRIMINATOR,
  WITHDRAW_FROM_POOL_DISCRIMINATOR,
  CLAIM_POOL_YIELD_DISCRIMINATOR,
  COMPOUND_YIELD_DISCRIMINATOR,
  UPDATE_YIELD_RATE_DISCRIMINATOR,
  HARVEST_YIELD_DISCRIMINATOR,
  YIELD_POOL_SEED,
  POOL_COMMITMENT_TREE_SEED,
  POOL_NULLIFIER_SEED,
  STEALTH_POOL_ANNOUNCEMENT_SEED,
  YIELD_POOL_DISCRIMINATOR,
  POOL_COMMITMENT_TREE_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_SIZE,
  // Stealth Types
  type StealthPoolPosition,
  type ScannedPoolPosition,
  type StealthPoolClaimInputs,
  type SerializedStealthPoolPosition,
  type OnChainStealthPoolAnnouncement,
  // Types
  type YieldPoolConfig,
  type DepositToPoolResult,
  type WithdrawFromPoolResult,
  type ClaimPoolYieldResult,
  type CompoundYieldResult,
  // High-level pool operations with proof generation
  generateDepositProof as generatePoolDepositProofWithProgress,
  generateWithdrawProof as generatePoolWithdrawProofWithProgress,
  generateClaimYieldProof as generatePoolClaimYieldProofWithProgress,
  // Operation status types
  type PoolOperationStep,
  type PoolOperationStatus,
  type PoolOperationProgressCallback,
} from "./yield-pool";

// ==========================================================================
// UltraHonk Browser Proof Generation (Client-Side Only)
// ==========================================================================

export {
  // Core proof generation
  generateUltraHonkProof,
  verifyUltraHonkProofLocal,
  // Initialization
  initBbJs,
  isUltraHonkAvailable,
  // Circuit loading
  loadCircuitArtifacts,
  // Solana instructions
  getUltraHonkVerifierProgramId,
  buildVerifyInstructionData,
  createVerifyInstruction,
  // High-level API
  proveAndBuildTransaction,
  // Types
  type UltraHonkProofResult,
  type CircuitArtifacts,
  type UltraHonkCircuit,
} from "./ultrahonk";

// ==========================================================================
// Low-level Instruction Builders (Buffer Mode Support)
// ==========================================================================

export {
  // Claim instruction (supports inline and buffer modes)
  buildClaimInstructionData,
  buildClaimInstruction,
  // Split instruction (supports inline and buffer modes)
  buildSplitInstructionData,
  buildSplitInstruction,
  // SpendPartialPublic instruction (supports inline and buffer modes)
  buildSpendPartialPublicInstructionData,
  buildSpendPartialPublicInstruction,
  // Pool deposit instruction (supports inline and buffer modes)
  buildPoolDepositInstructionData,
  buildPoolDepositInstruction,
  // Pool withdraw instruction (supports inline and buffer modes)
  buildPoolWithdrawInstructionData,
  buildPoolWithdrawInstruction,
  // Pool claim yield instruction (supports inline and buffer modes)
  buildPoolClaimYieldInstructionData,
  buildPoolClaimYieldInstruction,
  // Utilities
  needsBuffer,
  calculateAvailableProofSpace,
  hexToBytes as instructionHexToBytes,
  bytesToHex as instructionBytesToHex,
  // Types
  type Instruction,
  type ProofSource,
  type ClaimInstructionOptions,
  type SplitInstructionOptions,
  type SpendPartialPublicInstructionOptions,
  type PoolDepositInstructionOptions,
  type PoolWithdrawInstructionOptions,
  type PoolClaimYieldInstructionOptions,
} from "./instructions";

// ==========================================================================
// Proof Relay (Backend relayer for large UltraHonk proofs)
// ==========================================================================

export {
  // Main relay functions (one function does all: create buffer → upload → submit → close)
  relaySpendPartialPublic,
  relaySpendSplit,
  // Lower-level operations (for custom flows)
  createChadBuffer as relayCreateChadBuffer,
  uploadProofToBuffer as relayUploadProofToBuffer,
  closeChadBuffer as relayCLoseChadBuffer,
  // Types
  type RelaySpendPartialPublicParams,
  type RelaySpendSplitParams,
  type RelayResult,
} from "./relay";

