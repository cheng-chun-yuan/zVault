/**
 * Yield Pool (zkEarn) SDK - Stealth Address Based
 *
 * Privacy-preserving yield pool using stealth addresses (EIP-5564/DKSAP pattern):
 * - Only publish ephemeral pubkey on-chain
 * - Viewing key can scan for positions (ECDH)
 * - Spending key required to claim/withdraw
 *
 * Position Commitment = Poseidon2(stealthPub.x, principal, depositEpoch)
 *
 * Flow:
 * 1. Deposit: Generate ephemeral key, ECDH derive stealth key, create commitment
 * 2. Scan: Viewing key scans announcements via ECDH
 * 3. Claim/Withdraw: Spending key derives stealthPriv for ZK proof
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bigintToBytes, bytesToBigint } from "./crypto";
import { poseidon2Hash } from "./poseidon2";
import {
  generateKeyPair as generateGrumpkinKeyPair,
  ecdh as grumpkinEcdh,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  scalarFromBytes,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_ORDER,
  type GrumpkinPoint,
} from "./grumpkin";
import type { ZVaultKeys, StealthMetaAddress } from "./keys";
import { parseStealthMetaAddress } from "./keys";
import type { Note } from "./note";
import type { MerkleProof } from "./merkle";
import {
  generatePoolDepositProof,
  generatePoolWithdrawProof,
  generatePoolClaimYieldProof,
  type PoolDepositInputs,
  type PoolWithdrawInputs,
  type PoolClaimYieldInputs,
  type MerkleProofInput,
} from "./prover";

// ==========================================================================
// Operation Status Types
// ==========================================================================

/**
 * Steps in a pool operation
 */
export type PoolOperationStep =
  | "preparing"
  | "generating_proof"
  | "building_tx"
  | "sending_tx"
  | "confirming"
  | "complete"
  | "error";

/**
 * Status update for pool operations
 */
export interface PoolOperationStatus {
  step: PoolOperationStep;
  message: string;
  progress?: number; // 0-100
  error?: string;
}

/**
 * Progress callback for pool operations
 */
export type PoolOperationProgressCallback = (status: PoolOperationStatus) => void;

// ==========================================================================
// Types
// ==========================================================================

/**
 * Stealth pool position (what user stores locally after deposit)
 *
 * Unlike note-based approach, user only needs to store ephemeral info.
 * Position can be rediscovered by scanning with viewing key.
 */
export interface StealthPoolPosition {
  /** Pool ID this position belongs to */
  poolId: Uint8Array;

  /** Ephemeral public key (33 bytes compressed) - stored on-chain */
  ephemeralPub: Uint8Array;

  /** Principal amount in satoshis */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Computed stealth public key point */
  stealthPub: GrumpkinPoint;

  /** Pool commitment: Poseidon2(stealthPub.x, principal, depositEpoch) */
  commitment: bigint;

  /** Leaf index in pool commitment tree */
  leafIndex: number;

  /** Byte representations for on-chain use */
  commitmentBytes: Uint8Array;
}

/**
 * Scanned pool position (found by viewing key)
 *
 * Contains enough info for display but NOT for spending.
 * Spending requires deriving stealthPriv with spending key.
 */
export interface ScannedPoolPosition {
  /** Pool ID */
  poolId: Uint8Array;

  /** Ephemeral public key from announcement */
  ephemeralPub: GrumpkinPoint;

  /** Principal amount */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Computed stealth public key */
  stealthPub: GrumpkinPoint;

  /** Pool commitment */
  commitment: Uint8Array;

  /** Leaf index in tree */
  leafIndex: number;

  /** Created timestamp */
  createdAt: number;
}

/**
 * Prepared claim/withdraw inputs (requires spending key)
 */
export interface StealthPoolClaimInputs {
  /** Stealth private key (spendingPriv + hash(sharedSecret)) */
  stealthPrivKey: bigint;

  /** Principal amount */
  principal: bigint;

  /** Deposit epoch */
  depositEpoch: bigint;

  /** Leaf index */
  leafIndex: number;

  /** Merkle proof elements */
  merklePath: bigint[];

  /** Merkle path indices */
  merkleIndices: number[];

  /** Pool merkle root */
  merkleRoot: bigint;

  /** Nullifier: Poseidon2(stealthPriv, leafIndex) */
  nullifier: bigint;

  /** Nullifier hash for on-chain */
  nullifierHash: bigint;
}

/**
 * Serializable pool position for storage
 */
export interface SerializedStealthPoolPosition {
  poolId: string;
  ephemeralPub: string;
  principal: string;
  depositEpoch: string;
  stealthPubX: string;
  stealthPubY: string;
  commitment: string;
  leafIndex: number;
}

/**
 * Yield pool configuration (on-chain state)
 */
export interface YieldPoolConfig {
  poolId: Uint8Array;
  yieldRateBps: number;
  epochDuration: number;
  currentEpoch: bigint;
  totalPrincipal: bigint;
  paused: boolean;
}

/**
 * Result from depositing to pool
 */
export interface DepositToPoolResult {
  position: StealthPoolPosition;
  signature?: string;
}

/**
 * Result from withdrawing from pool
 */
export interface WithdrawFromPoolResult {
  outputNote: Note;
  yieldEarned: bigint;
  signature?: string;
}

/**
 * Result from claiming yield
 */
export interface ClaimPoolYieldResult {
  newPosition: StealthPoolPosition;
  yieldNote: Note;
  yieldAmount: bigint;
  signature?: string;
}

/**
 * Result from compounding yield
 */
export interface CompoundYieldResult {
  newPosition: StealthPoolPosition;
  compoundedAmount: bigint;
  signature?: string;
}

/**
 * On-chain stealth pool announcement
 */
export interface OnChainStealthPoolAnnouncement {
  poolId: Uint8Array;
  ephemeralPub: Uint8Array;
  principal: bigint;
  depositEpoch: bigint;
  poolCommitment: Uint8Array;
  leafIndex: number;
  createdAt: number;
}

// ==========================================================================
// Constants
// ==========================================================================

/** Discriminator for CREATE_YIELD_POOL instruction */
export const CREATE_YIELD_POOL_DISCRIMINATOR = 30;

/** Discriminator for DEPOSIT_TO_POOL instruction */
export const DEPOSIT_TO_POOL_DISCRIMINATOR = 31;

/** Discriminator for WITHDRAW_FROM_POOL instruction */
export const WITHDRAW_FROM_POOL_DISCRIMINATOR = 32;

/** Discriminator for CLAIM_POOL_YIELD instruction */
export const CLAIM_POOL_YIELD_DISCRIMINATOR = 33;

/** Discriminator for COMPOUND_YIELD instruction */
export const COMPOUND_YIELD_DISCRIMINATOR = 34;

/** Discriminator for UPDATE_YIELD_RATE instruction */
export const UPDATE_YIELD_RATE_DISCRIMINATOR = 35;

/** Discriminator for HARVEST_YIELD instruction */
export const HARVEST_YIELD_DISCRIMINATOR = 36;

/** Seed for YieldPool PDA */
export const YIELD_POOL_SEED = "yield_pool";

/** Seed for PoolCommitmentTree PDA */
export const POOL_COMMITMENT_TREE_SEED = "pool_commitment_tree";

/** Seed for PoolNullifierRecord PDA */
export const POOL_NULLIFIER_SEED = "pool_nullifier";

/** Seed for StealthPoolAnnouncement PDA */
export const STEALTH_POOL_ANNOUNCEMENT_SEED = "stealth_pool_ann";

/** YieldPool discriminator */
export const YIELD_POOL_DISCRIMINATOR = 0x10;

/** PoolCommitmentTree discriminator */
export const POOL_COMMITMENT_TREE_DISCRIMINATOR = 0x12;

/** StealthPoolAnnouncement discriminator */
export const STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR = 0x13;

/** StealthPoolAnnouncement account size */
export const STEALTH_POOL_ANNOUNCEMENT_SIZE = 136;

/** Domain separator for stealth key derivation */
const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-pool-stealth-v1");

// ==========================================================================
// Stealth Key Derivation (EIP-5564/DKSAP Pattern)
// ==========================================================================

/**
 * Derive stealth scalar from shared secret
 *
 * stealthScalar = hash(sharedSecret || domain) mod order
 */
function deriveStealthScalar(sharedSecret: GrumpkinPoint): bigint {
  const sharedBytes = pointToCompressedBytes(sharedSecret);
  const hashInput = new Uint8Array(sharedBytes.length + STEALTH_KEY_DOMAIN.length);
  hashInput.set(sharedBytes, 0);
  hashInput.set(STEALTH_KEY_DOMAIN, sharedBytes.length);
  const hash = sha256(hashInput);
  return scalarFromBytes(hash);
}

/**
 * Derive stealth public key (EIP-5564 pattern)
 *
 * stealthPub = spendingPub + hash(sharedSecret) * G
 */
function deriveStealthPubKey(
  spendingPub: GrumpkinPoint,
  sharedSecret: GrumpkinPoint
): GrumpkinPoint {
  const scalar = deriveStealthScalar(sharedSecret);
  const scalarPoint = pointMul(scalar, GRUMPKIN_GENERATOR);
  return pointAdd(spendingPub, scalarPoint);
}

/**
 * Derive stealth private key (EIP-5564 pattern)
 *
 * stealthPriv = spendingPriv + hash(sharedSecret)
 */
function deriveStealthPrivKey(
  spendingPriv: bigint,
  sharedSecret: GrumpkinPoint
): bigint {
  const scalar = deriveStealthScalar(sharedSecret);
  return (spendingPriv + scalar) % GRUMPKIN_ORDER;
}

// ==========================================================================
// Position Creation (Sender Side)
// ==========================================================================

/**
 * Create a stealth pool deposit for a recipient
 *
 * Uses EIP-5564/DKSAP pattern:
 * 1. Generate ephemeral Grumpkin keypair
 * 2. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 * 3. stealthPub = spendingPub + hash(sharedSecret) * G
 * 4. commitment = Poseidon2(stealthPub.x, principal, depositEpoch)
 *
 * @param recipientMeta - Recipient's stealth meta-address (spending + viewing pubkeys)
 * @param principal - Amount to deposit in satoshis
 * @param depositEpoch - Current epoch at deposit time
 * @param poolId - Pool identifier
 * @returns Stealth pool position ready for on-chain announcement
 */
export function createStealthPoolDeposit(
  recipientMeta: StealthMetaAddress,
  principal: bigint,
  depositEpoch: bigint,
  poolId: Uint8Array
): Omit<StealthPoolPosition, "leafIndex"> & { ephemeralPriv: bigint } {
  // Parse recipient's public keys
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate ephemeral Grumpkin keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key (for recipient scanning)
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute pool commitment: Poseidon2(stealthPub.x, principal, depositEpoch)
  const commitment = poseidon2Hash([stealthPub.x, principal, depositEpoch]);

  return {
    poolId,
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    ephemeralPriv: ephemeral.privKey, // Keep this for testing, don't store!
    principal,
    depositEpoch,
    stealthPub,
    commitment,
    commitmentBytes: bigintToBytes(commitment),
  };
}

/**
 * Create self-deposit (depositing to own stealth address)
 *
 * Same as createStealthPoolDeposit but uses own keys.
 */
export function createSelfStealthPoolDeposit(
  keys: ZVaultKeys,
  principal: bigint,
  depositEpoch: bigint,
  poolId: Uint8Array
): Omit<StealthPoolPosition, "leafIndex"> & { ephemeralPriv: bigint } {
  // Generate ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute pool commitment
  const commitment = poseidon2Hash([stealthPub.x, principal, depositEpoch]);

  return {
    poolId,
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    ephemeralPriv: ephemeral.privKey,
    principal,
    depositEpoch,
    stealthPub,
    commitment,
    commitmentBytes: bigintToBytes(commitment),
  };
}

// ==========================================================================
// Position Scanning (Viewing Key Only)
// ==========================================================================

/**
 * Scan stealth pool announcements using viewing key
 *
 * For each announcement:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. Verify: commitment == Poseidon2(stealthPub.x, principal, depositEpoch)
 *
 * This can DETECT positions but CANNOT derive stealthPriv for spending.
 *
 * @param keys - User's ZVaultKeys (needs viewing key)
 * @param announcements - Array of on-chain announcements
 * @returns Array of positions belonging to this user
 */
export function scanPoolAnnouncements(
  keys: ZVaultKeys,
  announcements: OnChainStealthPoolAnnouncement[]
): ScannedPoolPosition[] {
  const found: ScannedPoolPosition[] = [];

  for (const ann of announcements) {
    try {
      // Parse ephemeral pubkey
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, ephemeralPub);

      // Derive stealth public key
      const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

      // Compute expected commitment
      const expectedCommitment = poseidon2Hash([
        stealthPub.x,
        ann.principal,
        ann.depositEpoch,
      ]);
      const actualCommitment = bytesToBigint(ann.poolCommitment);

      if (expectedCommitment !== actualCommitment) {
        // Not for us
        continue;
      }

      // This position belongs to us!
      found.push({
        poolId: ann.poolId,
        ephemeralPub,
        principal: ann.principal,
        depositEpoch: ann.depositEpoch,
        stealthPub,
        commitment: ann.poolCommitment,
        leafIndex: ann.leafIndex,
        createdAt: ann.createdAt,
      });
    } catch {
      // Skip invalid announcements
      continue;
    }
  }

  return found;
}

// ==========================================================================
// Claim Preparation (Spending Key Required)
// ==========================================================================

/**
 * Prepare claim/withdraw inputs for ZK proof
 *
 * REQUIRES spending key to derive stealthPriv and nullifier.
 *
 * @param keys - User's ZVaultKeys (needs spending key)
 * @param position - Scanned position to claim
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir circuit
 */
export function prepareStealthPoolClaimInputs(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  merkleProof: MerkleProof
): StealthPoolClaimInputs {
  // Recompute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, position.ephemeralPub);

  // Derive stealth private key (requires spending key!)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // Verify stealth key matches (sanity check)
  const expectedStealthPub = pointMul(stealthPrivKey, GRUMPKIN_GENERATOR);
  if (
    expectedStealthPub.x !== position.stealthPub.x ||
    expectedStealthPub.y !== position.stealthPub.y
  ) {
    throw new Error("Stealth key mismatch - position may not belong to you");
  }

  // Compute nullifier: Poseidon2(stealthPriv, leafIndex)
  const nullifier = poseidon2Hash([stealthPrivKey, BigInt(position.leafIndex)]);
  const nullifierHash = poseidon2Hash([nullifier]);

  return {
    stealthPrivKey,
    principal: position.principal,
    depositEpoch: position.depositEpoch,
    leafIndex: position.leafIndex,
    merklePath: merkleProof.pathElements.map((el) => bytesToBigint(new Uint8Array(el))),
    merkleIndices: merkleProof.pathIndices,
    merkleRoot: bytesToBigint(new Uint8Array(merkleProof.root)),
    nullifier,
    nullifierHash,
  };
}

// ==========================================================================
// Yield Calculation
// ==========================================================================

/**
 * Calculate earned yield for a position
 *
 * @param principal - Principal amount (satoshis)
 * @param depositEpoch - When the position was created
 * @param currentEpoch - Current epoch
 * @param yieldRateBps - Annual yield rate in basis points (500 = 5%)
 * @returns Earned yield amount (satoshis)
 */
export function calculateYield(
  principal: bigint,
  depositEpoch: bigint,
  currentEpoch: bigint,
  yieldRateBps: number
): bigint {
  if (currentEpoch <= depositEpoch) {
    return 0n;
  }

  const epochsStaked = currentEpoch - depositEpoch;
  // yield = (principal * epochsStaked * yieldRateBps) / 10000
  return (principal * epochsStaked * BigInt(yieldRateBps)) / 10000n;
}

/**
 * Calculate total value (principal + yield) for a position
 */
export function calculateTotalValue(
  position: ScannedPoolPosition,
  currentEpoch: bigint,
  yieldRateBps: number
): bigint {
  const yieldAmount = calculateYield(
    position.principal,
    position.depositEpoch,
    currentEpoch,
    yieldRateBps
  );
  return position.principal + yieldAmount;
}

// ==========================================================================
// Serialization
// ==========================================================================

/**
 * Serialize a pool position for storage
 */
export function serializePoolPosition(
  position: StealthPoolPosition
): SerializedStealthPoolPosition {
  return {
    poolId: Buffer.from(position.poolId).toString("hex"),
    ephemeralPub: Buffer.from(position.ephemeralPub).toString("hex"),
    principal: position.principal.toString(),
    depositEpoch: position.depositEpoch.toString(),
    stealthPubX: position.stealthPub.x.toString(),
    stealthPubY: position.stealthPub.y.toString(),
    commitment: position.commitment.toString(),
    leafIndex: position.leafIndex,
  };
}

/**
 * Deserialize a pool position from storage
 */
export function deserializePoolPosition(
  data: SerializedStealthPoolPosition
): StealthPoolPosition {
  return {
    poolId: new Uint8Array(Buffer.from(data.poolId, "hex")),
    ephemeralPub: new Uint8Array(Buffer.from(data.ephemeralPub, "hex")),
    principal: BigInt(data.principal),
    depositEpoch: BigInt(data.depositEpoch),
    stealthPub: {
      x: BigInt(data.stealthPubX),
      y: BigInt(data.stealthPubY),
    },
    commitment: BigInt(data.commitment),
    leafIndex: data.leafIndex,
    commitmentBytes: bigintToBytes(BigInt(data.commitment)),
  };
}

// ==========================================================================
// On-Chain Account Parsing
// ==========================================================================

/**
 * Parse StealthPoolAnnouncement account data
 *
 * Layout (136 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - padding (6 bytes)
 * - pool_id (8 bytes)
 * - ephemeral_pub (33 bytes)
 * - padding2 (7 bytes)
 * - principal (8 bytes)
 * - deposit_epoch (8 bytes)
 * - pool_commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 * - reserved (16 bytes)
 */
export function parseStealthPoolAnnouncement(
  data: Uint8Array
): OnChainStealthPoolAnnouncement | null {
  if (data.length < STEALTH_POOL_ANNOUNCEMENT_SIZE) {
    return null;
  }

  // Check discriminator
  if (data[0] !== STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR) {
    return null;
  }

  let offset = 8; // Skip discriminator, bump, padding

  const poolId = data.slice(offset, offset + 8);
  offset += 8;

  const ephemeralPub = data.slice(offset, offset + 33);
  offset += 33 + 7; // Skip padding2

  const view = new DataView(data.buffer, data.byteOffset);

  const principal = view.getBigUint64(offset, true);
  offset += 8;

  const depositEpoch = view.getBigUint64(offset, true);
  offset += 8;

  const poolCommitment = data.slice(offset, offset + 32);
  offset += 32;

  const leafIndex = Number(view.getBigUint64(offset, true));
  offset += 8;

  const createdAt = Number(view.getBigInt64(offset, true));

  return {
    poolId: new Uint8Array(poolId),
    ephemeralPub: new Uint8Array(ephemeralPub),
    principal,
    depositEpoch,
    poolCommitment: new Uint8Array(poolCommitment),
    leafIndex,
    createdAt,
  };
}

/**
 * Parse YieldPool account data
 */
export function parseYieldPool(data: Uint8Array): YieldPoolConfig | null {
  if (data.length < 200 || data[0] !== YIELD_POOL_DISCRIMINATOR) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = data.slice(4, 12);
  const yieldRateBps = view.getUint16(12, true);
  const currentEpoch = view.getBigUint64(36, true);
  const epochDuration = Number(view.getBigInt64(44, true));
  const totalPrincipal = view.getBigUint64(52, true);
  const paused = (data[2] & 1) !== 0;

  return {
    poolId: new Uint8Array(poolId),
    yieldRateBps,
    epochDuration,
    currentEpoch,
    totalPrincipal,
    paused,
  };
}

// ==========================================================================
// Instruction Data Builders
// ==========================================================================

/**
 * Build instruction data for CREATE_YIELD_POOL
 */
export function buildCreateYieldPoolData(
  poolId: Uint8Array,
  yieldRateBps: number,
  epochDuration: number,
  defiVault: Uint8Array
): Uint8Array {
  const data = new Uint8Array(51);
  data[0] = CREATE_YIELD_POOL_DISCRIMINATOR;

  data.set(poolId.slice(0, 8), 1);

  const rateView = new DataView(data.buffer, 9, 2);
  rateView.setUint16(0, yieldRateBps, true);

  const durationView = new DataView(data.buffer, 11, 8);
  durationView.setBigInt64(0, BigInt(epochDuration), true);

  data.set(defiVault.slice(0, 32), 19);

  return data;
}

/**
 * Build instruction data for DEPOSIT_TO_POOL (stealth mode)
 */
export function buildDepositToPoolData(
  proof: Uint8Array,
  inputNullifierHash: Uint8Array,
  poolCommitment: Uint8Array,
  ephemeralPub: Uint8Array,
  principal: bigint,
  inputMerkleRoot: Uint8Array
): Uint8Array {
  const data = new Uint8Array(394); // 1 + 256 + 32 + 32 + 33 + 8 + 32
  data[0] = DEPOSIT_TO_POOL_DISCRIMINATOR;

  let offset = 1;

  // proof (256 bytes)
  data.set(proof.slice(0, 256), offset);
  offset += 256;

  // input_nullifier_hash (32 bytes)
  data.set(inputNullifierHash.slice(0, 32), offset);
  offset += 32;

  // pool_commitment (32 bytes)
  data.set(poolCommitment.slice(0, 32), offset);
  offset += 32;

  // ephemeral_pub (33 bytes) - NEW for stealth mode
  data.set(ephemeralPub.slice(0, 33), offset);
  offset += 33;

  // principal (8 bytes, little-endian)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, principal, true);
  offset += 8;

  // input_merkle_root (32 bytes)
  data.set(inputMerkleRoot.slice(0, 32), offset);

  return data;
}

/**
 * Build instruction data for WITHDRAW_FROM_POOL (stealth mode)
 */
export function buildWithdrawFromPoolData(
  proof: Uint8Array,
  poolNullifierHash: Uint8Array,
  outputCommitment: Uint8Array,
  poolMerkleRoot: Uint8Array,
  stealthPubX: Uint8Array,
  principal: bigint,
  depositEpoch: bigint
): Uint8Array {
  const data = new Uint8Array(401); // 1 + 256 + 32 + 32 + 32 + 32 + 8 + 8
  data[0] = WITHDRAW_FROM_POOL_DISCRIMINATOR;

  let offset = 1;

  // proof (256 bytes)
  data.set(proof.slice(0, 256), offset);
  offset += 256;

  // pool_nullifier_hash (32 bytes)
  data.set(poolNullifierHash.slice(0, 32), offset);
  offset += 32;

  // output_commitment (32 bytes)
  data.set(outputCommitment.slice(0, 32), offset);
  offset += 32;

  // pool_merkle_root (32 bytes)
  data.set(poolMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // stealth_pub_x (32 bytes) - for verification
  data.set(stealthPubX.slice(0, 32), offset);
  offset += 32;

  // principal (8 bytes)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, principal, true);
  offset += 8;

  // deposit_epoch (8 bytes)
  const epochView = new DataView(data.buffer, offset, 8);
  epochView.setBigUint64(0, depositEpoch, true);

  return data;
}

/**
 * Build instruction data for CLAIM_POOL_YIELD (stealth mode)
 */
export function buildClaimPoolYieldData(
  proof: Uint8Array,
  oldNullifierHash: Uint8Array,
  newPoolCommitment: Uint8Array,
  newEphemeralPub: Uint8Array,
  yieldCommitment: Uint8Array,
  poolMerkleRoot: Uint8Array,
  stealthPubX: Uint8Array,
  principal: bigint,
  depositEpoch: bigint
): Uint8Array {
  const data = new Uint8Array(466); // 1 + 256 + 32 + 32 + 33 + 32 + 32 + 32 + 8 + 8
  data[0] = CLAIM_POOL_YIELD_DISCRIMINATOR;

  let offset = 1;

  // proof (256 bytes)
  data.set(proof.slice(0, 256), offset);
  offset += 256;

  // old_nullifier_hash (32 bytes)
  data.set(oldNullifierHash.slice(0, 32), offset);
  offset += 32;

  // new_pool_commitment (32 bytes)
  data.set(newPoolCommitment.slice(0, 32), offset);
  offset += 32;

  // new_ephemeral_pub (33 bytes)
  data.set(newEphemeralPub.slice(0, 33), offset);
  offset += 33;

  // yield_commitment (32 bytes)
  data.set(yieldCommitment.slice(0, 32), offset);
  offset += 32;

  // pool_merkle_root (32 bytes)
  data.set(poolMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // stealth_pub_x (32 bytes)
  data.set(stealthPubX.slice(0, 32), offset);
  offset += 32;

  // principal (8 bytes)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, principal, true);
  offset += 8;

  // deposit_epoch (8 bytes)
  const epochView = new DataView(data.buffer, offset, 8);
  epochView.setBigUint64(0, depositEpoch, true);

  return data;
}

/**
 * Build instruction data for COMPOUND_YIELD (stealth mode)
 */
export function buildCompoundYieldData(
  proof: Uint8Array,
  oldNullifierHash: Uint8Array,
  newPoolCommitment: Uint8Array,
  newEphemeralPub: Uint8Array,
  poolMerkleRoot: Uint8Array,
  stealthPubX: Uint8Array,
  oldPrincipal: bigint,
  depositEpoch: bigint
): Uint8Array {
  const data = new Uint8Array(434); // 1 + 256 + 32 + 32 + 33 + 32 + 32 + 8 + 8
  data[0] = COMPOUND_YIELD_DISCRIMINATOR;

  let offset = 1;

  // proof (256 bytes)
  data.set(proof.slice(0, 256), offset);
  offset += 256;

  // old_nullifier_hash (32 bytes)
  data.set(oldNullifierHash.slice(0, 32), offset);
  offset += 32;

  // new_pool_commitment (32 bytes)
  data.set(newPoolCommitment.slice(0, 32), offset);
  offset += 32;

  // new_ephemeral_pub (33 bytes)
  data.set(newEphemeralPub.slice(0, 33), offset);
  offset += 33;

  // pool_merkle_root (32 bytes)
  data.set(poolMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // stealth_pub_x (32 bytes)
  data.set(stealthPubX.slice(0, 32), offset);
  offset += 32;

  // old_principal (8 bytes)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, oldPrincipal, true);
  offset += 8;

  // deposit_epoch (8 bytes)
  const epochView = new DataView(data.buffer, offset, 8);
  epochView.setBigUint64(0, depositEpoch, true);

  return data;
}

/**
 * Build instruction data for UPDATE_YIELD_RATE
 */
export function buildUpdateYieldRateData(newRateBps: number): Uint8Array {
  const data = new Uint8Array(3);
  data[0] = UPDATE_YIELD_RATE_DISCRIMINATOR;

  const rateView = new DataView(data.buffer, 1, 2);
  rateView.setUint16(0, newRateBps, true);

  return data;
}

/**
 * Build instruction data for HARVEST_YIELD
 */
export function buildHarvestYieldData(harvestedAmount: bigint): Uint8Array {
  const data = new Uint8Array(9);
  data[0] = HARVEST_YIELD_DISCRIMINATOR;

  const amountView = new DataView(data.buffer, 1, 8);
  amountView.setBigUint64(0, harvestedAmount, true);

  return data;
}

// ==========================================================================
// PDA Derivation
// ==========================================================================

/**
 * Get seeds for YieldPool PDA
 */
export function getYieldPoolPDASeeds(poolId: Uint8Array): Uint8Array[] {
  return [Buffer.from(YIELD_POOL_SEED), poolId.slice(0, 8)];
}

/**
 * Get seeds for PoolCommitmentTree PDA
 */
export function getPoolCommitmentTreePDASeeds(poolId: Uint8Array): Uint8Array[] {
  return [Buffer.from(POOL_COMMITMENT_TREE_SEED), poolId.slice(0, 8)];
}

/**
 * Get seeds for PoolNullifierRecord PDA
 */
export function getPoolNullifierPDASeeds(
  poolId: Uint8Array,
  nullifierHash: Uint8Array
): Uint8Array[] {
  return [
    Buffer.from(POOL_NULLIFIER_SEED),
    poolId.slice(0, 8),
    nullifierHash.slice(0, 32),
  ];
}

/**
 * Get seeds for StealthPoolAnnouncement PDA
 */
export function getStealthPoolAnnouncementPDASeeds(
  poolId: Uint8Array,
  commitment: Uint8Array
): Uint8Array[] {
  return [
    Buffer.from(STEALTH_POOL_ANNOUNCEMENT_SEED),
    poolId.slice(0, 8),
    commitment.slice(0, 32),
  ];
}

// ==========================================================================
// Circuit Input Preparation
// ==========================================================================

/**
 * Prepare inputs for pool_deposit_stealth circuit
 */
export function preparePoolDepositInputs(
  inputNote: Note,
  inputMerkleProof: MerkleProof,
  stealthPubX: bigint,
  principal: bigint,
  depositEpoch: bigint
) {
  return {
    // Private inputs
    input_nullifier: inputNote.nullifier.toString(),
    input_secret: inputNote.secret.toString(),
    input_amount: inputNote.amount.toString(),
    input_merkle_path: inputMerkleProof.pathElements.map((p) => p.toString()),
    input_path_indices: inputMerkleProof.pathIndices,

    // Public inputs
    input_merkle_root: bytesToBigint(new Uint8Array(inputMerkleProof.root)).toString(),
    input_nullifier_hash: inputNote.nullifierHash.toString(),
    stealth_pub_x: stealthPubX.toString(),
    pool_commitment: poseidon2Hash([stealthPubX, principal, depositEpoch]).toString(),
    deposit_epoch: depositEpoch.toString(),
  };
}

/**
 * Prepare inputs for pool_withdraw_stealth circuit
 */
export function preparePoolWithdrawInputs(
  claimInputs: StealthPoolClaimInputs,
  outputNote: Note,
  currentEpoch: bigint,
  yieldRateBps: number,
  poolId: bigint
) {
  return {
    // Private inputs
    stealth_priv: claimInputs.stealthPrivKey.toString(),
    principal: claimInputs.principal.toString(),
    deposit_epoch: claimInputs.depositEpoch.toString(),
    pool_merkle_path: claimInputs.merklePath.map((p) => p.toString()),
    pool_path_indices: claimInputs.merkleIndices,

    output_nullifier: outputNote.nullifier.toString(),
    output_secret: outputNote.secret.toString(),

    // Public inputs
    pool_merkle_root: claimInputs.merkleRoot.toString(),
    pool_nullifier_hash: claimInputs.nullifierHash.toString(),
    output_commitment: outputNote.commitment.toString(),
    current_epoch: currentEpoch.toString(),
    yield_rate_bps: yieldRateBps.toString(),
    pool_id: poolId.toString(),
  };
}

/**
 * Prepare inputs for pool_claim_yield_stealth circuit
 */
export function preparePoolClaimYieldInputs(
  claimInputs: StealthPoolClaimInputs,
  newStealthPubX: bigint,
  newPrincipal: bigint,
  newDepositEpoch: bigint,
  yieldNote: Note,
  currentEpoch: bigint,
  yieldRateBps: number,
  poolId: bigint
) {
  return {
    // Private inputs (old position)
    stealth_priv: claimInputs.stealthPrivKey.toString(),
    principal: claimInputs.principal.toString(),
    deposit_epoch: claimInputs.depositEpoch.toString(),
    pool_merkle_path: claimInputs.merklePath.map((p) => p.toString()),
    pool_path_indices: claimInputs.merkleIndices,

    yield_nullifier: yieldNote.nullifier.toString(),
    yield_secret: yieldNote.secret.toString(),

    // Public inputs
    pool_merkle_root: claimInputs.merkleRoot.toString(),
    old_nullifier_hash: claimInputs.nullifierHash.toString(),
    new_stealth_pub_x: newStealthPubX.toString(),
    new_pool_commitment: poseidon2Hash([newStealthPubX, newPrincipal, newDepositEpoch]).toString(),
    yield_commitment: yieldNote.commitment.toString(),
    current_epoch: currentEpoch.toString(),
    yield_rate_bps: yieldRateBps.toString(),
    pool_id: poolId.toString(),
  };
}

// ==========================================================================
// High-Level Pool Operations with Proof Generation
// ==========================================================================

/**
 * Generate proof for pool deposit operation
 *
 * Generates the ZK proof for depositing a zkBTC note into the yield pool.
 *
 * @param inputNote - The zkBTC note being deposited
 * @param inputMerkleProof - Merkle proof for the input note
 * @param stealthDeposit - Stealth deposit data (from createSelfStealthPoolDeposit)
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateDepositProof(
  inputNote: Note,
  inputMerkleProof: MerkleProof,
  stealthDeposit: Omit<StealthPoolPosition, "leafIndex">,
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing deposit inputs...", progress: 10 });

  // Convert merkle proof to prover format
  const merkleProofInput: MerkleProofInput = {
    siblings: inputMerkleProof.pathElements.map((el) =>
      bytesToBigint(new Uint8Array(el))
    ),
    indices: inputMerkleProof.pathIndices,
  };

  const proofInputs: PoolDepositInputs = {
    inputNullifier: inputNote.nullifier,
    inputSecret: inputNote.secret,
    inputAmount: inputNote.amount,
    merkleProof: merkleProofInput,
    merkleRoot: bytesToBigint(new Uint8Array(inputMerkleProof.root)),
    inputNullifierHash: inputNote.nullifierHash,
    stealthPubX: stealthDeposit.stealthPub.x,
    poolCommitment: stealthDeposit.commitment,
    depositEpoch: stealthDeposit.depositEpoch,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolDepositProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}

/**
 * Generate proof for pool withdraw operation
 *
 * Generates the ZK proof for withdrawing from the yield pool (with yield).
 *
 * @param keys - User's ZVault keys
 * @param position - Scanned pool position
 * @param poolMerkleProof - Merkle proof for the pool position
 * @param outputNote - New zkBTC note for principal + yield
 * @param poolConfig - Pool configuration (yield rate, current epoch)
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateWithdrawProof(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  poolMerkleProof: MerkleProof,
  outputNote: Note,
  poolConfig: { currentEpoch: bigint; yieldRateBps: number; poolId: bigint },
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing withdraw inputs...", progress: 10 });

  // Prepare claim inputs (derives stealth private key)
  const claimInputs = prepareStealthPoolClaimInputs(keys, position, poolMerkleProof);

  // Convert merkle proof to prover format
  const poolMerkleProofInput: MerkleProofInput = {
    siblings: claimInputs.merklePath,
    indices: claimInputs.merkleIndices,
  };

  const proofInputs: PoolWithdrawInputs = {
    stealthPriv: claimInputs.stealthPrivKey,
    principal: claimInputs.principal,
    depositEpoch: claimInputs.depositEpoch,
    leafIndex: BigInt(claimInputs.leafIndex),
    poolMerkleProof: poolMerkleProofInput,
    outputNullifier: outputNote.nullifier,
    outputSecret: outputNote.secret,
    poolMerkleRoot: claimInputs.merkleRoot,
    poolNullifierHash: claimInputs.nullifierHash,
    stealthPubX: position.stealthPub.x,
    outputCommitment: outputNote.commitment,
    currentEpoch: poolConfig.currentEpoch,
    yieldRateBps: BigInt(poolConfig.yieldRateBps),
    poolId: poolConfig.poolId,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolWithdrawProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}

/**
 * Generate proof for pool claim yield operation
 *
 * Generates the ZK proof for claiming yield while keeping principal staked.
 *
 * @param keys - User's ZVault keys
 * @param position - Scanned pool position
 * @param poolMerkleProof - Merkle proof for the pool position
 * @param newStealthDeposit - New stealth deposit for updated position
 * @param yieldNote - New zkBTC note for yield amount
 * @param poolConfig - Pool configuration (yield rate, current epoch)
 * @param onProgress - Progress callback
 * @returns Generated proof data
 */
export async function generateClaimYieldProof(
  keys: ZVaultKeys,
  position: ScannedPoolPosition,
  poolMerkleProof: MerkleProof,
  newStealthDeposit: Omit<StealthPoolPosition, "leafIndex">,
  yieldNote: Note,
  poolConfig: { currentEpoch: bigint; yieldRateBps: number; poolId: bigint },
  onProgress?: PoolOperationProgressCallback
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  onProgress?.({ step: "preparing", message: "Preparing claim inputs...", progress: 10 });

  // Prepare claim inputs (derives stealth private key)
  const claimInputs = prepareStealthPoolClaimInputs(keys, position, poolMerkleProof);

  // Convert merkle proof to prover format
  const poolMerkleProofInput: MerkleProofInput = {
    siblings: claimInputs.merklePath,
    indices: claimInputs.merkleIndices,
  };

  const proofInputs: PoolClaimYieldInputs = {
    oldStealthPriv: claimInputs.stealthPrivKey,
    principal: claimInputs.principal,
    depositEpoch: claimInputs.depositEpoch,
    leafIndex: BigInt(claimInputs.leafIndex),
    poolMerkleProof: poolMerkleProofInput,
    yieldNullifier: yieldNote.nullifier,
    yieldSecret: yieldNote.secret,
    poolMerkleRoot: claimInputs.merkleRoot,
    oldNullifierHash: claimInputs.nullifierHash,
    oldStealthPubX: position.stealthPub.x,
    newStealthPubX: newStealthDeposit.stealthPub.x,
    newPoolCommitment: newStealthDeposit.commitment,
    yieldCommitment: yieldNote.commitment,
    currentEpoch: poolConfig.currentEpoch,
    yieldRateBps: BigInt(poolConfig.yieldRateBps),
    poolId: poolConfig.poolId,
  };

  onProgress?.({ step: "generating_proof", message: "Generating ZK proof...", progress: 30 });

  const result = await generatePoolClaimYieldProof(proofInputs);

  onProgress?.({ step: "generating_proof", message: "Proof generated", progress: 80 });

  return result;
}

// ==========================================================================
// Formatting Utilities
// ==========================================================================

/**
 * Format yield rate for display
 * @param bps - Basis points (500 = 5%)
 * @returns Formatted string (e.g., "5.00%")
 */
export function formatYieldRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Format satoshis as BTC
 */
export function formatBtcAmount(sats: bigint): string {
  const btc = Number(sats) / 100_000_000;
  return btc.toFixed(8);
}

/**
 * Format epoch duration
 */
export function formatEpochDuration(seconds: number): string {
  if (seconds < 3600) return `${seconds}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

