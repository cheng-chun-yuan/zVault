/**
 * Spend Partial Public Instruction Builder
 *
 * @module instructions/spend-partial-public
 */

import type { Address } from "@solana/kit";
import { INSTRUCTION_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";

/**
 * Build spend_partial_public instruction data
 *
 * Format: disc(1) + root(32) + nullifier(32) + amount(8)
 *         + change(32) + recipient(32) + vk_hash(32) + ephPubX(32) + encAmount(32)
 */
export function buildSpendPartialPublicInstructionData(options: {
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

  const totalSize = 1 + 32 + 32 + 8 + 32 + 32 + 32 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.SPEND_PARTIAL_PUBLIC;

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
