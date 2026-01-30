/**
 * Stealth Deposit utilities for ZVault
 *
 * Combines BTC deposit verification with automatic stealth announcement.
 * When a user deposits BTC to a recipient's stealth address, after SPV
 * verification the commitment goes directly to the recipient - no
 * separate claim step needed.
 *
 * OP_RETURN Format (MINIMAL - 32 bytes):
 * - [0-31]    commitment (32 bytes, raw Poseidon hash)
 *
 * NOTE: No magic/version header needed - program ID identifies the scheme.
 * Ephemeral key is stored on Solana StealthAnnouncement only.
 * Recipient matches commitment between Bitcoin and Solana to correlate.
 *
 * Benefits:
 * - 99 → 32 bytes (-68% reduction)
 * - Simpler parsing (just raw commitment)
 * - Ephemeral key remains on Solana only (no cross-chain correlation via OP_RETURN)
 */

import {
  address,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  pipe,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getProgramDerivedAddress,
  sendAndConfirmTransactionFactory,
  AccountRole,
  type Address,
  type Rpc,
  type RpcSubscriptions,
  type KeyPairSigner,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToBigint, bigintToBytes, BN254_FIELD_PRIME } from "./crypto";
import {
  generateKeyPair as generateGrumpkinKeyPair,
  ecdh as grumpkinEcdh,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  scalarFromBytes,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
} from "./grumpkin";
import type { StealthMetaAddress } from "./keys";
import { parseStealthMetaAddress } from "./keys";
import { deriveTaprootAddress } from "./taproot";
import { poseidonHashSync } from "./poseidon";
import {
  prepareVerifyDeposit,
  bytesToHex,
  fetchRawTransaction,
  fetchMerkleProof,
  uploadTransactionToBuffer,
} from "./chadbuffer";
import {
  derivePoolStatePDA,
  deriveLightClientPDA,
  deriveBlockHeaderPDA,
  deriveCommitmentTreePDA,
  deriveDepositRecordPDA,
} from "./pda";
import { buildMerkleProof } from "./chadbuffer";

// ========== Constants ==========

/**
 * Total size of stealth OP_RETURN data
 * = 32 bytes (commitment only, no header needed - program ID identifies scheme)
 */
export const STEALTH_OP_RETURN_SIZE = 32;

/** Instruction discriminator for verify_stealth_deposit */
export const VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = 20;

// Program IDs (Solana Devnet)
import { ZVAULT_PROGRAM_ID } from "./pda";
const SYSTEM_PROGRAM_ID: Address = address(
  "11111111111111111111111111111111"
);

/** Domain separator for stealth key derivation */
const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-stealth-v1");

// ========== Types ==========

/**
 * Prepared stealth deposit data for BTC transaction
 */
export interface PreparedStealthDeposit {
  /** Taproot address to send BTC to (any amount) */
  btcDepositAddress: string;

  /** Hex data to embed in OP_RETURN output (32 bytes) */
  opReturnData: Uint8Array;

  /** Stealth data for Solana announcement */
  stealthData: StealthDepositData;
}

/**
 * Internal stealth deposit data (single ephemeral key)
 */
export interface StealthDepositData {
  /** Single Grumpkin ephemeral public key (33 bytes compressed) */
  ephemeralPub: Uint8Array;

  /** Commitment for Merkle tree (32 bytes) */
  commitment: Uint8Array;
}

/**
 * Parsed stealth data from OP_RETURN
 */
export interface ParsedStealthOpReturn {
  commitment: Uint8Array;
}

// ========== Helper Functions ==========

/**
 * Derive stealth scalar from shared secret (EIP-5564 pattern)
 */
function deriveStealthScalar(sharedSecretBytes: Uint8Array): bigint {
  const hashInput = new Uint8Array(sharedSecretBytes.length + STEALTH_KEY_DOMAIN.length);
  hashInput.set(sharedSecretBytes, 0);
  hashInput.set(STEALTH_KEY_DOMAIN, sharedSecretBytes.length);
  const hash = sha256(hashInput);
  return scalarFromBytes(hash);
}

// ========== Sender Functions ==========

/**
 * Grumpkin keypair type for optional ephemeral key injection
 */
export interface GrumpkinKeyPair {
  privKey: bigint;
  pubKey: { x: bigint; y: bigint };
}

/**
 * Prepare a stealth deposit for a recipient (MINIMAL FORMAT)
 *
 * Uses EIP-5564/DKSAP pattern with single Grumpkin ephemeral key.
 * Amount is NOT specified - send any amount to the returned address.
 * Actual amount is read from the BTC transaction during verification.
 *
 * BTC transaction outputs:
 * - Output 1: ANY amount to btcDepositAddress (Taproot)
 * - Output 2: OP_RETURN with commitment only (32 bytes)
 *
 * Stealth derivation:
 * 1. sharedSecret = ECDH(ephemeral.priv, viewingPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. commitment = Poseidon(stealthPub.x)  // amount-independent
 *
 * @param params - Deposit parameters
 * @param params.ephemeralKeyPair - Optional: provide your own ephemeral keypair.
 *   If not provided, a random keypair is generated.
 *
 * @example
 * ```typescript
 * const deposit = await prepareStealthDeposit({
 *   recipientMeta,
 *   network: "testnet"
 * });
 *
 * // Send ANY amount to this address
 * console.log(deposit.btcDepositAddress);
 *
 * // Ephemeral pubkey stored on-chain for recipient scanning
 * console.log(deposit.stealthData.ephemeralPub);
 * ```
 *
 * @returns Prepared deposit data (same address works for any amount)
 */
export async function prepareStealthDeposit(params: {
  recipientMeta: StealthMetaAddress;
  network: "testnet" | "mainnet";
  /** Optional: provide your own ephemeral keypair */
  ephemeralKeyPair?: GrumpkinKeyPair;
}): Promise<PreparedStealthDeposit> {
  const { recipientMeta, network, ephemeralKeyPair } = params;

  // Parse recipient's public keys (both Grumpkin now)
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Use provided ephemeral keypair or generate a random one
  const ephemeral = ephemeralKeyPair ?? generateGrumpkinKeyPair();

  // Compute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key (EIP-5564 pattern)
  // stealthPub = spendingPub + hash(sharedSecret) * G
  const sharedSecretBytes = pointToCompressedBytes(sharedSecret);
  const stealthScalar = deriveStealthScalar(sharedSecretBytes);
  const scalarPoint = pointMul(stealthScalar, GRUMPKIN_GENERATOR);
  const stealthPub = pointAdd(spendingPubKey, scalarPoint);

  // Compute commitment using Poseidon (amount-independent)
  // commitment = Poseidon(stealthPub.x)
  const commitmentBigint = poseidonHashSync([stealthPub.x]);
  const commitment = bigintToBytes(commitmentBigint);

  // Build OP_RETURN data (minimal format - commitment only)
  const opReturnData = buildStealthOpReturn({ commitment });

  // Derive taproot address from commitment
  const { address: btcDepositAddress } = await deriveTaprootAddress(
    commitment,
    network
  );

  return {
    btcDepositAddress,
    opReturnData,
    stealthData: {
      ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
      commitment,
    },
  };
}

/**
 * Build the OP_RETURN script data (MINIMAL FORMAT)
 *
 * Layout (32 bytes):
 * - [0-31]   commitment (32 bytes, raw)
 *
 * No magic/version needed - program ID identifies the scheme.
 * Ephemeral key is stored on Solana StealthAnnouncement only.
 */
export function buildStealthOpReturn(params: {
  commitment: Uint8Array;
}): Uint8Array {
  // Just return the commitment directly (32 bytes)
  return new Uint8Array(params.commitment);
}

/**
 * Parse stealth data from OP_RETURN (32-byte commitment)
 */
export function parseStealthOpReturn(
  data: Uint8Array
): ParsedStealthOpReturn | null {
  if (data.length !== STEALTH_OP_RETURN_SIZE) {
    return null;
  }
  return { commitment: new Uint8Array(data) };
}

// ========== On-chain Verification ==========

/**
 * Derive stealth announcement PDA
 *
 * Uses ephemeral Grumpkin public key (33 bytes) as seed.
 */
export async function deriveStealthAnnouncementPDA(
  programId: Address,
  ephemeralPub: Uint8Array
): Promise<[Address, number]> {
  const seeds = [
    new TextEncoder().encode("stealth"),
    ephemeralPub,
  ];
  const [pda, bump] = await getProgramDerivedAddress({
    seeds,
    programAddress: programId,
  });
  return [pda, bump];
}

/**
 * Verify a stealth deposit on Solana
 *
 * Calls the verify_stealth_deposit instruction which:
 * 1. Verifies the BTC transaction via SPV
 * 2. Parses commitment from OP_RETURN
 * 3. Adds commitment to Merkle tree
 * 4. Creates stealth announcement with leaf_index
 *
 * Note: The ephemeralPub must be provided separately since the OP_RETURN
 * only contains the commitment. The ephemeral key is stored in the
 * StealthAnnouncement for recipient scanning.
 *
 * @param rpc - Solana RPC client
 * @param rpcSubscriptions - Solana RPC subscriptions client
 * @param payer - Transaction fee payer (KeyPairSigner)
 * @param btcTxid - Bitcoin transaction ID (hex string)
 * @param expectedValue - Expected deposit value in satoshis
 * @param ephemeralPub - Grumpkin ephemeral public key (33 bytes)
 * @param network - Bitcoin network
 * @param programId - Optional program ID override
 * @returns Transaction signature
 */
export async function verifyStealthDeposit(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  btcTxid: string,
  expectedValue: bigint,
  ephemeralPub: Uint8Array,
  network: "mainnet" | "testnet" = "testnet",
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<string> {
  console.log("=== Verify Stealth Deposit ===");
  console.log(`Txid: ${btcTxid}`);
  console.log(`Expected value: ${expectedValue} sats`);

  // Validate ephemeral key size
  if (ephemeralPub.length !== 33) {
    throw new Error("ephemeralPub must be 33 bytes (compressed Grumpkin)");
  }

  // Step 1: Fetch tx and merkle proof, upload to buffer
  const {
    bufferAddress,
    transactionSize,
    merkleProof,
    blockHeight,
    txIndex,
    txidBytes,
  } = await prepareVerifyDeposit(rpc, rpcSubscriptions, payer, btcTxid, network);

  // Step 2: Verify the OP_RETURN contains valid commitment
  const rawTx = await fetchRawTransaction(btcTxid, network);
  const stealthData = extractStealthDataFromRawTx(rawTx);
  if (!stealthData) {
    throw new Error("Could not find stealth OP_RETURN in transaction");
  }

  // Step 3: Derive PDAs
  const [poolState] = await derivePoolStatePDA(programId);
  const [lightClient] = await deriveLightClientPDA(programId);
  const [blockHeader] = await deriveBlockHeaderPDA(blockHeight, programId);
  const [commitmentTree] = await deriveCommitmentTreePDA(programId);
  const [depositRecord] = await deriveDepositRecordPDA(txidBytes, programId);
  const [stealthAnnouncement] = await deriveStealthAnnouncementPDA(
    programId,
    ephemeralPub
  );

  console.log("PDAs derived:");
  console.log(`  Pool: ${poolState}`);
  console.log(`  Light Client: ${lightClient}`);
  console.log(`  Block Header: ${blockHeader}`);
  console.log(`  Commitment Tree: ${commitmentTree}`);
  console.log(`  Deposit Record: ${depositRecord}`);
  console.log(`  Stealth Announcement: ${stealthAnnouncement}`);

  // Build merkle proof data
  const merkleProofData = buildMerkleProof(txidBytes, merkleProof, txIndex);

  // Build instruction data (includes ephemeralPub for stealth announcement)
  const instructionData = buildVerifyStealthDepositData({
    txid: txidBytes,
    blockHeight: BigInt(blockHeight),
    expectedValue,
    transactionSize,
    merkleProof: merkleProofData,
    ephemeralPub,
  });

  // Create instruction using v2 format
  const instruction = {
    programAddress: programId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: lightClient, role: AccountRole.READONLY },
      { address: blockHeader, role: AccountRole.READONLY },
      { address: commitmentTree, role: AccountRole.WRITABLE },
      { address: depositRecord, role: AccountRole.WRITABLE },
      { address: stealthAnnouncement, role: AccountRole.WRITABLE },
      { address: bufferAddress, role: AccountRole.READONLY },
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(instructionData),
  };

  // Get blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transaction message
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(instruction, msg)
  );

  // Sign and send
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sendAndConfirm(signedTx as any, { commitment: "confirmed" });

  const signature = getSignatureFromTransaction(signedTx);
  console.log(`Transaction confirmed: ${signature}`);
  return signature;
}

/**
 * Build instruction data for verify_stealth_deposit
 *
 * Includes ephemeralPub since OP_RETURN only contains commitment.
 * merkleProof is pre-serialized bytes from buildMerkleProof().
 */
function buildVerifyStealthDepositData(params: {
  txid: Uint8Array;
  blockHeight: bigint;
  expectedValue: bigint;
  transactionSize: number;
  merkleProof: Uint8Array;
  ephemeralPub: Uint8Array;
}): Uint8Array {
  // Calculate size: discriminator + txid + block_height + expected_value + tx_size + ephemeral_pub + merkle_proof
  const data = new Uint8Array(1 + 32 + 8 + 8 + 4 + 33 + params.merkleProof.length);
  let offset = 0;

  // Discriminator
  data[offset++] = VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR;

  // Txid (32 bytes)
  data.set(params.txid, offset);
  offset += 32;

  // Block height (8 bytes, LE)
  const blockHeightBytes = new Uint8Array(8);
  new DataView(blockHeightBytes.buffer).setBigUint64(
    0,
    params.blockHeight,
    true
  );
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

  // Ephemeral public key (33 bytes)
  data.set(params.ephemeralPub, offset);
  offset += 33;

  // Merkle proof (pre-serialized bytes)
  data.set(params.merkleProof, offset);

  return data;
}

/**
 * Extract stealth data from raw BTC transaction (32-byte commitment)
 */
function extractStealthDataFromRawTx(
  rawTx: Uint8Array
): ParsedStealthOpReturn | null {
  // Simple OP_RETURN finder - looks for 0x6a (OP_RETURN) followed by push
  for (let i = 0; i < rawTx.length - STEALTH_OP_RETURN_SIZE - 2; i++) {
    // Look for OP_RETURN (0x6a)
    if (rawTx[i] === 0x6a) {
      // Check push length (could be 1-byte or OP_PUSHDATA)
      let pushLen = 0;
      let dataStart = i + 2;

      if (rawTx[i + 1] <= 0x4b) {
        // Direct push (1-75 bytes)
        pushLen = rawTx[i + 1];
      } else if (rawTx[i + 1] === 0x4c) {
        // OP_PUSHDATA1
        pushLen = rawTx[i + 2];
        dataStart = i + 3;
      } else if (rawTx[i + 1] === 0x4d) {
        // OP_PUSHDATA2
        pushLen = rawTx[i + 2] | (rawTx[i + 3] << 8);
        dataStart = i + 4;
      }

      if (pushLen >= STEALTH_OP_RETURN_SIZE && dataStart + pushLen <= rawTx.length) {
        const opReturnData = rawTx.slice(dataStart, dataStart + pushLen);
        const parsed = parseStealthOpReturn(opReturnData);
        if (parsed) {
          return parsed;
        }
      }
    }
  }
  return null;
}

