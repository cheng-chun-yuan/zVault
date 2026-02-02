/**
 * Stealth Address Module
 *
 * EIP-5564/DKSAP stealth address implementation for ZVault.
 * Provides privacy-preserving deposit and receiving functionality.
 *
 * Module Structure:
 * - types.ts: All interfaces and type definitions
 * - encryption.ts: Amount encryption/decryption helpers
 * - derivation.ts: Stealth key derivation functions
 * - parse.ts: On-chain parsing and circuit packing utilities
 * - pda.ts: PDA derivation helpers
 * - claim.ts: Claim preparation for ZK proofs
 * - scan.ts: Announcement scanning functions
 * - deposit.ts: Stealth deposit creation
 * - address.ts: Stealth meta-address utilities
 * - btc-deposit.ts: BTC stealth deposit (combined BTC + announcement)
 */

// ========== Types ==========
export {
  // Constants
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  // Deposit types
  type StealthDeposit,
  // Scanned note types
  type ScannedNote,
  type ViewOnlyScannedNote,
  // Claim types
  type ClaimInputs,
  type ClaimInputs as StealthClaimInputs,
  // On-chain types
  type OnChainStealthAnnouncement,
  // View-only keys
  type ViewOnlyKeys,
  // Stealth output types
  type StealthOutputData,
  type StealthOutputWithKeys,
  type CircuitStealthOutput,
  // Connection adapter
  type ConnectionAdapter,
  // Announcement format
  type AnnouncementScanFormat,
} from "./types";

// ========== Encryption ==========
export {
  encryptAmount,
  decryptAmount,
  deriveAmountEncryptionKey,
} from "./encryption";

// ========== Key Derivation ==========
export {
  deriveStealthScalar,
  deriveStealthPubKey,
  deriveStealthPrivKey,
} from "./derivation";

// ========== Parsing ==========
export {
  parseStealthAnnouncement,
  announcementToScanFormat,
  extractYSign,
  extractX,
  packEncryptedAmountWithSign,
  unpackEncryptedAmountWithSign,
  reconstructCompressedPub,
  packStealthOutputForCircuit,
} from "./parse";

// ========== PDA Derivation ==========
export {
  deriveStealthAnnouncementPda,
  deriveNullifierPda,
  deriveCommitmentPda,
  computeNullifierHash,
} from "./pda";

// ========== Claim Preparation ==========
export {
  prepareClaimInputs,
  computeNullifierHashForNote,
} from "./claim";

// ========== Scanning ==========
export {
  scanAnnouncements,
  scanAnnouncementsViewOnly,
  exportViewOnlyKeys,
  scanByZkeyName,
  resolveZkeyName,
} from "./scan";

// ========== Utilities ==========
export { isWalletAdapter } from "./utils";

// ========== Deposit Creation ==========
export {
  createStealthDeposit,
  createStealthDepositWithKeys,
  createStealthOutput,
  createStealthOutputWithKeys,
  createStealthOutputForCommitment,
} from "./deposit";

// ========== Stealth Meta-Address Utilities ==========
export {
  createStealthMetaAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
  parseStealthMetaAddress,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  type StealthMetaAddress,
  type SerializedStealthMetaAddress,
} from "./address";

// ========== BTC Stealth Deposit ==========
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
} from "./btc-deposit";
