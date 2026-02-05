/**
 * Spend Partial Public Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/spend-partial-public
 */

import type { Address } from "@solana/kit";
import { INSTRUCTION_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";

/**
 * Build spend_partial_public instruction data
 *
 * Format: disc(1) + proof_len(4) + proof(388) + root(32) + nullifier(32) + amount(8)
 *         + change(32) + recipient(32) + vk_hash(32) + ephPubX(32) + encAmount(32)
 */
export function buildSpendPartialPublicInstructionData(options: {
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
  const {
    proofBytes,
    root,
    nullifierHash,
    publicAmountSats,
    changeCommitment,
    recipient,
    vkHash,
    changeEphemeralPubX,
    changeEncryptedAmountWithSign,
  } = options;
  const recipientBytes = addressToBytes(recipient);

  // disc(1) + proof_len(4) + proof + root(32) + nullifier(32) + amount(8)
  // + change(32) + recipient(32) + vk_hash(32) + ephPubX(32) + encAmount(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32 + 32 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.SPEND_PARTIAL_PUBLIC;

  // Proof length and bytes
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;

  // Public inputs
  data.set(root, offset);
  offset += 32;
  data.set(nullifierHash, offset);
  offset += 32;
  view.setBigUint64(offset, publicAmountSats, true);
  offset += 8;
  data.set(changeCommitment, offset);
  offset += 32;
  data.set(recipientBytes, offset);
  offset += 32;
  data.set(vkHash, offset);
  offset += 32;
  data.set(changeEphemeralPubX, offset);
  offset += 32;
  data.set(changeEncryptedAmountWithSign, offset);

  return data;
}
