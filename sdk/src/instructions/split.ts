/**
 * Split Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/split
 */

import { INSTRUCTION_DISCRIMINATORS } from "./types";

/**
 * Build split instruction data
 *
 * Format: disc(1) + proof_len(4) + proof(388) + root(32) + nullifier(32) + out1(32) + out2(32)
 *         + vk_hash(32) + eph1_x(32) + enc1(32) + eph2_x(32) + enc2(32)
 */
export function buildSplitInstructionData(options: {
  proofBytes: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  outputCommitment1: Uint8Array;
  outputCommitment2: Uint8Array;
  vkHash: Uint8Array;
  output1EphemeralPubX: Uint8Array;
  output1EncryptedAmountWithSign: Uint8Array;
  output2EphemeralPubX: Uint8Array;
  output2EncryptedAmountWithSign: Uint8Array;
}): Uint8Array {
  const {
    proofBytes,
    root,
    nullifierHash,
    outputCommitment1,
    outputCommitment2,
    vkHash,
    output1EphemeralPubX,
    output1EncryptedAmountWithSign,
    output2EphemeralPubX,
    output2EncryptedAmountWithSign,
  } = options;

  // disc(1) + proof_len(4) + proof + root(32) + nullifier(32) + out1(32) + out2(32)
  // + vk_hash(32) + eph1_x(32) + enc1(32) + eph2_x(32) + enc2(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.SPEND_SPLIT;

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
  data.set(outputCommitment1, offset);
  offset += 32;
  data.set(outputCommitment2, offset);
  offset += 32;
  data.set(vkHash, offset);
  offset += 32;
  data.set(output1EphemeralPubX, offset);
  offset += 32;
  data.set(output1EncryptedAmountWithSign, offset);
  offset += 32;
  data.set(output2EphemeralPubX, offset);
  offset += 32;
  data.set(output2EncryptedAmountWithSign, offset);

  return data;
}
