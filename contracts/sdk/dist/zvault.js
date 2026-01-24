"use strict";
/**
 * ZVault Client - Main SDK Entry Point
 *
 * Provides high-level APIs for the complete zVault flow:
 *
 * ## 6 Main Functions
 * 1. deposit() - Generate deposit credentials (taproot address + claim link)
 * 2. withdraw() - Request BTC withdrawal (burn sbBTC)
 * 3. privateClaim() - Claim sbBTC tokens with ZK proof
 * 4. privateSplit() - Split one commitment into two outputs
 * 5. sendLink() - Create global claim link (off-chain)
 * 6. sendStealth() - Send to specific recipient via stealth ECDH
 *
 * Note: This SDK uses Noir circuits with Poseidon2 hashing for ZK proofs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZVaultClient = exports.ZVAULT_PROGRAM_ID = void 0;
exports.createClient = createClient;
const web3_js_1 = require("@solana/web3.js");
const note_1 = require("./note");
const merkle_1 = require("./merkle");
const taproot_1 = require("./taproot");
const claim_link_1 = require("./claim-link");
const proof_1 = require("./proof");
const crypto_1 = require("./crypto");
const api_1 = require("./api");
// Program ID (Solana Devnet)
exports.ZVAULT_PROGRAM_ID = new web3_js_1.PublicKey("AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf");
/**
 * ZVault SDK Client
 *
 * Provides high-level APIs for all zVault operations.
 *
 * ## Quick Start
 * ```typescript
 * const client = createClient(connection, 'devnet');
 * client.setPayer(myKeypair);
 *
 * // Generate deposit credentials
 * const deposit = await client.deposit(100_000n);
 * console.log('Send BTC to:', deposit.taprootAddress);
 *
 * // Later: claim sbBTC
 * const result = await client.privateClaim(deposit.claimLink);
 * ```
 */
class ZVaultClient {
    constructor(connection, programId = exports.ZVAULT_PROGRAM_ID, historyManager) {
        this.connection = connection;
        this.programId = programId;
        this.merkleState = {
            leaves: [],
            filledSubtrees: Array(merkle_1.TREE_DEPTH).fill(null).map(() => new Uint8Array(merkle_1.ZERO_VALUE)),
            root: new Uint8Array(merkle_1.ZERO_VALUE),
        };
        this.historyManager = historyManager;
    }
    /**
     * Set the payer keypair for transactions
     */
    setPayer(payer) {
        this.payer = payer;
    }
    /**
     * Get API client config for use with api.ts functions
     */
    getApiConfig() {
        return {
            connection: this.connection,
            programId: this.programId,
            payer: this.payer,
        };
    }
    // ==========================================================================
    // 6 Main Functions (Simplified API)
    // ==========================================================================
    /**
     * 1. DEPOSIT - Generate deposit credentials
     *
     * Creates new secrets, derives taproot address, and creates claim link.
     * User should send BTC to the taproot address externally.
     *
     * @param amountSats - Amount in satoshis
     * @param network - Bitcoin network
     * @param baseUrl - Base URL for claim link
     */
    async deposit(amountSats, network = "testnet", baseUrl) {
        const result = await (0, api_1.deposit)(amountSats, network, baseUrl);
        if (this.historyManager) {
            await this.historyManager.addEvent("deposit", { amount: amountSats }, new Uint8Array(0));
        }
        return result;
    }
    /**
     * 2. WITHDRAW - Request BTC withdrawal
     *
     * Burns sbBTC and creates redemption request. Relayer will send BTC.
     *
     * @param note - Note to withdraw from
     * @param btcAddress - Bitcoin address to receive withdrawal
     * @param withdrawAmount - Amount to withdraw (defaults to full)
     */
    async withdraw(note, btcAddress, withdrawAmount) {
        const merkleProof = this.generateMerkleProofForNote(note);
        const result = await (0, api_1.withdraw)(this.getApiConfig(), note, btcAddress, withdrawAmount, merkleProof);
        return result;
    }
    /**
     * 3. PRIVATE_CLAIM - Claim sbBTC with ZK proof
     *
     * Claims sbBTC tokens to wallet using ZK proof of commitment ownership.
     *
     * @param claimLinkOrNote - Claim link URL or Note object
     */
    async privateClaim(claimLinkOrNote) {
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
        const merkleProof = this.generateMerkleProofForNote(note);
        const result = await (0, api_1.privateClaim)(this.getApiConfig(), note, merkleProof);
        if (this.historyManager) {
            await this.historyManager.addEvent("claim", { amount: result.amount }, new Uint8Array(0));
        }
        return result;
    }
    /**
     * 4. PRIVATE_SPLIT - Split one commitment into two
     *
     * Splits an input commitment into two outputs. Returns both notes
     * for the user to distribute via sendLink or sendStealth.
     *
     * @param inputNote - Note to split
     * @param amount1 - Amount for first output
     */
    async privateSplit(inputNote, amount1) {
        const merkleProof = this.generateMerkleProofForNote(inputNote);
        const result = await (0, api_1.privateSplit)(this.getApiConfig(), inputNote, amount1, merkleProof);
        if (this.historyManager) {
            await this.historyManager.addEvent("split", { inputAmount: inputNote.amount, amount1, amount2: inputNote.amount - amount1 }, new Uint8Array(0));
        }
        return result;
    }
    /**
     * 5. SEND_LINK - Create global claim link
     *
     * Creates a shareable URL that anyone can use to claim.
     * No on-chain transaction - purely client-side.
     *
     * @param note - Note to create link for
     * @param baseUrl - Base URL for the link
     */
    sendLink(note, baseUrl) {
        return (0, api_1.sendLink)(note, baseUrl);
    }
    /**
     * 6. SEND_STEALTH - Send to specific recipient via ECDH
     *
     * Creates on-chain stealth announcement. Only recipient can claim.
     *
     * @param note - Note to send
     * @param recipientPubKey - Recipient's X25519 public key
     * @param leafIndex - Leaf index in tree
     */
    async sendStealth(note, recipientPubKey, leafIndex = 0) {
        const result = await (0, api_1.sendStealth)(this.getApiConfig(), note, recipientPubKey, leafIndex);
        return result;
    }
    /**
     * Send to Solana recipient via stealth address
     */
    async sendStealthToSolana(note, recipientSolanaPubKey, leafIndex = 0) {
        return (0, api_1.sendStealthToSolana)(this.getApiConfig(), note, recipientSolanaPubKey, leafIndex);
    }
    /**
     * Generate merkle proof for a note (helper)
     */
    generateMerkleProofForNote(note) {
        const leafIndex = this.findLeafIndex(note.commitmentBytes);
        if (leafIndex !== -1) {
            return this.generateMerkleProof(leafIndex);
        }
        // Return empty proof if not found
        return (0, merkle_1.createEmptyMerkleProof)();
    }
    // ==========================================================================
    // PDA Derivation
    // ==========================================================================
    /**
     * Derive pool state PDA
     */
    derivePoolStatePDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("pool_state")], this.programId);
    }
    /**
     * Derive light client PDA
     */
    deriveLightClientPDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("btc_light_client")], this.programId);
    }
    /**
     * Derive commitment tree PDA
     */
    deriveCommitmentTreePDA() {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], this.programId);
    }
    /**
     * Derive block header PDA
     */
    deriveBlockHeaderPDA(height) {
        const heightBuffer = Buffer.alloc(8);
        heightBuffer.writeBigUInt64LE(BigInt(height));
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("block_header"), heightBuffer], this.programId);
    }
    /**
     * Derive deposit record PDA
     */
    deriveDepositRecordPDA(txid) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("deposit"), txid], this.programId);
    }
    /**
     * Derive nullifier record PDA
     */
    deriveNullifierRecordPDA(nullifierHash) {
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("nullifier"), nullifierHash], this.programId);
    }
    /**
     * Derive stealth announcement PDA
     */
    deriveStealthAnnouncementPDA(commitment) {
        const commitmentBuffer = Buffer.from(commitment.toString(16).padStart(64, "0"), "hex");
        return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("stealth"), commitmentBuffer], this.programId);
    }
    // ==========================================================================
    // Deposit Flow
    // ==========================================================================
    /**
     * Generate deposit credentials
     *
     * Creates new secrets for a note. The commitment and nullifier hash
     * will be computed by the Noir circuit during proof generation.
     *
     * @param amountSats - Amount in satoshis
     * @param network - Bitcoin network
     * @param baseUrl - Base URL for claim link
     */
    async generateDeposit(amountSats, network = "testnet", baseUrl) {
        // Generate note with random secrets
        // Note: commitment is 0n until computed by Noir circuit
        const note = (0, note_1.generateNote)(amountSats);
        // For Taproot address, we need a commitment
        // In practice, compute via helper circuit or use a deterministic derivation
        // For demo, use a hash of the secrets as placeholder
        const placeholderCommitment = (0, crypto_1.bigintToBytes)((note.nullifier ^ note.secret) % (2n ** 256n));
        const { address: taprootAddress } = await (0, taproot_1.deriveTaprootAddress)(placeholderCommitment, network);
        // Generate claim link
        const claimLink = (0, claim_link_1.createClaimLink)(note, baseUrl);
        if (this.historyManager) {
            await this.historyManager.addEvent("deposit", { amount: amountSats, commitment: placeholderCommitment }, new Uint8Array(0));
        }
        return {
            note,
            taprootAddress,
            claimLink,
            displayAmount: (0, note_1.formatBtc)(amountSats),
        };
    }
    /**
     * Restore deposit credentials from a claim link
     */
    async restoreFromClaimLink(link) {
        const note = deserializeNoteFromClaimLink(link);
        if (!note)
            return null;
        const placeholderCommitment = (0, crypto_1.bigintToBytes)((note.nullifier ^ note.secret) % (2n ** 256n));
        const { address: taprootAddress } = await (0, taproot_1.deriveTaprootAddress)(placeholderCommitment, "testnet");
        return {
            note,
            taprootAddress,
            claimLink: link,
            displayAmount: (0, note_1.formatBtc)(note.amount),
        };
    }
    // ==========================================================================
    // Claim Flow
    // ==========================================================================
    /**
     * Generate a claim proof for a note
     *
     * Call this after the deposit has been verified on-chain.
     * The proof can then be submitted to the claim instruction.
     */
    async generateClaimProof(note) {
        // Get Merkle proof for the commitment
        const leafIndex = this.findLeafIndex(note.commitmentBytes);
        if (leafIndex === -1) {
            throw new Error("Commitment not found in tree. Was the deposit verified?");
        }
        const merkleProof = this.generateMerkleProof(leafIndex);
        // Generate ZK proof using Noir circuit
        const proofResult = await (0, proof_1.generateClaimProof)(note, merkleProof);
        if (this.historyManager) {
            await this.historyManager.addEvent("claim", { nullifier: note.nullifierHashBytes, amount: note.amount }, proofResult.proof);
        }
        return {
            proof: proofResult,
            merkleProof,
            amount: note.amount,
        };
    }
    /**
     * Find leaf index for a commitment
     */
    findLeafIndex(commitment) {
        for (let i = 0; i < this.merkleState.leaves.length; i++) {
            if (this.arraysEqual(this.merkleState.leaves[i], commitment)) {
                return i;
            }
        }
        return -1;
    }
    /**
     * Generate a Merkle proof for a leaf index
     * Note: This is a simplified implementation. In production,
     * query the on-chain Merkle tree for accurate proofs.
     */
    generateMerkleProof(leafIndex) {
        const pathIndices = (0, merkle_1.leafIndexToPathIndices)(leafIndex);
        const pathElements = [];
        // Use filled subtrees for proof (simplified)
        for (let i = 0; i < merkle_1.TREE_DEPTH; i++) {
            pathElements.push(new Uint8Array(this.merkleState.filledSubtrees[i]));
        }
        return {
            pathElements,
            pathIndices,
            leafIndex,
            root: new Uint8Array(this.merkleState.root),
        };
    }
    // ==========================================================================
    // Split Flow
    // ==========================================================================
    /**
     * Generate a split - divide one note into two
     *
     * @param inputNote - Note to split
     * @param amount1 - Amount for first output
     * @param amount2 - Amount for second output (auto-calculated if not provided)
     */
    async generateSplit(inputNote, amount1, amount2) {
        const finalAmount2 = amount2 ?? inputNote.amount - amount1;
        if (amount1 + finalAmount2 !== inputNote.amount) {
            throw new Error("Split amounts must equal input amount");
        }
        if (amount1 <= 0n || finalAmount2 <= 0n) {
            throw new Error("Both output amounts must be positive");
        }
        // Generate output notes
        const output1 = (0, note_1.generateNote)(amount1);
        const output2 = (0, note_1.generateNote)(finalAmount2);
        // Get Merkle proof for input
        const leafIndex = this.findLeafIndex(inputNote.commitmentBytes);
        if (leafIndex === -1) {
            throw new Error("Input commitment not found in tree");
        }
        const merkleProof = this.generateMerkleProof(leafIndex);
        // Generate split proof using Noir circuit
        const proofResult = await (0, proof_1.generateSplitProof)(inputNote, output1, output2, merkleProof);
        if (this.historyManager) {
            await this.historyManager.addEvent("split", {
                inputNullifier: inputNote.nullifierHashBytes,
                output1Commitment: output1.commitmentBytes,
                output2Commitment: output2.commitmentBytes,
            }, proofResult.proof);
        }
        return {
            output1,
            output2,
            claimLink1: (0, claim_link_1.createClaimLink)(output1),
            claimLink2: (0, claim_link_1.createClaimLink)(output2),
            proof: proofResult,
            inputNullifierHash: inputNote.nullifierHashBytes,
        };
    }
    // ==========================================================================
    // Transfer Flow
    // ==========================================================================
    /**
     * Generate a transfer (commitment refresh)
     *
     * Creates a new note with new secrets but same amount.
     * Useful for privacy enhancement.
     */
    async generateTransfer(inputNote) {
        const outputNote = (0, note_1.generateNote)(inputNote.amount);
        const leafIndex = this.findLeafIndex(inputNote.commitmentBytes);
        if (leafIndex === -1) {
            throw new Error("Input commitment not found in tree");
        }
        const merkleProof = this.generateMerkleProof(leafIndex);
        // Generate transfer proof using Noir circuit
        const proofResult = await (0, proof_1.generateTransferProof)(inputNote, outputNote, merkleProof);
        if (this.historyManager) {
            await this.historyManager.addEvent("transfer", {
                inputNullifier: inputNote.nullifierHashBytes,
                outputCommitment: outputNote.commitmentBytes,
            }, proofResult.proof);
        }
        return {
            outputNote,
            claimLink: (0, claim_link_1.createClaimLink)(outputNote),
            proof: proofResult,
            inputNullifierHash: inputNote.nullifierHashBytes,
        };
    }
    // ==========================================================================
    // Verification Helpers
    // ==========================================================================
    /**
     * Validate a BTC address
     */
    validateBtcAddress(address) {
        const result = (0, taproot_1.isValidBitcoinAddress)(address);
        return result.valid;
    }
    /**
     * Check if claim link is valid
     */
    async validateClaimLink(link) {
        const note = deserializeNoteFromClaimLink(link);
        return note !== null;
    }
    // ==========================================================================
    // State Management
    // ==========================================================================
    /**
     * Insert commitment into local Merkle state
     * (Should be synced with on-chain state)
     */
    insertCommitment(commitment) {
        const index = this.merkleState.leaves.length;
        this.merkleState.leaves.push(new Uint8Array(commitment));
        // Update filled subtrees (simplified)
        const isLeft = index % 2 === 0;
        if (isLeft && this.merkleState.filledSubtrees[0]) {
            this.merkleState.filledSubtrees[0] = new Uint8Array(commitment);
        }
        return index;
    }
    /**
     * Get current Merkle root
     */
    getMerkleRoot() {
        return this.merkleState.root;
    }
    /**
     * Get leaf count
     */
    getLeafCount() {
        return this.merkleState.leaves.length;
    }
    arraysEqual(a, b) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i])
                return false;
        }
        return true;
    }
}
exports.ZVaultClient = ZVaultClient;
/**
 * Helper to deserialize note from claim link
 */
function deserializeNoteFromClaimLink(link) {
    try {
        return (0, claim_link_1.parseClaimLink)(link);
    }
    catch {
        return null;
    }
}
/**
 * Create a new ZVault client (Solana Devnet)
 */
function createClient(connection, historyManager) {
    return new ZVaultClient(connection, exports.ZVAULT_PROGRAM_ID, historyManager);
}
