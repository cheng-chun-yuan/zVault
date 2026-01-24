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
// ==========================================================================
// Cryptographic utilities
// ==========================================================================
export { randomFieldElement, bigintToBytes, bytesToBigint, hexToBytes, bytesToHex, sha256Hash, doubleSha256, taggedHash, BN254_FIELD_PRIME, } from "./crypto";
// Grumpkin curve operations (Noir's embedded curve for efficient in-circuit ECDH)
export { GRUMPKIN_FIELD_PRIME, GRUMPKIN_ORDER, GRUMPKIN_GENERATOR, GRUMPKIN_INFINITY, pointAdd, pointDouble, pointMul, pointNegate, isOnCurve, isInfinity, scalarFromBytes, scalarToBytes, pointToBytes, pointFromBytes, pointToCompressedBytes, pointFromCompressedBytes, pubKeyToBytes, pubKeyFromBytes, generateKeyPair as generateGrumpkinKeyPair, deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed, ecdh as grumpkinEcdh, ecdhSharedSecret as grumpkinEcdhSharedSecret, } from "./grumpkin";
// RAILGUN-style key derivation (Solana wallet -> spending/viewing keys)
export { deriveKeysFromWallet, deriveKeysFromSignature, deriveKeysFromSeed, SPENDING_KEY_DERIVATION_MESSAGE, createStealthMetaAddress, serializeStealthMetaAddress, deserializeStealthMetaAddress, parseStealthMetaAddress, encodeStealthMetaAddress, decodeStealthMetaAddress, createDelegatedViewKey, serializeDelegatedViewKey, deserializeDelegatedViewKey, isDelegatedKeyValid, hasPermission, ViewPermissions, constantTimeCompare, clearKey, clearZVaultKeys, clearDelegatedViewKey, extractViewOnlyBundle, } from "./keys";
// Poseidon2 hash utilities (matches Noir circuits)
export { poseidon2Hash, deriveNotePubKey, computeCommitmentV2, computeNullifierV2, hashNullifier, computeCommitmentV1, computeNullifierHashV1, BN254_SCALAR_FIELD, } from "./poseidon2";
// ==========================================================================
// Note (shielded commitment) utilities
// ==========================================================================
export { generateNote, createNoteFromSecrets, updateNoteWithHashes, serializeNote, deserializeNote, noteHasComputedHashes, formatBtc, parseBtc, 
// Deterministic derivation (HD-style)
deriveNote, deriveNotes, deriveMasterKey, deriveNoteFromMaster, estimateSeedStrength, 
// Simple note creation
createNote, initPoseidon, isPoseidonReady, prepareWithdrawal, 
// V2 Note types (dual-key ECDH support)
createNoteV2, updateNoteV2WithHashes, serializeNoteV2, deserializeNoteV2, noteV2HasComputedHashes, } from "./note";
// ==========================================================================
// Merkle tree utilities
// ==========================================================================
export { createMerkleProof, createMerkleProofFromBigints, proofToNoirFormat, proofToOnChainFormat, createEmptyMerkleProof, leafIndexToPathIndices, pathIndicesToLeafIndex, validateMerkleProofStructure, TREE_DEPTH, ROOT_HISTORY_SIZE, MAX_LEAVES, ZERO_VALUE, } from "./merkle";
// ==========================================================================
// Taproot address utilities
// ==========================================================================
export { deriveTaprootAddress, verifyTaprootAddress, createP2TRScriptPubkey, parseP2TRScriptPubkey, isValidBitcoinAddress, getInternalKey, createCustomInternalKey, } from "./taproot";
// ==========================================================================
// Claim link utilities
// ==========================================================================
export { createClaimLink, parseClaimLink, isValidClaimLinkFormat, shortenClaimLink, createProtectedClaimLink, extractAmountFromClaimLink, encodeClaimLink, decodeClaimLink, generateClaimUrl, parseClaimUrl, } from "./claim-link";
// ==========================================================================
// WASM Prover (Browser + Node.js)
// ==========================================================================
export { initProver, isProverAvailable, generateClaimProof as generateClaimProofWasm, generateSplitProof as generateSplitProofWasm, generateTransferProof as generateTransferProofWasm, generateWithdrawProof as generateWithdrawProofWasm, verifyProof as verifyProofWasm, setCircuitPath, getCircuitPath, circuitExists, proofToBytes, cleanup as cleanupProver, } from "./prover";
// ==========================================================================
// ChadBuffer utilities (for SPV verification)
// ==========================================================================
export { uploadTransactionToBuffer, closeBuffer, readBufferData, fetchRawTransaction, fetchMerkleProof, prepareVerifyDeposit, CHADBUFFER_PROGRAM_ID, } from "./chadbuffer";
// ==========================================================================
// Verify deposit helpers
// ==========================================================================
export { verifyDeposit, derivePoolStatePDA, deriveLightClientPDA, deriveBlockHeaderPDA, deriveCommitmentTreePDA, deriveDepositRecordPDA, buildMerkleProof, } from "./verify-deposit";
// ==========================================================================
// Stealth address utilities (Dual-key ECDH)
// ==========================================================================
export { isWalletAdapter, createStealthDeposit, scanAnnouncements, prepareClaimInputs, parseStealthAnnouncement, announcementToScanFormat, STEALTH_ANNOUNCEMENT_SIZE, STEALTH_ANNOUNCEMENT_DISCRIMINATOR, } from "./stealth";
// ==========================================================================
// Direct stealth deposit (combined BTC deposit + stealth announcement)
// ==========================================================================
export { prepareStealthDeposit, buildStealthOpReturn, parseStealthOpReturn, verifyStealthDeposit, deriveStealthAnnouncementPDA, STEALTH_OP_RETURN_MAGIC, STEALTH_OP_RETURN_VERSION, STEALTH_OP_RETURN_SIZE, VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR, } from "./stealth-deposit";
// ==========================================================================
// Core utilities (Platform-agnostic)
// ==========================================================================
export { EsploraClient, esploraTestnet, esploraMainnet, } from "./core/esplora";
// ==========================================================================
// Deposit Watcher (Real-time BTC deposit tracking)
// ==========================================================================
export { DEFAULT_WATCHER_CONFIG, serializeDeposit, deserializeDeposit, generateDepositId, BaseDepositWatcher, WebDepositWatcher, createWebWatcher, NativeDepositWatcher, createNativeWatcher, setAsyncStorage, } from "./watcher";
// ==========================================================================
// React Hooks (Web + React Native)
// ==========================================================================
export { useDepositWatcher, useSingleDeposit, } from "./react";
// ==========================================================================
// Name Registry (.zkey names)
// ==========================================================================
export { 
// Lookup functions
lookupZkeyName, lookupZkeyNameWithPDA, parseNameRegistry, 
// Validation
isValidName, normalizeName, formatZkeyName, getNameValidationError, hashName, 
// Instruction builders
buildRegisterNameData, buildUpdateNameData, buildTransferNameData, 
// Constants
MAX_NAME_LENGTH, NAME_REGISTRY_SEED, NAME_REGISTRY_DISCRIMINATOR, NAME_REGISTRY_SIZE, ZVAULT_PROGRAM_ID, } from "./name-registry";
