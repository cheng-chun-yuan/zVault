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

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  generateNote,
  type Note,
  formatBtc,
} from "./note";
import {
  type MerkleProof,
  createEmptyMerkleProof,
  TREE_DEPTH,
  ZERO_VALUE,
  leafIndexToPathIndices,
} from "./merkle";
import { deriveTaprootAddress, isValidBitcoinAddress } from "./taproot";
import { createClaimLink, parseClaimLink } from "./claim-link";
import {
  generateClaimProof,
  generateTransferProof,
  generateSplitProof,
  type NoirProof,
} from "./proof";
import { bigintToBytes } from "./crypto";
import { HistoryManager } from "./history";
import {
  deposit as apiDeposit,
  withdraw as apiWithdraw,
  privateClaim as apiPrivateClaim,
  privateSplit as apiPrivateSplit,
  sendLink as apiSendLink,
  sendStealth as apiSendStealth,
  sendStealthToSolana as apiSendStealthToSolana,
  type DepositResult,
  type WithdrawResult,
  type ClaimResult as ApiClaimResultType,
  type SplitResult as ApiSplitResultType,
  type StealthResult,
  type ApiClientConfig,
} from "./api";

// Program ID (Solana Devnet)
export const ZVAULT_PROGRAM_ID = new PublicKey(
  "AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf"
);

/**
 * Deposit credentials returned after generating a deposit
 */
export interface DepositCredentials {
  // Note containing all secrets
  note: Note;
  // Taproot address to send BTC to
  taprootAddress: string;
  // Claim link (URL with encoded secrets)
  claimLink: string;
  // Human-readable amount
  displayAmount: string;
}

/**
 * Claim result
 */
export interface ClaimResult {
  // Transaction signature
  signature: string;
  // Amount claimed in satoshis
  amount: bigint;
  // Recipient wallet
  recipient: PublicKey;
}

/**
 * Split result
 */
export interface SplitResult {
  // Transaction signature
  signature: string;
  // First output note and claim link
  output1: {
    note: Note;
    claimLink: string;
  };
  // Second output note and claim link
  output2: {
    note: Note;
    claimLink: string;
  };
}

/**
 * Simple local commitment storage for demo purposes
 * In production, query on-chain state
 */
interface LocalMerkleState {
  leaves: Uint8Array[];
  filledSubtrees: Uint8Array[];
  root: Uint8Array;
}

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
export class ZVaultClient {
  private connection: Connection;
  private programId: PublicKey;
  private merkleState: LocalMerkleState;
  private payer?: Keypair;
  public historyManager?: HistoryManager;

  constructor(
    connection: Connection,
    programId: PublicKey = ZVAULT_PROGRAM_ID,
    historyManager?: HistoryManager
  ) {
    this.connection = connection;
    this.programId = programId;
    this.merkleState = {
      leaves: [],
      filledSubtrees: Array(TREE_DEPTH).fill(null).map(() => new Uint8Array(ZERO_VALUE)),
      root: new Uint8Array(ZERO_VALUE),
    };
    this.historyManager = historyManager;
  }

  /**
   * Set the payer keypair for transactions
   */
  setPayer(payer: Keypair): void {
    this.payer = payer;
  }

  /**
   * Get API client config for use with api.ts functions
   */
  private getApiConfig(): ApiClientConfig {
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
  async deposit(
    amountSats: bigint,
    network: "mainnet" | "testnet" = "testnet",
    baseUrl?: string
  ): Promise<DepositResult> {
    const result = await apiDeposit(amountSats, network, baseUrl);

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "deposit",
        { amount: amountSats },
        new Uint8Array(0)
      );
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
  async withdraw(
    note: Note,
    btcAddress: string,
    withdrawAmount?: bigint
  ): Promise<WithdrawResult> {
    const merkleProof = this.generateMerkleProofForNote(note);
    const result = await apiWithdraw(
      this.getApiConfig(),
      note,
      btcAddress,
      withdrawAmount,
      merkleProof
    );

    return result;
  }

  /**
   * 3. PRIVATE_CLAIM - Claim sbBTC with ZK proof
   *
   * Claims sbBTC tokens to wallet using ZK proof of commitment ownership.
   *
   * @param claimLinkOrNote - Claim link URL or Note object
   */
  async privateClaim(claimLinkOrNote: string | Note): Promise<ApiClaimResultType> {
    let note: Note;
    if (typeof claimLinkOrNote === "string") {
      const parsed = parseClaimLink(claimLinkOrNote);
      if (!parsed) {
        throw new Error("Invalid claim link");
      }
      note = parsed;
    } else {
      note = claimLinkOrNote;
    }

    const merkleProof = this.generateMerkleProofForNote(note);
    const result = await apiPrivateClaim(
      this.getApiConfig(),
      note,
      merkleProof
    );

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "claim",
        { amount: result.amount },
        new Uint8Array(0)
      );
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
  async privateSplit(inputNote: Note, amount1: bigint): Promise<ApiSplitResultType> {
    const merkleProof = this.generateMerkleProofForNote(inputNote);
    const result = await apiPrivateSplit(
      this.getApiConfig(),
      inputNote,
      amount1,
      merkleProof
    );

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "split",
        { inputAmount: inputNote.amount, amount1, amount2: inputNote.amount - amount1 },
        new Uint8Array(0)
      );
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
  sendLink(note: Note, baseUrl?: string): string {
    return apiSendLink(note, baseUrl);
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
  async sendStealth(
    note: Note,
    recipientPubKey: Uint8Array,
    leafIndex: number = 0
  ): Promise<StealthResult> {
    const result = await apiSendStealth(
      this.getApiConfig(),
      note,
      recipientPubKey,
      leafIndex
    );

    return result;
  }

  /**
   * Send to Solana recipient via stealth address
   */
  async sendStealthToSolana(
    note: Note,
    recipientSolanaPubKey: Uint8Array,
    leafIndex: number = 0
  ): Promise<StealthResult> {
    return apiSendStealthToSolana(
      this.getApiConfig(),
      note,
      recipientSolanaPubKey,
      leafIndex
    );
  }

  /**
   * Generate merkle proof for a note (helper)
   */
  private generateMerkleProofForNote(note: Note): MerkleProof {
    const leafIndex = this.findLeafIndex(note.commitmentBytes);
    if (leafIndex !== -1) {
      return this.generateMerkleProof(leafIndex);
    }
    // Return empty proof if not found
    return createEmptyMerkleProof();
  }

  // ==========================================================================
  // PDA Derivation
  // ==========================================================================

  /**
   * Derive pool state PDA
   */
  derivePoolStatePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool_state")],
      this.programId
    );
  }

  /**
   * Derive light client PDA
   */
  deriveLightClientPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("btc_light_client")],
      this.programId
    );
  }

  /**
   * Derive commitment tree PDA
   */
  deriveCommitmentTreePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commitment_tree")],
      this.programId
    );
  }

  /**
   * Derive block header PDA
   */
  deriveBlockHeaderPDA(height: number): [PublicKey, number] {
    const heightBuffer = Buffer.alloc(8);
    heightBuffer.writeBigUInt64LE(BigInt(height));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("block_header"), heightBuffer],
      this.programId
    );
  }

  /**
   * Derive deposit record PDA
   */
  deriveDepositRecordPDA(txid: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), txid],
      this.programId
    );
  }

  /**
   * Derive nullifier record PDA
   */
  deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), nullifierHash],
      this.programId
    );
  }

  /**
   * Derive stealth announcement PDA
   */
  deriveStealthAnnouncementPDA(commitment: bigint): [PublicKey, number] {
    const commitmentBuffer = Buffer.from(
      commitment.toString(16).padStart(64, "0"),
      "hex"
    );
    return PublicKey.findProgramAddressSync(
      [Buffer.from("stealth"), commitmentBuffer],
      this.programId
    );
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
  async generateDeposit(
    amountSats: bigint,
    network: "mainnet" | "testnet" = "testnet",
    baseUrl?: string
  ): Promise<DepositCredentials> {
    // Generate note with random secrets
    // Note: commitment is 0n until computed by Noir circuit
    const note = generateNote(amountSats);

    // For Taproot address, we need a commitment
    // In practice, compute via helper circuit or use a deterministic derivation
    // For demo, use a hash of the secrets as placeholder
    const placeholderCommitment = bigintToBytes(
      (note.nullifier ^ note.secret) % (2n ** 256n)
    );

    const { address: taprootAddress } = await deriveTaprootAddress(
      placeholderCommitment,
      network
    );

    // Generate claim link
    const claimLink = createClaimLink(note, baseUrl);

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "deposit",
        { amount: amountSats, commitment: placeholderCommitment },
        new Uint8Array(0)
      );
    }

    return {
      note,
      taprootAddress,
      claimLink,
      displayAmount: formatBtc(amountSats),
    };
  }

  /**
   * Restore deposit credentials from a claim link
   */
  async restoreFromClaimLink(
    link: string
  ): Promise<DepositCredentials | null> {
    const note = deserializeNoteFromClaimLink(link);
    if (!note) return null;

    const placeholderCommitment = bigintToBytes(
      (note.nullifier ^ note.secret) % (2n ** 256n)
    );

    const { address: taprootAddress } = await deriveTaprootAddress(
      placeholderCommitment,
      "testnet"
    );

    return {
      note,
      taprootAddress,
      claimLink: link,
      displayAmount: formatBtc(note.amount),
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
  async generateClaimProof(note: Note): Promise<{
    proof: NoirProof;
    merkleProof: MerkleProof;
    amount: bigint;
  }> {
    // Get Merkle proof for the commitment
    const leafIndex = this.findLeafIndex(note.commitmentBytes);
    if (leafIndex === -1) {
      throw new Error(
        "Commitment not found in tree. Was the deposit verified?"
      );
    }

    const merkleProof = this.generateMerkleProof(leafIndex);

    // Generate ZK proof using Noir circuit
    const proofResult = await generateClaimProof(note, merkleProof);

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "claim",
        { nullifier: note.nullifierHashBytes, amount: note.amount },
        proofResult.proof
      );
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
  private findLeafIndex(commitment: Uint8Array): number {
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
  private generateMerkleProof(leafIndex: number): MerkleProof {
    const pathIndices = leafIndexToPathIndices(leafIndex);
    const pathElements: Uint8Array[] = [];

    // Use filled subtrees for proof (simplified)
    for (let i = 0; i < TREE_DEPTH; i++) {
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
  async generateSplit(
    inputNote: Note,
    amount1: bigint,
    amount2?: bigint
  ): Promise<{
    output1: Note;
    output2: Note;
    claimLink1: string;
    claimLink2: string;
    proof: NoirProof;
    inputNullifierHash: Uint8Array;
  }> {
    const finalAmount2 = amount2 ?? inputNote.amount - amount1;

    if (amount1 + finalAmount2 !== inputNote.amount) {
      throw new Error("Split amounts must equal input amount");
    }

    if (amount1 <= 0n || finalAmount2 <= 0n) {
      throw new Error("Both output amounts must be positive");
    }

    // Generate output notes
    const output1 = generateNote(amount1);
    const output2 = generateNote(finalAmount2);

    // Get Merkle proof for input
    const leafIndex = this.findLeafIndex(inputNote.commitmentBytes);
    if (leafIndex === -1) {
      throw new Error("Input commitment not found in tree");
    }

    const merkleProof = this.generateMerkleProof(leafIndex);

    // Generate split proof using Noir circuit
    const proofResult = await generateSplitProof(
      inputNote,
      output1,
      output2,
      merkleProof
    );

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "split",
        {
          inputNullifier: inputNote.nullifierHashBytes,
          output1Commitment: output1.commitmentBytes,
          output2Commitment: output2.commitmentBytes,
        },
        proofResult.proof
      );
    }

    return {
      output1,
      output2,
      claimLink1: createClaimLink(output1),
      claimLink2: createClaimLink(output2),
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
  async generateTransfer(inputNote: Note): Promise<{
    outputNote: Note;
    claimLink: string;
    proof: NoirProof;
    inputNullifierHash: Uint8Array;
  }> {
    const outputNote = generateNote(inputNote.amount);

    const leafIndex = this.findLeafIndex(inputNote.commitmentBytes);
    if (leafIndex === -1) {
      throw new Error("Input commitment not found in tree");
    }

    const merkleProof = this.generateMerkleProof(leafIndex);

    // Generate transfer proof using Noir circuit
    const proofResult = await generateTransferProof(
      inputNote,
      outputNote,
      merkleProof
    );

    if (this.historyManager) {
      await this.historyManager.addEvent(
        "transfer",
        {
          inputNullifier: inputNote.nullifierHashBytes,
          outputCommitment: outputNote.commitmentBytes,
        },
        proofResult.proof
      );
    }

    return {
      outputNote,
      claimLink: createClaimLink(outputNote),
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
  validateBtcAddress(address: string): boolean {
    const result = isValidBitcoinAddress(address);
    return result.valid;
  }

  /**
   * Check if claim link is valid
   */
  async validateClaimLink(link: string): Promise<boolean> {
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
  insertCommitment(commitment: Uint8Array): number {
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
  getMerkleRoot(): Uint8Array {
    return this.merkleState.root;
  }

  /**
   * Get leaf count
   */
  getLeafCount(): number {
    return this.merkleState.leaves.length;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

/**
 * Helper to deserialize note from claim link
 */
function deserializeNoteFromClaimLink(link: string): Note | null {
  try {
    return parseClaimLink(link);
  } catch {
    return null;
  }
}

/**
 * Create a new ZVault client (Solana Devnet)
 */
export function createClient(
  connection: Connection,
  historyManager?: HistoryManager
): ZVaultClient {
  return new ZVaultClient(connection, ZVAULT_PROGRAM_ID, historyManager);
}

// Re-export types from api.ts
export type {
  DepositResult,
  WithdrawResult,
  StealthResult,
} from "./api";

// Re-export with different names to avoid conflicts with local types
export type { ClaimResult as ApiClaimResult } from "./api";
export type { SplitResult as ApiSplitResult } from "./api";
