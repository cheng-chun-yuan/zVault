"use strict";
/**
 * ZVault Simplified API
 *
 * 6 main user-facing functions:
 * - deposit: Generate deposit credentials (taproot address + claim link)
 * - withdraw: Request BTC withdrawal (burn sbBTC)
 * - privateClaim: Claim sbBTC tokens with ZK proof
 * - privateSplit: Split one commitment into two outputs
 * - sendLink: Create global claim link (anyone with URL can claim)
 * - sendStealth: Send to specific recipient via stealth ECDH
 *
 * @module api
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWalletAdapter = exports.prepareClaimInputs = exports.scanAnnouncements = exports.parseClaimLink = exports.estimateSeedStrength = exports.deriveNotes = exports.deriveNote = exports.createNoteFromSecrets = exports.generateNote = exports.DEFAULT_PROGRAM_ID = void 0;
exports.deposit = deposit;
exports.withdraw = withdraw;
exports.privateClaim = privateClaim;
exports.privateSplit = privateSplit;
exports.sendLink = sendLink;
exports.sendStealth = sendStealth;
const web3_js_1 = require("@solana/web3.js");
const note_1 = require("./note");
const taproot_1 = require("./taproot");
const claim_link_1 = require("./claim-link");
const proof_1 = require("./proof");
const stealth_1 = require("./stealth");
const merkle_1 = require("./merkle");
const crypto_1 = require("./crypto");
// ============================================================================
// Constants
// ============================================================================
/** Default program ID (Solana Devnet) */
exports.DEFAULT_PROGRAM_ID = new web3_js_1.PublicKey("AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf");
/** Instruction discriminators */
const INSTRUCTION = {
    SPLIT_COMMITMENT: 4,
    REQUEST_REDEMPTION: 5,
    VERIFY_DEPOSIT: 8,
    CLAIM: 9,
    ANNOUNCE_STEALTH: 12,
};
// ============================================================================
// PDA Derivation Helpers
// ============================================================================
function derivePoolStatePDA(programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("pool_state")], programId);
}
function deriveCommitmentTreePDA(programId) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], programId);
}
function deriveNullifierRecordPDA(programId, nullifierHash) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("nullifier"), nullifierHash], programId);
}
function deriveStealthAnnouncementPDA(programId, commitment) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("stealth"), commitment], programId);
}
// ============================================================================
// 1. DEPOSIT
// ============================================================================
/**
 * Generate deposit credentials
 *
 * Creates a new note with random secrets, derives a taproot address for
 * receiving BTC, and creates a claim link for later claiming.
 *
 * **Flow:**
 * 1. Generate random nullifier + secret
 * 2. Derive taproot address from commitment
 * 3. Create claim link with encoded secrets
 * 4. User sends BTC to taproot address externally
 * 5. Later: call verifyDeposit to add commitment to on-chain tree
 *
 * @param amountSats - Amount in satoshis
 * @param network - Bitcoin network (mainnet/testnet)
 * @param baseUrl - Base URL for claim link
 * @returns Deposit credentials
 *
 * @example
 * ```typescript
 * const result = await deposit(100_000n); // 0.001 BTC
 * console.log('Send BTC to:', result.taprootAddress);
 * console.log('Save this link:', result.claimLink);
 * ```
 */
async function deposit(amountSats, network = "testnet", baseUrl) {
    // Generate note with random secrets
    const note = (0, note_1.generateNote)(amountSats);
    // For taproot derivation, use XOR of nullifier/secret as placeholder commitment
    // In production, compute actual Poseidon2 hash via helper circuit
    const placeholderCommitment = (0, crypto_1.bigintToBytes)((note.nullifier ^ note.secret) % (2n ** 256n));
    // Derive taproot address
    const { address: taprootAddress } = await (0, taproot_1.deriveTaprootAddress)(placeholderCommitment, network);
    // Create claim link
    const claimLink = (0, claim_link_1.createClaimLink)(note, baseUrl);
    return {
        note,
        taprootAddress,
        claimLink,
        displayAmount: (0, note_1.formatBtc)(amountSats),
    };
}
// ============================================================================
// 2. WITHDRAW
// ============================================================================
/**
 * Request BTC withdrawal (burn sbBTC)
 *
 * Generates a partial_withdraw ZK proof and submits REQUEST_REDEMPTION instruction.
 * Burns sbBTC tokens and creates a redemption request for the relayer to fulfill.
 *
 * **Flow:**
 * 1. Generate partial_withdraw proof
 * 2. Call REQUEST_REDEMPTION instruction
 * 3. Program verifies proof, burns sbBTC, creates RedemptionRequest PDA
 * 4. If partial: adds change commitment to tree
 * 5. Relayer monitors and sends BTC (external)
 *
 * @param config - Client configuration
 * @param note - Note to withdraw from
 * @param btcAddress - Bitcoin address to receive withdrawal
 * @param withdrawAmount - Amount to withdraw (defaults to full amount)
 * @param merkleProof - Merkle proof for the commitment
 * @returns Withdrawal result
 *
 * @example
 * ```typescript
 * // Full withdrawal
 * const result = await withdraw(config, myNote, 'bc1q...');
 *
 * // Partial withdrawal (50%)
 * const result = await withdraw(config, myNote, 'bc1q...', myNote.amount / 2n);
 * ```
 */
async function withdraw(config, note, btcAddress, withdrawAmount, merkleProof) {
    if (!config.payer) {
        throw new Error("Payer keypair required for withdraw");
    }
    const actualWithdrawAmount = withdrawAmount ?? note.amount;
    const isPartialWithdraw = actualWithdrawAmount < note.amount;
    // Hash BTC address for recipient field
    const encoder = new TextEncoder();
    const recipientBytes = new Uint8Array(32);
    const btcAddressBytes = encoder.encode(btcAddress);
    recipientBytes.set(btcAddressBytes.slice(0, Math.min(32, btcAddressBytes.length)));
    let changeNote;
    let proof;
    if (isPartialWithdraw) {
        // Generate change note for remaining amount
        const changeAmount = note.amount - actualWithdrawAmount;
        changeNote = (0, note_1.generateNote)(changeAmount);
        // Generate partial withdraw proof
        const mp = merkleProof ?? createEmptyMerkleProofForNote();
        proof = await (0, proof_1.generatePartialWithdrawProof)(note, actualWithdrawAmount, changeNote, mp, recipientBytes);
    }
    else {
        // Full withdrawal - use partial_withdraw with zero change
        changeNote = (0, note_1.generateNote)(0n);
        const mp = merkleProof ?? createEmptyMerkleProofForNote();
        proof = await (0, proof_1.generatePartialWithdrawProof)(note, actualWithdrawAmount, changeNote, mp, recipientBytes);
        changeNote = undefined; // No change for full withdrawal
    }
    // Build instruction data
    const data = buildRequestRedemptionData(proof, actualWithdrawAmount, recipientBytes, changeNote?.commitmentBytes);
    // Derive PDAs
    const [poolState] = derivePoolStatePDA(config.programId);
    const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
    const [nullifierRecord] = deriveNullifierRecordPDA(config.programId, note.nullifierHashBytes);
    // Build transaction
    const ix = new web3_js_1.TransactionInstruction({
        programId: config.programId,
        keys: [
            { pubkey: poolState, isSigner: false, isWritable: true },
            { pubkey: commitmentTree, isSigner: false, isWritable: true },
            { pubkey: nullifierRecord, isSigner: false, isWritable: true },
            { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
    });
    const tx = new web3_js_1.Transaction().add(ix);
    const signature = await config.connection.sendTransaction(tx, [config.payer]);
    await config.connection.confirmTransaction(signature);
    return {
        signature,
        withdrawAmount: actualWithdrawAmount,
        changeNote,
        changeClaimLink: changeNote ? (0, claim_link_1.createClaimLink)(changeNote) : undefined,
    };
}
// ============================================================================
// 3. PRIVATE_CLAIM
// ============================================================================
/**
 * Claim sbBTC tokens with ZK proof
 *
 * Parses claim link (or uses provided note), generates a claim proof,
 * and mints sbBTC tokens to the user's wallet.
 *
 * **Flow:**
 * 1. Parse claim link to recover note (if link provided)
 * 2. Get merkle proof for commitment
 * 3. Generate claim ZK proof
 * 4. Call CLAIM instruction
 * 5. Program verifies proof, mints sbBTC
 *
 * @param config - Client configuration
 * @param claimLinkOrNote - Claim link URL or Note object
 * @param merkleProof - Merkle proof for the commitment
 * @returns Claim result
 *
 * @example
 * ```typescript
 * // Claim from link
 * const result = await privateClaim(config, 'https://sbbtc.app/claim?note=...');
 *
 * // Claim from note
 * const result = await privateClaim(config, myNote);
 * ```
 */
async function privateClaim(config, claimLinkOrNote, merkleProof) {
    if (!config.payer) {
        throw new Error("Payer keypair required for claim");
    }
    // Parse note from link or use directly
    let note;
    if (typeof claimLinkOrNote === "string") {
        const parsed = (0, claim_link_1.parseClaimLink)(claimLinkOrNote);
        if (!parsed) {
            throw new Error("Invalid claim link");
        }
        note = parsed;
    }
    else {
        note = claimLinkOrNote;
    }
    // Use provided merkle proof or create empty one
    const mp = merkleProof ?? createEmptyMerkleProofForNote();
    // Generate ZK proof
    const proof = await (0, proof_1.generateClaimProof)(note, mp);
    // Build instruction data
    const data = buildClaimData(proof, note.amount);
    // Derive PDAs
    const [poolState] = derivePoolStatePDA(config.programId);
    const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
    const [nullifierRecord] = deriveNullifierRecordPDA(config.programId, note.nullifierHashBytes);
    // Build transaction
    const ix = new web3_js_1.TransactionInstruction({
        programId: config.programId,
        keys: [
            { pubkey: poolState, isSigner: false, isWritable: true },
            { pubkey: commitmentTree, isSigner: false, isWritable: false },
            { pubkey: nullifierRecord, isSigner: false, isWritable: true },
            { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
    });
    const tx = new web3_js_1.Transaction().add(ix);
    const signature = await config.connection.sendTransaction(tx, [config.payer]);
    await config.connection.confirmTransaction(signature);
    return {
        signature,
        amount: note.amount,
        recipient: config.payer.publicKey,
    };
}
// ============================================================================
// 4. PRIVATE_SPLIT
// ============================================================================
/**
 * Split one commitment into two outputs
 *
 * Generates a split proof and adds two new commitments to the tree
 * while spending the input commitment.
 *
 * **Flow:**
 * 1. Generate two output notes
 * 2. Generate split ZK proof
 * 3. Call SPLIT_COMMITMENT instruction
 * 4. Program verifies proof, nullifies input, adds outputs
 *
 * @param config - Client configuration
 * @param inputNote - Note to split
 * @param amount1 - Amount for first output
 * @param merkleProof - Merkle proof for input commitment
 * @returns Split result with two output notes
 *
 * @example
 * ```typescript
 * // Split 1 BTC into 0.3 + 0.7
 * const { output1, output2 } = await privateSplit(config, myNote, 30_000_000n);
 *
 * // Send 0.3 to Alice via stealth
 * await sendStealth(config, output1, alicePubKey);
 *
 * // Keep 0.7 as claim link
 * const myLink = sendLink(output2);
 * ```
 */
async function privateSplit(config, inputNote, amount1, merkleProof) {
    if (!config.payer) {
        throw new Error("Payer keypair required for split");
    }
    const amount2 = inputNote.amount - amount1;
    if (amount1 <= 0n || amount2 <= 0n) {
        throw new Error("Both output amounts must be positive");
    }
    // Generate output notes
    const output1 = (0, note_1.generateNote)(amount1);
    const output2 = (0, note_1.generateNote)(amount2);
    // Use provided merkle proof or create empty one
    const mp = merkleProof ?? createEmptyMerkleProofForNote();
    // Generate split proof
    const proof = await (0, proof_1.generateSplitProof)(inputNote, output1, output2, mp);
    // Build instruction data
    const data = buildSplitData(proof, output1.commitmentBytes, output2.commitmentBytes);
    // Derive PDAs
    const [poolState] = derivePoolStatePDA(config.programId);
    const [commitmentTree] = deriveCommitmentTreePDA(config.programId);
    const [nullifierRecord] = deriveNullifierRecordPDA(config.programId, inputNote.nullifierHashBytes);
    // Build transaction
    const ix = new web3_js_1.TransactionInstruction({
        programId: config.programId,
        keys: [
            { pubkey: poolState, isSigner: false, isWritable: true },
            { pubkey: commitmentTree, isSigner: false, isWritable: true },
            { pubkey: nullifierRecord, isSigner: false, isWritable: true },
            { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
    });
    const tx = new web3_js_1.Transaction().add(ix);
    const signature = await config.connection.sendTransaction(tx, [config.payer]);
    await config.connection.confirmTransaction(signature);
    return {
        signature,
        output1,
        output2,
        inputNullifierHash: inputNote.nullifierHashBytes,
    };
}
// ============================================================================
// 5. SEND_LINK (Claim Link Mode)
// ============================================================================
/**
 * Create a global claim link
 *
 * Encodes a note into a shareable URL. Anyone with the link can claim.
 * This is purely client-side - no on-chain transaction.
 *
 * **Use case:** Share funds directly via messaging, email, QR code.
 *
 * @param note - Note to create link for
 * @param baseUrl - Base URL for the link
 * @returns Claim link URL
 *
 * @example
 * ```typescript
 * const link = sendLink(myNote);
 * // => "https://sbbtc.app/claim?note=eyJhbW91bnQ..."
 *
 * // Share link with recipient
 * // Recipient calls: await privateClaim(config, link);
 * ```
 */
function sendLink(note, baseUrl) {
    return (0, claim_link_1.createClaimLink)(note, baseUrl);
}
// ============================================================================
// 6. SEND_STEALTH (ECDH Mode)
// ============================================================================
/**
 * Send to specific recipient via stealth address (dual-key ECDH)
 *
 * Creates an on-chain stealth announcement that only the recipient
 * can discover by scanning with their view key.
 *
 * **Flow:**
 * 1. Dual ECDH key exchange: X25519 (viewing) + Grumpkin (spending)
 * 2. Compute commitment using Poseidon2
 * 3. Create on-chain StealthAnnouncement
 * 4. Recipient scans announcements with view key
 * 5. Recipient prepares claim inputs with spending key
 *
 * @param config - Client configuration
 * @param recipientMeta - Recipient's stealth meta-address (spending + viewing public keys)
 * @param amountSats - Amount in satoshis
 * @param leafIndex - Leaf index in commitment tree
 * @returns Stealth result
 *
 * @example
 * ```typescript
 * // Send to Alice's stealth address
 * const result = await sendStealth(config, aliceMetaAddress, 100_000n);
 *
 * // Alice scans and claims
 * const found = await scanAnnouncements(aliceKeys, announcements);
 * const claimInputs = await prepareClaimInputs(aliceKeys, found[0], merkleProof);
 * ```
 */
async function sendStealth(config, recipientMeta, amountSats, leafIndex = 0) {
    if (!config.payer) {
        throw new Error("Payer keypair required for stealth send");
    }
    // Create stealth deposit data using dual-key ECDH
    const stealthDeposit = await (0, stealth_1.createStealthDeposit)(recipientMeta, amountSats);
    // Build instruction data (113 bytes)
    // ephemeral_view_pub (32) + ephemeral_spend_pub (33) + amount_sats (8) + commitment (32) + leaf_index (8)
    const data = new Uint8Array(1 + 113);
    data[0] = INSTRUCTION.ANNOUNCE_STEALTH;
    let offset = 1;
    data.set(stealthDeposit.ephemeralViewPub, offset);
    offset += 32;
    data.set(stealthDeposit.ephemeralSpendPub, offset);
    offset += 33;
    const amountView = new DataView(data.buffer, offset, 8);
    amountView.setBigUint64(0, amountSats, true);
    offset += 8;
    data.set(stealthDeposit.commitment, offset);
    offset += 32;
    const leafIndexView = new DataView(data.buffer, offset, 8);
    leafIndexView.setBigUint64(0, BigInt(leafIndex), true);
    // Derive stealth announcement PDA
    const [stealthAnnouncement] = deriveStealthAnnouncementPDA(config.programId, stealthDeposit.commitment);
    // Build transaction
    const ix = new web3_js_1.TransactionInstruction({
        programId: config.programId,
        keys: [
            { pubkey: stealthAnnouncement, isSigner: false, isWritable: true },
            { pubkey: config.payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(data),
    });
    const tx = new web3_js_1.Transaction().add(ix);
    const signature = await config.connection.sendTransaction(tx, [config.payer]);
    await config.connection.confirmTransaction(signature);
    return {
        signature,
        ephemeralPubKey: stealthDeposit.ephemeralViewPub,
        leafIndex,
    };
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Create empty merkle proof (for testing/demo)
 */
function createEmptyMerkleProofForNote() {
    return {
        pathElements: Array(merkle_1.TREE_DEPTH)
            .fill(null)
            .map(() => new Uint8Array(merkle_1.ZERO_VALUE)),
        pathIndices: Array(merkle_1.TREE_DEPTH).fill(0),
        leafIndex: 0,
        root: new Uint8Array(merkle_1.ZERO_VALUE),
    };
}
/**
 * Build claim instruction data
 */
function buildClaimData(proof, amount) {
    // Format: discriminator (1) + proof_len (4) + proof + amount (8)
    const proofBytes = proof.proof;
    const data = new Uint8Array(1 + 4 + proofBytes.length + 8);
    const view = new DataView(data.buffer);
    data[0] = INSTRUCTION.CLAIM;
    view.setUint32(1, proofBytes.length, true);
    data.set(proofBytes, 5);
    view.setBigUint64(5 + proofBytes.length, amount, true);
    return data;
}
/**
 * Build split instruction data
 */
function buildSplitData(proof, outputCommitment1, outputCommitment2) {
    // Format: discriminator (1) + proof_len (4) + proof + output1 (32) + output2 (32)
    const proofBytes = proof.proof;
    const data = new Uint8Array(1 + 4 + proofBytes.length + 64);
    const view = new DataView(data.buffer);
    data[0] = INSTRUCTION.SPLIT_COMMITMENT;
    view.setUint32(1, proofBytes.length, true);
    data.set(proofBytes, 5);
    data.set(outputCommitment1, 5 + proofBytes.length);
    data.set(outputCommitment2, 5 + proofBytes.length + 32);
    return data;
}
/**
 * Build request redemption instruction data
 */
function buildRequestRedemptionData(proof, withdrawAmount, recipient, changeCommitment) {
    const proofBytes = proof.proof;
    const hasChange = changeCommitment !== undefined;
    // Format: discriminator (1) + proof_len (4) + proof + amount (8) + recipient (32) + has_change (1) + [change_commitment (32)]
    const dataLen = 1 + 4 + proofBytes.length + 8 + 32 + 1 + (hasChange ? 32 : 0);
    const data = new Uint8Array(dataLen);
    const view = new DataView(data.buffer);
    let offset = 0;
    data[offset++] = INSTRUCTION.REQUEST_REDEMPTION;
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;
    data.set(proofBytes, offset);
    offset += proofBytes.length;
    view.setBigUint64(offset, withdrawAmount, true);
    offset += 8;
    data.set(recipient, offset);
    offset += 32;
    data[offset++] = hasChange ? 1 : 0;
    if (hasChange && changeCommitment) {
        data.set(changeCommitment, offset);
    }
    return data;
}
// ============================================================================
// Re-exports for convenience
// ============================================================================
var note_2 = require("./note");
Object.defineProperty(exports, "generateNote", { enumerable: true, get: function () { return note_2.generateNote; } });
Object.defineProperty(exports, "createNoteFromSecrets", { enumerable: true, get: function () { return note_2.createNoteFromSecrets; } });
Object.defineProperty(exports, "deriveNote", { enumerable: true, get: function () { return note_2.deriveNote; } });
Object.defineProperty(exports, "deriveNotes", { enumerable: true, get: function () { return note_2.deriveNotes; } });
Object.defineProperty(exports, "estimateSeedStrength", { enumerable: true, get: function () { return note_2.estimateSeedStrength; } });
var claim_link_2 = require("./claim-link");
Object.defineProperty(exports, "parseClaimLink", { enumerable: true, get: function () { return claim_link_2.parseClaimLink; } });
var stealth_2 = require("./stealth");
Object.defineProperty(exports, "scanAnnouncements", { enumerable: true, get: function () { return stealth_2.scanAnnouncements; } });
Object.defineProperty(exports, "prepareClaimInputs", { enumerable: true, get: function () { return stealth_2.prepareClaimInputs; } });
Object.defineProperty(exports, "isWalletAdapter", { enumerable: true, get: function () { return stealth_2.isWalletAdapter; } });
