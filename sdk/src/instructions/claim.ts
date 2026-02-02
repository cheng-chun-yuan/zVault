/**
 * Claim Instruction Builder
 *
 * @module instructions/claim
 */

import type { Address } from "@solana/kit";
import type { ProofSource } from "./types";
import { INSTRUCTION_DISCRIMINATORS } from "./types";
import { addressToBytes } from "./utils";

/**
 * Build claim instruction data (UltraHonk - supports buffer mode)
 *
 * ## Inline Mode (proof_source=0)
 * - proof_source: u8 (0)
 * - proof_len: u32 (LE)
 * - proof: [u8; proof_len]
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - amount_sats: u64 (LE)
 * - recipient: [u8; 32]
 * - vk_hash: [u8; 32]
 *
 * ## Buffer Mode (proof_source=1)
 * - proof_source: u8 (1)
 * - root: [u8; 32]
 * - nullifier_hash: [u8; 32]
 * - amount_sats: u64 (LE)
 * - recipient: [u8; 32]
 * - vk_hash: [u8; 32]
 */
export function buildClaimInstructionData(options: {
  proofSource: ProofSource;
  proofBytes?: Uint8Array;
  root: Uint8Array;
  nullifierHash: Uint8Array;
  amountSats: bigint;
  recipient: Address;
  vkHash: Uint8Array;
}): Uint8Array {
  const { proofSource, proofBytes, root, nullifierHash, amountSats, recipient, vkHash } = options;
  const recipientBytes = addressToBytes(recipient);

  if (proofSource === "inline") {
    if (!proofBytes) {
      throw new Error("proofBytes required for inline mode");
    }

    // Inline format: discriminator(1) + proof_source(1) + proof_len(4) + proof + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 4 + proofBytes.length + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM;

    // Proof source (inline = 0)
    data[offset++] = 0;

    // Proof length (4 bytes, LE)
    view.setUint32(offset, proofBytes.length, true);
    offset += 4;

    // Proof bytes
    data.set(proofBytes, offset);
    offset += proofBytes.length;

    // Root (32 bytes)
    data.set(root, offset);
    offset += 32;

    // Nullifier hash (32 bytes)
    data.set(nullifierHash, offset);
    offset += 32;

    // Amount (8 bytes, LE)
    view.setBigUint64(offset, amountSats, true);
    offset += 8;

    // Recipient (32 bytes)
    data.set(recipientBytes, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);

    return data;
  } else {
    // Buffer format: discriminator(1) + proof_source(1) + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32)
    const totalSize = 1 + 1 + 32 + 32 + 8 + 32 + 32;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);

    let offset = 0;

    // Discriminator
    data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM;

    // Proof source (buffer = 1)
    data[offset++] = 1;

    // Root (32 bytes)
    data.set(root, offset);
    offset += 32;

    // Nullifier hash (32 bytes)
    data.set(nullifierHash, offset);
    offset += 32;

    // Amount (8 bytes, LE)
    view.setBigUint64(offset, amountSats, true);
    offset += 8;

    // Recipient (32 bytes)
    data.set(recipientBytes, offset);
    offset += 32;

    // VK hash (32 bytes)
    data.set(vkHash, offset);

    return data;
  }
}
