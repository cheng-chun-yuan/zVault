/**
 * zVault Mobile Library
 *
 * Re-exports all mobile utilities.
 */

// Key management
export {
  generateMnemonic,
  generateMnemonic12,
  validateMnemonic,
  deriveKeysFromMnemonic,
  saveKeys,
  loadKeys,
  loadStealthMetaAddress,
  loadStealthMetaAddressEncoded,
  formatStealthAddress,
  type MobileKeys,
} from './keys';

// Storage
export {
  STORAGE_KEYS,
  checkBiometricSupport,
  authenticateBiometric,
  setSecureItem,
  getSecureItem,
  deleteSecureItem,
  setCachedItem,
  getCachedItem,
  deleteCachedItem,
  isWalletInitialized,
  clearAllData,
} from './storage';

// Stealth operations
export {
  createDeposit,
  scanForDeposits,
  prepareClaim,
  formatSats,
  formatBtc,
  parseSats,
  truncateHex,
  type StealthDeposit,
  type ScannedNote,
  type ClaimInputs,
} from './stealth';

// Proof generation
export {
  isNoirAvailable,
  initializeCircuits,
  areCircuitsAvailable,
  generateProof,
  verifyProof,
  generateClaimProof,
  generatePartialWithdrawProof,
  requestBackendProof,
  createEmptyMerkleProof,
  bigintToHex,
  numberToString,
  CIRCUITS,
  type ProofInputs,
  type ProofResult,
  type MerkleProof,
  type ClaimProofInput,
  type PartialWithdrawProofInput,
  type CircuitName,
} from './proof';
