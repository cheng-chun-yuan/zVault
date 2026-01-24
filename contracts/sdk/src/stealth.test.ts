import { expect, test, describe } from "bun:test";
import { 
  createStealthDeposit, 
  generateStealthKeys, 
  scanAnnouncements,
  solanaKeyToX25519,
  solanaPubKeyToX25519
} from "./stealth";
import { Keypair } from "@solana/web3.js";

describe("Stealth Address", () => {
  test("Option B: Native X25519 Stealth Deposit & Scan", async () => {
    // 1. Recipient generates keys
    const recipientKeys = generateStealthKeys();
    
    // 2. Sender creates deposit
    const amount = 100_000n; // 0.001 BTC
    const deposit = await createStealthDeposit(recipientKeys.viewPubKey, amount);
    
    // 3. Simulate announcement on-chain
    const announcements = [{
      ephemeralPubKey: deposit.ephemeralPubKey,
      commitment: deposit.commitment,
      encryptedAmount: deposit.encryptedAmount,
      recipientHint: deposit.recipientHint
    }];
    
    // 4. Recipient scans
    const found = await scanAnnouncements(
      recipientKeys.viewPrivKey, 
      recipientKeys.viewPubKey, 
      announcements
    );
    
    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].commitment).toBe(deposit.commitment);
    expect(found[0].nullifier).toBe(deposit.nullifier);
    expect(found[0].secret).toBe(deposit.secret);
  });

  test("Option A: Solana-Linked Stealth Deposit & Scan", async () => {
    // 1. Recipient has Solana wallet
    const solanaKeypair = Keypair.generate();
    // Solana secret key is 64 bytes (32 bytes secret + 32 bytes pubkey)
    // We only need the first 32 bytes for conversion
    const recipientKeys = solanaKeyToX25519(solanaKeypair.secretKey.slice(0, 32));
    
    // 2. Sender creates deposit using Solana pubkey
    const recipientX25519Pub = solanaPubKeyToX25519(solanaKeypair.publicKey.toBytes());
    expect(recipientX25519Pub).toEqual(recipientKeys.viewPubKey);
    
    const amount = 50_000n;
    const deposit = await createStealthDeposit(recipientX25519Pub, amount);
    
    // 3. Simulate announcement
    const announcements = [{
      ephemeralPubKey: deposit.ephemeralPubKey,
      commitment: deposit.commitment,
      encryptedAmount: deposit.encryptedAmount,
      recipientHint: deposit.recipientHint
    }];
    
    // 4. Recipient scans
    const found = await scanAnnouncements(
      recipientKeys.viewPrivKey,
      recipientKeys.viewPubKey,
      announcements
    );
    
    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].commitment).toBe(deposit.commitment);
  });

  test("Scanning ignores irrelevant announcements", async () => {
    const recipientKeys = generateStealthKeys();
    const otherKeys = generateStealthKeys();
    
    // Deposit for someone else
    const deposit = await createStealthDeposit(otherKeys.viewPubKey, 100n);
    
    const announcements = [{
      ephemeralPubKey: deposit.ephemeralPubKey,
      commitment: deposit.commitment,
      encryptedAmount: deposit.encryptedAmount,
      recipientHint: deposit.recipientHint
    }];
    
    const found = await scanAnnouncements(
      recipientKeys.viewPrivKey,
      recipientKeys.viewPubKey,
      announcements
    );
    
    expect(found.length).toBe(0);
  });
});
