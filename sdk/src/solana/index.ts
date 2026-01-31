/**
 * Solana Subpath
 *
 * Solana-related utilities for ZVault:
 * - PDA derivation
 * - Instruction builders
 * - Network configuration
 * - ChadBuffer for large proof uploads
 */

// PDA derivation
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
} from "../pda";

// Instruction builders
export {
  INSTRUCTION_DISCRIMINATORS,
  buildClaimInstructionData,
  buildClaimInstruction,
  buildSplitInstructionData,
  buildSplitInstruction,
  buildSpendPartialPublicInstructionData,
  buildSpendPartialPublicInstruction,
  buildRedemptionRequestInstructionData,
  buildRedemptionRequestInstruction,
  buildPoolDepositInstructionData,
  buildPoolDepositInstruction,
  buildPoolWithdrawInstructionData,
  buildPoolWithdrawInstruction,
  buildPoolClaimYieldInstructionData,
  buildPoolClaimYieldInstruction,
  needsBuffer,
  calculateAvailableProofSpace,
  bigintTo32Bytes,
  bytes32ToBigint,
  type Instruction,
  type ProofSource,
  type ClaimInstructionOptions,
  type SplitInstructionOptions,
  type SpendPartialPublicInstructionOptions,
  type RedemptionRequestInstructionOptions,
  type PoolDepositInstructionOptions,
  type PoolWithdrawInstructionOptions,
  type PoolClaimYieldInstructionOptions,
} from "../instructions";

// Network configuration
export {
  getConfig,
  setConfig,
  createConfig,
  DEVNET_CONFIG,
  MAINNET_CONFIG,
  LOCALNET_CONFIG,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  SDK_VERSION,
  DEPLOYMENT_INFO,
  type NetworkConfig,
  type NetworkType,
} from "../config";

// ChadBuffer utilities (for large proof uploads)
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
} from "../chadbuffer";

// Commitment tree parsing
export {
  COMMITMENT_TREE_DISCRIMINATOR,
  parseCommitmentTreeData,
  isValidRoot,
  fetchCommitmentTree,
  getCommitmentIndex,
  saveCommitmentIndex,
  CommitmentTreeIndex,
  type CommitmentTreeState,
} from "../commitment-tree";

// Relay utilities
export {
  relaySpendPartialPublic,
  relaySpendSplit,
  createChadBuffer as relayCreateChadBuffer,
  uploadProofToBuffer as relayUploadProofToBuffer,
  closeChadBuffer as relayCloseChadBuffer,
  type RelaySpendPartialPublicParams,
  type RelaySpendSplitParams,
  type RelayResult,
} from "../relay";
