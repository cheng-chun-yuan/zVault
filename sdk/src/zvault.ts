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
import { bigintToBytes } from "./crypto";
import {
  deposit as apiDeposit,
  withdraw as apiWithdraw,
  privateClaim as apiPrivateClaim,
  privateSplit as apiPrivateSplit,
  sendLink as apiSendLink,
  sendStealth as apiSendStealth,
  type DepositResult,
  type WithdrawResult,
  type ClaimResult as ApiClaimResultType,
  type SplitResult as ApiSplitResultType,
  type StealthResult,
  type ApiClientConfig,
  type StealthMetaAddress,
} from "./api";

// Program ID (Solana Devnet)
export const ZVAULT_PROGRAM_ID = new PublicKey(
  "BDH9iTYp2nBptboCcSmTn7GTkzYTzaMr7MMG5D5sXXRp"
);

/**
 * Deposit credentials returned after generating a deposit
 */
export interface DepositCredentials {
  note: Note;
  taprootAddress: string;
  claimLink: string;
  displayAmount: string;
}

/**
 * Claim result
 */
export interface ClaimResult {
  signature: string;
  amount: bigint;
  recipient: PublicKey;
}

/**
 * Split result
 */
export interface SplitResult {
  signature: string;
  output1: { note: Note; claimLink: string };
  output2: { note: Note; claimLink: string };
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
 * const client = createClient(connection);
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

  constructor(
    connection: Connection,
    programId: PublicKey = ZVAULT_PROGRAM_ID
  ) {
    this.connection = connection;
    this.programId = programId;
    this.merkleState = {
      leaves: [],
      filledSubtrees: Array(TREE_DEPTH).fill(null).map(() => new Uint8Array(ZERO_VALUE)),
      root: new Uint8Array(ZERO_VALUE),
    };
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
  // 6 Main Functions
  // ==========================================================================

  /**
   * 1. DEPOSIT - Generate deposit credentials
   *
   * Creates new secrets, derives taproot address, and creates claim link.
   * User should send BTC to the taproot address externally.
   */
  async deposit(
    amountSats: bigint,
    network: "mainnet" | "testnet" = "testnet",
    baseUrl?: string
  ): Promise<DepositResult> {
    return apiDeposit(amountSats, network, baseUrl);
  }

  /**
   * 2. WITHDRAW - Request BTC withdrawal
   *
   * Burns sbBTC and creates redemption request. Relayer will send BTC.
   */
  async withdraw(
    note: Note,
    btcAddress: string,
    withdrawAmount?: bigint
  ): Promise<WithdrawResult> {
    const merkleProof = this.generateMerkleProofForNote(note);
    return apiWithdraw(
      this.getApiConfig(),
      note,
      btcAddress,
      withdrawAmount,
      merkleProof
    );
  }

  /**
   * 3. PRIVATE_CLAIM - Claim sbBTC with ZK proof
   *
   * Claims sbBTC tokens to wallet using ZK proof of commitment ownership.
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
    return apiPrivateClaim(this.getApiConfig(), note, merkleProof);
  }

  /**
   * 4. PRIVATE_SPLIT - Split one commitment into two
   *
   * Splits an input commitment into two outputs.
   */
  async privateSplit(inputNote: Note, amount1: bigint): Promise<ApiSplitResultType> {
    const merkleProof = this.generateMerkleProofForNote(inputNote);
    return apiPrivateSplit(this.getApiConfig(), inputNote, amount1, merkleProof);
  }

  /**
   * 5. SEND_LINK - Create global claim link (off-chain)
   */
  sendLink(note: Note, baseUrl?: string): string {
    return apiSendLink(note, baseUrl);
  }

  /**
   * 6. SEND_STEALTH - Send to specific recipient via dual-key ECDH
   */
  async sendStealth(
    recipientMeta: StealthMetaAddress,
    amountSats: bigint,
    leafIndex: number = 0
  ): Promise<StealthResult> {
    return apiSendStealth(this.getApiConfig(), recipientMeta, amountSats, leafIndex);
  }

  // ==========================================================================
  // PDA Derivation
  // ==========================================================================

  derivePoolStatePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool_state")],
      this.programId
    );
  }

  deriveLightClientPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("btc_light_client")],
      this.programId
    );
  }

  deriveCommitmentTreePDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commitment_tree")],
      this.programId
    );
  }

  deriveBlockHeaderPDA(height: number): [PublicKey, number] {
    const heightBuffer = Buffer.alloc(8);
    heightBuffer.writeBigUInt64LE(BigInt(height));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("block_header"), heightBuffer],
      this.programId
    );
  }

  deriveDepositRecordPDA(txid: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), txid],
      this.programId
    );
  }

  deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), nullifierHash],
      this.programId
    );
  }

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
  // Helper Methods
  // ==========================================================================

  /**
   * Restore deposit credentials from a claim link
   */
  async restoreFromClaimLink(link: string): Promise<DepositCredentials | null> {
    const note = parseClaimLink(link);
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

  validateBtcAddress(address: string): boolean {
    return isValidBitcoinAddress(address).valid;
  }

  validateClaimLink(link: string): boolean {
    return parseClaimLink(link) !== null;
  }

  // ==========================================================================
  // Merkle State Management (for local testing)
  // ==========================================================================

  insertCommitment(commitment: Uint8Array): number {
    const index = this.merkleState.leaves.length;
    this.merkleState.leaves.push(new Uint8Array(commitment));

    const isLeft = index % 2 === 0;
    if (isLeft && this.merkleState.filledSubtrees[0]) {
      this.merkleState.filledSubtrees[0] = new Uint8Array(commitment);
    }

    return index;
  }

  getMerkleRoot(): Uint8Array {
    return this.merkleState.root;
  }

  getLeafCount(): number {
    return this.merkleState.leaves.length;
  }

  private generateMerkleProofForNote(note: Note): MerkleProof {
    const leafIndex = this.findLeafIndex(note.commitmentBytes);
    if (leafIndex !== -1) {
      return this.generateMerkleProof(leafIndex);
    }
    return createEmptyMerkleProof();
  }

  private findLeafIndex(commitment: Uint8Array): number {
    for (let i = 0; i < this.merkleState.leaves.length; i++) {
      if (this.arraysEqual(this.merkleState.leaves[i], commitment)) {
        return i;
      }
    }
    return -1;
  }

  private generateMerkleProof(leafIndex: number): MerkleProof {
    const pathIndices = leafIndexToPathIndices(leafIndex);
    const pathElements: Uint8Array[] = [];

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

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

/**
 * Create a new ZVault client (Solana Devnet)
 */
export function createClient(connection: Connection): ZVaultClient {
  return new ZVaultClient(connection, ZVAULT_PROGRAM_ID);
}

// Re-export types from api.ts
export type {
  DepositResult,
  WithdrawResult,
  StealthResult,
} from "./api";

export type { ClaimResult as ApiClaimResult } from "./api";
export type { SplitResult as ApiSplitResult } from "./api";
