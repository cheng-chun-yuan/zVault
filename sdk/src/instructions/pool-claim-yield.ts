/**
 * Pool Claim Yield Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/pool-claim-yield
 */

import type { Address } from "@solana/kit";
import { INSTRUCTION_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";

/**
 * Build pool claim yield instruction data (Groth16 inline)
 */
export function buildPoolClaimYieldInstructionData(options: {
  proofBytes: Uint8Array;
  poolRoot: Uint8Array;
  poolNullifierHash: Uint8Array;
  newPoolCommitment: Uint8Array;
  yieldAmountSats: bigint;
  recipient: Address;
  vkHash: Uint8Array;
}): Uint8Array {
  const {
    proofBytes,
    poolRoot,
    poolNullifierHash,
    newPoolCommitment,
    yieldAmountSats,
    recipient,
    vkHash,
  } = options;
  const recipientBytes = addressToBytes(recipient);

  // Inline: discriminator(1) + proof_len(4) + proof + pool_root(32) + pool_nullifier(32) + new_commitment(32) + yield_amount(8) + recipient(32) + vk_hash(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 32 + 8 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM_POOL_YIELD;
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;
  data.set(poolRoot, offset);
  offset += 32;
  data.set(poolNullifierHash, offset);
  offset += 32;
  data.set(newPoolCommitment, offset);
  offset += 32;
  view.setBigUint64(offset, yieldAmountSats, true);
  offset += 8;
  data.set(recipientBytes, offset);
  offset += 32;
  data.set(vkHash, offset);

  return data;
}
