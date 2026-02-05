/**
 * Sunspot Groth16 Verifier Instruction Builders
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/verifier
 */

import type { Address } from "@solana/kit";
import type { Instruction } from "./types";
import { VERIFIER_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";
import { BN254_FIELD_PRIME, bytesToBigint, bigintToBytes } from "../crypto";

/** Groth16 proof size constant */
export const GROTH16_PROOF_SIZE = 388;

/**
 * Build VERIFY instruction for Sunspot Groth16 verifier
 *
 * This instruction includes the proof directly in the instruction data.
 * Groth16 proofs are only 388 bytes, making inline mode efficient.
 *
 * This instruction must be called BEFORE the zVault instruction in the same TX.
 * The zVault instruction uses instruction introspection to verify this was called.
 *
 * Accounts: [vk_account (READONLY)]
 * Format: [discriminator(1)] [proof_len(4)] [proof] [pi_count(4)] [public_inputs(N*32)] [vk_hash(32)]
 */
export function buildVerifyInstruction(options: {
  verifierProgramId: Address;
  vkAddress: Address;
  /** Groth16 proof bytes (388 bytes) */
  proofBytes: Uint8Array;
  /** Public inputs - 32-byte field elements */
  publicInputs: Uint8Array[] | string[];
  vkHash: Uint8Array;
}): Instruction {
  const { AccountRole } = require("@solana/kit");

  const { verifierProgramId, vkAddress, proofBytes, publicInputs, vkHash } = options;

  // Convert string hex public inputs to Uint8Array
  const piBytes: Uint8Array[] = publicInputs.map((pi) => {
    if (typeof pi === "string") {
      const hex = pi.startsWith("0x") ? pi.slice(2) : pi;
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2) || "0", 16);
      }
      return bytes;
    }
    return pi;
  });

  const piCount = piBytes.length;
  // Format: discriminator(1) + proof_len(4) + proof + pi_count(4) + public_inputs(N*32) + vk_hash(32)
  const totalSize = 1 + 4 + proofBytes.length + 4 + piCount * 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = VERIFIER_DISCRIMINATORS.VERIFY;

  // Proof length (little-endian)
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;

  // Proof bytes
  data.set(proofBytes, offset);
  offset += proofBytes.length;

  // Public inputs count (little-endian)
  view.setUint32(offset, piCount, true);
  offset += 4;

  // Public inputs
  for (const pi of piBytes) {
    if (pi.length !== 32) {
      throw new Error(`Public input must be 32 bytes, got ${pi.length}`);
    }
    data.set(pi, offset);
    offset += 32;
  }

  // VK hash
  data.set(vkHash, offset);

  return {
    programAddress: verifierProgramId,
    accounts: [
      { address: vkAddress, role: AccountRole.READONLY },
    ],
    data,
  };
}

/**
 * Build public inputs array for claim verifier call
 *
 * Order must match circuit: [merkle_root, nullifier_hash, amount, recipient]
 *
 * IMPORTANT: Recipient must be reduced modulo BN254_FIELD_PRIME to match what the prover uses.
 * The Noir circuit represents public keys as field elements, which are always < BN254_FIELD_PRIME.
 */
export function buildClaimVerifierInputs(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  amountSats: bigint;
  recipient: Address;
}): Uint8Array[] {
  // Reduce recipient modulo BN254_FIELD_PRIME to match circuit's field element representation
  const recipientRaw = addressToBytes(options.recipient);
  const recipientReduced = bytesToBigint(recipientRaw) % BN254_FIELD_PRIME;
  const recipientBytes = bigintToBytes(recipientReduced);

  // Encode amount as 32-byte field element (big-endian, like other field elements)
  const amountBytes = new Uint8Array(32);
  const amountHex = options.amountSats.toString(16).padStart(16, "0");
  for (let i = 0; i < 8; i++) {
    amountBytes[24 + i] = parseInt(amountHex.slice(i * 2, i * 2 + 2), 16);
  }

  return [
    options.root,
    options.nullifierHash,
    amountBytes,
    recipientBytes,
  ];
}

/**
 * Build public inputs array for spend_split verifier call
 *
 * Order must match circuit: [root, nullifier_hash, out1, out2, eph1_x, enc1, eph2_x, enc2]
 */
export function buildSplitVerifierInputs(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  output1EphemeralPubX: Uint8Array;
  output1EncryptedAmountWithSign: Uint8Array;
  output2EphemeralPubX: Uint8Array;
  output2EncryptedAmountWithSign: Uint8Array;
}): Uint8Array[] {
  return [
    options.root,
    options.nullifierHash,
    options.outputCommitment1,
    options.outputCommitment2,
    options.output1EphemeralPubX,
    options.output1EncryptedAmountWithSign,
    options.output2EphemeralPubX,
    options.output2EncryptedAmountWithSign,
  ];
}

/**
 * Build public inputs array for spend_partial_public verifier call
 *
 * Order must match circuit: [root, nullifier_hash, public_amount, change_commitment,
 *                           recipient, ephemeral_pub_x, encrypted_amount_with_sign]
 *
 * IMPORTANT: Recipient must be reduced modulo BN254_FIELD_PRIME to match what the prover uses.
 * The Noir circuit represents public keys as field elements, which are always < BN254_FIELD_PRIME.
 */
export function buildPartialPublicVerifierInputs(options: {
  root: Uint8Array;
  nullifierHash: Uint8Array;
  publicAmountSats: bigint;
  changeCommitment: Uint8Array;
  recipient: Address;
  changeEphemeralPubX: Uint8Array;
  changeEncryptedAmountWithSign: Uint8Array;
}): Uint8Array[] {
  // Reduce recipient modulo BN254_FIELD_PRIME to match circuit's field element representation
  const recipientRaw = addressToBytes(options.recipient);
  const recipientReduced = bytesToBigint(recipientRaw) % BN254_FIELD_PRIME;
  const recipientBytes = bigintToBytes(recipientReduced);

  // Encode amount as 32-byte field element (big-endian)
  const amountBytes = new Uint8Array(32);
  const amountHex = options.publicAmountSats.toString(16).padStart(16, "0");
  for (let i = 0; i < 8; i++) {
    amountBytes[24 + i] = parseInt(amountHex.slice(i * 2, i * 2 + 2), 16);
  }

  return [
    options.root,
    options.nullifierHash,
    amountBytes,
    options.changeCommitment,
    recipientBytes,
    options.changeEphemeralPubX,
    options.changeEncryptedAmountWithSign,
  ];
}
