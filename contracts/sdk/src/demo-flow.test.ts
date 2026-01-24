import { expect, test, describe } from "bun:test";
import { 
  createStealthDeposit, 
  generateStealthKeys, 
  scanAnnouncements,
  getStealthSharedSecret
} from "./stealth";
import { generateNote } from "./note";
import { createClaimLink } from "./claim-link";
import { scalarMult, box } from 'tweetnacl';
import { bytesToBigint } from './crypto';

describe("Full Path Demo Flow", () => {
  
  test("1. Stealth Address Deposit & Claim Flow", async () => {
    console.log("\n--- Step 1: Stealth Deposit & Claim ---");
    
    // 1. Receiver generates long-term stealth keys
    const receiverKeys = generateStealthKeys();
    console.log("Receiver PubKey:", Buffer.from(receiverKeys.viewPubKey).toString('hex'));

    // 2. Sender creates stealth deposit (off-chain calculation)
    const amount = 100_000n; // 0.001 BTC
    console.log("Sender creating deposit for:", amount, "sats");
    
    const deposit = await createStealthDeposit(receiverKeys.viewPubKey, amount);
    console.log("Ephemeral PubKey:", Buffer.from(deposit.ephemeralPubKey).toString('hex'));

    const announcements = [{
      ephemeralPubKey: deposit.ephemeralPubKey,
      commitment: deposit.commitment,
      encryptedAmount: deposit.encryptedAmount,
      recipientHint: deposit.recipientHint
    }];

    // 4. Receiver scans announcements
    console.log("Receiver scanning...");
    const found = await scanAnnouncements(
      receiverKeys.viewPrivKey,
      receiverKeys.viewPubKey,
      announcements
    );

    expect(found.length).toBe(1);
    expect(found[0].amount).toBe(amount);
    expect(found[0].secret).toBe(deposit.secret);
    expect(found[0].nullifier).toBe(deposit.nullifier);
    
    console.log("Receiver found deposit!");
    console.log("Recovered Secret:", found[0].secret);
  });

  test("2. Note Split Flow (Off-chain generation)", async () => {
    console.log("\n--- Step 2: Note Split ---");
    
    // 1. Start with a note (e.g. from the claim above)
    const inputAmount = 100_000n;
    const inputNote = await generateNote(inputAmount);
    console.log("Input Note Commitment:", Buffer.from(inputNote.commitmentBytes).toString('hex'));

    // 2. Split into 60k and 40k
    const amount1 = 60_000n;
    const amount2 = 40_000n;
    
    const output1 = await generateNote(amount1);
    const output2 = await generateNote(amount2);
    
    console.log(`Splitting ${inputAmount} -> ${amount1} + ${amount2}`);
    console.log("Output 1 Commitment:", Buffer.from(output1.commitmentBytes).toString('hex'));
    console.log("Output 2 Commitment:", Buffer.from(output2.commitmentBytes).toString('hex'));

    // 3. Generate Claim Links for outputs
    const link1 = createClaimLink(output1);
    const link2 = createClaimLink(output2);
    
    console.log("Claim Link 1:", link1.substring(0, 50) + "...");
    
    // We verify the logic holds: input = sum(outputs)
    expect(inputNote.amount).toBe(output1.amount + output2.amount);
  });

  test("3. Multi-Ephemeral Key Test (10x)", async () => {
    console.log("\n--- Step 3: 10 Ephemeral Keys Test ---");
    
    // 1. Fixed Receiver
    const receiverKeys = generateStealthKeys();
    const receiverPubHex = Buffer.from(receiverKeys.viewPubKey).toString('hex');
    console.log("Fixed Receiver PubKey:", receiverPubHex);

    const amount = 500n;
    const announcements = [];
    const deposits = [];

    // 2. Sender generates 10 deposits with DIFFERENT ephemeral keys
    for (let i = 0; i < 10; i++) {
      const deposit = await createStealthDeposit(receiverKeys.viewPubKey, amount + BigInt(i));
      deposits.push(deposit);
      announcements.push({
        ephemeralPubKey: deposit.ephemeralPubKey,
        commitment: deposit.commitment,
        encryptedAmount: deposit.encryptedAmount,
        recipientHint: deposit.recipientHint
      });
      
      if (i > 0) {
        expect(deposit.ephemeralPubKey).not.toEqual(deposits[i-1].ephemeralPubKey);
      }
    }
    console.log("Generated 10 unique deposits.");

    // 3. Receiver scans all
    console.log("Receiver scanning...");
    const found = await scanAnnouncements(
      receiverKeys.viewPrivKey,
      receiverKeys.viewPubKey,
      announcements
    );

    console.log(`Found ${found.length} deposits.`);
    expect(found.length).toBe(10);

    // 4. Verify each recovered amount (match by secret since commitment is computed by Noir)
    for (let i = 0; i < 10; i++) {
      const original = deposits[i];
      const recovered = found.find(f => f.secret === original.secret);
      expect(recovered).toBeDefined();
      expect(recovered?.amount).toBe(amount + BigInt(i));
      expect(recovered?.nullifier).toBe(original.nullifier);
    }
    console.log("All 10 deposits successfully recovered and verified.");
  });
});
