/**
 * Yield Pool (zkEarn) Subpath
 *
 * Privacy-preserving yield pool using stealth addresses.
 */

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
} from "../yield-pool";
