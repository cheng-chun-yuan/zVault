/**
 * ZVault SDK
 *
 * Complete client library for interacting with the ZVault protocol.
 * Privacy-preserving BTC to Solana bridge using ZK proofs.
 *
 * Networks: Solana Devnet + Bitcoin Testnet3
 *
 * ## 6 Main Functions
 * - **deposit**: Generate deposit credentials (taproot address + claim link)
 * - **withdraw**: Request BTC withdrawal (burn sbBTC)
 * - **privateClaim**: Claim sbBTC tokens with ZK proof
 * - **privateSplit**: Split one commitment into two outputs
 * - **sendLink**: Create global claim link (off-chain)
 * - **sendStealth**: Send to specific recipient via stealth ECDH
 *
 * ## Quick Start
 * ```typescript
 * import { createClient } from '@zvault/sdk';
 *
 * const client = createClient(connection);
 * client.setPayer(myKeypair);
 *
 * // 1. DEPOSIT: Generate credentials
 * const deposit = await client.deposit(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', deposit.taprootAddress);
 * console.log('Save this link:', deposit.claimLink);
 *
 * // 2. CLAIM: After BTC is confirmed
 * const result = await client.privateClaim(deposit.claimLink);
 *
 * // 3. SPLIT: Divide into two outputs
 * const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);
 *
 * // 4. SEND: Via link or stealth
 * const link = client.sendLink(output1);
 * await client.sendStealth(output2, recipientPubKey);
 * ```
 */

// Cryptographic utilities
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
  // Legacy exports (throw errors directing to Noir)
  poseidonHash1,
  poseidonHash2,
} from "./crypto";

// Grumpkin curve operations (Noir's embedded curve for efficient in-circuit ECDH)
export {
  // Constants
  GRUMPKIN_FIELD_PRIME,
  GRUMPKIN_ORDER,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_INFINITY,
  // Point operations
  pointAdd,
  pointDouble,
  pointMul,
  pointNegate,
  isOnCurve,
  isInfinity,
  // Serialization
  scalarFromBytes,
  scalarToBytes,
  pointToBytes,
  pointFromBytes,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  pubKeyToBytes,
  pubKeyFromBytes,
  // Key generation
  generateKeyPair as generateGrumpkinKeyPair,
  deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed,
  // ECDH
  ecdh as grumpkinEcdh,
  ecdhSharedSecret as grumpkinEcdhSharedSecret,
  // Types
  type GrumpkinPoint,
} from "./grumpkin";

// RAILGUN-style key derivation (Solana wallet → spending/viewing keys)
export {
  // Key derivation
  deriveKeysFromWallet,
  deriveKeysFromSignature,
  deriveKeysFromSeed,
  SPENDING_KEY_DERIVATION_MESSAGE,
  // Stealth meta-address
  createStealthMetaAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
  parseStealthMetaAddress,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  // Viewing key delegation
  createDelegatedViewKey,
  serializeDelegatedViewKey,
  deserializeDelegatedViewKey,
  isDelegatedKeyValid,
  hasPermission,
  ViewPermissions,
  // Key security
  constantTimeCompare,
  clearKey,
  clearZVaultKeys,
  clearDelegatedViewKey,
  extractViewOnlyBundle,
  // Types
  type ZVaultKeys,
  type StealthMetaAddress,
  type SerializedStealthMetaAddress,
  type DelegatedViewKey,
  type WalletSignerAdapter,
} from "./keys";

// Poseidon2 hash utilities (matches Noir circuits)
export {
  poseidon2Hash,
  deriveNotePubKey,
  computeCommitmentV2,
  computeNullifierV2,
  hashNullifier,
  computeCommitmentV1,
  computeNullifierHashV1,
  BN254_SCALAR_FIELD,
} from "./poseidon2";

// Optional .zkey name registry
export {
  // Name utilities
  isValidName,
  normalizeName,
  hashName,
  formatZkeyName,
  getNameValidationError,
  // Instruction builders
  buildRegisterNameData,
  buildUpdateNameData,
  buildTransferNameData,
  // PDA derivation
  NAME_REGISTRY_SEED,
  deriveNameRegistryPDA,
  // Parsing
  parseNameEntry,
  entryToStealthAddress,
  // Constants
  MAX_NAME_LENGTH,
  NAME_REGEX,
  // Types
  type NameEntry,
  type NameLookupResult,
} from "./name-registry";

// Note (shielded commitment) utilities
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
  // Poseidon-based commitment computation (browser compatible)
  computeCommitment,
  computeNullifierHash,
  createNote,
  initPoseidon,
  isPoseidonReady,
  prepareWithdrawal,
  type Note,
  type SerializedNote,
  type NoteData,
  // V2 Note types (dual-key ECDH support)
  createNoteV2,
  updateNoteV2WithHashes,
  serializeNoteV2,
  deserializeNoteV2,
  noteV2HasComputedHashes,
  type NoteV2,
  type SerializedNoteV2,
} from "./note";

// Poseidon hash utilities (browser compatible via circomlibjs)
export {
  poseidon,
  poseidon1,
  poseidon2,
  poseidon3,
  poseidon4,
  computeZeroHashes,
  FIELD_MODULUS,
} from "./poseidon";

// Merkle tree utilities
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

// Taproot address utilities
export {
  deriveTaprootAddress,
  verifyTaprootAddress,
  createP2TRScriptPubkey,
  parseP2TRScriptPubkey,
  isValidBitcoinAddress,
  getInternalKey,
  createCustomInternalKey,
} from "./taproot";

// Claim link utilities
export {
  createClaimLink,
  parseClaimLink,
  isValidClaimLinkFormat,
  shortenClaimLink,
  createProtectedClaimLink,
  extractAmountFromClaimLink,
  // Simple claim link encoding (frontend compatible)
  encodeClaimLink,
  decodeClaimLink,
  generateClaimUrl,
  parseClaimUrl,
  type ClaimLinkData,
} from "./claim-link";

// ZK proof generation (Noir UltraHonk) - Node.js only
// NOTE: Proof generation requires Node.js (child_process, fs)
// For browser: Use Noir/bb.js in your frontend code
// Import directly from '@zvault/sdk/dist/proof.js' if needed in Node.js
export type { NoirProof, CircuitType } from "./proof";

// ChadBuffer utilities (for SPV verification)
export {
  uploadTransactionToBuffer,
  closeBuffer,
  readBufferData,
  fetchRawTransaction,
  fetchMerkleProof,
  prepareVerifyDeposit,
  CHADBUFFER_PROGRAM_ID,
} from "./chadbuffer";

// Verify deposit helpers
export {
  verifyDeposit,
  derivePoolStatePDA,
  deriveLightClientPDA,
  deriveBlockHeaderPDA,
  deriveCommitmentTreePDA,
  deriveDepositRecordPDA,
  buildMerkleProof,
} from "./verify-deposit";

// Main SDK client - Node.js only (requires proof generation)
// NOTE: ZVaultClient requires Node.js for proof generation (child_process, fs)
// For browser: Use individual functions from this SDK + Noir/bb.js for proofs
// Import directly from '@zvault/sdk/dist/zvault.js' if needed in Node.js
export type { DepositCredentials, ClaimResult, SplitResult } from "./zvault";

// Stealth address utilities (Dual-key ECDH: X25519 viewing + Grumpkin spending)
export {
  // Type guard
  isWalletAdapter,
  // Core functions (accept wallet adapter OR ZVaultKeys)
  createStealthDeposit,
  scanAnnouncements,
  prepareClaimInputs,
  // On-chain announcement parsing
  parseStealthAnnouncement,
  announcementToScanFormat,
  // Constants
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  // Types
  type StealthDeposit,
  type ScannedNote,
  type ClaimInputs,
  type OnChainStealthAnnouncement,
} from "./stealth";

// Direct stealth deposit (combined BTC deposit + stealth announcement)
export {
  // Sender functions
  prepareStealthDeposit,
  buildStealthOpReturn,
  parseStealthOpReturn,
  // On-chain verification
  verifyStealthDeposit,
  deriveStealthAnnouncementPDA,
  // Constants
  STEALTH_OP_RETURN_MAGIC,
  STEALTH_OP_RETURN_VERSION,
  STEALTH_OP_RETURN_SIZE,
  VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR,
  // Types
  type PreparedStealthDeposit,
  type StealthDepositData,
  type ParsedStealthOpReturn,
} from "./stealth-deposit";

// History / Audit utilities
export {
  HistoryManager,
  MockRecursiveProver,
  type HistoryNode,
  type HistoryChain,
  type ProofAggregator,
  type OperationType,
} from "./history";

// ==========================================================================
// Simplified API (6 Main Functions) - Node.js only
// ==========================================================================

// NOTE: The API module requires Node.js for proof generation (child_process, fs)
// For browser: Use individual SDK functions + your own proof generation (Noir/bb.js)
// Import directly from '@zvault/sdk/dist/api.js' if needed in Node.js
export type {
  DepositResult,
  WithdrawResult,
  ClaimResult as ApiClaimResult,
  SplitResult as ApiSplitResult,
  StealthResult,
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
  // Types
  type DepositStatus,
  type PendingDeposit,
  type WatcherCallbacks,
  type WatcherConfig,
  type StorageAdapter,
  DEFAULT_WATCHER_CONFIG,
  serializeDeposit,
  deserializeDeposit,
  generateDepositId,
  // Base class
  BaseDepositWatcher,
  // Web implementation
  WebDepositWatcher,
  createWebWatcher,
  // React Native implementation
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
