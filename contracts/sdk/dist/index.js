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
exports.deriveTaprootAddress = exports.ZERO_VALUE = exports.MAX_LEAVES = exports.ROOT_HISTORY_SIZE = exports.TREE_DEPTH = exports.validateMerkleProofStructure = exports.pathIndicesToLeafIndex = exports.leafIndexToPathIndices = exports.createEmptyMerkleProof = exports.proofToOnChainFormat = exports.proofToNoirFormat = exports.createMerkleProofFromBigints = exports.createMerkleProof = exports.FIELD_MODULUS = exports.computeZeroHashes = exports.poseidon4 = exports.poseidon3 = exports.poseidon2 = exports.poseidon1 = exports.poseidon = exports.prepareWithdrawal = exports.isPoseidonReady = exports.initPoseidon = exports.createNote = exports.computeNullifierHash = exports.computeCommitment = exports.estimateSeedStrength = exports.deriveNoteFromMaster = exports.deriveMasterKey = exports.deriveNotes = exports.deriveNote = exports.parseBtc = exports.formatBtc = exports.noteHasComputedHashes = exports.deserializeNote = exports.serializeNote = exports.updateNoteWithHashes = exports.createNoteFromSecrets = exports.generateNote = exports.poseidonHash2 = exports.poseidonHash1 = exports.BN254_FIELD_PRIME = exports.taggedHash = exports.doubleSha256 = exports.sha256Hash = exports.bytesToHex = exports.hexToBytes = exports.bytesToBigint = exports.bigintToBytes = exports.randomFieldElement = void 0;
exports.createWebWatcher = exports.WebDepositWatcher = exports.BaseDepositWatcher = exports.generateDepositId = exports.deserializeDeposit = exports.serializeDeposit = exports.DEFAULT_WATCHER_CONFIG = exports.esploraMainnet = exports.esploraTestnet = exports.EsploraClient = exports.MockRecursiveProver = exports.HistoryManager = exports.scanAnnouncementsWithSolana = exports.scanAnnouncements = exports.getStealthSharedSecret = exports.createStealthDepositForSolana = exports.createStealthDeposit = exports.generateStealthKeys = exports.solanaPubKeyToX25519 = exports.solanaKeyToX25519 = exports.buildMerkleProof = exports.deriveDepositRecordPDA = exports.deriveCommitmentTreePDA = exports.deriveBlockHeaderPDA = exports.deriveLightClientPDA = exports.derivePoolStatePDA = exports.verifyDeposit = exports.CHADBUFFER_PROGRAM_ID = exports.prepareVerifyDeposit = exports.fetchMerkleProof = exports.fetchRawTransaction = exports.readBufferData = exports.closeBuffer = exports.uploadTransactionToBuffer = exports.parseClaimUrl = exports.generateClaimUrl = exports.decodeClaimLink = exports.encodeClaimLink = exports.extractAmountFromClaimLink = exports.createProtectedClaimLink = exports.shortenClaimLink = exports.isValidClaimLinkFormat = exports.parseClaimLink = exports.createClaimLink = exports.createCustomInternalKey = exports.getInternalKey = exports.isValidBitcoinAddress = exports.parseP2TRScriptPubkey = exports.createP2TRScriptPubkey = exports.verifyTaprootAddress = void 0;
exports.useSingleDeposit = exports.useDepositWatcher = exports.setAsyncStorage = exports.createNativeWatcher = exports.NativeDepositWatcher = void 0;
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
// Stealth address utilities
var stealth_1 = require("./stealth");
Object.defineProperty(exports, "solanaKeyToX25519", { enumerable: true, get: function () { return stealth_1.solanaKeyToX25519; } });
Object.defineProperty(exports, "solanaPubKeyToX25519", { enumerable: true, get: function () { return stealth_1.solanaPubKeyToX25519; } });
Object.defineProperty(exports, "generateStealthKeys", { enumerable: true, get: function () { return stealth_1.generateStealthKeys; } });
Object.defineProperty(exports, "createStealthDeposit", { enumerable: true, get: function () { return stealth_1.createStealthDeposit; } });
Object.defineProperty(exports, "createStealthDepositForSolana", { enumerable: true, get: function () { return stealth_1.createStealthDepositForSolana; } });
Object.defineProperty(exports, "getStealthSharedSecret", { enumerable: true, get: function () { return stealth_1.getStealthSharedSecret; } });
Object.defineProperty(exports, "scanAnnouncements", { enumerable: true, get: function () { return stealth_1.scanAnnouncements; } });
Object.defineProperty(exports, "scanAnnouncementsWithSolana", { enumerable: true, get: function () { return stealth_1.scanAnnouncementsWithSolana; } });
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
