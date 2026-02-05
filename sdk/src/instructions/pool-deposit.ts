/**
 * Pool Deposit Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/pool-deposit
 */

import { INSTRUCTION_DISCRIMINATORS } from "./types";

/**
 * Build pool deposit instruction data (Groth16 inline)
 */
export function buildPoolDepositInstructionData(options: {
  proofBytes: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  poolCommitment: Uint8Array;
  amountSats: bigint;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofBytes, root, nullifierHash, poolCommitment, amountSats, vkHash } = options;

  // Inline: discriminator(1) + proof_len(4) + proof + root(32) + nullifier(32) + pool_commitment(32) + amount(8) + vk_hash(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 32 + 8 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.DEPOSIT_TO_POOL;
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;
  data.set(root, offset);
  offset += 32;
  data.set(nullifierHash, offset);
  offset += 32;
  data.set(poolCommitment, offset);
  offset += 32;
  view.setBigUint64(offset, amountSats, true);
  offset += 8;
  data.set(vkHash, offset);

  return data;
}
