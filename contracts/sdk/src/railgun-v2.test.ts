/**
 * RAILGUN-Style Privacy Enhancement Tests
 *
 * Tests the dual-key ECDH system:
 * - Grumpkin curve operations
 * - Solana-derived key hierarchy
 * - Stealth deposit/scan/claim flow
 * - Key separation guarantees
 */

import { expect, test, describe } from "bun:test";
import {
  // Grumpkin curve
  generateKeyPair as generateGrumpkinKeyPair,
  deriveKeyPairFromSeed as deriveGrumpkinKeyPairFromSeed,
  ecdh as grumpkinEcdh,
  ecdhSharedSecret as grumpkinEcdhSharedSecret,
  pointMul,
  pointAdd,
  isOnCurve,
  scalarFromBytes,
  scalarToBytes,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  GRUMPKIN_GENERATOR,
  GRUMPKIN_ORDER,
  type GrumpkinPoint,
} from "./grumpkin";
import {
  // Key derivation
  deriveKeysFromSignature,
  deriveKeysFromSeed,
  createStealthMetaAddress,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  createDelegatedViewKey,
  ViewPermissions,
  isDelegatedKeyValid,
  hasPermission,
} from "./keys";
import {
  // Stealth (unified API)
  createStealthDeposit,
  scanAnnouncements,
  prepareClaimInputs,
} from "./stealth";
import {
  // Note V2
  createNoteV2,
  serializeNoteV2,
  deserializeNoteV2,
} from "./note";
import { sha256Hash, bigintToBytes } from "./crypto";

describe("Grumpkin Curve Operations", () => {
  test("generates valid keypair", () => {
    const { privKey, pubKey } = generateGrumpkinKeyPair();

    expect(privKey).toBeGreaterThan(0n);
    expect(privKey).toBeLessThan(GRUMPKIN_ORDER);
    expect(isOnCurve(pubKey)).toBe(true);
  });

  test("scalar multiplication works correctly", () => {
    const scalar = 12345n;
    const point = pointMul(scalar, GRUMPKIN_GENERATOR);

    expect(isOnCurve(point)).toBe(true);
    expect(point.x).not.toBe(0n);
  });

  test("ECDH produces same shared secret", () => {
    const alice = generateGrumpkinKeyPair();
    const bob = generateGrumpkinKeyPair();

    // Alice computes shared with Bob's public
    const aliceShared = grumpkinEcdhSharedSecret(alice.privKey, bob.pubKey);

    // Bob computes shared with Alice's public
    const bobShared = grumpkinEcdhSharedSecret(bob.privKey, alice.pubKey);

    // Should be the same!
    expect(aliceShared).toEqual(bobShared);
  });

  test("point serialization roundtrip", () => {
    const { pubKey } = generateGrumpkinKeyPair();

    // Compressed format
    const compressed = pointToCompressedBytes(pubKey);
    expect(compressed.length).toBe(33);

    const recovered = pointFromCompressedBytes(compressed);
    expect(recovered.x).toBe(pubKey.x);
    expect(recovered.y).toBe(pubKey.y);
  });

  test("deterministic key derivation from seed", () => {
    const seed = new Uint8Array(32);
    seed.fill(42);

    const kp1 = deriveGrumpkinKeyPairFromSeed(seed);
    const kp2 = deriveGrumpkinKeyPairFromSeed(seed);

    expect(kp1.privKey).toBe(kp2.privKey);
    expect(kp1.pubKey.x).toBe(kp2.pubKey.x);
    expect(kp1.pubKey.y).toBe(kp2.pubKey.y);
  });
});

describe("Key Derivation from Solana Wallet", () => {
  test("derives keys from signature (deterministic)", () => {
    // Simulate a Solana signature
    const signature = new Uint8Array(64);
    signature.fill(0x42);

    const solanaPublicKey = new Uint8Array(32);
    solanaPublicKey.fill(0x01);

    const keys1 = deriveKeysFromSignature(signature, solanaPublicKey);
    const keys2 = deriveKeysFromSignature(signature, solanaPublicKey);

    // Same signature → same keys
    expect(keys1.spendingPrivKey).toBe(keys2.spendingPrivKey);
    expect(keys1.viewingPrivKey).toEqual(keys2.viewingPrivKey);
  });

  test("spending and viewing keys are different", () => {
    const signature = new Uint8Array(64);
    signature.fill(0x42);

    const solanaPublicKey = new Uint8Array(32);
    solanaPublicKey.fill(0x01);

    const keys = deriveKeysFromSignature(signature, solanaPublicKey);

    // Keys should be different
    const spendingBytes = scalarToBytes(keys.spendingPrivKey);
    expect(spendingBytes).not.toEqual(keys.viewingPrivKey);
  });

  test("derives keys from seed", () => {
    const seed = new Uint8Array(32);
    seed.fill(0xAB);

    const keys = deriveKeysFromSeed(seed);

    expect(keys.spendingPrivKey).toBeGreaterThan(0n);
    expect(isOnCurve(keys.spendingPubKey)).toBe(true);
    expect(keys.viewingPrivKey.length).toBe(32);
    expect(keys.viewingPubKey.length).toBe(32);
  });
});

describe("Stealth Meta-Address", () => {
  test("creates and encodes stealth meta-address", () => {
    const seed = new Uint8Array(32);
    seed.fill(0xCD);

    const keys = deriveKeysFromSeed(seed);
    const meta = createStealthMetaAddress(keys);

    expect(meta.spendingPubKey.length).toBe(33); // Compressed Grumpkin
    expect(meta.viewingPubKey.length).toBe(32); // X25519

    // Encode/decode roundtrip
    const encoded = encodeStealthMetaAddress(meta);
    expect(encoded.length).toBe(130); // 65 bytes * 2 (hex)

    const decoded = decodeStealthMetaAddress(encoded);
    expect(decoded.spendingPubKey).toEqual(meta.spendingPubKey);
    expect(decoded.viewingPubKey).toEqual(meta.viewingPubKey);
  });
});

describe("Viewing Key Delegation", () => {
  test("creates delegated viewing key", () => {
    const seed = new Uint8Array(32);
    seed.fill(0xEF);

    const keys = deriveKeysFromSeed(seed);
    const delegated = createDelegatedViewKey(keys, ViewPermissions.FULL);

    expect(delegated.viewingPrivKey).toEqual(keys.viewingPrivKey);
    expect(delegated.permissions).toBe(ViewPermissions.FULL);
  });

  test("validates expiration", () => {
    const seed = new Uint8Array(32);
    seed.fill(0x12);

    const keys = deriveKeysFromSeed(seed);

    // Not expired
    const future = createDelegatedViewKey(keys, ViewPermissions.SCAN, {
      expiresAt: Date.now() + 1000000,
    });
    expect(isDelegatedKeyValid(future)).toBe(true);

    // Expired
    const past = createDelegatedViewKey(keys, ViewPermissions.SCAN, {
      expiresAt: Date.now() - 1000,
    });
    expect(isDelegatedKeyValid(past)).toBe(false);
  });

  test("checks permissions correctly", () => {
    const seed = new Uint8Array(32);
    seed.fill(0x34);

    const keys = deriveKeysFromSeed(seed);
    const scanOnly = createDelegatedViewKey(keys, ViewPermissions.SCAN);
    const full = createDelegatedViewKey(keys, ViewPermissions.FULL);

    expect(hasPermission(scanOnly, ViewPermissions.SCAN)).toBe(true);
    expect(hasPermission(scanOnly, ViewPermissions.HISTORY)).toBe(false);

    expect(hasPermission(full, ViewPermissions.SCAN)).toBe(true);
    expect(hasPermission(full, ViewPermissions.HISTORY)).toBe(true);
  });
});

describe("Stealth Deposit Flow", () => {
  test("creates stealth deposit", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x56);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const amount = 100_000n;
    const deposit = await createStealthDeposit(meta, amount);

    expect(deposit.ephemeralViewPub.length).toBe(32);
    expect(deposit.ephemeralSpendPub.length).toBe(33);
    expect(deposit.amountSats).toBe(amount);
    expect(deposit.commitment.length).toBe(32);
  });

  test("recipient scans announcements", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x78);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const amount = 50_000n;
    const deposit = await createStealthDeposit(meta, amount);

    // Simulate on-chain announcement
    const announcements = [
      {
        ephemeralViewPub: deposit.ephemeralViewPub,
        ephemeralSpendPub: deposit.ephemeralSpendPub,
        amountSats: deposit.amountSats,
        commitment: deposit.commitment,
        leafIndex: 0,
      },
    ];

    // Scan with ZVaultKeys
    const found = await scanAnnouncements(recipientKeys, announcements);

    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].leafIndex).toBe(0);
  });

  test("wrong recipient cannot claim (commitment mismatch)", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x9A);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const wrongSeed = new Uint8Array(32);
    wrongSeed.fill(0xBC);
    const wrongKeys = deriveKeysFromSeed(wrongSeed);

    const amount = 75_000n;
    const deposit = await createStealthDeposit(meta, amount);

    const announcements = [
      {
        ephemeralViewPub: deposit.ephemeralViewPub,
        ephemeralSpendPub: deposit.ephemeralSpendPub,
        amountSats: deposit.amountSats,
        commitment: deposit.commitment,
        leafIndex: 0,
      },
    ];

    // Scan still works (amount is public)
    const found = await scanAnnouncements(wrongKeys, announcements);
    expect(found.length).toBe(1);

    // But claim preparation fails (commitment mismatch)
    const merkleProof = {
      root: 12345n,
      pathElements: Array(20).fill(0n),
      pathIndices: Array(20).fill(0),
    };

    await expect(
      prepareClaimInputs(wrongKeys, found[0], merkleProof)
    ).rejects.toThrow("Commitment mismatch");
  });
});

describe("Claim Preparation", () => {
  test("prepares claim inputs with ZVaultKeys", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0xDE);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const amount = 25_000n;
    const deposit = await createStealthDeposit(meta, amount);

    const announcements = [
      {
        ephemeralViewPub: deposit.ephemeralViewPub,
        ephemeralSpendPub: deposit.ephemeralSpendPub,
        amountSats: deposit.amountSats,
        commitment: deposit.commitment,
        leafIndex: 5,
      },
    ];

    const found = await scanAnnouncements(recipientKeys, announcements);
    expect(found.length).toBe(1);

    // Prepare claim with spending key
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
});

describe("NoteV2 Types", () => {
  test("creates and serializes NoteV2", () => {
    const note = createNoteV2(
      100_000n,
      12345678901234567890n,
      { x: 111n, y: 222n },
      42
    );

    expect(note.amount).toBe(100_000n);
    expect(note.random).toBe(12345678901234567890n);
    expect(note.leafIndex).toBe(42);

    // Serialize/deserialize
    const serialized = serializeNoteV2(note);
    const recovered = deserializeNoteV2(serialized);

    expect(recovered.amount).toBe(note.amount);
    expect(recovered.random).toBe(note.random);
    expect(recovered.leafIndex).toBe(note.leafIndex);
  });
});

describe("Key Separation Security", () => {
  test("viewing key cannot derive spending key", () => {
    const seed = new Uint8Array(32);
    seed.fill(0xF0);

    const keys = deriveKeysFromSeed(seed);

    // Viewing key is X25519, spending key is Grumpkin scalar
    // They are derived via different paths from the signature
    // There's no way to derive one from the other

    // This test just documents the property - the separation is
    // enforced by the derivation algorithm using different domain
    // separators ("spending" vs "viewing")
    expect(keys.viewingPrivKey).not.toEqual(
      scalarToBytes(keys.spendingPrivKey)
    );
  });

  test("different nullifiers for different leaf indices", async () => {
    const recipientSeed = new Uint8Array(32);
    recipientSeed.fill(0x11);
    const recipientKeys = deriveKeysFromSeed(recipientSeed);
    const meta = createStealthMetaAddress(recipientKeys);

    const amount = 10_000n;
    const deposit = await createStealthDeposit(meta, amount);

    const baseAnn = {
      ephemeralViewPub: deposit.ephemeralViewPub,
      ephemeralSpendPub: deposit.ephemeralSpendPub,
      amountSats: deposit.amountSats,
      commitment: deposit.commitment,
    };

    // Same note at different leaf indices
    const ann1 = { ...baseAnn, leafIndex: 0 };
    const ann2 = { ...baseAnn, leafIndex: 1 };

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
});
