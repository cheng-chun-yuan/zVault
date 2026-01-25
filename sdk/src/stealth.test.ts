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
import { prepareStealthDeposit } from "./stealth-deposit";
import { deriveKeysFromSeed, createStealthMetaAddress } from "./keys";
import { deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed } from "./grumpkin";

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
    // Build mock on-chain data (98 bytes with single ephemeral key)
    const data = new Uint8Array(STEALTH_ANNOUNCEMENT_SIZE);
    data[0] = STEALTH_ANNOUNCEMENT_DISCRIMINATOR; // discriminator
    data[1] = 255; // bump

    // ephemeral_pub (33 bytes starting at offset 2)
    data[2] = 0x02; // compressed point prefix
    for (let i = 1; i < 33; i++) data[2 + i] = i;

    // amount_sats (8 bytes LE starting at offset 35)
    const amountView = new DataView(data.buffer, 35, 8);
    amountView.setBigUint64(0, 50000n, true);

    // commitment (32 bytes starting at offset 43)
    for (let i = 0; i < 32; i++) data[43 + i] = 0xAB;

    // leaf_index (8 bytes LE starting at offset 75)
    const leafIndexView = new DataView(data.buffer, 75, 8);
    leafIndexView.setBigUint64(0, 42n, true);

    // created_at (8 bytes LE starting at offset 83)
    const createdAtView = new DataView(data.buffer, 83, 8);
    createdAtView.setBigInt64(0, BigInt(Date.now()), true);

    const parsed = parseStealthAnnouncement(data);
    expect(parsed).not.toBeNull();
    expect(parsed!.amountSats).toBe(50000n);
    expect(parsed!.leafIndex).toBe(42);
    expect(parsed!.ephemeralPub.length).toBe(33); // Single Grumpkin key
    expect(parsed!.commitment.length).toBe(32);
  });

  test("announcementToScanFormat converts correctly", () => {
    const announcement = {
      ephemeralPub: new Uint8Array(33), // Single Grumpkin key
      amountSats: 100_000n,
      commitment: new Uint8Array(32),
      leafIndex: 10,
      createdAt: Date.now(),
    };

    const scanFormat = announcementToScanFormat(announcement);

    expect(scanFormat.ephemeralPub).toBe(announcement.ephemeralPub);
    expect(scanFormat.amountSats).toBe(announcement.amountSats);
    expect(scanFormat.commitment).toBe(announcement.commitment);
    expect(scanFormat.leafIndex).toBe(announcement.leafIndex);
  });
});

describe("Stealth Deposit (Amount-Independent)", () => {
  test("prepareStealthDeposit with custom ephemeralKeyPair produces same output", async () => {
    // Create recipient keys
    const recipientKeys = deriveKeysFromSeed(new Uint8Array(32).fill(0x42));
    const recipientMeta = createStealthMetaAddress(recipientKeys);

    // Create deterministic ephemeral keypair from seed
    const seed = new Uint8Array(32).fill(0xAB);
    const ephemeralKeyPair = deriveGrumpkinKeyPairFromSeed(seed);

    // Generate two deposits with same ephemeral key (no amount needed)
    const deposit1 = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair,
    });

    const deposit2 = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair,
    });

    // Should be deterministic - same outputs (same address for any amount)
    expect(deposit1.btcDepositAddress).toBe(deposit2.btcDepositAddress);
    expect(Buffer.from(deposit1.opReturnData).toString("hex"))
      .toBe(Buffer.from(deposit2.opReturnData).toString("hex"));
    expect(Buffer.from(deposit1.stealthData.ephemeralPub).toString("hex"))
      .toBe(Buffer.from(deposit2.stealthData.ephemeralPub).toString("hex"));
  });

  test("different ephemeral keys produce different deposits", async () => {
    const recipientKeys = deriveKeysFromSeed(new Uint8Array(32).fill(0x42));
    const recipientMeta = createStealthMetaAddress(recipientKeys);

    const ephemeral1 = deriveGrumpkinKeyPairFromSeed(new Uint8Array(32).fill(0x11));
    const ephemeral2 = deriveGrumpkinKeyPairFromSeed(new Uint8Array(32).fill(0x22));

    const deposit1 = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair: ephemeral1,
    });

    const deposit2 = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair: ephemeral2,
    });

    // Different ephemeral keys = different addresses
    expect(deposit1.btcDepositAddress).not.toBe(deposit2.btcDepositAddress);
    expect(Buffer.from(deposit1.stealthData.ephemeralPub).toString("hex"))
      .not.toBe(Buffer.from(deposit2.stealthData.ephemeralPub).toString("hex"));
  });

  test("random vs custom ephemeral key stealth deposit", async () => {
    const recipientKeys = deriveKeysFromSeed(new Uint8Array(32).fill(0x42));
    const recipientMeta = createStealthMetaAddress(recipientKeys);

    // Random ephemeral key (default)
    const randomDeposit = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
    });

    // Custom ephemeral key
    const customEphemeral = deriveGrumpkinKeyPairFromSeed(new Uint8Array(32).fill(0xAB));
    const customDeposit = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair: customEphemeral,
    });

    // Both should have valid structure
    expect(randomDeposit.btcDepositAddress).toMatch(/^tb1p/);
    expect(customDeposit.btcDepositAddress).toMatch(/^tb1p/);
    expect(randomDeposit.opReturnData.length).toBe(32);
    expect(customDeposit.opReturnData.length).toBe(32);
    expect(randomDeposit.stealthData.ephemeralPub.length).toBe(33);
    expect(customDeposit.stealthData.ephemeralPub.length).toBe(33);
  });

  test("same address works for any amount", async () => {
    const recipientKeys = deriveKeysFromSeed(new Uint8Array(32).fill(0x42));
    const recipientMeta = createStealthMetaAddress(recipientKeys);
    const ephemeralKeyPair = deriveGrumpkinKeyPairFromSeed(new Uint8Array(32).fill(0xAB));

    // Generate deposit address once
    const deposit = await prepareStealthDeposit({
      recipientMeta,
      network: "testnet",
      ephemeralKeyPair,
    });

    // Address is amount-independent - user can send any amount
    expect(deposit.btcDepositAddress).toMatch(/^tb1p/);
    // No amountSats in the response - it's determined by actual BTC tx
    expect(deposit).not.toHaveProperty("amountSats");
  });
});
