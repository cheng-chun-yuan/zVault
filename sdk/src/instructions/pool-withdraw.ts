/**
 * Pool Withdraw Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/pool-withdraw
 */

import { INSTRUCTION_DISCRIMINATORS } from "./types";

/**
 * Build pool withdraw instruction data (Groth16 inline)
 */
export function buildPoolWithdrawInstructionData(options: {
  proofBytes: Uint8Array;
  poolRoot: Uint8Array;
  poolNullifierHash: Uint8Array;
  amountSats: bigint;
  outputCommitment: Uint8Array;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofBytes, poolRoot, poolNullifierHash, amountSats, outputCommitment, vkHash } = options;

  // Inline: discriminator(1) + proof_len(4) + proof + pool_root(32) + pool_nullifier(32) + amount(8) + output_commitment(32) + vk_hash(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.WITHDRAW_FROM_POOL;
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;
  data.set(poolRoot, offset);
  offset += 32;
  data.set(poolNullifierHash, offset);
  offset += 32;
  view.setBigUint64(offset, amountSats, true);
  offset += 8;
  data.set(outputCommitment, offset);
  offset += 32;
  data.set(vkHash, offset);

  return data;
}
