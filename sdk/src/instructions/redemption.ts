/**
 * Redemption Request Instruction Builder
 *
 * @module instructions/redemption
 */

import { INSTRUCTION_DISCRIMINATORS } from "./types";

/**
 * Build instruction data for REQUEST_REDEMPTION
 *
 * Burns zBTC and creates a RedemptionRequest PDA that the
 * backend redemption processor will pick up.
 *
 * Layout:
 * - discriminator (1 byte) = 5
 * - amount_sats (8 bytes, LE)
 * - btc_address_len (1 byte)
 * - btc_address (variable, max 62 bytes)
 *
 * @param amountSats - Amount to redeem in satoshis
 * @param btcAddress - Bitcoin address for withdrawal (max 62 bytes)
 */
export function buildRedemptionRequestInstructionData(
  amountSats: bigint,
  btcAddress: string
): Uint8Array {
  const btcAddrBytes = new TextEncoder().encode(btcAddress);
  if (btcAddrBytes.length > 62) {
    throw new Error("BTC address too long (max 62 bytes)");
  }

  // Layout: discriminator(1) + amount(8) + addr_len(1) + addr
  const totalLen = 1 + 8 + 1 + btcAddrBytes.length;
  const data = new Uint8Array(totalLen);
  const view = new DataView(data.buffer);

  let offset = 0;
  data[offset++] = INSTRUCTION_DISCRIMINATORS.REQUEST_REDEMPTION;

  view.setBigUint64(offset, amountSats, true);
  offset += 8;

  data[offset++] = btcAddrBytes.length;
  data.set(btcAddrBytes, offset);

  return data;
}
