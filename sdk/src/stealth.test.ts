import { expect, test, describe } from "bun:test";
import {
  createStealthDeposit,
  scanAnnouncements,
  prepareClaimInputs,
  parseStealthAnnouncement,
  announcementToScanFormat,
  isWalletAdapter,
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
} from "./stealth";
import {
  deriveKeysFromSeed,
  createStealthMetaAddress,
} from "./keys";

describe("Stealth Address (Unified API)", () => {
  test("creates stealth deposit with dual-key ECDH", async () => {
    // Generate recipient keys
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x42);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    // Create stealth deposit
    const amount = 100_000n; // 0.001 BTC
    const deposit = await createStealthDeposit(meta, amount);

    expect(deposit.ephemeralViewPub.length).toBe(32);
    expect(deposit.ephemeralSpendPub.length).toBe(33);
    expect(deposit.amountSats).toBe(amount);
    expect(deposit.commitment.length).toBe(32);
    expect(deposit.createdAt).toBeGreaterThan(0);
  });

  test("scans announcements with ZVaultKeys", async () => {
    // Generate recipient keys
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x56);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    // Create deposit
    const amount = 50_000n;
    const deposit = await createStealthDeposit(meta, amount);

    // Simulate on-chain announcement
    const announcements = [{
      ephemeralViewPub: deposit.ephemeralViewPub,
      ephemeralSpendPub: deposit.ephemeralSpendPub,
      amountSats: deposit.amountSats,
      commitment: deposit.commitment,
      leafIndex: 0,
    }];

    // Scan with keys
    const found = await scanAnnouncements(recipientKeys, announcements);

    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].leafIndex).toBe(0);
  });

  test("prepares claim inputs with ZVaultKeys", async () => {
    // Generate recipient keys
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x78);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    // Create deposit
    const amount = 25_000n;
    const deposit = await createStealthDeposit(meta, amount);

    // Simulate on-chain announcement
    const announcements = [{
      ephemeralViewPub: deposit.ephemeralViewPub,
      ephemeralSpendPub: deposit.ephemeralSpendPub,
      amountSats: deposit.amountSats,
      commitment: deposit.commitment,
      leafIndex: 5,
    }];

    // Scan
    const found = await scanAnnouncements(recipientKeys, announcements);
    expect(found.length).toBe(1);

    // Prepare claim inputs
    const merkleProof = {
      root: 12345n,
      pathElements: Array(20).fill(0n),
      pathIndices: Array(20).fill(0),
    };

    const claimInputs = await prepareClaimInputs(recipientKeys, found[0], merkleProof);

    expect(claimInputs.spendingPrivKey).toBe(recipientKeys.spendingPrivKey);
    expect(claimInputs.amount).toBe(amount);
    expect(claimInputs.leafIndex).toBe(5);
    expect(claimInputs.nullifier).toBeGreaterThan(0n);
  });

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

  test("different nullifiers for different leaf indices", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x9A);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const amount = 10_000n;
    const deposit = await createStealthDeposit(meta, amount);

    // Same deposit at different leaf indices
    const ann1 = {
      ephemeralViewPub: deposit.ephemeralViewPub,
      ephemeralSpendPub: deposit.ephemeralSpendPub,
      amountSats: deposit.amountSats,
      commitment: deposit.commitment,
      leafIndex: 0,
    };
    const ann2 = { ...ann1, leafIndex: 1 };

    const found1 = await scanAnnouncements(recipientKeys, [ann1]);
    const found2 = await scanAnnouncements(recipientKeys, [ann2]);

    const merkleProof = {
      root: 12345n,
      pathElements: Array(20).fill(0n),
      pathIndices: Array(20).fill(0),
    };

    const claim1 = await prepareClaimInputs(recipientKeys, found1[0], merkleProof);
    const claim2 = await prepareClaimInputs(recipientKeys, found2[0], merkleProof);

    // Different leaf indices → different nullifiers!
    expect(claim1.nullifier).not.toBe(claim2.nullifier);
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
