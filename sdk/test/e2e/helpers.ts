/**
 * E2E Test Helpers
 *
 * Common test utilities for E2E tests.
 * Provides real proof generation, note creation, and assertion helpers.
 *
 * NOTE: For full stealth flow with real proofs, use stealth-helpers.ts:
 * - generateTestKeys() - Deterministic key generation
 * - createAndSubmitStealthDeposit() - Full stealth deposit flow
 * - scanAndPrepareClaim() - Scan + prepare claim inputs
 * - checkNullifierExists() - Verify nullifier spent
 *
 * REAL PROOF GENERATION:
 * - generateRealClaimProof() - Generate UltraHonk claim proof
 * - generateRealSpendSplitProof() - Generate UltraHonk split proof
 * - generateRealSpendPartialPublicProof() - Generate UltraHonk partial public proof
 *
 * MERKLE TREE:
 * - createRealMerkleProof() - Create Merkle proof using real commitment tree
 */

import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { address, type Address } from "@solana/kit";

import {
  computeUnifiedCommitmentSync,
  computeNullifierSync,
  hashNullifierSync,
  poseidonHashSync,
  initPoseidon,
  merkleHashSync,
} from "../../src/poseidon";
import { randomFieldElement, bigintToBytes, bytesToBigint } from "../../src/crypto";
import { derivePoolStatePDA, deriveCommitmentTreePDA, deriveNullifierRecordPDA } from "../../src/pda";
import { DEMO_INSTRUCTION, buildAddDemoStealthData } from "../../src/demo";
import {
  generateGrumpkinKeyPair,
  pointToCompressedBytes,
} from "../../src/crypto";

/** Real proof size in bytes (~10KB for UltraHonk) */
export const REAL_PROOF_SIZE = 10 * 1024;

/** @deprecated Use REAL_PROOF_SIZE */
export const MOCK_PROOF_SIZE = REAL_PROOF_SIZE;

// =============================================================================
// Types
// =============================================================================

export interface TestNote {
  /** Private key (spending key) */
  privKey: bigint;
  /** Public key X-coordinate */
  pubKeyX: bigint;
  /** Amount in satoshis */
  amount: bigint;
  /** Commitment = Poseidon(pubKeyX, amount) */
  commitment: bigint;
  /** Commitment as 32 bytes */
  commitmentBytes: Uint8Array;
  /** Leaf index in the commitment tree */
  leafIndex: bigint;
  /** Nullifier = Poseidon(privKey, leafIndex) */
  nullifier: bigint;
  /** Nullifier hash = Poseidon(nullifier) */
  nullifierHash: bigint;
  /** Nullifier hash as 32 bytes */
  nullifierHashBytes: Uint8Array;
}

export interface MerkleProof {
  /** Sibling hashes at each level */
  siblings: bigint[];
  /** Path indices (0 = left, 1 = right) at each level */
  indices: number[];
  /** Merkle root */
  root: bigint;
}

// =============================================================================
// Constants
// =============================================================================

/** Standard tree depth for commitment tree */
export const TREE_DEPTH = 20;

/** Minimum deposit in satoshis (0.0001 BTC) */
export const MIN_DEPOSIT_SATS = 10_000n;

/** Common test amounts */
export const TEST_AMOUNTS = {
  small: 100_000n, // 0.001 BTC
  medium: 1_000_000n, // 0.01 BTC
  large: 10_000_000n, // 0.1 BTC
  btc: 100_000_000n, // 1 BTC
};

// =============================================================================
// Note Creation
// =============================================================================

/**
 * Create a test note with computed commitment and nullifier
 *
 * Uses the unified model:
 * - Commitment = Poseidon(pubKeyX, amount)
 * - Nullifier = Poseidon(privKey, leafIndex)
 */
export function createTestNote(
  amount: bigint,
  leafIndex: bigint = 0n,
  privKey?: bigint
): TestNote {
  // Generate or use provided private key
  const pk = privKey ?? randomFieldElement();

  // For testing, we use privKey as pubKeyX since we're not doing real EC operations
  // In production, pubKeyX would be derived from privKey via Grumpkin curve
  const pubKeyX = randomFieldElement();

  // Compute commitment = Poseidon(pubKeyX, amount)
  const commitment = computeUnifiedCommitmentSync(pubKeyX, amount);
  const commitmentBytes = bigintToBytes(commitment, 32);

  // Compute nullifier = Poseidon(privKey, leafIndex)
  const nullifier = computeNullifierSync(pk, leafIndex);
  const nullifierHash = hashNullifierSync(nullifier);
  const nullifierHashBytes = bigintToBytes(nullifierHash, 32);

  return {
    privKey: pk,
    pubKeyX,
    amount,
    commitment,
    commitmentBytes,
    leafIndex,
    nullifier,
    nullifierHash,
    nullifierHashBytes,
  };
}

/**
 * Create multiple test notes
 */
export function createTestNotes(
  amounts: bigint[],
  startLeafIndex: bigint = 0n
): TestNote[] {
  return amounts.map((amount, i) =>
    createTestNote(amount, startLeafIndex + BigInt(i))
  );
}

// =============================================================================
// Real Proof Generation
// =============================================================================

/**
 * Generate real UltraHonk claim proof
 *
 * Uses the Noir circuit and bb.js to generate a real proof.
 */
export async function generateRealClaimProof(
  note: TestNote,
  merkleProof: MerkleProof,
  recipient: bigint
): Promise<Uint8Array> {
  const { generateClaimProof } = await import("../../src/prover/web");

  const proofData = await generateClaimProof({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: note.leafIndex,
    merkleRoot: merkleProof.root,
    merkleProof: {
      siblings: merkleProof.siblings,
      indices: merkleProof.indices,
    },
    recipient,
  });

  return proofData.proof;
}

/**
 * Generate real UltraHonk spend split proof
 */
export async function generateRealSpendSplitProof(
  note: TestNote,
  merkleProof: MerkleProof,
  output1: { pubKeyX: bigint; amount: bigint; ephemeralPubX: bigint; encryptedAmountWithSign: bigint },
  output2: { pubKeyX: bigint; amount: bigint; ephemeralPubX: bigint; encryptedAmountWithSign: bigint }
): Promise<Uint8Array> {
  const { generateSpendSplitProof } = await import("../../src/prover/web");

  const proofData = await generateSpendSplitProof({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: note.leafIndex,
    merkleRoot: merkleProof.root,
    merkleProof: {
      siblings: merkleProof.siblings,
      indices: merkleProof.indices,
    },
    output1PubKeyX: output1.pubKeyX,
    output1Amount: output1.amount,
    output2PubKeyX: output2.pubKeyX,
    output2Amount: output2.amount,
    output1EphemeralPubX: output1.ephemeralPubX,
    output1EncryptedAmountWithSign: output1.encryptedAmountWithSign,
    output2EphemeralPubX: output2.ephemeralPubX,
    output2EncryptedAmountWithSign: output2.encryptedAmountWithSign,
  });

  return proofData.proof;
}

/**
 * Generate real UltraHonk spend partial public proof
 */
export async function generateRealSpendPartialPublicProof(
  note: TestNote,
  merkleProof: MerkleProof,
  publicAmount: bigint,
  change: { pubKeyX: bigint; amount: bigint; ephemeralPubX: bigint; encryptedAmountWithSign: bigint },
  recipient: bigint
): Promise<Uint8Array> {
  const { generateSpendPartialPublicProof } = await import("../../src/prover/web");

  const proofData = await generateSpendPartialPublicProof({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: note.leafIndex,
    merkleRoot: merkleProof.root,
    merkleProof: {
      siblings: merkleProof.siblings,
      indices: merkleProof.indices,
    },
    publicAmount,
    changePubKeyX: change.pubKeyX,
    changeAmount: change.amount,
    recipient,
    changeEphemeralPubX: change.ephemeralPubX,
    changeEncryptedAmountWithSign: change.encryptedAmountWithSign,
  });

  return proofData.proof;
}

/**
 * Create deterministic 32-byte value for testing (not a real hash)
 */
export function createTest32Bytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i * 7) % 256;
  }
  return bytes;
}

/**
 * Create random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Cached VK hashes from real circuits */
const cachedVkHashes: Map<string, Uint8Array> = new Map();
let vkHashesInitialized = false;

/**
 * Initialize VK hashes from compiled circuits
 *
 * Call this during test setup to preload real VK hashes.
 * Throws if circuits aren't compiled.
 */
export async function initVkHashes(): Promise<void> {
  if (vkHashesInitialized) return;

  const { getVkHash, circuitExists } = await import("../../src/prover/web");

  const circuits = ["claim", "spend_split", "spend_partial_public"] as const;

  for (const circuit of circuits) {
    if (await circuitExists(circuit)) {
      const hash = await getVkHash(circuit);
      cachedVkHashes.set(circuit, hash);
      console.log(`[VkHash] Loaded real VK hash for ${circuit}`);
    } else {
      throw new Error(`Circuit ${circuit} not found. Run: cd noir-circuits && bun run compile:all && bun run copy-to-sdk`);
    }
  }

  vkHashesInitialized = true;
}

/**
 * Get real VK hash for a circuit type
 *
 * @throws Error if VK hashes haven't been initialized
 */
export function getVkHashForCircuit(
  circuitType: "claim" | "spend_split" | "spend_partial_public"
): Uint8Array {
  const cached = cachedVkHashes.get(circuitType);
  if (!cached) {
    throw new Error(`VK hash for ${circuitType} not loaded. Call initVkHashes() first.`);
  }
  return cached;
}

/**
 * Check if real VK hashes are available
 */
export function hasRealVkHashes(): boolean {
  return cachedVkHashes.size > 0;
}

// =============================================================================
// Merkle Tree Utilities
// =============================================================================

/**
 * Compute Merkle root from a single commitment using zero siblings
 *
 * This mirrors what the Noir circuit does for a tree with one leaf.
 */
export function computeMerkleRootFromCommitment(
  commitment: bigint,
  depth: number = TREE_DEPTH
): bigint {
  let current = commitment;
  for (let i = 0; i < depth; i++) {
    // At each level, hash with zero sibling (left child)
    current = poseidonHashSync([current, 0n]);
  }
  return current;
}

/**
 * Create a Merkle proof for a commitment using a real commitment tree
 *
 * Inserts the commitment at index 0 and returns the real proof.
 */
export function createRealMerkleProof(
  commitment: bigint,
  depth: number = TREE_DEPTH
): MerkleProof {
  // Import and use real commitment tree
  const { CommitmentTreeIndex } = require("../../src/commitment-tree");
  const tree = new CommitmentTreeIndex();

  // Add the commitment to tree
  tree.addCommitment(commitment, 0n); // amount doesn't affect merkle tree

  // Get the real merkle proof
  const proof = tree.getMerkleProof(commitment);
  if (!proof) {
    throw new Error("Failed to get merkle proof for commitment");
  }

  return {
    siblings: proof.siblings,
    indices: proof.indices,
    root: proof.root,
  };
}

/**
 * Create a Merkle proof for multiple commitments
 *
 * Inserts all commitments and returns proof for the specified one.
 */
export function createRealMerkleProofWithMultiple(
  commitments: { commitment: bigint; amount: bigint }[],
  targetCommitment: bigint,
  depth: number = TREE_DEPTH
): MerkleProof {
  const { CommitmentTreeIndex } = require("../../src/commitment-tree");
  const tree = new CommitmentTreeIndex();

  // Add all commitments to tree
  for (const { commitment, amount } of commitments) {
    tree.addCommitment(commitment, amount);
  }

  // Get the real merkle proof
  const proof = tree.getMerkleProof(targetCommitment);
  if (!proof) {
    throw new Error("Failed to get merkle proof for commitment");
  }

  return {
    siblings: proof.siblings,
    indices: proof.indices,
    root: proof.root,
  };
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  commitment: bigint,
  proof: MerkleProof
): boolean {
  let current = commitment;

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const isLeft = proof.indices[i] === 0;

    if (isLeft) {
      current = poseidonHashSync([current, sibling]);
    } else {
      current = poseidonHashSync([sibling, current]);
    }
  }

  return current === proof.root;
}

// =============================================================================
// Stealth Address Helpers
// =============================================================================

/**
 * Create a stealth deposit announcement for testing
 *
 * Generates ephemeral key, commitment, and encrypted amount
 * as would be created during a real stealth deposit.
 */
export function createStealthAnnouncement(
  amount: bigint
): {
  ephemeralPub: Uint8Array;
  commitment: Uint8Array;
  encryptedAmount: Uint8Array;
  ephemeralPubX: bigint;
  encryptedAmountWithSign: bigint;
} {
  // Generate ephemeral key
  const ephemeralKey = generateGrumpkinKeyPair();
  const ephemeralPub = pointToCompressedBytes(ephemeralKey.pubKey);

  // Create commitment
  const commitment = randomBytes(32);

  // Encrypt amount (use amount bytes for testing)
  const encryptedAmount = new Uint8Array(8);
  const view = new DataView(encryptedAmount.buffer);
  view.setBigUint64(0, amount, true); // little-endian

  // Extract ephemeral pub x-coordinate for circuit input
  const ephemeralPubX = bytesToBigint(ephemeralPub.slice(0, 32));

  // Pack encrypted amount with y-sign bit (bit 64 = sign bit from compressed key)
  const ySign = ephemeralPub[32] & 1; // Sign bit is LSB of last byte for compressed format
  const encryptedAmountWithSign = amount | (BigInt(ySign) << 64n);

  return {
    ephemeralPub,
    commitment,
    encryptedAmount,
    ephemeralPubX,
    encryptedAmountWithSign,
  };
}

// =============================================================================
// PDA Helpers
// =============================================================================

/**
 * Derive nullifier record PDA from nullifier hash
 */
export async function deriveNullifierPDA(
  nullifierHashBytes: Uint8Array,
  programId: Address
): Promise<[Address, number]> {
  return deriveNullifierRecordPDA(nullifierHashBytes, programId);
}

/**
 * Check if a nullifier has been spent (PDA exists)
 */
export async function isNullifierSpent(
  connection: Connection,
  nullifierHashBytes: Uint8Array,
  programId: Address
): Promise<boolean> {
  const [nullifierPda] = await deriveNullifierRecordPDA(nullifierHashBytes, programId);
  const pubkey = new PublicKey(nullifierPda.toString());

  try {
    const info = await connection.getAccountInfo(pubkey);
    return info !== null;
  } catch {
    return false;
  }
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that two Uint8Arrays are equal
 */
export function assertBytesEqual(
  actual: Uint8Array,
  expected: Uint8Array,
  message?: string
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `${message || "Bytes mismatch"}: length ${actual.length} !== ${expected.length}`
    );
  }

  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${message || "Bytes mismatch"}: byte ${i} is ${actual[i]} !== ${expected[i]}`
      );
    }
  }
}

/**
 * Assert that an error contains expected message
 */
export function assertErrorContains(
  error: unknown,
  expectedMessage: string
): void {
  if (!(error instanceof Error)) {
    throw new Error(`Expected Error but got: ${typeof error}`);
  }

  if (!error.message.includes(expectedMessage)) {
    throw new Error(
      `Expected error message to contain "${expectedMessage}" but got: "${error.message}"`
    );
  }
}

// =============================================================================
// Byte Conversion Utilities
// =============================================================================

/**
 * Convert bigint to 32-byte array (big-endian)
 */
export function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert 32-byte array to bigint (big-endian)
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  }

  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// =============================================================================
// Demo Deposit Helper
// =============================================================================

/**
 * Build instruction data for adding a demo stealth announcement
 *
 * This is used to seed the commitment tree for testing.
 */
export function buildDemoStealthInstructionData(
  ephemeralPub: Uint8Array,
  commitment: Uint8Array,
  encryptedAmount: Uint8Array
): Uint8Array {
  return buildAddDemoStealthData(ephemeralPub, commitment, encryptedAmount);
}

/**
 * Create demo deposit for testing
 *
 * Returns both the note and the instruction data needed to add it on-chain.
 */
export function createDemoDeposit(amount: bigint): {
  note: TestNote;
  instructionData: Uint8Array;
  ephemeralPub: Uint8Array;
  stealthData: {
    ephemeralPubX: bigint;
    encryptedAmountWithSign: bigint;
  };
} {
  const note = createTestNote(amount, 0n);

  // Create stealth announcement
  const { ephemeralPub, encryptedAmount, ephemeralPubX, encryptedAmountWithSign } = createStealthAnnouncement(amount);

  // Build instruction data
  const instructionData = buildDemoStealthInstructionData(
    ephemeralPub,
    note.commitmentBytes,
    encryptedAmount
  );

  return {
    note,
    instructionData,
    ephemeralPub,
    stealthData: {
      ephemeralPubX,
      encryptedAmountWithSign,
    },
  };
}
