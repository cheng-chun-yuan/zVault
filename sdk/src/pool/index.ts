/**
 * Yield Pool (zkEarn) Module
 *
 * Privacy-preserving yield pool using stealth addresses (EIP-5564/DKSAP pattern):
 * - Only publish ephemeral pubkey on-chain
 * - Viewing key can scan for positions (ECDH)
 * - Spending key required to claim/withdraw
 *
 * Position Commitment = Poseidon(stealthPub.x, principal, depositEpoch)
 *
 * Flow:
 * 1. Deposit: Generate ephemeral key, ECDH derive stealth key, create commitment
 * 2. Scan: Viewing key scans announcements via ECDH
 * 3. Claim/Withdraw: Spending key derives stealthPriv for ZK proof
 */

// ==========================================================================
// Types
// ==========================================================================
export type {
  // Operation status types
  PoolOperationStep,
  PoolOperationStatus,
  PoolOperationProgressCallback,
  // Position types
  StealthPoolPosition,
  ScannedPoolPosition,
  StealthPoolClaimInputs,
  SerializedStealthPoolPosition,
  // Configuration types
  YieldPoolConfig,
  // Result types
  DepositToPoolResult,
  WithdrawFromPoolResult,
  ClaimPoolYieldResult,
  CompoundYieldResult,
  // On-chain types
  OnChainStealthPoolAnnouncement,
  // Input types
  UnifiedCommitmentInput,
} from "./types";

// ==========================================================================
// Constants
// ==========================================================================
export {
  // Instruction discriminators
  CREATE_YIELD_POOL_DISCRIMINATOR,
  DEPOSIT_TO_POOL_DISCRIMINATOR,
  WITHDRAW_FROM_POOL_DISCRIMINATOR,
  CLAIM_POOL_YIELD_DISCRIMINATOR,
  COMPOUND_YIELD_DISCRIMINATOR,
  UPDATE_YIELD_RATE_DISCRIMINATOR,
  HARVEST_YIELD_DISCRIMINATOR,
  // PDA seeds
  YIELD_POOL_SEED,
  POOL_COMMITMENT_TREE_SEED,
  POOL_NULLIFIER_SEED,
  STEALTH_POOL_ANNOUNCEMENT_SEED,
  // Account discriminators
  YIELD_POOL_DISCRIMINATOR,
  POOL_COMMITMENT_TREE_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR,
  // Account sizes
  STEALTH_POOL_ANNOUNCEMENT_SIZE,
  // Domain separators
  STEALTH_KEY_DOMAIN,
} from "./constants";

// ==========================================================================
// PDA Derivation
// ==========================================================================
export {
  getYieldPoolPDASeeds,
  getPoolCommitmentTreePDASeeds,
  getPoolNullifierPDASeeds,
  getStealthPoolAnnouncementPDASeeds,
} from "./pda";

// ==========================================================================
// Stealth Key Derivation (Internal - exported for advanced use)
// ==========================================================================
export {
  deriveStealthScalar,
  deriveStealthPubKey,
  deriveStealthPrivKey,
} from "./stealth";

// ==========================================================================
// Deposit Functions
// ==========================================================================
export {
  createStealthPoolDeposit,
  createSelfStealthPoolDeposit,
} from "./deposit";

// ==========================================================================
// Withdraw Functions
// ==========================================================================
export {
  generateWithdrawProof,
  preparePoolWithdrawInputs,
  buildWithdrawFromPoolData,
} from "./withdraw";

// ==========================================================================
// Claim Yield Functions
// ==========================================================================
export {
  prepareStealthPoolClaimInputs,
  generateClaimYieldProof,
  preparePoolClaimYieldInputs,
  buildClaimPoolYieldData,
} from "./claim-yield";

// ==========================================================================
// Scanning Functions
// ==========================================================================
export { scanPoolAnnouncements } from "./scan";

// ==========================================================================
// Yield Calculation Functions
// ==========================================================================
export { calculateYield, calculateTotalValue } from "./yield";

// ==========================================================================
// Account Parsing Functions
// ==========================================================================
export { parseStealthPoolAnnouncement, parseYieldPool } from "./parse";

// ==========================================================================
// Position Management Functions
// ==========================================================================
export { serializePoolPosition, deserializePoolPosition } from "./position";

// ==========================================================================
// Instruction Data Builders
// ==========================================================================
export {
  buildCreateYieldPoolData,
  buildDepositToPoolData,
  buildCompoundYieldData,
  buildUpdateYieldRateData,
  buildHarvestYieldData,
  preparePoolDepositInputs,
} from "./instructions";

// ==========================================================================
// Proof Generation Functions
// ==========================================================================
export { generateDepositProof } from "./proof";

// Re-export with aliases for backward compatibility
export { generateDepositProof as generatePoolDepositProofWithProgress } from "./proof";
export { generateWithdrawProof as generatePoolWithdrawProofWithProgress } from "./withdraw";
export { generateClaimYieldProof as generatePoolClaimYieldProofWithProgress } from "./claim-yield";

// ==========================================================================
// Formatting Utilities
// ==========================================================================
export { formatYieldRate, formatBtcAmount, formatEpochDuration } from "./format";
