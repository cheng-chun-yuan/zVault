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
  parseSats,
  type StealthDeposit,
  type ScannedNote,
  type ClaimInputs,
} from './stealth';

// Proof generation
export {
  isNoirAvailable,
  initializeCircuits,
  generateProof,
  verifyProof,
  generateClaimProof,
  generateSplitProof,
  generateWithdrawProof,
  requestBackendProof,
  CIRCUITS,
  type ProofInputs,
  type ProofResult,
} from './proof';
