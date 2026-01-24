"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.constantTimeCompare = exports.ViewPermissions = exports.hasPermission = exports.isDelegatedKeyValid = exports.deserializeDelegatedViewKey = exports.serializeDelegatedViewKey = exports.createDelegatedViewKey = exports.decodeStealthMetaAddress = exports.encodeStealthMetaAddress = exports.parseStealthMetaAddress = exports.deserializeStealthMetaAddress = exports.serializeStealthMetaAddress = exports.createStealthMetaAddress = exports.SPENDING_KEY_DERIVATION_MESSAGE = exports.deriveKeysFromSeed = exports.deriveKeysFromSignature = exports.deriveKeysFromWallet = exports.grumpkinEcdhSharedSecret = exports.grumpkinEcdh = exports.deriveGrumpkinKeyPairFromSeed = exports.generateGrumpkinKeyPair = exports.pubKeyFromBytes = exports.pubKeyToBytes = exports.pointFromCompressedBytes = exports.pointToCompressedBytes = exports.pointFromBytes = exports.pointToBytes = exports.scalarToBytes = exports.scalarFromBytes = exports.isInfinity = exports.isOnCurve = exports.pointNegate = exports.pointMul = exports.pointDouble = exports.pointAdd = exports.GRUMPKIN_INFINITY = exports.GRUMPKIN_GENERATOR = exports.GRUMPKIN_ORDER = exports.GRUMPKIN_FIELD_PRIME = exports.poseidonHash2 = exports.poseidonHash1 = exports.BN254_FIELD_PRIME = exports.taggedHash = exports.doubleSha256 = exports.sha256Hash = exports.bytesToHex = exports.hexToBytes = exports.bytesToBigint = exports.bigintToBytes = exports.randomFieldElement = void 0;
exports.noteV2HasComputedHashes = exports.deserializeNoteV2 = exports.serializeNoteV2 = exports.updateNoteV2WithHashes = exports.createNoteV2 = exports.prepareWithdrawal = exports.isPoseidonReady = exports.initPoseidon = exports.createNote = exports.computeNullifierHash = exports.computeCommitment = exports.estimateSeedStrength = exports.deriveNoteFromMaster = exports.deriveMasterKey = exports.deriveNotes = exports.deriveNote = exports.parseBtc = exports.formatBtc = exports.noteHasComputedHashes = exports.deserializeNote = exports.serializeNote = exports.updateNoteWithHashes = exports.createNoteFromSecrets = exports.generateNote = exports.NAME_REGEX = exports.MAX_NAME_LENGTH = exports.entryToStealthAddress = exports.parseNameEntry = exports.deriveNameRegistryPDA = exports.NAME_REGISTRY_SEED = exports.buildTransferNameData = exports.buildUpdateNameData = exports.buildRegisterNameData = exports.getNameValidationError = exports.formatZkeyName = exports.hashName = exports.normalizeName = exports.isValidName = exports.BN254_SCALAR_FIELD = exports.computeNullifierHashV1 = exports.computeCommitmentV1 = exports.hashNullifier = exports.computeNullifierV2 = exports.computeCommitmentV2 = exports.deriveNotePubKey = exports.poseidon2Hash = exports.extractViewOnlyBundle = exports.clearDelegatedViewKey = exports.clearZVaultKeys = exports.clearKey = void 0;
exports.buildMerkleProof = exports.deriveDepositRecordPDA = exports.deriveCommitmentTreePDA = exports.deriveBlockHeaderPDA = exports.deriveLightClientPDA = exports.derivePoolStatePDA = exports.verifyDeposit = exports.CHADBUFFER_PROGRAM_ID = exports.prepareVerifyDeposit = exports.fetchMerkleProof = exports.fetchRawTransaction = exports.readBufferData = exports.closeBuffer = exports.uploadTransactionToBuffer = exports.parseClaimUrl = exports.generateClaimUrl = exports.decodeClaimLink = exports.encodeClaimLink = exports.extractAmountFromClaimLink = exports.createProtectedClaimLink = exports.shortenClaimLink = exports.isValidClaimLinkFormat = exports.parseClaimLink = exports.createClaimLink = exports.createCustomInternalKey = exports.getInternalKey = exports.isValidBitcoinAddress = exports.parseP2TRScriptPubkey = exports.createP2TRScriptPubkey = exports.verifyTaprootAddress = exports.deriveTaprootAddress = exports.ZERO_VALUE = exports.MAX_LEAVES = exports.ROOT_HISTORY_SIZE = exports.TREE_DEPTH = exports.validateMerkleProofStructure = exports.pathIndicesToLeafIndex = exports.leafIndexToPathIndices = exports.createEmptyMerkleProof = exports.proofToOnChainFormat = exports.proofToNoirFormat = exports.createMerkleProofFromBigints = exports.createMerkleProof = exports.FIELD_MODULUS = exports.computeZeroHashes = exports.poseidon4 = exports.poseidon3 = exports.poseidon2 = exports.poseidon1 = exports.poseidon = void 0;
exports.useSingleDeposit = exports.useDepositWatcher = exports.setAsyncStorage = exports.createNativeWatcher = exports.NativeDepositWatcher = exports.createWebWatcher = exports.WebDepositWatcher = exports.BaseDepositWatcher = exports.generateDepositId = exports.deserializeDeposit = exports.serializeDeposit = exports.DEFAULT_WATCHER_CONFIG = exports.esploraMainnet = exports.esploraTestnet = exports.EsploraClient = exports.MockRecursiveProver = exports.HistoryManager = exports.VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = exports.STEALTH_OP_RETURN_SIZE = exports.STEALTH_OP_RETURN_VERSION = exports.STEALTH_OP_RETURN_MAGIC = exports.deriveStealthAnnouncementPDA = exports.verifyStealthDeposit = exports.parseStealthOpReturn = exports.buildStealthOpReturn = exports.prepareStealthDeposit = exports.STEALTH_ANNOUNCEMENT_DISCRIMINATOR = exports.STEALTH_ANNOUNCEMENT_SIZE = exports.announcementToScanFormat = exports.parseStealthAnnouncement = exports.prepareClaimInputs = exports.scanAnnouncements = exports.createStealthDeposit = exports.isWalletAdapter = void 0;
// Cryptographic utilities
var crypto_1 = require("./crypto");
Object.defineProperty(exports, "randomFieldElement", { enumerable: true, get: function () { return crypto_1.randomFieldElement; } });
Object.defineProperty(exports, "bigintToBytes", { enumerable: true, get: function () { return crypto_1.bigintToBytes; } });
Object.defineProperty(exports, "bytesToBigint", { enumerable: true, get: function () { return crypto_1.bytesToBigint; } });
Object.defineProperty(exports, "hexToBytes", { enumerable: true, get: function () { return crypto_1.hexToBytes; } });
Object.defineProperty(exports, "bytesToHex", { enumerable: true, get: function () { return crypto_1.bytesToHex; } });
Object.defineProperty(exports, "sha256Hash", { enumerable: true, get: function () { return crypto_1.sha256Hash; } });
Object.defineProperty(exports, "doubleSha256", { enumerable: true, get: function () { return crypto_1.doubleSha256; } });
Object.defineProperty(exports, "taggedHash", { enumerable: true, get: function () { return crypto_1.taggedHash; } });
Object.defineProperty(exports, "BN254_FIELD_PRIME", { enumerable: true, get: function () { return crypto_1.BN254_FIELD_PRIME; } });
// Legacy exports (throw errors directing to Noir)
Object.defineProperty(exports, "poseidonHash1", { enumerable: true, get: function () { return crypto_1.poseidonHash1; } });
Object.defineProperty(exports, "poseidonHash2", { enumerable: true, get: function () { return crypto_1.poseidonHash2; } });
// Grumpkin curve operations (Noir's embedded curve for efficient in-circuit ECDH)
var grumpkin_1 = require("./grumpkin");
// Constants
Object.defineProperty(exports, "GRUMPKIN_FIELD_PRIME", { enumerable: true, get: function () { return grumpkin_1.GRUMPKIN_FIELD_PRIME; } });
Object.defineProperty(exports, "GRUMPKIN_ORDER", { enumerable: true, get: function () { return grumpkin_1.GRUMPKIN_ORDER; } });
Object.defineProperty(exports, "GRUMPKIN_GENERATOR", { enumerable: true, get: function () { return grumpkin_1.GRUMPKIN_GENERATOR; } });
Object.defineProperty(exports, "GRUMPKIN_INFINITY", { enumerable: true, get: function () { return grumpkin_1.GRUMPKIN_INFINITY; } });
// Point operations
Object.defineProperty(exports, "pointAdd", { enumerable: true, get: function () { return grumpkin_1.pointAdd; } });
Object.defineProperty(exports, "pointDouble", { enumerable: true, get: function () { return grumpkin_1.pointDouble; } });
Object.defineProperty(exports, "pointMul", { enumerable: true, get: function () { return grumpkin_1.pointMul; } });
Object.defineProperty(exports, "pointNegate", { enumerable: true, get: function () { return grumpkin_1.pointNegate; } });
Object.defineProperty(exports, "isOnCurve", { enumerable: true, get: function () { return grumpkin_1.isOnCurve; } });
Object.defineProperty(exports, "isInfinity", { enumerable: true, get: function () { return grumpkin_1.isInfinity; } });
// Serialization
Object.defineProperty(exports, "scalarFromBytes", { enumerable: true, get: function () { return grumpkin_1.scalarFromBytes; } });
Object.defineProperty(exports, "scalarToBytes", { enumerable: true, get: function () { return grumpkin_1.scalarToBytes; } });
Object.defineProperty(exports, "pointToBytes", { enumerable: true, get: function () { return grumpkin_1.pointToBytes; } });
Object.defineProperty(exports, "pointFromBytes", { enumerable: true, get: function () { return grumpkin_1.pointFromBytes; } });
Object.defineProperty(exports, "pointToCompressedBytes", { enumerable: true, get: function () { return grumpkin_1.pointToCompressedBytes; } });
Object.defineProperty(exports, "pointFromCompressedBytes", { enumerable: true, get: function () { return grumpkin_1.pointFromCompressedBytes; } });
Object.defineProperty(exports, "pubKeyToBytes", { enumerable: true, get: function () { return grumpkin_1.pubKeyToBytes; } });
Object.defineProperty(exports, "pubKeyFromBytes", { enumerable: true, get: function () { return grumpkin_1.pubKeyFromBytes; } });
// Key generation
Object.defineProperty(exports, "generateGrumpkinKeyPair", { enumerable: true, get: function () { return grumpkin_1.generateKeyPair; } });
Object.defineProperty(exports, "deriveGrumpkinKeyPairFromSeed", { enumerable: true, get: function () { return grumpkin_1.deriveKeyPairFromSeed; } });
// ECDH
Object.defineProperty(exports, "grumpkinEcdh", { enumerable: true, get: function () { return grumpkin_1.ecdh; } });
Object.defineProperty(exports, "grumpkinEcdhSharedSecret", { enumerable: true, get: function () { return grumpkin_1.ecdhSharedSecret; } });
// RAILGUN-style key derivation (Solana wallet → spending/viewing keys)
var keys_1 = require("./keys");
// Key derivation
Object.defineProperty(exports, "deriveKeysFromWallet", { enumerable: true, get: function () { return keys_1.deriveKeysFromWallet; } });
Object.defineProperty(exports, "deriveKeysFromSignature", { enumerable: true, get: function () { return keys_1.deriveKeysFromSignature; } });
Object.defineProperty(exports, "deriveKeysFromSeed", { enumerable: true, get: function () { return keys_1.deriveKeysFromSeed; } });
Object.defineProperty(exports, "SPENDING_KEY_DERIVATION_MESSAGE", { enumerable: true, get: function () { return keys_1.SPENDING_KEY_DERIVATION_MESSAGE; } });
// Stealth meta-address
Object.defineProperty(exports, "createStealthMetaAddress", { enumerable: true, get: function () { return keys_1.createStealthMetaAddress; } });
Object.defineProperty(exports, "serializeStealthMetaAddress", { enumerable: true, get: function () { return keys_1.serializeStealthMetaAddress; } });
Object.defineProperty(exports, "deserializeStealthMetaAddress", { enumerable: true, get: function () { return keys_1.deserializeStealthMetaAddress; } });
Object.defineProperty(exports, "parseStealthMetaAddress", { enumerable: true, get: function () { return keys_1.parseStealthMetaAddress; } });
Object.defineProperty(exports, "encodeStealthMetaAddress", { enumerable: true, get: function () { return keys_1.encodeStealthMetaAddress; } });
Object.defineProperty(exports, "decodeStealthMetaAddress", { enumerable: true, get: function () { return keys_1.decodeStealthMetaAddress; } });
// Viewing key delegation
Object.defineProperty(exports, "createDelegatedViewKey", { enumerable: true, get: function () { return keys_1.createDelegatedViewKey; } });
Object.defineProperty(exports, "serializeDelegatedViewKey", { enumerable: true, get: function () { return keys_1.serializeDelegatedViewKey; } });
Object.defineProperty(exports, "deserializeDelegatedViewKey", { enumerable: true, get: function () { return keys_1.deserializeDelegatedViewKey; } });
Object.defineProperty(exports, "isDelegatedKeyValid", { enumerable: true, get: function () { return keys_1.isDelegatedKeyValid; } });
Object.defineProperty(exports, "hasPermission", { enumerable: true, get: function () { return keys_1.hasPermission; } });
Object.defineProperty(exports, "ViewPermissions", { enumerable: true, get: function () { return keys_1.ViewPermissions; } });
// Key security
Object.defineProperty(exports, "constantTimeCompare", { enumerable: true, get: function () { return keys_1.constantTimeCompare; } });
Object.defineProperty(exports, "clearKey", { enumerable: true, get: function () { return keys_1.clearKey; } });
Object.defineProperty(exports, "clearZVaultKeys", { enumerable: true, get: function () { return keys_1.clearZVaultKeys; } });
Object.defineProperty(exports, "clearDelegatedViewKey", { enumerable: true, get: function () { return keys_1.clearDelegatedViewKey; } });
Object.defineProperty(exports, "extractViewOnlyBundle", { enumerable: true, get: function () { return keys_1.extractViewOnlyBundle; } });
// Poseidon2 hash utilities (matches Noir circuits)
var poseidon2_1 = require("./poseidon2");
Object.defineProperty(exports, "poseidon2Hash", { enumerable: true, get: function () { return poseidon2_1.poseidon2Hash; } });
Object.defineProperty(exports, "deriveNotePubKey", { enumerable: true, get: function () { return poseidon2_1.deriveNotePubKey; } });
Object.defineProperty(exports, "computeCommitmentV2", { enumerable: true, get: function () { return poseidon2_1.computeCommitmentV2; } });
Object.defineProperty(exports, "computeNullifierV2", { enumerable: true, get: function () { return poseidon2_1.computeNullifierV2; } });
Object.defineProperty(exports, "hashNullifier", { enumerable: true, get: function () { return poseidon2_1.hashNullifier; } });
Object.defineProperty(exports, "computeCommitmentV1", { enumerable: true, get: function () { return poseidon2_1.computeCommitmentV1; } });
Object.defineProperty(exports, "computeNullifierHashV1", { enumerable: true, get: function () { return poseidon2_1.computeNullifierHashV1; } });
Object.defineProperty(exports, "BN254_SCALAR_FIELD", { enumerable: true, get: function () { return poseidon2_1.BN254_SCALAR_FIELD; } });
// Optional .zkey name registry
var name_registry_1 = require("./name-registry");
// Name utilities
Object.defineProperty(exports, "isValidName", { enumerable: true, get: function () { return name_registry_1.isValidName; } });
Object.defineProperty(exports, "normalizeName", { enumerable: true, get: function () { return name_registry_1.normalizeName; } });
Object.defineProperty(exports, "hashName", { enumerable: true, get: function () { return name_registry_1.hashName; } });
Object.defineProperty(exports, "formatZkeyName", { enumerable: true, get: function () { return name_registry_1.formatZkeyName; } });
Object.defineProperty(exports, "getNameValidationError", { enumerable: true, get: function () { return name_registry_1.getNameValidationError; } });
// Instruction builders
Object.defineProperty(exports, "buildRegisterNameData", { enumerable: true, get: function () { return name_registry_1.buildRegisterNameData; } });
Object.defineProperty(exports, "buildUpdateNameData", { enumerable: true, get: function () { return name_registry_1.buildUpdateNameData; } });
Object.defineProperty(exports, "buildTransferNameData", { enumerable: true, get: function () { return name_registry_1.buildTransferNameData; } });
// PDA derivation
Object.defineProperty(exports, "NAME_REGISTRY_SEED", { enumerable: true, get: function () { return name_registry_1.NAME_REGISTRY_SEED; } });
Object.defineProperty(exports, "deriveNameRegistryPDA", { enumerable: true, get: function () { return name_registry_1.deriveNameRegistryPDA; } });
// Parsing
Object.defineProperty(exports, "parseNameEntry", { enumerable: true, get: function () { return name_registry_1.parseNameEntry; } });
Object.defineProperty(exports, "entryToStealthAddress", { enumerable: true, get: function () { return name_registry_1.entryToStealthAddress; } });
// Constants
Object.defineProperty(exports, "MAX_NAME_LENGTH", { enumerable: true, get: function () { return name_registry_1.MAX_NAME_LENGTH; } });
Object.defineProperty(exports, "NAME_REGEX", { enumerable: true, get: function () { return name_registry_1.NAME_REGEX; } });
// Note (shielded commitment) utilities
var note_1 = require("./note");
Object.defineProperty(exports, "generateNote", { enumerable: true, get: function () { return note_1.generateNote; } });
Object.defineProperty(exports, "createNoteFromSecrets", { enumerable: true, get: function () { return note_1.createNoteFromSecrets; } });
Object.defineProperty(exports, "updateNoteWithHashes", { enumerable: true, get: function () { return note_1.updateNoteWithHashes; } });
Object.defineProperty(exports, "serializeNote", { enumerable: true, get: function () { return note_1.serializeNote; } });
Object.defineProperty(exports, "deserializeNote", { enumerable: true, get: function () { return note_1.deserializeNote; } });
Object.defineProperty(exports, "noteHasComputedHashes", { enumerable: true, get: function () { return note_1.noteHasComputedHashes; } });
Object.defineProperty(exports, "formatBtc", { enumerable: true, get: function () { return note_1.formatBtc; } });
Object.defineProperty(exports, "parseBtc", { enumerable: true, get: function () { return note_1.parseBtc; } });
// Deterministic derivation (HD-style)
Object.defineProperty(exports, "deriveNote", { enumerable: true, get: function () { return note_1.deriveNote; } });
Object.defineProperty(exports, "deriveNotes", { enumerable: true, get: function () { return note_1.deriveNotes; } });
Object.defineProperty(exports, "deriveMasterKey", { enumerable: true, get: function () { return note_1.deriveMasterKey; } });
Object.defineProperty(exports, "deriveNoteFromMaster", { enumerable: true, get: function () { return note_1.deriveNoteFromMaster; } });
Object.defineProperty(exports, "estimateSeedStrength", { enumerable: true, get: function () { return note_1.estimateSeedStrength; } });
// Poseidon-based commitment computation (browser compatible)
Object.defineProperty(exports, "computeCommitment", { enumerable: true, get: function () { return note_1.computeCommitment; } });
Object.defineProperty(exports, "computeNullifierHash", { enumerable: true, get: function () { return note_1.computeNullifierHash; } });
Object.defineProperty(exports, "createNote", { enumerable: true, get: function () { return note_1.createNote; } });
Object.defineProperty(exports, "initPoseidon", { enumerable: true, get: function () { return note_1.initPoseidon; } });
Object.defineProperty(exports, "isPoseidonReady", { enumerable: true, get: function () { return note_1.isPoseidonReady; } });
Object.defineProperty(exports, "prepareWithdrawal", { enumerable: true, get: function () { return note_1.prepareWithdrawal; } });
// V2 Note types (dual-key ECDH support)
Object.defineProperty(exports, "createNoteV2", { enumerable: true, get: function () { return note_1.createNoteV2; } });
Object.defineProperty(exports, "updateNoteV2WithHashes", { enumerable: true, get: function () { return note_1.updateNoteV2WithHashes; } });
Object.defineProperty(exports, "serializeNoteV2", { enumerable: true, get: function () { return note_1.serializeNoteV2; } });
Object.defineProperty(exports, "deserializeNoteV2", { enumerable: true, get: function () { return note_1.deserializeNoteV2; } });
Object.defineProperty(exports, "noteV2HasComputedHashes", { enumerable: true, get: function () { return note_1.noteV2HasComputedHashes; } });
// Poseidon hash utilities (browser compatible via circomlibjs)
var poseidon_1 = require("./poseidon");
Object.defineProperty(exports, "poseidon", { enumerable: true, get: function () { return poseidon_1.poseidon; } });
Object.defineProperty(exports, "poseidon1", { enumerable: true, get: function () { return poseidon_1.poseidon1; } });
Object.defineProperty(exports, "poseidon2", { enumerable: true, get: function () { return poseidon_1.poseidon2; } });
Object.defineProperty(exports, "poseidon3", { enumerable: true, get: function () { return poseidon_1.poseidon3; } });
Object.defineProperty(exports, "poseidon4", { enumerable: true, get: function () { return poseidon_1.poseidon4; } });
Object.defineProperty(exports, "computeZeroHashes", { enumerable: true, get: function () { return poseidon_1.computeZeroHashes; } });
Object.defineProperty(exports, "FIELD_MODULUS", { enumerable: true, get: function () { return poseidon_1.FIELD_MODULUS; } });
// Merkle tree utilities
var merkle_1 = require("./merkle");
Object.defineProperty(exports, "createMerkleProof", { enumerable: true, get: function () { return merkle_1.createMerkleProof; } });
Object.defineProperty(exports, "createMerkleProofFromBigints", { enumerable: true, get: function () { return merkle_1.createMerkleProofFromBigints; } });
Object.defineProperty(exports, "proofToNoirFormat", { enumerable: true, get: function () { return merkle_1.proofToNoirFormat; } });
Object.defineProperty(exports, "proofToOnChainFormat", { enumerable: true, get: function () { return merkle_1.proofToOnChainFormat; } });
Object.defineProperty(exports, "createEmptyMerkleProof", { enumerable: true, get: function () { return merkle_1.createEmptyMerkleProof; } });
Object.defineProperty(exports, "leafIndexToPathIndices", { enumerable: true, get: function () { return merkle_1.leafIndexToPathIndices; } });
Object.defineProperty(exports, "pathIndicesToLeafIndex", { enumerable: true, get: function () { return merkle_1.pathIndicesToLeafIndex; } });
Object.defineProperty(exports, "validateMerkleProofStructure", { enumerable: true, get: function () { return merkle_1.validateMerkleProofStructure; } });
Object.defineProperty(exports, "TREE_DEPTH", { enumerable: true, get: function () { return merkle_1.TREE_DEPTH; } });
Object.defineProperty(exports, "ROOT_HISTORY_SIZE", { enumerable: true, get: function () { return merkle_1.ROOT_HISTORY_SIZE; } });
Object.defineProperty(exports, "MAX_LEAVES", { enumerable: true, get: function () { return merkle_1.MAX_LEAVES; } });
Object.defineProperty(exports, "ZERO_VALUE", { enumerable: true, get: function () { return merkle_1.ZERO_VALUE; } });
// Taproot address utilities
var taproot_1 = require("./taproot");
Object.defineProperty(exports, "deriveTaprootAddress", { enumerable: true, get: function () { return taproot_1.deriveTaprootAddress; } });
Object.defineProperty(exports, "verifyTaprootAddress", { enumerable: true, get: function () { return taproot_1.verifyTaprootAddress; } });
Object.defineProperty(exports, "createP2TRScriptPubkey", { enumerable: true, get: function () { return taproot_1.createP2TRScriptPubkey; } });
Object.defineProperty(exports, "parseP2TRScriptPubkey", { enumerable: true, get: function () { return taproot_1.parseP2TRScriptPubkey; } });
Object.defineProperty(exports, "isValidBitcoinAddress", { enumerable: true, get: function () { return taproot_1.isValidBitcoinAddress; } });
Object.defineProperty(exports, "getInternalKey", { enumerable: true, get: function () { return taproot_1.getInternalKey; } });
Object.defineProperty(exports, "createCustomInternalKey", { enumerable: true, get: function () { return taproot_1.createCustomInternalKey; } });
// Claim link utilities
var claim_link_1 = require("./claim-link");
Object.defineProperty(exports, "createClaimLink", { enumerable: true, get: function () { return claim_link_1.createClaimLink; } });
Object.defineProperty(exports, "parseClaimLink", { enumerable: true, get: function () { return claim_link_1.parseClaimLink; } });
Object.defineProperty(exports, "isValidClaimLinkFormat", { enumerable: true, get: function () { return claim_link_1.isValidClaimLinkFormat; } });
Object.defineProperty(exports, "shortenClaimLink", { enumerable: true, get: function () { return claim_link_1.shortenClaimLink; } });
Object.defineProperty(exports, "createProtectedClaimLink", { enumerable: true, get: function () { return claim_link_1.createProtectedClaimLink; } });
Object.defineProperty(exports, "extractAmountFromClaimLink", { enumerable: true, get: function () { return claim_link_1.extractAmountFromClaimLink; } });
// Simple claim link encoding (frontend compatible)
Object.defineProperty(exports, "encodeClaimLink", { enumerable: true, get: function () { return claim_link_1.encodeClaimLink; } });
Object.defineProperty(exports, "decodeClaimLink", { enumerable: true, get: function () { return claim_link_1.decodeClaimLink; } });
Object.defineProperty(exports, "generateClaimUrl", { enumerable: true, get: function () { return claim_link_1.generateClaimUrl; } });
Object.defineProperty(exports, "parseClaimUrl", { enumerable: true, get: function () { return claim_link_1.parseClaimUrl; } });
// ChadBuffer utilities (for SPV verification)
var chadbuffer_1 = require("./chadbuffer");
Object.defineProperty(exports, "uploadTransactionToBuffer", { enumerable: true, get: function () { return chadbuffer_1.uploadTransactionToBuffer; } });
Object.defineProperty(exports, "closeBuffer", { enumerable: true, get: function () { return chadbuffer_1.closeBuffer; } });
Object.defineProperty(exports, "readBufferData", { enumerable: true, get: function () { return chadbuffer_1.readBufferData; } });
Object.defineProperty(exports, "fetchRawTransaction", { enumerable: true, get: function () { return chadbuffer_1.fetchRawTransaction; } });
Object.defineProperty(exports, "fetchMerkleProof", { enumerable: true, get: function () { return chadbuffer_1.fetchMerkleProof; } });
Object.defineProperty(exports, "prepareVerifyDeposit", { enumerable: true, get: function () { return chadbuffer_1.prepareVerifyDeposit; } });
Object.defineProperty(exports, "CHADBUFFER_PROGRAM_ID", { enumerable: true, get: function () { return chadbuffer_1.CHADBUFFER_PROGRAM_ID; } });
// Verify deposit helpers
var verify_deposit_1 = require("./verify-deposit");
Object.defineProperty(exports, "verifyDeposit", { enumerable: true, get: function () { return verify_deposit_1.verifyDeposit; } });
Object.defineProperty(exports, "derivePoolStatePDA", { enumerable: true, get: function () { return verify_deposit_1.derivePoolStatePDA; } });
Object.defineProperty(exports, "deriveLightClientPDA", { enumerable: true, get: function () { return verify_deposit_1.deriveLightClientPDA; } });
Object.defineProperty(exports, "deriveBlockHeaderPDA", { enumerable: true, get: function () { return verify_deposit_1.deriveBlockHeaderPDA; } });
Object.defineProperty(exports, "deriveCommitmentTreePDA", { enumerable: true, get: function () { return verify_deposit_1.deriveCommitmentTreePDA; } });
Object.defineProperty(exports, "deriveDepositRecordPDA", { enumerable: true, get: function () { return verify_deposit_1.deriveDepositRecordPDA; } });
Object.defineProperty(exports, "buildMerkleProof", { enumerable: true, get: function () { return verify_deposit_1.buildMerkleProof; } });
// Stealth address utilities (Dual-key ECDH: X25519 viewing + Grumpkin spending)
var stealth_1 = require("./stealth");
// Type guard
Object.defineProperty(exports, "isWalletAdapter", { enumerable: true, get: function () { return stealth_1.isWalletAdapter; } });
// Core functions (accept wallet adapter OR ZVaultKeys)
Object.defineProperty(exports, "createStealthDeposit", { enumerable: true, get: function () { return stealth_1.createStealthDeposit; } });
Object.defineProperty(exports, "scanAnnouncements", { enumerable: true, get: function () { return stealth_1.scanAnnouncements; } });
Object.defineProperty(exports, "prepareClaimInputs", { enumerable: true, get: function () { return stealth_1.prepareClaimInputs; } });
// On-chain announcement parsing
Object.defineProperty(exports, "parseStealthAnnouncement", { enumerable: true, get: function () { return stealth_1.parseStealthAnnouncement; } });
Object.defineProperty(exports, "announcementToScanFormat", { enumerable: true, get: function () { return stealth_1.announcementToScanFormat; } });
// Constants
Object.defineProperty(exports, "STEALTH_ANNOUNCEMENT_SIZE", { enumerable: true, get: function () { return stealth_1.STEALTH_ANNOUNCEMENT_SIZE; } });
Object.defineProperty(exports, "STEALTH_ANNOUNCEMENT_DISCRIMINATOR", { enumerable: true, get: function () { return stealth_1.STEALTH_ANNOUNCEMENT_DISCRIMINATOR; } });
// Direct stealth deposit (combined BTC deposit + stealth announcement)
var stealth_deposit_1 = require("./stealth-deposit");
// Sender functions
Object.defineProperty(exports, "prepareStealthDeposit", { enumerable: true, get: function () { return stealth_deposit_1.prepareStealthDeposit; } });
Object.defineProperty(exports, "buildStealthOpReturn", { enumerable: true, get: function () { return stealth_deposit_1.buildStealthOpReturn; } });
Object.defineProperty(exports, "parseStealthOpReturn", { enumerable: true, get: function () { return stealth_deposit_1.parseStealthOpReturn; } });
// On-chain verification
Object.defineProperty(exports, "verifyStealthDeposit", { enumerable: true, get: function () { return stealth_deposit_1.verifyStealthDeposit; } });
Object.defineProperty(exports, "deriveStealthAnnouncementPDA", { enumerable: true, get: function () { return stealth_deposit_1.deriveStealthAnnouncementPDA; } });
// Constants
Object.defineProperty(exports, "STEALTH_OP_RETURN_MAGIC", { enumerable: true, get: function () { return stealth_deposit_1.STEALTH_OP_RETURN_MAGIC; } });
Object.defineProperty(exports, "STEALTH_OP_RETURN_VERSION", { enumerable: true, get: function () { return stealth_deposit_1.STEALTH_OP_RETURN_VERSION; } });
Object.defineProperty(exports, "STEALTH_OP_RETURN_SIZE", { enumerable: true, get: function () { return stealth_deposit_1.STEALTH_OP_RETURN_SIZE; } });
Object.defineProperty(exports, "VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR", { enumerable: true, get: function () { return stealth_deposit_1.VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR; } });
// History / Audit utilities
var history_1 = require("./history");
Object.defineProperty(exports, "HistoryManager", { enumerable: true, get: function () { return history_1.HistoryManager; } });
Object.defineProperty(exports, "MockRecursiveProver", { enumerable: true, get: function () { return history_1.MockRecursiveProver; } });
// ==========================================================================
// Core utilities (Platform-agnostic)
// ==========================================================================
var esplora_1 = require("./core/esplora");
Object.defineProperty(exports, "EsploraClient", { enumerable: true, get: function () { return esplora_1.EsploraClient; } });
Object.defineProperty(exports, "esploraTestnet", { enumerable: true, get: function () { return esplora_1.esploraTestnet; } });
Object.defineProperty(exports, "esploraMainnet", { enumerable: true, get: function () { return esplora_1.esploraMainnet; } });
// ==========================================================================
// Deposit Watcher (Real-time BTC deposit tracking)
// ==========================================================================
var watcher_1 = require("./watcher");
Object.defineProperty(exports, "DEFAULT_WATCHER_CONFIG", { enumerable: true, get: function () { return watcher_1.DEFAULT_WATCHER_CONFIG; } });
Object.defineProperty(exports, "serializeDeposit", { enumerable: true, get: function () { return watcher_1.serializeDeposit; } });
Object.defineProperty(exports, "deserializeDeposit", { enumerable: true, get: function () { return watcher_1.deserializeDeposit; } });
Object.defineProperty(exports, "generateDepositId", { enumerable: true, get: function () { return watcher_1.generateDepositId; } });
// Base class
Object.defineProperty(exports, "BaseDepositWatcher", { enumerable: true, get: function () { return watcher_1.BaseDepositWatcher; } });
// Web implementation
Object.defineProperty(exports, "WebDepositWatcher", { enumerable: true, get: function () { return watcher_1.WebDepositWatcher; } });
Object.defineProperty(exports, "createWebWatcher", { enumerable: true, get: function () { return watcher_1.createWebWatcher; } });
// React Native implementation
Object.defineProperty(exports, "NativeDepositWatcher", { enumerable: true, get: function () { return watcher_1.NativeDepositWatcher; } });
Object.defineProperty(exports, "createNativeWatcher", { enumerable: true, get: function () { return watcher_1.createNativeWatcher; } });
Object.defineProperty(exports, "setAsyncStorage", { enumerable: true, get: function () { return watcher_1.setAsyncStorage; } });
// ==========================================================================
// React Hooks (Web + React Native)
// ==========================================================================
var react_1 = require("./react");
Object.defineProperty(exports, "useDepositWatcher", { enumerable: true, get: function () { return react_1.useDepositWatcher; } });
Object.defineProperty(exports, "useSingleDeposit", { enumerable: true, get: function () { return react_1.useSingleDeposit; } });
