/**
 * ZVault Client - Main SDK Entry Point
 *
 * Provides high-level APIs for the complete zVault flow:
 *
 * ## DEPOSIT (BTC → zkBTC)
 * - deposit() - Generate deposit credentials (taproot address + claim link)
 * - claimNote() - Claim zkBTC tokens with ZK proof
 * - claimPublic() - Claim zkBTC to public wallet (reveals amount)
 * - sendStealth() - Send to specific recipient via stealth ECDH
 *
 * ## TRANSFER (zkBTC → Someone)
 * - splitNote() - Split one note into two outputs
 * - createClaimLink() - Create shareable claim URL (off-chain)
 *
 * ## WITHDRAW (zkBTC → BTC)
 * - withdraw() - Request BTC withdrawal (burn zkBTC)
 *
 * Note: This SDK uses Noir circuits with Poseidon2 hashing for ZK proofs.
 */

import {
  type Address,
} from "@solana/kit";

import {
  ZVAULT_PROGRAM_ID,
  derivePoolStatePDA,
  deriveLightClientPDA,
  deriveCommitmentTreePDA,
  deriveBlockHeaderPDA,
  deriveDepositRecordPDA,
  deriveNullifierRecordPDA,
  deriveStealthAnnouncementPDA,
  commitmentToBytes,
} from "./pda";

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
  depositToNote as apiDeposit,
  withdraw as apiWithdraw,
  claimNote as apiClaimNote,
  splitNote as apiSplitNote,
  createClaimLinkFromNote as apiCreateClaimLink,
  sendStealth as apiSendStealth,
  type DepositResult,
  type WithdrawResult,
  type ClaimResult as ApiClaimResultType,
  type SplitResult as ApiSplitResultType,
  type StealthResult,
  type ApiClientConfig,
  type StealthMetaAddress,
} from "./api";

// Re-export program ID from pda module
export { ZVAULT_PROGRAM_ID } from "./pda";

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
  recipient: Address;
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
  /** Index map for O(1) commitment lookups */
  leafIndex: Map<string, number>;
  filledSubtrees: Uint8Array[];
  root: Uint8Array;
}

/** Convert Uint8Array to hex string for Map key */
function toHexKey(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * ZVault SDK Client
 *
 * Provides high-level APIs for all zVault operations.
 *
 * ## Quick Start
 * ```typescript
 * const client = createClient(rpc);
 * client.setPayer(myKeypair);
 *
 * // 1. Generate deposit credentials
 * const deposit = await client.deposit(100_000n);
 * console.log('Send BTC to:', deposit.taprootAddress);
 *
 * // 2. Claim zkBTC after BTC confirmed
 * const claimed = await client.claimNote(deposit.claimLink);
 *
 * // 3. Split into two notes
 * const { output1, output2 } = await client.splitNote(deposit.note, 60_000n);
 *
 * // 4. Create shareable claim link
 * const link = client.createClaimLink(output1);
 * ```
 */
export class ZVaultClient {
  private rpc: ApiClientConfig["rpc"];
  private programId: Address;
  private merkleState: LocalMerkleState;
  private payer?: ApiClientConfig["payer"];

  constructor(
    rpc: ApiClientConfig["rpc"],
    programId: Address = ZVAULT_PROGRAM_ID
  ) {
    this.rpc = rpc;
    this.programId = programId;
    this.merkleState = {
      leaves: [],
      leafIndex: new Map(),
      filledSubtrees: Array(TREE_DEPTH).fill(null).map(() => new Uint8Array(ZERO_VALUE)),
      root: new Uint8Array(ZERO_VALUE),
    };
  }

  /**
   * Set the payer keypair for transactions
   */
  setPayer(payer: ApiClientConfig["payer"]): void {
    this.payer = payer;
  }

  /**
   * Get API client config for use with api.ts functions
   */
  private getApiConfig(): ApiClientConfig {
    return {
      rpc: this.rpc,
      programId: this.programId,
      payer: this.payer,
    };
  }

  // ==========================================================================
  // DEPOSIT Functions (BTC → zkBTC)
  // ==========================================================================

  /**
   * Generate deposit credentials
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
   * Claim zkBTC with ZK proof
   *
   * Claims zkBTC tokens to wallet using ZK proof of commitment ownership.
   */
  async claimNote(claimLinkOrNote: string | Note): Promise<ApiClaimResultType> {
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
    return apiClaimNote(this.getApiConfig(), note, merkleProof);
  }

  /**
   * Send to specific recipient via dual-key ECDH (for new deposits)
   */
  async sendStealth(
    recipientMeta: StealthMetaAddress,
    amountSats: bigint,
    leafIndex: number = 0
  ): Promise<StealthResult> {
    return apiSendStealth(this.getApiConfig(), recipientMeta, amountSats, leafIndex);
  }

  // ==========================================================================
  // TRANSFER Functions (zkBTC → Someone)
  // ==========================================================================

  /**
   * Split one note into two outputs
   */
  async splitNote(inputNote: Note, amount1: bigint): Promise<ApiSplitResultType> {
    const merkleProof = this.generateMerkleProofForNote(inputNote);
    return apiSplitNote(this.getApiConfig(), inputNote, amount1, merkleProof);
  }

  /**
   * Create shareable claim link (off-chain)
   */
  createClaimLink(note: Note, baseUrl?: string): string {
    return apiCreateClaimLink(note, baseUrl);
  }

  // ==========================================================================
  // WITHDRAW Functions (zkBTC → BTC)
  // ==========================================================================

  /**
   * Request BTC withdrawal
   *
   * Burns zkBTC and creates redemption request. Relayer will send BTC.
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

  // ==========================================================================
  // PDA Derivation (delegated to shared pda module)
  // ==========================================================================

  derivePoolStatePDA(): Promise<[Address, number]> {
    return derivePoolStatePDA(this.programId);
  }

  deriveLightClientPDA(): Promise<[Address, number]> {
    return deriveLightClientPDA(this.programId);
  }

  deriveCommitmentTreePDA(): Promise<[Address, number]> {
    return deriveCommitmentTreePDA(this.programId);
  }

  deriveBlockHeaderPDA(height: number): Promise<[Address, number]> {
    return deriveBlockHeaderPDA(height, this.programId);
  }

  deriveDepositRecordPDA(txid: Uint8Array): Promise<[Address, number]> {
    return deriveDepositRecordPDA(txid, this.programId);
  }

  deriveNullifierRecordPDA(nullifierHash: Uint8Array): Promise<[Address, number]> {
    return deriveNullifierRecordPDA(nullifierHash, this.programId);
  }

  deriveStealthAnnouncementPDA(commitment: bigint): Promise<[Address, number]> {
    const commitmentBuffer = commitmentToBytes(commitment);
    return deriveStealthAnnouncementPDA(commitmentBuffer, this.programId);
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
    const commitmentCopy = new Uint8Array(commitment);
    this.merkleState.leaves.push(commitmentCopy);

    // Add to index map for O(1) lookup
    this.merkleState.leafIndex.set(toHexKey(commitmentCopy), index);

    const isLeft = index % 2 === 0;
    if (isLeft && this.merkleState.filledSubtrees[0]) {
      this.merkleState.filledSubtrees[0] = commitmentCopy;
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
    // O(1) lookup using index map
    const key = toHexKey(commitment);
    const index = this.merkleState.leafIndex.get(key);
    return index ?? -1;
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

}

/**
 * Create a new ZVault client (Solana Devnet)
 */
export function createClient(rpc: ApiClientConfig["rpc"]): ZVaultClient {
  return new ZVaultClient(rpc, ZVAULT_PROGRAM_ID);
}

// Re-export types from api.ts
export type {
  DepositResult,
  WithdrawResult,
  StealthResult,
} from "./api";

export type { ClaimResult as ApiClaimResult } from "./api";
export type { SplitResult as ApiSplitResult } from "./api";
