/**
 * SDK Integration Test
 *
 * Comprehensive test of SDK functions working together:
 * - Note generation
 * - Claim link encoding/decoding
 * - Stealth address flow
 * - API deposit flow
 * - Merkle tree operations
 */

import { expect, test, describe } from "bun:test";
import {
  generateNote,
  formatBtc,
  parseBtc,
  type Note
} from "./note";
import {
  createClaimLink,
  parseClaimLink,
  encodeClaimLink,
  decodeClaimLink
} from "./claim-link";
import {
  createStealthDeposit,
  generateStealthKeys,
  scanAnnouncements,
  solanaKeyToX25519,
  solanaPubKeyToX25519
} from "./stealth";
import {
  deposit,
  DEFAULT_PROGRAM_ID
} from "./api";
import {
  createEmptyMerkleProof,
  validateMerkleProofStructure,
  leafIndexToPathIndices,
  pathIndicesToLeafIndex,
  TREE_DEPTH,
  ZERO_VALUE,
} from "./merkle";
import { deriveTaprootAddress } from "./taproot";
import { Keypair } from "@solana/web3.js";

describe("SDK Integration Tests", () => {

  describe("1. Note Generation & Claim Links", () => {

    test("Generate note with correct properties", () => {
      const amount = 100_000n; // 0.001 BTC
      const note = generateNote(amount);

      expect(note.amount).toBe(amount);
      expect(note.nullifier).toBeGreaterThan(0n);
      expect(note.secret).toBeGreaterThan(0n);
      expect(note.nullifierBytes.length).toBe(32);
      expect(note.secretBytes.length).toBe(32);

      // Verify bytes match bigints
      const nullifierFromBytes = BigInt("0x" + Buffer.from(note.nullifierBytes).toString("hex"));
      expect(nullifierFromBytes).toBe(note.nullifier);
    });

    test("Create and parse claim link (full note)", () => {
      const note = generateNote(50_000n);
      const link = createClaimLink(note);

      expect(link).toContain("https://sbbtc.app/claim");
      expect(link).toContain("note=");

      const parsed = parseClaimLink(link);
      expect(parsed).toBeDefined();
      expect(parsed?.amount).toBe(note.amount);
      expect(parsed?.nullifier).toBe(note.nullifier);
      expect(parsed?.secret).toBe(note.secret);
    });

    test("Encode/decode claim link (simple format)", () => {
      const nullifier = 123456789n;
      const secret = 987654321n;

      const encoded = encodeClaimLink(nullifier, secret);
      const decoded = decodeClaimLink(encoded);

      expect(decoded).toBeDefined();
      // decodeClaimLink returns strings, not bigints
      expect(BigInt(decoded!.nullifier)).toBe(nullifier);
      expect(BigInt(decoded!.secret)).toBe(secret);
    });

    test("Format and parse BTC amounts", () => {
      expect(formatBtc(100_000_000n)).toBe("1.00000000 BTC");
      expect(formatBtc(50_000n)).toBe("0.00050000 BTC");
      expect(formatBtc(1n)).toBe("0.00000001 BTC");

      expect(parseBtc("1 BTC")).toBe(100_000_000n);
      expect(parseBtc("0.001 BTC")).toBe(100_000n);
      expect(parseBtc("0.00000001 BTC")).toBe(1n);
    });
  });

  describe("2. Stealth Address Flow", () => {

    test("Generate stealth keys", () => {
      const keys = generateStealthKeys();

      expect(keys.viewPrivKey.length).toBe(32);
      expect(keys.viewPubKey.length).toBe(32);

      // Keys should be random
      const keys2 = generateStealthKeys();
      expect(keys.viewPrivKey).not.toEqual(keys2.viewPrivKey);
    });

    test("Create stealth deposit", () => {
      const receiver = generateStealthKeys();
      const amount = 100_000n;

      const deposit = createStealthDeposit(receiver.viewPubKey, amount);

      expect(deposit.ephemeralPubKey.length).toBe(32);
      expect(deposit.encryptedAmount.length).toBe(8);
      expect(deposit.recipientHint.length).toBe(4);
      expect(deposit.amount).toBe(amount);
      expect(deposit.nullifier).toBeGreaterThan(0n);
      expect(deposit.secret).toBeGreaterThan(0n);
    });

    test("Scan and recover stealth deposit", () => {
      const receiver = generateStealthKeys();
      const amount = 75_000n;

      const deposit = createStealthDeposit(receiver.viewPubKey, amount);

      // Create announcement
      const announcements = [{
        ephemeralPubKey: deposit.ephemeralPubKey,
        encryptedAmount: deposit.encryptedAmount,
      }];

      // Receiver scans
      const found = scanAnnouncements(
        receiver.viewPrivKey,
        receiver.viewPubKey,
        announcements
      );

      expect(found.length).toBe(1);
      expect(found[0].amount).toBe(amount);
      expect(found[0].secret).toBe(deposit.secret);
      expect(found[0].nullifier).toBe(deposit.nullifier);
    });

    test("Multiple deposits with different amounts", () => {
      const receiver = generateStealthKeys();
      const amounts = [10_000n, 25_000n, 50_000n, 100_000n, 200_000n];

      const deposits = amounts.map(amount =>
        createStealthDeposit(receiver.viewPubKey, amount)
      );

      const announcements = deposits.map(d => ({
        ephemeralPubKey: d.ephemeralPubKey,
        encryptedAmount: d.encryptedAmount,
      }));

      const found = scanAnnouncements(
        receiver.viewPrivKey,
        receiver.viewPubKey,
        announcements
      );

      expect(found.length).toBe(5);

      // Verify all amounts recovered correctly
      for (let i = 0; i < amounts.length; i++) {
        const original = deposits[i];
        const recovered = found.find(f => f.secret === original.secret);
        expect(recovered).toBeDefined();
        expect(recovered?.amount).toBe(amounts[i]);
      }
    });

    test("Solana key to X25519 conversion", () => {
      const solanaKeypair = Keypair.generate();

      // Convert private key
      const stealthKeys = solanaKeyToX25519(solanaKeypair.secretKey);
      expect(stealthKeys.viewPrivKey.length).toBe(32);
      expect(stealthKeys.viewPubKey.length).toBe(32);

      // Convert public key
      const x25519Pub = solanaPubKeyToX25519(solanaKeypair.publicKey.toBytes());
      expect(x25519Pub.length).toBe(32);
    });
  });

  describe("3. Taproot Address Derivation", () => {

    test("Derive testnet taproot address", async () => {
      const commitment = new Uint8Array(32).fill(0xab);
      const { address, outputKey, tweak } = await deriveTaprootAddress(commitment, "testnet");

      expect(address).toMatch(/^tb1p/); // Testnet taproot prefix
      expect(outputKey.length).toBe(32);
      expect(tweak.length).toBe(32);
    });

    test("Derive mainnet taproot address", async () => {
      const commitment = new Uint8Array(32).fill(0xcd);
      const { address } = await deriveTaprootAddress(commitment, "mainnet");

      expect(address).toMatch(/^bc1p/); // Mainnet taproot prefix
    });

    test("Different commitments produce different addresses", async () => {
      const commitment1 = new Uint8Array(32).fill(0x11);
      const commitment2 = new Uint8Array(32).fill(0x22);

      const { address: addr1 } = await deriveTaprootAddress(commitment1, "testnet");
      const { address: addr2 } = await deriveTaprootAddress(commitment2, "testnet");

      expect(addr1).not.toBe(addr2);
    });
  });

  describe("4. Merkle Tree Operations", () => {

    test("Create empty merkle proof with correct structure", () => {
      const proof = createEmptyMerkleProof();

      expect(proof.pathElements.length).toBe(TREE_DEPTH);
      expect(proof.pathIndices.length).toBe(TREE_DEPTH);
      expect(proof.leafIndex).toBe(0);
      expect(proof.root.length).toBe(32);

      // Path indices should all be 0
      for (const idx of proof.pathIndices) {
        expect(idx).toBe(0);
      }
    });

    test("Validate merkle proof structure", () => {
      const proof = createEmptyMerkleProof();
      expect(validateMerkleProofStructure(proof)).toBe(true);

      // Invalid proof should fail validation
      const badProof = { ...proof, pathElements: [] };
      expect(validateMerkleProofStructure(badProof)).toBe(false);
    });

    test("Leaf index to path indices conversion", () => {
      // Leaf 0 -> all zeros
      const indices0 = leafIndexToPathIndices(0);
      expect(indices0.every(i => i === 0)).toBe(true);

      // Leaf 1 -> first index is 1
      const indices1 = leafIndexToPathIndices(1);
      expect(indices1[0]).toBe(1);
      expect(indices1.slice(1).every(i => i === 0)).toBe(true);

      // Roundtrip
      for (let i = 0; i < 100; i++) {
        const indices = leafIndexToPathIndices(i);
        const recovered = pathIndicesToLeafIndex(indices);
        expect(recovered).toBe(i);
      }
    });

    test("ZERO_VALUE has correct length", () => {
      expect(ZERO_VALUE.length).toBe(32);
    });
  });

  describe("5. API Deposit Flow", () => {

    test("Generate deposit credentials", async () => {
      const amount = 100_000n;
      const result = await deposit(amount, "testnet");

      expect(result.note.amount).toBe(amount);
      expect(result.taprootAddress).toMatch(/^tb1p/);
      expect(result.claimLink).toContain("sbbtc.app/claim");
      expect(result.displayAmount).toBe("0.00100000 BTC");
    });

    test("Generate multiple deposits with unique addresses", async () => {
      const deposits = await Promise.all([
        deposit(10_000n, "testnet"),
        deposit(20_000n, "testnet"),
        deposit(30_000n, "testnet"),
      ]);

      // All addresses should be unique
      const addresses = deposits.map(d => d.taprootAddress);
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(3);

      // All claim links should be unique
      const links = deposits.map(d => d.claimLink);
      const uniqueLinks = new Set(links);
      expect(uniqueLinks.size).toBe(3);
    });

    test("Custom base URL for claim links", async () => {
      const result = await deposit(50_000n, "testnet", "https://myapp.com");

      expect(result.claimLink).toContain("https://myapp.com");
    });
  });

  describe("6. End-to-End Integration", () => {

    test("Complete stealth deposit flow", async () => {
      // 1. Receiver generates keys
      const receiverSolana = Keypair.generate();
      const receiverStealth = solanaKeyToX25519(receiverSolana.secretKey);

      console.log("\n=== E2E Stealth Deposit Flow ===");
      console.log("Receiver Solana:", receiverSolana.publicKey.toString());

      // 2. Sender creates deposit
      const amount = 50_000n;
      const stealthDeposit = createStealthDeposit(receiverStealth.viewPubKey, amount);

      console.log("Stealth deposit created:");
      console.log("  Amount:", amount.toString(), "sats");
      console.log("  Ephemeral:", Buffer.from(stealthDeposit.ephemeralPubKey).toString("hex").slice(0, 16) + "...");

      // 3. Generate taproot address for BTC deposit
      const placeholderCommitment = new Uint8Array(32);
      const nullifierBytes = Buffer.from(stealthDeposit.nullifier.toString(16).padStart(64, "0"), "hex");
      placeholderCommitment.set(nullifierBytes.slice(0, 32));

      const { address: btcAddress } = await deriveTaprootAddress(placeholderCommitment, "testnet");
      console.log("  BTC Address:", btcAddress);

      // 4. Receiver scans and finds deposit
      const announcements = [{
        ephemeralPubKey: stealthDeposit.ephemeralPubKey,
        encryptedAmount: stealthDeposit.encryptedAmount,
      }];

      const found = scanAnnouncements(
        receiverStealth.viewPrivKey,
        receiverStealth.viewPubKey,
        announcements
      );

      expect(found.length).toBe(1);
      console.log("Receiver found deposit!");
      console.log("  Recovered amount:", found[0].amount.toString(), "sats");

      // 5. Convert to Note format for claim
      const note: Note = {
        amount: found[0].amount,
        nullifier: found[0].nullifier,
        secret: found[0].secret,
        nullifierBytes: Buffer.from(found[0].nullifier.toString(16).padStart(64, "0"), "hex"),
        secretBytes: Buffer.from(found[0].secret.toString(16).padStart(64, "0"), "hex"),
        commitmentBytes: new Uint8Array(32), // Would be computed by Noir
        nullifierHashBytes: new Uint8Array(32), // Would be computed by Noir
        commitment: 0n,
        nullifierHash: 0n,
      };

      // 6. Create claim link for backup
      const claimLink = createClaimLink(note);
      console.log("  Claim link:", claimLink.slice(0, 50) + "...");

      // 7. Parse back to verify
      const parsed = parseClaimLink(claimLink);
      expect(parsed?.amount).toBe(amount);
      expect(parsed?.nullifier).toBe(found[0].nullifier);

      console.log("=== E2E Complete ===\n");
    });

    test("Note split simulation", () => {
      // Create input note
      const inputNote = generateNote(100_000n);

      console.log("\n=== Note Split Simulation ===");
      console.log("Input amount:", inputNote.amount.toString(), "sats");

      // Split into 60k and 40k
      const output1 = generateNote(60_000n);
      const output2 = generateNote(40_000n);

      console.log("Output 1:", output1.amount.toString(), "sats");
      console.log("Output 2:", output2.amount.toString(), "sats");

      // Verify conservation
      expect(output1.amount + output2.amount).toBe(inputNote.amount);

      // Create claim links for outputs
      const link1 = createClaimLink(output1);
      const link2 = createClaimLink(output2);

      console.log("Claim link 1:", link1.slice(0, 40) + "...");
      console.log("Claim link 2:", link2.slice(0, 40) + "...");

      // Verify links are parseable
      expect(parseClaimLink(link1)?.amount).toBe(60_000n);
      expect(parseClaimLink(link2)?.amount).toBe(40_000n);

      console.log("=== Split Complete ===\n");
    });
  });
});
