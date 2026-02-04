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
 * Build claim instruction data (UltraHonk - buffer mode only)
 *
 * Layout (buffer mode - proof in ChadBuffer, verified via introspection):
 * - root: [u8; 32] - Merkle tree root
 * - nullifier_hash: [u8; 32] - Nullifier to prevent double-spend
 * - amount_sats: u64 (LE) - Amount to claim (revealed)
 * - recipient: [u8; 32] - Recipient Solana wallet address
 * - vk_hash: [u8; 32] - Verification key hash
 *
 * Total: discriminator(1) + 136 bytes = 137 bytes
 *
 * Note: UltraHonk proofs (~16KB) are too large for inline mode.
 * Always use buffer mode with ChadBuffer + instruction introspection.
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
  const { proofSource, root, nullifierHash, amountSats, recipient, vkHash } = options;
  const recipientBytes = addressToBytes(recipient);

  if (proofSource === "inline") {
    throw new Error("Inline mode not supported for claim - UltraHonk proofs are too large. Use buffer mode.");
  }

  // Buffer format: discriminator(1) + root(32) + nullifier(32) + amount(8) + recipient(32) + vk_hash(32) = 137 bytes
  const totalSize = 1 + 32 + 32 + 8 + 32 + 32;
  const data = new Uint8Array(totalSize);
  const view = new DataView(data.buffer);

  let offset = 0;

  // Discriminator
  data[offset++] = INSTRUCTION_DISCRIMINATORS.CLAIM;

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
