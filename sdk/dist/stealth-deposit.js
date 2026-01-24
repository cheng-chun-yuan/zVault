"use strict";
/**
 * Stealth Deposit utilities for ZVault
 *
 * Combines BTC deposit verification with automatic stealth announcement.
 * When a user deposits BTC to a recipient's stealth address, after SPV
 * verification the commitment goes directly to the recipient - no
 * separate claim step needed.
 *
 * OP_RETURN Format (SIMPLIFIED - 99 bytes, down from 142):
 * - [0]       Magic: 0x7A ('z' for zVault stealth)
 * - [1]       Version (1 byte)
 * - [2-33]    ephemeral_view_pub (32 bytes, X25519)
 * - [34-66]   ephemeral_spend_pub (33 bytes, Grumpkin compressed)
 * - [67-98]   commitment (32 bytes, Poseidon2 hash)
 *
 * SECURITY IMPROVEMENTS:
 * - Removed encrypted_amount (8 bytes): BTC amount is public on blockchain
 * - Removed encrypted_random (32 bytes): Ephemeral key uniqueness sufficient
 * - Reduced version field (3 bytes saved): 1 byte is enough
 * - Total savings: 43 bytes (142 → 99)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = exports.STEALTH_OP_RETURN_SIZE_V1 = exports.STEALTH_OP_RETURN_SIZE = exports.STEALTH_OP_RETURN_VERSION = exports.STEALTH_OP_RETURN_MAGIC = void 0;
exports.prepareStealthDeposit = prepareStealthDeposit;
exports.buildStealthOpReturn = buildStealthOpReturn;
exports.parseStealthOpReturn = parseStealthOpReturn;
exports.deriveStealthAnnouncementPDA = deriveStealthAnnouncementPDA;
exports.verifyStealthDeposit = verifyStealthDeposit;
const web3_js_1 = require("@solana/web3.js");
const tweetnacl_1 = require("tweetnacl");
const crypto_1 = require("./crypto");
const grumpkin_1 = require("./grumpkin");
const taproot_1 = require("./taproot");
const poseidon2_1 = require("./poseidon2");
const chadbuffer_1 = require("./chadbuffer");
const verify_deposit_1 = require("./verify-deposit");
// ========== Constants ==========
/** Magic byte for stealth OP_RETURN */
exports.STEALTH_OP_RETURN_MAGIC = 0x7a; // 'z' for zVault stealth
/** Current version for stealth OP_RETURN format (simplified) */
exports.STEALTH_OP_RETURN_VERSION = 2; // Version 2 = simplified format
/**
 * Total size of stealth OP_RETURN data (SIMPLIFIED)
 * = 1 (magic) + 1 (version) + 32 (view pub) + 33 (spend pub) + 32 (commitment)
 */
exports.STEALTH_OP_RETURN_SIZE = 99;
/** Legacy size for backward compatibility parsing */
exports.STEALTH_OP_RETURN_SIZE_V1 = 142;
/** Instruction discriminator for verify_stealth_deposit */
exports.VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = 20;
// Program ID (Solana Devnet)
const ZVAULT_PROGRAM_ID = new web3_js_1.PublicKey("AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf");
// ========== Sender Functions ==========
/**
 * Prepare a stealth deposit for a recipient (SIMPLIFIED FORMAT)
 *
 * Generates ephemeral keypairs and creates the OP_RETURN.
 * The sender then creates a BTC transaction with:
 * - Output 1: amount to btcDepositAddress
 * - Output 2: OP_RETURN with opReturnData
 *
 * SECURITY IMPROVEMENTS:
 * - Uses Poseidon2 for commitment (matches Noir circuits)
 * - No encrypted_amount: BTC amount is public on blockchain
 * - No encrypted_random: Fresh ephemeral keys provide uniqueness
 *
 * @param params - Deposit parameters
 * @returns Prepared deposit data
 */
async function prepareStealthDeposit(params) {
    const { recipientMeta, amountSats, network } = params;
    // Parse recipient's public keys
    const recipientViewPub = recipientMeta.viewingPubKey;
    const recipientSpendPub = (0, grumpkin_1.pointFromCompressedBytes)(recipientMeta.spendingPubKey);
    // Generate ephemeral X25519 keypair for viewing
    const ephemeralView = tweetnacl_1.box.keyPair();
    // Note: viewShared not needed for commitment computation
    // Generate ephemeral Grumpkin keypair for spending
    const ephemeralSpend = (0, grumpkin_1.generateKeyPair)();
    const spendShared = (0, grumpkin_1.ecdh)(ephemeralSpend.privKey, recipientSpendPub);
    // Compute commitment using Poseidon2 (SIMPLIFIED: no random)
    // notePubKey = Poseidon2(spendShared.x, spendShared.y, DOMAIN_NPK)
    const notePubKey = (0, poseidon2_1.deriveNotePubKey)(spendShared.x, spendShared.y);
    // commitment = Poseidon2(notePubKey, amount, 0)
    // Note: random is 0 in simplified format
    const commitmentBigint = (0, poseidon2_1.computeCommitmentV2)(notePubKey, amountSats, 0n);
    const commitment = (0, crypto_1.bigintToBytes)(commitmentBigint);
    // Build OP_RETURN data (simplified format)
    const opReturnData = buildStealthOpReturn({
        ephemeralViewPub: ephemeralView.publicKey,
        ephemeralSpendPub: (0, grumpkin_1.pointToCompressedBytes)(ephemeralSpend.pubKey),
        commitment,
    });
    // Derive taproot address from commitment
    const { address: btcDepositAddress } = await (0, taproot_1.deriveTaprootAddress)(commitment, network);
    return {
        btcDepositAddress,
        opReturnData,
        amountSats,
        stealthData: {
            ephemeralViewPub: ephemeralView.publicKey,
            ephemeralSpendPub: (0, grumpkin_1.pointToCompressedBytes)(ephemeralSpend.pubKey),
            commitment,
        },
    };
}
/**
 * Build the OP_RETURN script data (SIMPLIFIED FORMAT)
 *
 * Layout (99 bytes):
 * - [0]      Magic: 0x7A
 * - [1]      Version: 2
 * - [2-33]   ephemeral_view_pub (32 bytes)
 * - [34-66]  ephemeral_spend_pub (33 bytes)
 * - [67-98]  commitment (32 bytes)
 */
function buildStealthOpReturn(params) {
    const data = new Uint8Array(exports.STEALTH_OP_RETURN_SIZE);
    let offset = 0;
    // Magic byte
    data[offset++] = exports.STEALTH_OP_RETURN_MAGIC;
    // Version (1 byte)
    data[offset++] = exports.STEALTH_OP_RETURN_VERSION;
    // Ephemeral view pubkey (32 bytes)
    data.set(params.ephemeralViewPub, offset);
    offset += 32;
    // Ephemeral spend pubkey (33 bytes)
    data.set(params.ephemeralSpendPub, offset);
    offset += 33;
    // Commitment (32 bytes)
    data.set(params.commitment, offset);
    return data;
}
/**
 * Parse stealth data from OP_RETURN (SIMPLIFIED FORMAT)
 *
 * Supports both V1 (legacy 142 bytes) and V2 (simplified 99 bytes) formats.
 */
function parseStealthOpReturn(data) {
    // Check minimum size (V2 is 99 bytes)
    if (data.length < exports.STEALTH_OP_RETURN_SIZE) {
        return null;
    }
    // Check magic byte
    if (data[0] !== exports.STEALTH_OP_RETURN_MAGIC) {
        return null;
    }
    // Parse version
    const version = data[1];
    if (version === 2) {
        // V2: Simplified format (99 bytes)
        return {
            version,
            ephemeralViewPub: data.slice(2, 34),
            ephemeralSpendPub: data.slice(34, 67),
            commitment: data.slice(67, 99),
        };
    }
    else if (version === 1 && data.length >= exports.STEALTH_OP_RETURN_SIZE_V1) {
        // V1: Legacy format (142 bytes) - parse version as 4-byte LE
        const versionV1 = new DataView(data.buffer, data.byteOffset + 1, 4).getUint32(0, true);
        if (versionV1 !== 1) {
            return null;
        }
        // V1 legacy format - return with only the fields we need
        return {
            version: versionV1,
            ephemeralViewPub: data.slice(5, 37),
            ephemeralSpendPub: data.slice(37, 70),
            // Note: encrypted_amount and encrypted_random are at 70-78 and 78-110
            // but we don't include them in the simplified interface
            commitment: data.slice(110, 142),
        };
    }
    return null;
}
// ========== On-chain Verification ==========
/**
 * Derive stealth announcement PDA
 */
function deriveStealthAnnouncementPDA(programId, ephemeralViewPub) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("stealth_v2"), ephemeralViewPub], programId);
}
/**
 * Verify a stealth deposit on Solana
 *
 * Calls the verify_stealth_deposit instruction which:
 * 1. Verifies the BTC transaction via SPV
 * 2. Parses stealth data from OP_RETURN
 * 3. Adds commitment to Merkle tree
 * 4. Creates stealth announcement with leaf_index
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param btcTxid - Bitcoin transaction ID (hex string)
 * @param expectedValue - Expected deposit value in satoshis
 * @param network - Bitcoin network
 * @param programId - Optional program ID override
 * @returns Transaction signature
 */
async function verifyStealthDeposit(connection, payer, btcTxid, expectedValue, network = "testnet", programId = ZVAULT_PROGRAM_ID) {
    console.log("=== Verify Stealth Deposit ===");
    console.log(`Txid: ${btcTxid}`);
    console.log(`Expected value: ${expectedValue} sats`);
    // Step 1: Fetch tx and merkle proof, upload to buffer
    const { bufferPubkey, transactionSize, merkleProof, blockHeight, txIndex, txidBytes, } = await (0, chadbuffer_1.prepareVerifyDeposit)(connection, payer, btcTxid, network);
    // Step 2: We need to parse the raw tx to get the stealth data for PDA derivation
    const rawTx = await (0, chadbuffer_1.fetchRawTransaction)(btcTxid, network);
    const stealthData = extractStealthDataFromRawTx(rawTx);
    if (!stealthData) {
        throw new Error("Could not find stealth OP_RETURN in transaction");
    }
    // Step 3: Derive PDAs
    const [poolState] = (0, verify_deposit_1.derivePoolStatePDA)(programId);
    const [lightClient] = (0, verify_deposit_1.deriveLightClientPDA)(programId);
    const [blockHeader] = (0, verify_deposit_1.deriveBlockHeaderPDA)(programId, blockHeight);
    const [commitmentTree] = (0, verify_deposit_1.deriveCommitmentTreePDA)(programId);
    const [depositRecord] = (0, verify_deposit_1.deriveDepositRecordPDA)(programId, txidBytes);
    const [stealthAnnouncement] = deriveStealthAnnouncementPDA(programId, stealthData.ephemeralViewPub);
    console.log("PDAs derived:");
    console.log(`  Pool: ${poolState.toBase58()}`);
    console.log(`  Light Client: ${lightClient.toBase58()}`);
    console.log(`  Block Header: ${blockHeader.toBase58()}`);
    console.log(`  Commitment Tree: ${commitmentTree.toBase58()}`);
    console.log(`  Deposit Record: ${depositRecord.toBase58()}`);
    console.log(`  Stealth Announcement: ${stealthAnnouncement.toBase58()}`);
    // Build merkle proof data
    const merkleProofData = (0, verify_deposit_1.buildMerkleProof)(txidBytes, merkleProof, txIndex);
    // Build instruction data
    const instructionData = buildVerifyStealthDepositData({
        txid: txidBytes,
        blockHeight: BigInt(blockHeight),
        expectedValue,
        transactionSize,
        merkleProof: merkleProofData,
    });
    // Create instruction
    const instruction = new web3_js_1.TransactionInstruction({
        programId,
        keys: [
            { pubkey: poolState, isSigner: false, isWritable: true },
            { pubkey: lightClient, isSigner: false, isWritable: false },
            { pubkey: blockHeader, isSigner: false, isWritable: false },
            { pubkey: commitmentTree, isSigner: false, isWritable: true },
            { pubkey: depositRecord, isSigner: false, isWritable: true },
            { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
            { pubkey: bufferPubkey, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(instructionData),
    });
    // Send transaction
    const tx = new web3_js_1.Transaction().add(instruction);
    const signature = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [payer]);
    console.log(`Transaction confirmed: ${signature}`);
    return signature;
}
/**
 * Build instruction data for verify_stealth_deposit
 */
function buildVerifyStealthDepositData(params) {
    // Calculate size: discriminator + txid + block_height + expected_value + tx_size + merkle_proof
    const proofSize = 32 +
        4 +
        params.merkleProof.siblings.length * 32 +
        Math.ceil(params.merkleProof.path.length / 8);
    const data = new Uint8Array(1 + 32 + 8 + 8 + 4 + proofSize);
    let offset = 0;
    // Discriminator
    data[offset++] = exports.VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR;
    // Txid (32 bytes)
    data.set(params.txid, offset);
    offset += 32;
    // Block height (8 bytes, LE)
    const blockHeightBytes = new Uint8Array(8);
    new DataView(blockHeightBytes.buffer).setBigUint64(0, params.blockHeight, true);
    data.set(blockHeightBytes, offset);
    offset += 8;
    // Expected value (8 bytes, LE)
    const valueBytes = new Uint8Array(8);
    new DataView(valueBytes.buffer).setBigUint64(0, params.expectedValue, true);
    data.set(valueBytes, offset);
    offset += 8;
    // Transaction size (4 bytes, LE)
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, params.transactionSize, true);
    data.set(sizeBytes, offset);
    offset += 4;
    // Merkle proof
    // Txid (32 bytes)
    data.set(new Uint8Array(params.merkleProof.txid), offset);
    offset += 32;
    // Siblings count (4 bytes, LE)
    const siblingCountBytes = new Uint8Array(4);
    new DataView(siblingCountBytes.buffer).setUint32(0, params.merkleProof.siblings.length, true);
    data.set(siblingCountBytes, offset);
    offset += 4;
    // Siblings
    for (const sibling of params.merkleProof.siblings) {
        data.set(new Uint8Array(sibling), offset);
        offset += 32;
    }
    // Path bits (packed)
    const pathBytes = new Uint8Array(Math.ceil(params.merkleProof.path.length / 8));
    for (let i = 0; i < params.merkleProof.path.length; i++) {
        if (params.merkleProof.path[i]) {
            pathBytes[Math.floor(i / 8)] |= 1 << (i % 8);
        }
    }
    data.set(pathBytes, offset);
    return data;
}
/**
 * Extract stealth data from raw BTC transaction
 */
function extractStealthDataFromRawTx(rawTx) {
    // Simple OP_RETURN finder - looks for 0x6a (OP_RETURN) followed by push and magic byte
    for (let i = 0; i < rawTx.length - exports.STEALTH_OP_RETURN_SIZE - 2; i++) {
        // Look for OP_RETURN (0x6a)
        if (rawTx[i] === 0x6a) {
            // Check push length
            const pushLen = rawTx[i + 1];
            if (pushLen >= exports.STEALTH_OP_RETURN_SIZE && i + 2 + pushLen <= rawTx.length) {
                // Check magic byte
                if (rawTx[i + 2] === exports.STEALTH_OP_RETURN_MAGIC) {
                    const opReturnData = rawTx.slice(i + 2, i + 2 + pushLen);
                    return parseStealthOpReturn(opReturnData);
                }
            }
        }
    }
    return null;
}
// ========== Utilities ==========
function randomFieldElement() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return (0, crypto_1.bytesToBigint)(bytes) % crypto_1.BN254_FIELD_PRIME;
}
function xorBytes(a, b) {
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}
function concatBytes(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
function textToBytes(text) {
    return new TextEncoder().encode(text);
}
function bigintToBytes8(value) {
    const bytes = new Uint8Array(8);
    let v = value;
    for (let i = 7; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}
