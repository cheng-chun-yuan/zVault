/**
 * Yield Pool Instruction Data Builders
 *
 * Functions for building instruction data for yield pool operations.
 */

import { bytesToBigint } from "../crypto";
import { poseidonHashSync } from "../poseidon";
import type { Note } from "../note";
import type { MerkleProof } from "../merkle";
import {
  CREATE_YIELD_POOL_DISCRIMINATOR,
  DEPOSIT_TO_POOL_DISCRIMINATOR,
  COMPOUND_YIELD_DISCRIMINATOR,
  UPDATE_YIELD_RATE_DISCRIMINATOR,
  HARVEST_YIELD_DISCRIMINATOR,
} from "./constants";

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
 * Build instruction data for DEPOSIT_TO_POOL (Groth16 - inline proof)
 *
 * Format: discriminator(1) + proof_len(4) + proof(N) + nullifier(32) + commitment(32) +
 *         ephemeral(33) + principal(8) + merkle_root(32) + vk_hash(32)
 */
export function buildDepositToPoolData(
  proof: Uint8Array,
  inputNullifierHash: Uint8Array,
  poolCommitment: Uint8Array,
  ephemeralPub: Uint8Array,
  principal: bigint,
  inputMerkleRoot: Uint8Array,
  vkHash: Uint8Array
): Uint8Array {
  const proofLen = proof.length;
  const totalSize = 1 + 4 + proofLen + 32 + 32 + 33 + 8 + 32 + 32;
  const data = new Uint8Array(totalSize);

  let offset = 0;

  // discriminator (1 byte)
  data[offset++] = DEPOSIT_TO_POOL_DISCRIMINATOR;

  // proof_len (4 bytes, little-endian)
  data[offset++] = proofLen & 0xff;
  data[offset++] = (proofLen >> 8) & 0xff;
  data[offset++] = (proofLen >> 16) & 0xff;
  data[offset++] = (proofLen >> 24) & 0xff;

  // proof (variable length)
  data.set(proof, offset);
  offset += proofLen;

  // input_nullifier_hash (32 bytes)
  data.set(inputNullifierHash.slice(0, 32), offset);
  offset += 32;

  // pool_commitment (32 bytes)
  data.set(poolCommitment.slice(0, 32), offset);
  offset += 32;

  // ephemeral_pub (33 bytes)
  data.set(ephemeralPub.slice(0, 33), offset);
  offset += 33;

  // principal (8 bytes, little-endian)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, principal, true);
  offset += 8;

  // input_merkle_root (32 bytes)
  data.set(inputMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // vk_hash (32 bytes)
  data.set(vkHash.slice(0, 32), offset);

  return data;
}

/**
 * Build instruction data for COMPOUND_YIELD (Groth16 - inline proof)
 *
 * Format: discriminator(1) + proof_len(4) + proof(N) + nullifier(32) + new_commitment(32) +
 *         merkle_root(32) + old_principal(8) + deposit_epoch(8) + vk_hash(32)
 */
export function buildCompoundYieldData(
  proof: Uint8Array,
  oldNullifierHash: Uint8Array,
  newPoolCommitment: Uint8Array,
  poolMerkleRoot: Uint8Array,
  oldPrincipal: bigint,
  depositEpoch: bigint,
  vkHash: Uint8Array
): Uint8Array {
  const proofLen = proof.length;
  const totalSize = 1 + 4 + proofLen + 32 + 32 + 32 + 8 + 8 + 32;
  const data = new Uint8Array(totalSize);

  let offset = 0;

  // discriminator (1 byte)
  data[offset++] = COMPOUND_YIELD_DISCRIMINATOR;

  // proof_len (4 bytes, little-endian)
  data[offset++] = proofLen & 0xff;
  data[offset++] = (proofLen >> 8) & 0xff;
  data[offset++] = (proofLen >> 16) & 0xff;
  data[offset++] = (proofLen >> 24) & 0xff;

  // proof (variable length)
  data.set(proof, offset);
  offset += proofLen;

  // old_nullifier_hash (32 bytes)
  data.set(oldNullifierHash.slice(0, 32), offset);
  offset += 32;

  // new_pool_commitment (32 bytes)
  data.set(newPoolCommitment.slice(0, 32), offset);
  offset += 32;

  // pool_merkle_root (32 bytes)
  data.set(poolMerkleRoot.slice(0, 32), offset);
  offset += 32;

  // old_principal (8 bytes)
  const principalView = new DataView(data.buffer, offset, 8);
  principalView.setBigUint64(0, oldPrincipal, true);
  offset += 8;

  // deposit_epoch (8 bytes)
  const epochView = new DataView(data.buffer, offset, 8);
  epochView.setBigUint64(0, depositEpoch, true);
  offset += 8;

  // vk_hash (32 bytes)
  data.set(vkHash.slice(0, 32), offset);

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
    pool_commitment: poseidonHashSync([stealthPubX, principal, depositEpoch]).toString(),
    deposit_epoch: depositEpoch.toString(),
  };
}
