/**
 * ZVault SDK v2.1
 *
 * Complete client library for interacting with the ZVault protocol.
 * Privacy-preserving BTC to Solana bridge using ZK proofs.
 *
 * Networks: Solana Devnet + Bitcoin Testnet3
 *
 * ## Instance-Based SDK (Recommended)
 *
 * ```typescript
 * import { createZVaultSDK } from "@zvault/sdk";
 *
 * const sdk = createZVaultSDK({
 *   programId: "YourProgramId...",
 *   network: "devnet",
 *   rpcUrl: "https://custom-rpc.example.com",
 * });
 *
 * const note = sdk.generateNote(100_000n);
 * const ix = sdk.instructions.claim({ ... });
 * ```
 *
 * ## Subpath Imports (for Tree-Shaking)
 *
 * ```typescript
 * import { generateClaimProof } from '@zvault/sdk/prover'
 * import { createStealthDeposit } from '@zvault/sdk/stealth'
 * import { deriveTaprootAddress } from '@zvault/sdk/bitcoin'
 * ```
 *
 * ## Legacy Quick Start (still supported)
 * ```typescript
 * import { depositToNote, claimNote, splitNote, formatBtc } from '@zvault/sdk';
 *
 * // 1. DEPOSIT: Generate credentials
 * const result = await depositToNote(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', result.taprootAddress);
 *
 * // 2. CLAIM: After BTC is confirmed
 * const claimed = await claimNote(config, result.claimLink);
 *
 * // 3. SPLIT: Divide into two outputs
 * const { output1, output2 } = await splitNote(config, result.note, 50_000n);
 * ```
 */

// ==========================================================================
// Instance-Based SDK (New API)
// ==========================================================================

export {
  createZVaultSDK,
  ZVaultSDK,
  InstructionBuilders,
  PDADerivation,
  ProverInterface,
  SDK_VERSION,
} from "./sdk";

export type {
  ZVaultSDKConfig,
  ResolvedConfig,
  NetworkConfig,
  NetworkType,
  BitcoinNetwork,
  VKHashes,
} from "./types/config";

// ==========================================================================
// Cryptographic utilities (from merged crypto.ts)
// ==========================================================================

export {
  // Field constants
  BN254_FIELD_PRIME,
  GRUMPKIN_FIELD_PRIME,
  GRUMPKIN_ORDER,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_INFINITY,
  // Byte conversion
  randomFieldElement,
  bigintToBytes,
  bytesToBigint,
  hexToBytes,
  bytesToHex,
  // Hashing
  sha256Hash,
  doubleSha256,
  taggedHash,
  // Grumpkin curve operations
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
  generateGrumpkinKeyPair,
  deriveGrumpkinKeyPairFromSeed,
  grumpkinEcdh,
  grumpkinEcdhSharedSecret,
  type GrumpkinPoint,
} from "./crypto";

// ==========================================================================
// Key derivation (Solana wallet -> spending/viewing keys)
// ==========================================================================

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

// ==========================================================================
// Poseidon hash utilities
// ==========================================================================

export {
  poseidonHash,
  poseidonHashSync,
  initPoseidon,
  computeUnifiedCommitment,
  computeNullifier,
  hashNullifier,
  computePoolCommitment,
  computeUnifiedCommitmentSync,
  computeNullifierSync,
  hashNullifierSync,
  computePoolCommitmentSync,
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
  getNotePublicKeyX,
  computeNoteCommitment,
  computeNoteNullifier,
  formatBtc,
  parseBtc,
  deriveNote,
  deriveNotes,
  deriveMasterKey,
  deriveNoteFromMaster,
  estimateSeedStrength,
  createNote,
  isPoseidonReady,
  prepareWithdrawal,
  createStealthNote,
  updateStealthNoteWithHashes,
  serializeStealthNote,
  deserializeStealthNote,
  stealthNoteHasComputedHashes,
  type Note,
  type SerializedNote,
  type NoteData,
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
// WASM Prover (Browser + Node.js)
// ==========================================================================

export {
  initProver,
  isProverAvailable,
  generateClaimProof,
  generateSpendSplitProof,
  generateSpendPartialPublicProof,
  generatePoolDepositProof,
  generatePoolWithdrawProof,
  generatePoolClaimYieldProof,
  verifyProof as verifyProofWasm,
  setCircuitPath,
  getCircuitPath,
  circuitExists,
  proofToBytes,
  cleanup as cleanupProver,
  type ProofData,
  type MerkleProofInput,
  type CircuitType,
  type ClaimInputs,
  type SpendSplitInputs,
  type SpendPartialPublicInputs,
  type PoolDepositInputs,
  type PoolWithdrawInputs,
  type PoolClaimYieldInputs,
} from "./prover/web";

// ==========================================================================
// ChadBuffer utilities (for large proof uploads)
// ==========================================================================

export {
  uploadTransactionToBuffer,
  uploadProofToBuffer,
  closeBuffer,
  readBufferData,
  fetchRawTransaction,
  fetchMerkleProof,
  prepareVerifyDeposit,
  buildMerkleProof,
  needsBuffer as bufferNeedsBuffer,
  getProofSource,
  calculateUploadTransactions,
  CHADBUFFER_PROGRAM_ID,
  AUTHORITY_SIZE,
  MAX_DATA_PER_WRITE,
  SOLANA_TX_SIZE_LIMIT,
  type ProofUploadResult,
} from "./chadbuffer";

// ==========================================================================
// Configuration
// ==========================================================================

export {
  getConfig,
  setConfig,
  createConfig,
  DEVNET_CONFIG,
  MAINNET_CONFIG,
  LOCALNET_CONFIG,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  DEPLOYMENT_INFO,
  // Note: SDK_VERSION, NetworkConfig, NetworkType are already exported from ./sdk and ./types/config
} from "./config";

// ==========================================================================
// PDA Derivation
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
// Stealth address utilities
// ==========================================================================

export {
  isWalletAdapter,
  createStealthDeposit,
  createStealthDepositWithKeys,
  createStealthOutput,
  createStealthOutputWithKeys,
  createStealthOutputForCommitment,
  packStealthOutputForCircuit,
  deriveStealthAnnouncementPda,
  scanAnnouncements,
  scanAnnouncementsViewOnly,
  exportViewOnlyKeys,
  prepareClaimInputs,
  parseStealthAnnouncement,
  announcementToScanFormat,
  scanByZkeyName,
  resolveZkeyName,
  encryptAmount,
  decryptAmount,
  computeNullifierHashForNote,
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  type StealthDeposit,
  type StealthOutputData,
  type StealthOutputWithKeys,
  type CircuitStealthOutput,
  type ScannedNote,
  type ClaimInputs as StealthClaimInputs,
  type OnChainStealthAnnouncement,
  type ConnectionAdapter,
  type ViewOnlyKeys,
  type ViewOnlyScannedNote,
} from "./stealth/index";

// ==========================================================================
// Direct stealth deposit (combined BTC deposit + stealth announcement)
// ==========================================================================

export {
  prepareStealthDeposit,
  buildStealthOpReturn,
  parseStealthOpReturn,
  verifyStealthDeposit,
  STEALTH_OP_RETURN_SIZE,
  VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR,
  type PreparedStealthDeposit,
  type StealthDepositData,
  type ParsedStealthOpReturn,
  type GrumpkinKeyPair,
} from "./stealth-deposit";

// ==========================================================================
// Simplified API
// ==========================================================================

export {
  depositToNote,
  claimNote,
  claimPublic,
  claimPublicStealth,
  splitNote,
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
// Core utilities
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

// Mempool.space client with SPV support
export {
  MempoolClient,
  mempoolTestnet,
  mempoolMainnet,
  reverseBytes,
  type BlockHeader,
  type TransactionInfo,
  type SPVProofData,
} from "./core/mempool";

// ==========================================================================
// Priority Fee Estimation
// ==========================================================================

export {
  estimatePriorityFee,
  buildPriorityFeeInstructionData,
  encodeSetComputeUnitLimit,
  encodeSetComputeUnitPrice,
  getHeliusRpcUrl,
  DEFAULT_COMPUTE_UNITS,
  DEFAULT_PRIORITY_FEE,
  COMPUTE_BUDGET_DISCRIMINATORS,
  type PriorityFeeConfig,
  type PriorityFeeEstimate,
  type PriorityFeeInstructions,
} from "./solana/priority-fee";

// ==========================================================================
// Connection Adapter Factory
// ==========================================================================

export {
  createFetchConnectionAdapter,
  createConnectionAdapterFromWeb3,
  createConnectionAdapterFromKit,
  getConnectionAdapter,
  clearConnectionAdapterCache,
  type RpcConfig,
  type Web3Connection,
  type KitRpc,
} from "./solana/connection";

// ==========================================================================
// Deposit Watcher
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
// React Hooks
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
  lookupZkeyName,
  lookupZkeyNameWithPDA,
  parseNameRegistry,
  reverseLookupZkeyName,
  deriveReverseRegistryPDA,
  parseReverseRegistry,
  isValidName,
  normalizeName,
  formatZkeyName,
  getNameValidationError,
  hashName,
  buildRegisterNameData,
  buildUpdateNameData,
  buildTransferNameData,
  MAX_NAME_LENGTH,
  NAME_REGISTRY_SEED,
  REVERSE_REGISTRY_SEED,
  NAME_REGISTRY_DISCRIMINATOR,
  REVERSE_REGISTRY_DISCRIMINATOR,
  NAME_REGISTRY_SIZE,
  REVERSE_REGISTRY_SIZE,
  type NameRegistryEntry,
  type ZkeyStealthAddress,
} from "./name-registry";

// ==========================================================================
// Commitment Tree
// ==========================================================================

export {
  COMMITMENT_TREE_DISCRIMINATOR,
  parseCommitmentTreeData,
  isValidRoot,
  fetchCommitmentTree,
  getCommitmentIndex,
  saveCommitmentIndex,
  CommitmentTreeIndex,
  // On-chain fetch functions (Helius-compatible)
  buildCommitmentTreeFromChain,
  getLeafIndexForCommitment,
  fetchMerkleProofForCommitment,
  getMerkleProofFromTree,
  type CommitmentTreeState,
  type RpcClient,
  type OnChainMerkleProof,
} from "./commitment-tree";

// ==========================================================================
// Yield Pool (zkEarn)
// ==========================================================================

export {
  createStealthPoolDeposit,
  createSelfStealthPoolDeposit,
  scanPoolAnnouncements,
  prepareStealthPoolClaimInputs,
  serializePoolPosition,
  deserializePoolPosition,
  calculateYield,
  calculateTotalValue,
  buildCreateYieldPoolData,
  buildDepositToPoolData,
  buildWithdrawFromPoolData,
  buildClaimPoolYieldData,
  buildCompoundYieldData,
  buildUpdateYieldRateData,
  buildHarvestYieldData,
  getYieldPoolPDASeeds,
  getPoolCommitmentTreePDASeeds,
  getPoolNullifierPDASeeds,
  getStealthPoolAnnouncementPDASeeds,
  parseYieldPool,
  parseStealthPoolAnnouncement,
  preparePoolDepositInputs,
  preparePoolWithdrawInputs,
  preparePoolClaimYieldInputs,
  formatYieldRate,
  formatBtcAmount,
  formatEpochDuration,
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
  type StealthPoolPosition,
  type ScannedPoolPosition,
  type StealthPoolClaimInputs,
  type SerializedStealthPoolPosition,
  type OnChainStealthPoolAnnouncement,
  type YieldPoolConfig,
  type DepositToPoolResult,
  type WithdrawFromPoolResult,
  type ClaimPoolYieldResult,
  type CompoundYieldResult,
  generateDepositProof as generatePoolDepositProofWithProgress,
  generateWithdrawProof as generatePoolWithdrawProofWithProgress,
  generateClaimYieldProof as generatePoolClaimYieldProofWithProgress,
  type PoolOperationStep,
  type PoolOperationStatus,
  type PoolOperationProgressCallback,
} from "./pool";

// ==========================================================================
// UltraHonk Browser Proof Generation
// ==========================================================================

export {
  generateUltraHonkProof,
  verifyUltraHonkProofLocal,
  initBbJs,
  isUltraHonkAvailable,
  loadCircuitArtifacts,
  getUltraHonkVerifierProgramId,
  buildVerifyInstructionData,
  createVerifyInstruction,
  proveAndBuildTransaction,
  type UltraHonkProofResult,
  type CircuitArtifacts,
  type UltraHonkCircuit,
} from "./ultrahonk";

// ==========================================================================
// Low-level Instruction Builders
// ==========================================================================

export {
  INSTRUCTION_DISCRIMINATORS,
  VERIFIER_DISCRIMINATORS,
  // Data builders (no config dependency)
  buildClaimInstructionData,
  buildSplitInstructionData,
  buildSpendPartialPublicInstructionData,
  buildRedemptionRequestInstructionData,
  buildPoolDepositInstructionData,
  buildPoolWithdrawInstructionData,
  buildPoolClaimYieldInstructionData,
  // Complete instruction builders (legacy - uses global config)
  buildClaimInstruction,
  buildSplitInstruction,
  buildSpendPartialPublicInstruction,
  buildRedemptionRequestInstruction,
  buildPoolDepositInstruction,
  buildPoolWithdrawInstruction,
  buildPoolClaimYieldInstruction,
  // Verifier instruction builders (for instruction introspection pattern)
  buildVerifyFromBufferInstruction,
  buildPartialPublicVerifierInputs,
  buildSplitVerifierInputs,
  // Utilities
  needsBuffer,
  calculateAvailableProofSpace,
  hexToBytes as instructionHexToBytes,
  bytesToHex as instructionBytesToHex,
  bigintTo32Bytes,
  bytes32ToBigint,
  addressToBytes,
  SYSTEM_PROGRAM_ADDRESS,
  INSTRUCTIONS_SYSVAR,
  type Instruction,
  type ProofSource,
  type ClaimInstructionOptions,
  type SplitInstructionOptions,
  type SpendPartialPublicInstructionOptions,
  type RedemptionRequestInstructionOptions,
  type PoolDepositInstructionOptions,
  type PoolWithdrawInstructionOptions,
  type PoolClaimYieldInstructionOptions,
} from "./instructions";

// ==========================================================================
// Proof Relay
// ==========================================================================

export {
  relaySpendPartialPublic,
  relaySpendSplit,
  createChadBuffer as relayCreateChadBuffer,
  uploadProofToBuffer as relayUploadProofToBuffer,
  closeChadBuffer as relayCloseChadBuffer,
  type RelaySpendPartialPublicParams,
  type RelaySpendSplitParams,
  type RelayResult,
} from "./relay";

// ==========================================================================
// Demo Instructions (devnet/localnet only)
// ==========================================================================

export {
  DEMO_INSTRUCTION,
  buildAddDemoStealthData,
  parseAddDemoStealthData,
} from "./demo";
