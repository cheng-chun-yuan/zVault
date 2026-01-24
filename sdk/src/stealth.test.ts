/**
 * Stealth Address Utilities Tests
 *
 * Tests stealth-specific utilities (parsing, type guards, conversions).
 * Core stealth flow tests (create, scan, claim) are in keys.test.ts.
 */

import { expect, test, describe } from "bun:test";
import {
  parseStealthAnnouncement,
  announcementToScanFormat,
  isWalletAdapter,
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
} from "./stealth";
import { deriveKeysFromSeed } from "./keys";

describe("Stealth Utilities", () => {
  test("isWalletAdapter type guard works correctly", () => {
    // Mock wallet adapter
    const mockWallet = {
      publicKey: { toBytes: () => new Uint8Array(32) },
      signMessage: async (msg: Uint8Array) => new Uint8Array(64),
    };

    // ZVaultKeys
    const keys = deriveKeysFromSeed(new Uint8Array(32));

    expect(isWalletAdapter(mockWallet)).toBe(true);
    expect(isWalletAdapter(keys)).toBe(false);
    expect(isWalletAdapter(null)).toBe(false);
    expect(isWalletAdapter(undefined)).toBe(false);
    expect(isWalletAdapter({})).toBe(false);
  });

  test("parseStealthAnnouncement parses on-chain data", () => {
    // Build mock on-chain data
    const data = new Uint8Array(STEALTH_ANNOUNCEMENT_SIZE);
    data[0] = STEALTH_ANNOUNCEMENT_DISCRIMINATOR; // discriminator
    data[1] = 255; // bump

    // ephemeral_view_pub (32 bytes starting at offset 2)
    for (let i = 0; i < 32; i++) data[2 + i] = i;

    // ephemeral_spend_pub (33 bytes starting at offset 34)
    data[34] = 0x02; // compressed point prefix
    for (let i = 1; i < 33; i++) data[34 + i] = i;

    // amount_sats (8 bytes LE starting at offset 67)
    const amountView = new DataView(data.buffer, 67, 8);
    amountView.setBigUint64(0, 50000n, true);

    // commitment (32 bytes starting at offset 75)
    for (let i = 0; i < 32; i++) data[75 + i] = 0xAB;

    // leaf_index (8 bytes LE starting at offset 107)
    const leafIndexView = new DataView(data.buffer, 107, 8);
    leafIndexView.setBigUint64(0, 42n, true);

    // created_at (8 bytes LE starting at offset 115)
    const createdAtView = new DataView(data.buffer, 115, 8);
    createdAtView.setBigInt64(0, BigInt(Date.now()), true);

    const parsed = parseStealthAnnouncement(data);
    expect(parsed).not.toBeNull();
    expect(parsed!.amountSats).toBe(50000n);
    expect(parsed!.leafIndex).toBe(42);
    expect(parsed!.ephemeralViewPub.length).toBe(32);
    expect(parsed!.ephemeralSpendPub.length).toBe(33);
    expect(parsed!.commitment.length).toBe(32);
  });

  test("announcementToScanFormat converts correctly", () => {
    const announcement = {
      ephemeralViewPub: new Uint8Array(32),
      ephemeralSpendPub: new Uint8Array(33),
      amountSats: 100_000n,
      commitment: new Uint8Array(32),
      leafIndex: 10,
      createdAt: Date.now(),
    };

    const scanFormat = announcementToScanFormat(announcement);

    expect(scanFormat.ephemeralViewPub).toBe(announcement.ephemeralViewPub);
    expect(scanFormat.ephemeralSpendPub).toBe(announcement.ephemeralSpendPub);
    expect(scanFormat.amountSats).toBe(announcement.amountSats);
    expect(scanFormat.commitment).toBe(announcement.commitment);
    expect(scanFormat.leafIndex).toBe(announcement.leafIndex);
  });
});
