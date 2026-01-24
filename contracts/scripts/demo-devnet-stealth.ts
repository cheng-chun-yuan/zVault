import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { zVault } from "../target/types/zVault";
import {
  createStealthDeposit,
  generateStealthKeys,
  scanAnnouncementsWithSolana,
  type StealthDeposit,
  getStealthSharedSecret
} from "../sdk/src/stealth";
import { 
  createClient, 
  ZVAULT_DEVNET_ID 
} from "../sdk/src/zVault";
import { generateNote, type Note } from "../sdk/src/note";
import { deriveTaprootAddress } from "../sdk/src/taproot";
import { Keypair, PublicKey } from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { 
  TOKEN_2022_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  createAccount 
} from "@solana/spl-token";

// Helper to wait
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("🚀 Starting zVault Devnet Demo...");

  // 1. Setup
  // Use ANCHOR_PROVIDER_URL and ANCHOR_WALLET from env
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.zVault as Program<zVault>;
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", provider.wallet.publicKey.toString());

  const sdk = createClient(provider.connection, "devnet");

  // 2. Initialize Pool & Tree (if needed)
  let poolStatePda: PublicKey;
  let poolStateBump: number;
  let sbbtcMint: PublicKey;
  let poolVault: PublicKey;
  let frostVault: PublicKey;
  // We need these for admin actions. In script, we use provider wallet as admin.
  // Assuming deployed by this wallet.
  const adminKeypair = (provider.wallet as any).payer as Keypair;

  [poolStatePda, poolStateBump] = sdk.derivePoolStatePDA();
  const treePda = sdk.deriveCommitmentTreePDA()[0];

  const poolInfo = await provider.connection.getAccountInfo(poolStatePda);
  
  if (!poolInfo) {
    console.log("Initializing Pool on Devnet...");
    // Generate new keys for vaults if needed, or derived?
    // In test we used random keys. Here we should maybe derive or use random.
    // Let's use random for simplicity, but log them.
    const privacyCashPool = Keypair.generate();
    
    // Create Mint
    console.log("Creating Mint...");
    sbbtcMint = await createMint(
      provider.connection,
      adminKeypair,
      poolStatePda,
      null,
      8,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("zBTC Mint:", sbbtcMint.toString());

    // Create Vaults
    const poolVaultAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      adminKeypair,
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
      adminKeypair,
      sbbtcMint,
      adminKeypair.publicKey, // Admin holds frost vault keys for demo
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Initialize Pool
    await program.methods
      .initialize(poolStateBump)
      .accounts({
        poolState: poolStatePda,
        sbbtcMint: sbbtcMint,
        poolVault: poolVault,
        frostVault: frostVault,
        privacyCashPool: privacyCashPool.publicKey,
        authority: adminKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([]) // provider wallet signs automatically
      .rpc();
    console.log("Pool Initialized");
  } else {
      console.log("Pool already initialized.");
      const poolAccount = await program.account.poolState.fetch(poolStatePda);
      sbbtcMint = poolAccount.sbbtcMint;
      // We assume provider wallet is authority
  }

  // Initialize Tree if needed
  const treeInfo = await provider.connection.getAccountInfo(treePda);
  if (!treeInfo) {
    console.log("Initializing Commitment Tree...");
    const [_treePda, treeBump] = sdk.deriveCommitmentTreePDA();
    
    await program.methods
      .initCommitmentTree(treeBump)
      .accounts({
        poolState: poolStatePda,
        commitmentTree: treePda,
        authority: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Commitment Tree Initialized");
  } else {
    console.log("Commitment Tree already initialized.");
  }

  // 3. Fixed Receiver Setup
  const receiverKeypair = Keypair.generate();
  console.log("\n👤 Receiver Identity:");
  console.log("  Pubkey:", receiverKeypair.publicKey.toString());
  console.log("  Secret:", bs58.encode(receiverKeypair.secretKey));

  // 4. Generate & Push 10 Stealth Deposits
  console.log("\n📦 Generating 10 Stealth Deposits...");
  
  const deposits: { deposit: StealthDeposit; amount: bigint }[] = [];
  const startAmount = 100_000n;

  for (let i = 0; i < 10; i++) {
    const amount = startAmount + BigInt(i * 1000);
    console.log(`\n[${i+1}/10] Processing deposit for ${amount} sats...`);

    const deposit = await createStealthDeposit(
      (await import("../sdk/src/stealth")).solanaPubKeyToX25519(receiverKeypair.publicKey.toBytes()),
      amount
    );
    deposits.push({ deposit, amount });

    // Simulate BTC TX
    const { address } = await deriveTaprootAddress(deposit.commitment, "testnet");
    console.log(`  BTC Address: ${address}`);
    console.log(`  OP_RETURN: ${deposit.commitment.toString(16)}`);

    try {
      const tx1 = await program.methods
        .addDemoCommitment(
          Array.from(Buffer.from(deposit.commitment.toString(16).padStart(64, "0"), "hex")), 
          new anchor.BN(amount.toString())
        )
        .accounts({
          poolState: poolStatePda,
          commitmentTree: treePda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log(`  ✅ Commitment added to tree: ${tx1}`);

      const tx2 = await program.methods
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
      console.log(`  ✅ Stealth Announced: ${tx2}`);
      
    } catch (e) {
      console.error("  ❌ Chain Error:", e);
    }
    
    await sleep(1000);
  }

  // 5. Receiver Scan
  console.log("\n🔍 Receiver Scanning Chain...");
  
  const announcementAccounts = await program.account.stealthAnnouncement.all();
  console.log(`  Found ${announcementAccounts.length} total announcements on-chain`);

  const announcements = announcementAccounts.map(a => ({
    ephemeralPubKey: new Uint8Array(a.account.ephemeralPubkey),
    commitment: BigInt("0x" + Buffer.from(a.account.commitment).toString("hex")),
    encryptedAmount: new Uint8Array(a.account.encryptedAmount),
    recipientHint: new Uint8Array(a.account.recipientHint)
  }));

  const found = await scanAnnouncementsWithSolana(
    receiverKeypair.secretKey,
    announcements
  );

  console.log(`  ✅ Successfully decrypted ${found.length} deposits!`);
  
  // 6. Random 3 Operations (Partial Withdraw)
  console.log("\n🎲 Selecting 3 Random Deposits for Partial Withdraw...");
  
  const shuffled = found.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 3);

  for (const [idx, item] of selected.entries()) {
    console.log(`\n[${idx+1}/3] Processing Note (Commitment: ${item.commitment.toString(16).substring(0, 16)}...)`);
    console.log(`  Amount: ${item.amount} sats`);

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
    console.log(`  Splitting: ${withdrawAmount} (Withdraw) + ${changeAmount} (Change)`);

    // Insert commitment into local SDK tree to generate valid proof
    // Devnet tree has it (we pushed it), but local SDK tree is empty.
    await sdk.insertCommitment(note.commitmentBytes);

    try {
      const splitResult = await sdk.generateSplit(note, withdrawAmount, changeAmount);
      
      console.log("  Proof Generated. Submitting Split...");

      const splitTx = await program.methods
        .splitCommitment(
          Array.from(splitResult.proof),
          Array.from(splitResult.inputNullifierHash),
          Array.from(splitResult.output1.commitmentBytes),
          Array.from(splitResult.output2.commitmentBytes),
          Array.from(sdk.getMerkleRoot())
        )
        .accounts({
          poolState: poolStatePda,
          commitmentTree: treePda,
          nullifierRecord: sdk.deriveNullifierRecordPDA(splitResult.inputNullifierHash)[0],
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log(`  ✅ Split Complete: ${splitTx}`);

      console.log("  Claiming Withdraw Note...");
      await sdk.insertCommitment(splitResult.output1.commitmentBytes);
      const { proof: claimProof } = await sdk.generateClaimProof(splitResult.output1);
      
      const claimTx = await program.methods
        .claimDirect(
          Array.from(claimProof),
          Array.from(sdk.getMerkleRoot()),
          Array.from(splitResult.output1.nullifierHashBytes),
          new anchor.BN(splitResult.output1.amount.toString())
        )
        .accounts({
          poolState: poolStatePda,
          commitmentTree: treePda,
          user: provider.wallet.publicKey,
          nullifierRecord: sdk.deriveNullifierRecordPDA(splitResult.output1.nullifierHashBytes)[0],
          sbbtcMint: sbbtcMint,
          userTokenAccount: await getOrCreateAssociatedTokenAccount(
            provider.connection,
            adminKeypair,
            sbbtcMint,
            provider.wallet.publicKey
          ).then(acc => acc.address),
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
        
      console.log(`  ✅ Claim Complete: ${claimTx}`);

    } catch (e: any) {
      if (e.message && e.message.includes("Circuit files not found")) {
        console.warn("  ⚠️ Skipping on-chain split/claim (Circuits missing)");
        continue;
      }
      console.error("  ❌ Operation Failed:", e);
    }
  }

  console.log("\n🎉 Demo Complete!");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
