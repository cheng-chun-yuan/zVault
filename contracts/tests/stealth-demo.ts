import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { zVault } from "../target/types/zVault";
import {
  createStealthDeposit,
  scanAnnouncementsWithSolana,
  type StealthDeposit,
  solanaPubKeyToX25519
} from "../sdk/src/stealth";
import { 
  createClient 
} from "../sdk/src/zVault";
import { type Note } from "../sdk/src/note";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { 
  TOKEN_2022_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  createAccount 
} from "@solana/spl-token";

describe("zVault Localnet Demo Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.zVault as Program<zVault>;
  const sdk = createClient(provider.connection, "localnet");

  const receiverKeypair = Keypair.generate();
  
  const deposits: { deposit: StealthDeposit; amount: bigint }[] = [];
  let foundDeposits: any[] = [];

  let poolStatePda: PublicKey;
  let poolStateBump: number;
  let sbbtcMint: PublicKey;
  let poolVault: PublicKey;
  let frostVault: PublicKey;
  let privacyCashPool: Keypair;
  let frostAuthority: Keypair;

  it("1. Initialize Pool & Tree (if needed)", async () => {
    [poolStatePda, poolStateBump] = sdk.derivePoolStatePDA();
    const treePda = sdk.deriveCommitmentTreePDA()[0];

    const poolInfo = await provider.connection.getAccountInfo(poolStatePda);
    
    if (!poolInfo) {
      console.log("Initializing Pool...");
      frostAuthority = Keypair.generate();
      privacyCashPool = Keypair.generate();

      const sig = await provider.connection.requestAirdrop(frostAuthority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      sbbtcMint = await createMint(
        provider.connection,
        frostAuthority,
        poolStatePda,
        null,
        8,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      console.log("zBTC Mint:", sbbtcMint.toString());

      const poolVaultAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        frostAuthority,
        sbbtcMint,
        poolStatePda,
        true,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      poolVault = poolVaultAccount.address;

      frostVault = await createAccount(
        provider.connection,
        frostAuthority,
        sbbtcMint,
        frostAuthority.publicKey,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      await program.methods
        .initialize(poolStateBump)
        .accounts({
          poolState: poolStatePda,
          sbbtcMint: sbbtcMint,
          poolVault: poolVault,
          frostVault: frostVault,
          privacyCashPool: privacyCashPool.publicKey,
          authority: frostAuthority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([frostAuthority])
        .rpc();
      console.log("Pool Initialized");
    } else {
        const poolAccount = await program.account.poolState.fetch(poolStatePda);
        sbbtcMint = poolAccount.sbbtcMint;
        frostVault = poolAccount.frostVault;
        // Mock authority if needed
        frostAuthority = Keypair.generate(); 
        // In real test reuse existing authority keypair if possible or fail if admin action needed
    }

    const treeInfo = await provider.connection.getAccountInfo(treePda);
    if (!treeInfo) {
      console.log("Initializing Commitment Tree...");
      const [_treePda, treeBump] = sdk.deriveCommitmentTreePDA();
      
      await program.methods
        .initCommitmentTree(treeBump)
        .accounts({
          poolState: poolStatePda,
          commitmentTree: treePda,
          authority: frostAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([frostAuthority])
        .rpc();
    }
  });

  it("2. Generate & Push 10 Stealth Deposits", async () => {
    if (!frostAuthority) throw new Error("Frost Authority not available");

    console.log("\n📦 Generating 10 Stealth Deposits...");
    const startAmount = 100_000n;

    for (let i = 0; i < 10; i++) {
      const amount = startAmount + BigInt(i * 1000);
      
      const deposit = await createStealthDeposit(
        solanaPubKeyToX25519(receiverKeypair.publicKey.toBytes()),
        amount
      );
      deposits.push({ deposit, amount });

      await program.methods
        .addDemoCommitment(
          Array.from(Buffer.from(deposit.commitment.toString(16).padStart(64, "0"), "hex")), 
          new anchor.BN(amount.toString())
        )
        .accounts({
          poolState: sdk.derivePoolStatePDA()[0],
          commitmentTree: sdk.deriveCommitmentTreePDA()[0],
          authority: frostAuthority.publicKey,
        })
        .signers([frostAuthority])
        .rpc();

      await program.methods
        .announceStealth(
          Array.from(deposit.ephemeralPubKey),
          Array.from(Buffer.from(deposit.commitment.toString(16).padStart(64, "0"), "hex")),
          Array.from(deposit.recipientHint),
          Array.from(deposit.encryptedAmount),
          new anchor.BN(0)
        )
        .accounts({
          stealthAnnouncement: sdk.deriveStealthAnnouncementPDA(deposit.commitment)[0],
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }
    console.log("  ✅ 10 Deposits pushed to Localnet");
  });

  it("3. Receiver Scan", async () => {
    console.log("\n🔍 Receiver Scanning Chain...");
    
    const announcementAccounts = await program.account.stealthAnnouncement.all();
    expect(announcementAccounts.length).to.be.at.least(10);

    const announcements = announcementAccounts.map(a => ({
      ephemeralPubKey: new Uint8Array(a.account.ephemeralPubkey),
      commitment: BigInt("0x" + Buffer.from(a.account.commitment).toString("hex")),
      encryptedAmount: new Uint8Array(a.account.encryptedAmount),
      recipientHint: new Uint8Array(a.account.recipientHint)
    }));

    foundDeposits = await scanAnnouncementsWithSolana(
      receiverKeypair.secretKey,
      announcements
    );

    console.log(`  ✅ Successfully decrypted ${foundDeposits.length} deposits!`);
    expect(foundDeposits.length).to.equal(10);
  });

  it("4. Partial Withdraw (Split + Claim) on 3 Random", async () => {
    const selected = foundDeposits.slice(0, 3);
    const poolPda = sdk.derivePoolStatePDA()[0];
    const treePda = sdk.deriveCommitmentTreePDA()[0];

    for (const item of selected) {
      const note: Note = {
        amount: item.amount,
        nullifier: item.nullifier,
        secret: item.secret,
        nullifierBytes: Buffer.from(item.nullifier.toString(16).padStart(64, "0"), "hex"),
        secretBytes: Buffer.from(item.secret.toString(16).padStart(64, "0"), "hex"),
        commitment: item.commitment,
        commitmentBytes: Buffer.from(item.commitment.toString(16).padStart(64, "0"), "hex"),
        nullifierHash: 0n,
        nullifierHashBytes: new Uint8Array(32)
      };

      const withdrawAmount = item.amount / 2n;
      const changeAmount = item.amount - withdrawAmount;

      await sdk.insertCommitment(note.commitmentBytes);

      try {
        const splitResult = await sdk.generateSplit(note, withdrawAmount, changeAmount);
        
        await program.methods
          .splitCommitment(
            Array.from(splitResult.proof),
            Array.from(splitResult.inputNullifierHash),
            Array.from(splitResult.output1.commitmentBytes),
            Array.from(splitResult.output2.commitmentBytes),
            Array.from(sdk.getMerkleRoot())
          )
          .accounts({
            poolState: poolPda,
            commitmentTree: treePda,
            nullifierRecord: sdk.deriveNullifierRecordPDA(splitResult.inputNullifierHash)[0],
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        await sdk.insertCommitment(splitResult.output1.commitmentBytes);
        const { proof: claimProof } = await sdk.generateClaimProof(splitResult.output1);

        await program.methods
          .claimDirect(
            Array.from(claimProof),
            Array.from(sdk.getMerkleRoot()),
            Array.from(splitResult.output1.nullifierHashBytes),
            new anchor.BN(splitResult.output1.amount.toString())
          )
          .accounts({
            poolState: poolPda,
            commitmentTree: treePda,
            user: provider.wallet.publicKey,
            nullifierRecord: sdk.deriveNullifierRecordPDA(splitResult.output1.nullifierHashBytes)[0],
            sbbtcMint: sbbtcMint,
            userTokenAccount: await getOrCreateAssociatedTokenAccount(
              provider.connection,
              (provider.wallet as any).payer,
              sbbtcMint,
              provider.wallet.publicKey
            ).then(acc => acc.address),
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
          
      } catch (e: any) {
        if (e.message && e.message.includes("Circuit files not found")) {
          console.warn("⚠️ Skipping on-chain split/claim because circuit files are missing.");
          continue; 
        }
        throw e;
      }
    }
  });
});
