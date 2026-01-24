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
export { randomFieldElement, bigintToBytes, bytesToBigint, hexToBytes, bytesToHex, sha256Hash, doubleSha256, taggedHash, BN254_FIELD_PRIME, } from "./crypto";
export { GRUMPKIN_FIELD_PRIME, GRUMPKIN_ORDER, GRUMPKIN_GENERATOR, GRUMPKIN_INFINITY, pointAdd, pointDouble, pointMul, pointNegate, isOnCurve, isInfinity, scalarFromBytes, scalarToBytes, pointToBytes, pointFromBytes, pointToCompressedBytes, pointFromCompressedBytes, pubKeyToBytes, pubKeyFromBytes, generateKeyPair as generateGrumpkinKeyPair, deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed, ecdh as grumpkinEcdh, ecdhSharedSecret as grumpkinEcdhSharedSecret, type GrumpkinPoint, } from "./grumpkin";
export { deriveKeysFromWallet, deriveKeysFromSignature, deriveKeysFromSeed, SPENDING_KEY_DERIVATION_MESSAGE, createStealthMetaAddress, serializeStealthMetaAddress, deserializeStealthMetaAddress, parseStealthMetaAddress, encodeStealthMetaAddress, decodeStealthMetaAddress, createDelegatedViewKey, serializeDelegatedViewKey, deserializeDelegatedViewKey, isDelegatedKeyValid, hasPermission, ViewPermissions, constantTimeCompare, clearKey, clearZVaultKeys, clearDelegatedViewKey, extractViewOnlyBundle, type ZVaultKeys, type StealthMetaAddress, type SerializedStealthMetaAddress, type DelegatedViewKey, type WalletSignerAdapter, } from "./keys";
export { poseidon2Hash, deriveNotePubKey, computeCommitment, computeNullifier, hashNullifier, computeCommitmentLegacy, computeNullifierHashLegacy, BN254_SCALAR_FIELD, } from "./poseidon2";
export { generateNote, createNoteFromSecrets, updateNoteWithHashes, serializeNote, deserializeNote, noteHasComputedHashes, formatBtc, parseBtc, deriveNote, deriveNotes, deriveMasterKey, deriveNoteFromMaster, estimateSeedStrength, createNote, initPoseidon, isPoseidonReady, prepareWithdrawal, type Note, type SerializedNote, type NoteData, createStealthNote, updateStealthNoteWithHashes, serializeStealthNote, deserializeStealthNote, stealthNoteHasComputedHashes, type StealthNote, type SerializedStealthNote, createNoteV2, updateNoteV2WithHashes, serializeNoteV2, deserializeNoteV2, noteV2HasComputedHashes, type NoteV2, type SerializedNoteV2, } from "./note";
export { createMerkleProof, createMerkleProofFromBigints, proofToNoirFormat, proofToOnChainFormat, createEmptyMerkleProof, leafIndexToPathIndices, pathIndicesToLeafIndex, validateMerkleProofStructure, TREE_DEPTH, ROOT_HISTORY_SIZE, MAX_LEAVES, ZERO_VALUE, type MerkleProof, } from "./merkle";
export { deriveTaprootAddress, verifyTaprootAddress, createP2TRScriptPubkey, parseP2TRScriptPubkey, isValidBitcoinAddress, getInternalKey, createCustomInternalKey, } from "./taproot";
export { createClaimLink, parseClaimLink, isValidClaimLinkFormat, shortenClaimLink, createProtectedClaimLink, extractAmountFromClaimLink, encodeClaimLink, decodeClaimLink, generateClaimUrl, parseClaimUrl, type ClaimLinkData, } from "./claim-link";
export type { NoirProof, CircuitType } from "./proof";
export { initProver, isProverAvailable, generateClaimProof as generateClaimProofWasm, generateSplitProof as generateSplitProofWasm, generateTransferProof as generateTransferProofWasm, generateWithdrawProof as generateWithdrawProofWasm, verifyProof as verifyProofWasm, setCircuitPath, getCircuitPath, circuitExists, proofToBytes, cleanup as cleanupProver, type ProofData, type MerkleProofInput, type ClaimInputs as ProverClaimInputs, type SplitInputs, type TransferInputs, type WithdrawInputs, } from "./prover";
export { uploadTransactionToBuffer, closeBuffer, readBufferData, fetchRawTransaction, fetchMerkleProof, prepareVerifyDeposit, CHADBUFFER_PROGRAM_ID, } from "./chadbuffer";
export { verifyDeposit, derivePoolStatePDA, deriveLightClientPDA, deriveBlockHeaderPDA, deriveCommitmentTreePDA, deriveDepositRecordPDA, buildMerkleProof, } from "./verify-deposit";
export type { DepositCredentials, ClaimResult, SplitResult } from "./zvault";
export { isWalletAdapter, createStealthDeposit, scanAnnouncements, prepareClaimInputs, parseStealthAnnouncement, announcementToScanFormat, STEALTH_ANNOUNCEMENT_SIZE, STEALTH_ANNOUNCEMENT_DISCRIMINATOR, type StealthDeposit, type ScannedNote, type ClaimInputs, type OnChainStealthAnnouncement, } from "./stealth";
export { prepareStealthDeposit, buildStealthOpReturn, parseStealthOpReturn, verifyStealthDeposit, deriveStealthAnnouncementPDA, STEALTH_OP_RETURN_MAGIC, STEALTH_OP_RETURN_VERSION, STEALTH_OP_RETURN_SIZE, VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR, type PreparedStealthDeposit, type StealthDepositData, type ParsedStealthOpReturn, } from "./stealth-deposit";
export type { DepositResult, WithdrawResult, ClaimResult as ApiClaimResult, SplitResult as ApiSplitResult, StealthResult, ApiClientConfig, } from "./api";
export { EsploraClient, esploraTestnet, esploraMainnet, type EsploraTransaction, type EsploraVin, type EsploraVout, type EsploraStatus, type EsploraAddressInfo, type EsploraUtxo, type EsploraMerkleProof, type EsploraNetwork, } from "./core/esplora";
export { type DepositStatus, type PendingDeposit, type WatcherCallbacks, type WatcherConfig, type StorageAdapter, DEFAULT_WATCHER_CONFIG, serializeDeposit, deserializeDeposit, generateDepositId, BaseDepositWatcher, WebDepositWatcher, createWebWatcher, NativeDepositWatcher, createNativeWatcher, setAsyncStorage, } from "./watcher";
export { useDepositWatcher, useSingleDeposit, type UseDepositWatcherState, type UseDepositWatcherActions, type UseDepositWatcherReturn, type UseDepositWatcherOptions, } from "./react";
export { lookupZkeyName, lookupZkeyNameWithPDA, parseNameRegistry, isValidName, normalizeName, formatZkeyName, getNameValidationError, hashName, buildRegisterNameData, buildUpdateNameData, buildTransferNameData, MAX_NAME_LENGTH, NAME_REGISTRY_SEED, NAME_REGISTRY_DISCRIMINATOR, NAME_REGISTRY_SIZE, ZVAULT_PROGRAM_ID, type NameRegistryEntry, type ZkeyStealthAddress, } from "./name-registry";
