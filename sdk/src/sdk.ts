/**
 * ZVault SDK Instance
 *
 * Instance-based SDK with namespaced methods for all zVault operations.
 *
 * @example
 * ```typescript
 * import { createZVaultSDK } from "@zvault/sdk";
 *
 * const sdk = createZVaultSDK({
 *   programId: "YourProgramId...",
 *   network: "devnet",
 *   rpcUrl: "https://custom-rpc.example.com",
 * });
 *
 * const note = sdk.generateNote(100_000n);
 * const ix = sdk.instructions.claim({ ... });
 * ```
 *
 * @module sdk
 */

import type { Address } from "@solana/kit";
import type { ZVaultSDKConfig, ResolvedConfig } from "./types/config";
import { resolveConfig } from "./config/resolver";
import { initPoseidon } from "./poseidon";

// Import core modules
import {
  generateNote as _generateNote,
  createNoteFromSecrets as _createNoteFromSecrets,
  serializeNote,
  deserializeNote,
  noteHasComputedHashes,
  formatBtc,
  parseBtc,
  type Note,
  type SerializedNote,
} from "./note";

// Import PDA derivation
import {
  PDA_SEEDS,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveNullifierRecordPDA,
  deriveStealthAnnouncementPDA,
  deriveDepositRecordPDA,
  deriveLightClientPDA,
  deriveBlockHeaderPDA,
  deriveNameRegistryPDA,
  deriveYieldPoolPDA,
  derivePoolCommitmentTreePDA,
  derivePoolNullifierPDA,
  deriveStealthPoolAnnouncementPDA,
  commitmentToBytes,
} from "./pda";

// Import instruction types
import type {
  Instruction,
  ClaimInstructionOptions,
  SplitInstructionOptions,
  SpendPartialPublicInstructionOptions,
  PoolDepositInstructionOptions,
  PoolWithdrawInstructionOptions,
  PoolClaimYieldInstructionOptions,
  RedemptionRequestInstructionOptions,
} from "./instructions";

// Import instruction builders
import {
  buildClaimInstructionData,
  buildSplitInstructionData,
  buildSpendPartialPublicInstructionData,
  buildPoolDepositInstructionData,
  buildPoolWithdrawInstructionData,
  buildPoolClaimYieldInstructionData,
  buildRedemptionRequestInstructionData,
  buildVerifyFromBufferInstruction as _buildVerifyFromBufferInstruction,
  buildPartialPublicVerifierInputs,
  buildSplitVerifierInputs,
  INSTRUCTION_DISCRIMINATORS,
} from "./instructions";

// Import prover types
import type {
  ProofData,
  CircuitType,
  ClaimInputs,
  SpendSplitInputs,
  SpendPartialPublicInputs,
  PoolDepositInputs,
  PoolWithdrawInputs,
  PoolClaimYieldInputs,
  MerkleProofInput,
} from "./prover/web";

// =============================================================================
// SDK Version
// =============================================================================

export const SDK_VERSION = "2.1.0";

// =============================================================================
// InstructionBuilders Class
// =============================================================================

/**
 * Namespaced instruction builders.
 * Each method builds the instruction data and complete instruction.
 */
export class InstructionBuilders {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Build claim instruction data
   */
  claimData(options: {
    proofBytes: Uint8Array;
    root: Uint8Array;
    nullifierHash: Uint8Array;
    amountSats: bigint;
    recipient: Address;
    vkHash: Uint8Array;
  }): Uint8Array {
    return buildClaimInstructionData(options);
  }

  /**
   * Build complete claim instruction
   */
  claim(options: Omit<ClaimInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("claim");

    const data = this.claimData({
      proofBytes: options.proofBytes,
      root: options.root,
      nullifierHash: options.nullifierHash,
      amountSats: options.amountSats,
      recipient: options.recipient,
      vkHash,
    });

    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
      { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
      { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
      { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: this.config.token2022ProgramId, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
    ];


    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build split instruction data
   */
  splitData(options: {
    proofBytes: Uint8Array;
    root: Uint8Array;
    nullifierHash: Uint8Array;
    outputCommitment1: Uint8Array;
    outputCommitment2: Uint8Array;
    vkHash: Uint8Array;
    output1EphemeralPubX: Uint8Array;
    output1EncryptedAmountWithSign: Uint8Array;
    output2EphemeralPubX: Uint8Array;
    output2EncryptedAmountWithSign: Uint8Array;
  }): Uint8Array {
    return buildSplitInstructionData(options);
  }

  /**
   * Build complete split instruction
   */
  split(options: Omit<SplitInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("split");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");

    const data = this.splitData({
      proofBytes: options.proofBytes,
      root: options.root,
      nullifierHash: options.nullifierHash,
      outputCommitment1: options.outputCommitment1,
      outputCommitment2: options.outputCommitment2,
      vkHash,
      output1EphemeralPubX: options.output1EphemeralPubX,
      output1EncryptedAmountWithSign: options.output1EncryptedAmountWithSign,
      output2EphemeralPubX: options.output2EphemeralPubX,
      output2EncryptedAmountWithSign: options.output2EncryptedAmountWithSign,
    });

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
      { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
      { address: options.accounts.stealthAnnouncement1, role: AccountRole.WRITABLE },
      { address: options.accounts.stealthAnnouncement2, role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build spend partial public instruction data
   */
  spendPartialPublicData(options: {
    proofBytes: Uint8Array;
    root: Uint8Array;
    nullifierHash: Uint8Array;
    publicAmountSats: bigint;
    changeCommitment: Uint8Array;
    recipient: Address;
    vkHash: Uint8Array;
    changeEphemeralPubX: Uint8Array;
    changeEncryptedAmountWithSign: Uint8Array;
  }): Uint8Array {
    return buildSpendPartialPublicInstructionData(options);
  }

  /**
   * Build complete spend partial public instruction
   */
  spendPartialPublic(
    options: Omit<SpendPartialPublicInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }
  ): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("spendPartialPublic");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");

    const data = this.spendPartialPublicData({
      proofBytes: options.proofBytes,
      root: options.root,
      nullifierHash: options.nullifierHash,
      publicAmountSats: options.publicAmountSats,
      changeCommitment: options.changeCommitment,
      recipient: options.recipient,
      vkHash,
      changeEphemeralPubX: options.changeEphemeralPubX,
      changeEncryptedAmountWithSign: options.changeEncryptedAmountWithSign,
    });

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
      { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
      { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
      { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: this.config.token2022ProgramId, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
      { address: options.accounts.stealthAnnouncementChange, role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build pool deposit instruction
   */
  poolDeposit(
    options: Omit<PoolDepositInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }
  ): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("poolDeposit");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

    const data = buildPoolDepositInstructionData({
      proofBytes: options.proofBytes,
      root: options.root,
      nullifierHash: options.nullifierHash,
      poolCommitment: options.poolCommitment,
      amountSats: options.amountSats,
      vkHash,
    });

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
      { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
      { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build pool withdraw instruction
   */
  poolWithdraw(
    options: Omit<PoolWithdrawInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }
  ): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("poolWithdraw");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

    const data = buildPoolWithdrawInstructionData({
      proofBytes: options.proofBytes,
      poolRoot: options.poolRoot,
      poolNullifierHash: options.poolNullifierHash,
      amountSats: options.amountSats,
      outputCommitment: options.outputCommitment,
      vkHash,
    });

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
      { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
      { address: options.accounts.poolCommitmentTree, role: AccountRole.READONLY },
      { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build pool claim yield instruction
   */
  poolClaimYield(
    options: Omit<PoolClaimYieldInstructionOptions, "vkHash"> & { vkHash?: Uint8Array }
  ): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const vkHash = options.vkHash ?? this.getVkHashBytes("poolClaimYield");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

    const data = buildPoolClaimYieldInstructionData({
      proofBytes: options.proofBytes,
      poolRoot: options.poolRoot,
      poolNullifierHash: options.poolNullifierHash,
      newPoolCommitment: options.newPoolCommitment,
      yieldAmountSats: options.yieldAmountSats,
      recipient: options.recipient,
      vkHash,
    });

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.READONLY },
      { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
      { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
      { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
      { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
      { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
      { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: this.config.token2022ProgramId, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.sunspotVerifierProgramId, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build redemption request instruction
   */
  redemptionRequest(options: RedemptionRequestInstructionOptions): Instruction {
    const { address, AccountRole } = require("@solana/kit");
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

    const data = buildRedemptionRequestInstructionData(options.amountSats, options.btcAddress);

    const accounts: Instruction["accounts"] = [
      { address: options.accounts.poolState, role: AccountRole.WRITABLE },
      { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
      { address: options.accounts.userTokenAccount, role: AccountRole.WRITABLE },
      { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: this.config.token2022ProgramId, role: AccountRole.READONLY },
    ];

    return {
      programAddress: this.config.zvaultProgramId,
      accounts,
      data,
    };
  }

  /**
   * Build verify from buffer instruction (for instruction introspection pattern)
   */
  verifyFromBuffer(options: {
    bufferAddress: Address;
    publicInputs: Uint8Array[];
    vkHash: Uint8Array;
  }): Instruction {
    const { AccountRole } = require("@solana/kit");

    // Verifier instruction discriminator
    const VERIFY_FROM_BUFFER_DISCRIMINATOR = 3;
    const piCount = options.publicInputs.length;
    const totalSize = 1 + 4 + piCount * 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = VERIFY_FROM_BUFFER_DISCRIMINATOR;
    view.setUint32(offset, piCount, true);
    offset += 4;

    for (const pi of options.publicInputs) {
      if (pi.length !== 32) {
        throw new Error(`Public input must be 32 bytes, got ${pi.length}`);
      }
      data.set(pi, offset);
      offset += 32;
    }

    data.set(options.vkHash, offset);

    return {
      programAddress: this.config.sunspotVerifierProgramId,
      accounts: [{ address: options.bufferAddress, role: AccountRole.READONLY }],
      data,
    };
  }

  /**
   * Build public inputs for partial public verifier
   */
  buildPartialPublicVerifierInputs = buildPartialPublicVerifierInputs;

  /**
   * Build public inputs for split verifier
   */
  buildSplitVerifierInputs = buildSplitVerifierInputs;

  /**
   * Instruction discriminators
   */
  readonly discriminators = INSTRUCTION_DISCRIMINATORS;

  /**
   * Get VK hash bytes for a circuit type
   */
  private getVkHashBytes(
    circuit: "claim" | "split" | "spendPartialPublic" | "poolDeposit" | "poolWithdraw" | "poolClaimYield"
  ): Uint8Array {
    const hexHash = this.config.vkHashes[circuit];
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hexHash.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}

// =============================================================================
// PDADerivation Class
// =============================================================================

/**
 * Namespaced PDA derivation methods.
 */
export class PDADerivation {
  constructor(private readonly config: ResolvedConfig) {}

  /** PDA seed constants */
  readonly seeds = PDA_SEEDS;

  /** Derive Pool State PDA */
  poolState(): Promise<[Address, number]> {
    return derivePoolStatePDA(this.config.zvaultProgramId);
  }

  /** Derive Commitment Tree PDA */
  commitmentTree(): Promise<[Address, number]> {
    return deriveCommitmentTreePDA(this.config.zvaultProgramId);
  }

  /** Derive Nullifier Record PDA */
  nullifierRecord(nullifierHash: Uint8Array): Promise<[Address, number]> {
    return deriveNullifierRecordPDA(nullifierHash, this.config.zvaultProgramId);
  }

  /** Derive Stealth Announcement PDA */
  stealthAnnouncement(ephemeralPubOrCommitment: Uint8Array): Promise<[Address, number]> {
    return deriveStealthAnnouncementPDA(ephemeralPubOrCommitment, this.config.zvaultProgramId);
  }

  /** Derive Deposit Record PDA */
  depositRecord(txid: Uint8Array): Promise<[Address, number]> {
    return deriveDepositRecordPDA(txid, this.config.zvaultProgramId);
  }

  /** Derive BTC Light Client PDA */
  lightClient(): Promise<[Address, number]> {
    return deriveLightClientPDA(this.config.btcLightClientProgramId);
  }

  /** Derive Block Header PDA */
  blockHeader(height: number): Promise<[Address, number]> {
    return deriveBlockHeaderPDA(height, this.config.btcLightClientProgramId);
  }

  /** Derive Name Registry PDA */
  nameRegistry(nameHash: Uint8Array): Promise<[Address, number]> {
    return deriveNameRegistryPDA(nameHash, this.config.zvaultProgramId);
  }

  /** Derive Yield Pool PDA */
  yieldPool(poolId: Uint8Array): Promise<[Address, number]> {
    return deriveYieldPoolPDA(poolId, this.config.zvaultProgramId);
  }

  /** Derive Pool Commitment Tree PDA */
  poolCommitmentTree(poolId: Uint8Array): Promise<[Address, number]> {
    return derivePoolCommitmentTreePDA(poolId, this.config.zvaultProgramId);
  }

  /** Derive Pool Nullifier PDA */
  poolNullifier(poolId: Uint8Array, nullifierHash: Uint8Array): Promise<[Address, number]> {
    return derivePoolNullifierPDA(poolId, nullifierHash, this.config.zvaultProgramId);
  }

  /** Derive Stealth Pool Announcement PDA */
  stealthPoolAnnouncement(poolId: Uint8Array, commitment: Uint8Array): Promise<[Address, number]> {
    return deriveStealthPoolAnnouncementPDA(poolId, commitment, this.config.zvaultProgramId);
  }

  /** Convert bigint commitment to bytes */
  commitmentToBytes = commitmentToBytes;
}

// =============================================================================
// ProverInterface Class
// =============================================================================

/**
 * Namespaced prover methods.
 * Wraps the prover module with SDK configuration.
 */
export class ProverInterface {
  private _initialized = false;

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Initialize the prover (loads WASM modules)
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    // Lazy import to avoid bundling issues
    const { initProver, setCircuitPath } = await import("./prover/web");

    // Set circuit path from config
    setCircuitPath(this.config.circuitCdnUrl);

    await initProver();
    this._initialized = true;
  }

  /**
   * Check if prover is initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Generate claim proof
   */
  async generateClaimProof(inputs: ClaimInputs): Promise<ProofData> {
    await this.initialize();
    const { generateClaimProof } = await import("./prover/web");
    return generateClaimProof(inputs);
  }

  /**
   * Generate spend split proof
   */
  async generateSpendSplitProof(inputs: SpendSplitInputs): Promise<ProofData> {
    await this.initialize();
    const { generateSpendSplitProof } = await import("./prover/web");
    return generateSpendSplitProof(inputs);
  }

  /**
   * Generate spend partial public proof
   */
  async generateSpendPartialPublicProof(inputs: SpendPartialPublicInputs): Promise<ProofData> {
    await this.initialize();
    const { generateSpendPartialPublicProof } = await import("./prover/web");
    return generateSpendPartialPublicProof(inputs);
  }

  /**
   * Generate pool deposit proof
   */
  async generatePoolDepositProof(inputs: PoolDepositInputs): Promise<ProofData> {
    await this.initialize();
    const { generatePoolDepositProof } = await import("./prover/web");
    return generatePoolDepositProof(inputs);
  }

  /**
   * Generate pool withdraw proof
   */
  async generatePoolWithdrawProof(inputs: PoolWithdrawInputs): Promise<ProofData> {
    await this.initialize();
    const { generatePoolWithdrawProof } = await import("./prover/web");
    return generatePoolWithdrawProof(inputs);
  }

  /**
   * Generate pool claim yield proof
   */
  async generatePoolClaimYieldProof(inputs: PoolClaimYieldInputs): Promise<ProofData> {
    await this.initialize();
    const { generatePoolClaimYieldProof } = await import("./prover/web");
    return generatePoolClaimYieldProof(inputs);
  }

  /**
   * Convert proof to bytes for transaction
   */
  async proofToBytes(proof: ProofData): Promise<Uint8Array> {
    const { proofToBytes } = await import("./prover/web");
    return proofToBytes(proof);
  }

  /**
   * Check if a circuit exists
   */
  async circuitExists(circuitType: CircuitType): Promise<boolean> {
    const { circuitExists } = await import("./prover/web");
    return circuitExists(circuitType);
  }

  /**
   * Cleanup prover resources
   */
  async cleanup(): Promise<void> {
    const { cleanup } = await import("./prover/web");
    await cleanup();
    this._initialized = false;
  }
}

// =============================================================================
// ZVaultSDK Class
// =============================================================================

/**
 * Main ZVault SDK class.
 *
 * Provides instance-based access to all SDK functionality with namespaced methods.
 */
export class ZVaultSDK {
  private readonly _config: ResolvedConfig;
  private readonly _instructions: InstructionBuilders;
  private readonly _pda: PDADerivation;
  private readonly _prover: ProverInterface;
  private _poseidonInitialized = false;

  constructor(config: ZVaultSDKConfig) {
    this._config = resolveConfig(config);
    this._instructions = new InstructionBuilders(this._config);
    this._pda = new PDADerivation(this._config);
    this._prover = new ProverInterface(this._config);
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Get the zVault program ID */
  get programId(): Address {
    return this._config.zvaultProgramId;
  }

  /** Get the fully resolved configuration */
  get config(): ResolvedConfig {
    return this._config;
  }

  /** Get the SDK version */
  get version(): string {
    return SDK_VERSION;
  }

  // ---------------------------------------------------------------------------
  // Namespaced Modules
  // ---------------------------------------------------------------------------

  /** Instruction builders */
  get instructions(): InstructionBuilders {
    return this._instructions;
  }

  /** PDA derivation */
  get pda(): PDADerivation {
    return this._pda;
  }

  /** Prover interface */
  get prover(): ProverInterface {
    return this._prover;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the SDK (Poseidon, prover WASM, etc.)
   *
   * This is called automatically when needed, but can be called explicitly
   * for faster first operation.
   */
  async initialize(): Promise<void> {
    if (!this._poseidonInitialized) {
      await initPoseidon();
      this._poseidonInitialized = true;
    }
  }

  /**
   * Check if SDK is initialized
   */
  get isInitialized(): boolean {
    return this._poseidonInitialized;
  }

  // ---------------------------------------------------------------------------
  // Note Operations
  // ---------------------------------------------------------------------------

  /**
   * Generate a new note with random nullifier and secret
   *
   * @param amountSats - Amount in satoshis
   * @returns Note with secrets (hashes computed later by circuit)
   */
  generateNote(amountSats: bigint): Note {
    return _generateNote(amountSats);
  }

  /**
   * Create a note from known secrets
   */
  createNoteFromSecrets(
    nullifier: bigint,
    secret: bigint,
    amountSats: bigint,
    commitment?: bigint,
    nullifierHash?: bigint
  ): Note {
    return _createNoteFromSecrets(nullifier, secret, amountSats, commitment, nullifierHash);
  }

  /**
   * Serialize a note for storage
   */
  serializeNote(note: Note): SerializedNote {
    return serializeNote(note);
  }

  /**
   * Deserialize a note from storage
   */
  deserializeNote(data: SerializedNote): Note {
    return deserializeNote(data);
  }

  /**
   * Check if a note has computed hash values
   */
  noteHasComputedHashes(note: Note): boolean {
    return noteHasComputedHashes(note);
  }

  // ---------------------------------------------------------------------------
  // Utility Functions
  // ---------------------------------------------------------------------------

  /**
   * Format satoshis as BTC string
   */
  formatBtc(sats: bigint): string {
    return formatBtc(sats);
  }

  /**
   * Parse BTC string to satoshis
   */
  parseBtc(btcString: string): bigint {
    return parseBtc(btcString);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ZVault SDK instance.
 *
 * @example
 * ```typescript
 * import { createZVaultSDK } from "@zvault/sdk";
 *
 * const sdk = createZVaultSDK({
 *   programId: "YourProgramId...",
 *   network: "devnet",
 * });
 *
 * // Generate a note
 * const note = sdk.generateNote(100_000n);
 *
 * // Build an instruction
 * const ix = sdk.instructions.claim({ ... });
 * ```
 */
export function createZVaultSDK(config: ZVaultSDKConfig): ZVaultSDK {
  return new ZVaultSDK(config);
}

// =============================================================================
// Type Exports
// =============================================================================

export type {
  Note,
  SerializedNote,
  Instruction,
  ClaimInstructionOptions,
  SplitInstructionOptions,
  SpendPartialPublicInstructionOptions,
  PoolDepositInstructionOptions,
  PoolWithdrawInstructionOptions,
  PoolClaimYieldInstructionOptions,
  RedemptionRequestInstructionOptions,
  ProofData,
  CircuitType,
  ClaimInputs,
  SpendSplitInputs,
  SpendPartialPublicInputs,
  PoolDepositInputs,
  PoolWithdrawInputs,
  PoolClaimYieldInputs,
  MerkleProofInput,
};
