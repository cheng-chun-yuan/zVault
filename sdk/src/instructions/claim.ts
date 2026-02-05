/**
 * Claim Instruction Builder
 *
 * Groth16 proofs are only 388 bytes, so inline mode is used exclusively.
 *
 * @module instructions/claim
 */

import type { Address } from "@solana/kit";
import { INSTRUCTION_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";

/**
 * Build claim instruction data (Groth16 proofs via Sunspot)
 *
 * Layout:
 * - discriminator: u8 (1 byte)
 * - proof_len: u32 LE (4 bytes)
 * - proof: [u8; N] - Groth16 proof (~388 bytes)
 * - root: [u8; 32] - Merkle tree root
 * - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
 * - amount_sats: u64 LE (8 bytes) - Amount to claim (revealed)
 * - recipient: [u8; 32] - Recipient Solana wallet address
 * - vk_hash: [u8; 32] - Verification key hash
 *
 * Total: ~529 bytes (1 + 4 + 388 + 32 + 32 + 8 + 32 + 32)
 */
export function buildClaimInstructionData(options: {
  proofBytes: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  amountSats: bigint;
  recipient: Address;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofBytes, root, nullifierHash, amountSats, recipient, vkHash } = options;
  const recipientBytes = addressToBytes(recipient);

  // Inline format: discriminator(1) + proof_len(4) + proof + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32)
  const totalSize = 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM;
  view.setUint32(offset, proofBytes.length, true);
  offset += 4;
  data.set(proofBytes, offset);
  offset += proofBytes.length;
  data.set(root, offset);
  offset += 32;
  data.set(nullifierHash, offset);
  offset += 32;
  view.setBigUint64(offset, amountSats, true);
  offset += 8;
  data.set(recipientBytes, offset);
  offset += 32;
  data.set(vkHash, offset);

  return data;
}
