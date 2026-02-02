/**
 * Pool Deposit Instruction Builder
 *
 * @module instructions/pool-deposit
 */

import type { ProofSource } from "./types";
import { INSTRUCTION_DISCRIMINATORS } from "./types";

/**
 * Build pool deposit instruction data (UltraHonk - supports buffer mode)
 */
export function buildPoolDepositInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  poolCommitment: Uint8Array;
  amountSats: bigint;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, poolCommitment, amountSats, vkHash } = options;

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) + pool_commitment(32) + amount(8) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 32 + 8 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION_DISCRIMINATORS.DEPOSIT_TO_POOL;
    data[offset++] = 0;
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
  } else {
    // Buffer: discriminator(1) + proof_source(1) + root(32) + nullifier(32) + pool_commitment(32) + amount(8) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 32 + 8 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;
    data[offset++] = INSTRUCTION_DISCRIMINATORS.DEPOSIT_TO_POOL;
    data[offset++] = 1;
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
}
