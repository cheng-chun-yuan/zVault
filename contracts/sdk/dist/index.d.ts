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
export { randomFieldElement, bigintToBytes, bytesToBigint, hexToBytes, bytesToHex, sha256Hash, doubleSha256, taggedHash, BN254_FIELD_PRIME, poseidonHash1, poseidonHash2, } from "./crypto";
export { GRUMPKIN_FIELD_PRIME, GRUMPKIN_ORDER, GRUMPKIN_GENERATOR, GRUMPKIN_INFINITY, pointAdd, pointDouble, pointMul, pointNegate, isOnCurve, isInfinity, scalarFromBytes, scalarToBytes, pointToBytes, pointFromBytes, pointToCompressedBytes, pointFromCompressedBytes, pubKeyToBytes, pubKeyFromBytes, generateKeyPair as generateGrumpkinKeyPair, deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed, ecdh as grumpkinEcdh, ecdhSharedSecret as grumpkinEcdhSharedSecret, type GrumpkinPoint, } from "./grumpkin";
export { deriveKeysFromWallet, deriveKeysFromSignature, deriveKeysFromSeed, SPENDING_KEY_DERIVATION_MESSAGE, createStealthMetaAddress, serializeStealthMetaAddress, deserializeStealthMetaAddress, parseStealthMetaAddress, encodeStealthMetaAddress, decodeStealthMetaAddress, createDelegatedViewKey, serializeDelegatedViewKey, deserializeDelegatedViewKey, isDelegatedKeyValid, hasPermission, ViewPermissions, constantTimeCompare, clearKey, clearZVaultKeys, clearDelegatedViewKey, extractViewOnlyBundle, type ZVaultKeys, type StealthMetaAddress, type SerializedStealthMetaAddress, type DelegatedViewKey, type WalletSignerAdapter, } from "./keys";
export { poseidon2Hash, deriveNotePubKey, computeCommitmentV2, computeNullifierV2, hashNullifier, computeCommitmentV1, computeNullifierHashV1, BN254_SCALAR_FIELD, } from "./poseidon2";
export { isValidName, normalizeName, hashName, formatZkeyName, getNameValidationError, buildRegisterNameData, buildUpdateNameData, buildTransferNameData, NAME_REGISTRY_SEED, deriveNameRegistryPDA, parseNameEntry, entryToStealthAddress, MAX_NAME_LENGTH, NAME_REGEX, type NameEntry, type NameLookupResult, } from "./name-registry";
export { generateNote, createNoteFromSecrets, updateNoteWithHashes, serializeNote, deserializeNote, noteHasComputedHashes, formatBtc, parseBtc, deriveNote, deriveNotes, deriveMasterKey, deriveNoteFromMaster, estimateSeedStrength, computeCommitment, computeNullifierHash, createNote, initPoseidon, isPoseidonReady, prepareWithdrawal, type Note, type SerializedNote, type NoteData, createNoteV2, updateNoteV2WithHashes, serializeNoteV2, deserializeNoteV2, noteV2HasComputedHashes, type NoteV2, type SerializedNoteV2, } from "./note";
export { poseidon, poseidon1, poseidon2, poseidon3, poseidon4, computeZeroHashes, FIELD_MODULUS, } from "./poseidon";
export { createMerkleProof, createMerkleProofFromBigints, proofToNoirFormat, proofToOnChainFormat, createEmptyMerkleProof, leafIndexToPathIndices, pathIndicesToLeafIndex, validateMerkleProofStructure, TREE_DEPTH, ROOT_HISTORY_SIZE, MAX_LEAVES, ZERO_VALUE, type MerkleProof, } from "./merkle";
export { deriveTaprootAddress, verifyTaprootAddress, createP2TRScriptPubkey, parseP2TRScriptPubkey, isValidBitcoinAddress, getInternalKey, createCustomInternalKey, } from "./taproot";
export { createClaimLink, parseClaimLink, isValidClaimLinkFormat, shortenClaimLink, createProtectedClaimLink, extractAmountFromClaimLink, encodeClaimLink, decodeClaimLink, generateClaimUrl, parseClaimUrl, type ClaimLinkData, } from "./claim-link";
export type { NoirProof, CircuitType } from "./proof";
export { uploadTransactionToBuffer, closeBuffer, readBufferData, fetchRawTransaction, fetchMerkleProof, prepareVerifyDeposit, CHADBUFFER_PROGRAM_ID, } from "./chadbuffer";
export { verifyDeposit, derivePoolStatePDA, deriveLightClientPDA, deriveBlockHeaderPDA, deriveCommitmentTreePDA, deriveDepositRecordPDA, buildMerkleProof, } from "./verify-deposit";
export type { DepositCredentials, ClaimResult, SplitResult } from "./zvault";
export { isWalletAdapter, createStealthDeposit, scanAnnouncements, prepareClaimInputs, parseStealthAnnouncement, announcementToScanFormat, STEALTH_ANNOUNCEMENT_SIZE, STEALTH_ANNOUNCEMENT_DISCRIMINATOR, type StealthDeposit, type ScannedNote, type ClaimInputs, type OnChainStealthAnnouncement, } from "./stealth";
export { prepareStealthDeposit, buildStealthOpReturn, parseStealthOpReturn, verifyStealthDeposit, deriveStealthAnnouncementPDA, STEALTH_OP_RETURN_MAGIC, STEALTH_OP_RETURN_VERSION, STEALTH_OP_RETURN_SIZE, VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR, type PreparedStealthDeposit, type StealthDepositData, type ParsedStealthOpReturn, } from "./stealth-deposit";
export { HistoryManager, MockRecursiveProver, type HistoryNode, type HistoryChain, type ProofAggregator, type OperationType, } from "./history";
export type { DepositResult, WithdrawResult, ClaimResult as ApiClaimResult, SplitResult as ApiSplitResult, StealthResult, ApiClientConfig, } from "./api";
export { EsploraClient, esploraTestnet, esploraMainnet, type EsploraTransaction, type EsploraVin, type EsploraVout, type EsploraStatus, type EsploraAddressInfo, type EsploraUtxo, type EsploraMerkleProof, type EsploraNetwork, } from "./core/esplora";
export { type DepositStatus, type PendingDeposit, type WatcherCallbacks, type WatcherConfig, type StorageAdapter, DEFAULT_WATCHER_CONFIG, serializeDeposit, deserializeDeposit, generateDepositId, BaseDepositWatcher, WebDepositWatcher, createWebWatcher, NativeDepositWatcher, createNativeWatcher, setAsyncStorage, } from "./watcher";
export { useDepositWatcher, useSingleDeposit, type UseDepositWatcherState, type UseDepositWatcherActions, type UseDepositWatcherReturn, type UseDepositWatcherOptions, } from "./react";
