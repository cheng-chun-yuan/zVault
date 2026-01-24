/**
 * Noir Localnet Test Script
 *
 * Tests the Noir proof generation and claim_noir instruction on localnet.
 *
 * Requirements:
 * 1. solana-test-validator running
 * 2. Program deployed: anchor deploy
 * 3. Noir circuits compiled
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  createAccount,
} from "@solana/spl-token";
import { execSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Import types from target
import { zVault } from "../target/types/zVault";

const NOIR_CIRCUITS_DIR = join(__dirname, "../noir-circuits");

interface NoirProof {
  proof: Uint8Array;
  publicInputs: Uint8Array[];
  vkHash: Uint8Array;
}

/**
 * Generate a Noir claim proof using the existing test values
 *
 * Note: This uses the pre-computed Prover.toml values that work with the circuit.
 * In production, the SDK would generate these values programmatically.
 */
function generateClaimProofWithTestValues(): NoirProof | null {
  const circuitPath = join(NOIR_CIRCUITS_DIR, "claim");
  const bbPath = join(NOIR_CIRCUITS_DIR, "node_modules/.bin/bb");

  try {
    // Execute circuit (uses existing Prover.toml)
    execSync("nargo execute", { cwd: circuitPath, stdio: "pipe" });

    // Generate proof
    const bytecode = join(circuitPath, "target", "zvault_claim.json");
    const witness = join(circuitPath, "target", "zvault_claim.gz");
    const proofsDir = join(circuitPath, "proofs", "proof");

    if (!existsSync(join(circuitPath, "proofs"))) {
      mkdirSync(join(circuitPath, "proofs"), { recursive: true });
    }

    execSync(
      `"${bbPath}" prove -b "${bytecode}" -w "${witness}" -o "${proofsDir}" --write_vk --verify`,
      { cwd: circuitPath, stdio: "pipe" }
    );

    // Read proof files
    const proof = readFileSync(join(proofsDir, "proof"));
    const publicInputsBinary = readFileSync(join(proofsDir, "public_inputs"));
    const vkHash = readFileSync(join(proofsDir, "vk_hash"));

    // Parse binary public inputs
    const publicInputs: Uint8Array[] = [];
    for (let i = 0; i < publicInputsBinary.length; i += 32) {
      publicInputs.push(new Uint8Array(publicInputsBinary.slice(i, i + 32)));
    }

    return {
      proof: new Uint8Array(proof),
      publicInputs,
      vkHash: new Uint8Array(vkHash),
    };
  } catch (error: any) {
    console.error("Error generating proof:", error.message);
    if (error.stderr) {
      console.error("stderr:", error.stderr.toString());
    }
    return null;
  }
}

async function main() {
  console.log("==============================================");
  console.log("    Noir Localnet Integration Test");
  console.log("==============================================\n");

  // Setup Anchor
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.zVault as Program<zVault>;
  console.log("Program ID:", program.programId.toString());

  // Test values
  const nullifier = 12345n;
  const secret = 67890n;
  const amount = 1_000_000n; // 0.01 BTC in satoshis

  // 1. Check if pool is initialized
  console.log("\n1. Checking pool state...");
  const [poolStatePda, poolStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state")],
    program.programId
  );

  let sbbtcMint: PublicKey;
  let authority: Keypair;

  const poolInfo = await provider.connection.getAccountInfo(poolStatePda);
  if (!poolInfo) {
    console.log("   Pool not initialized. Initializing...");

    // Use wallet as authority for simpler testing
    authority = (provider.wallet as any).payer as Keypair;

    // Create mint
    sbbtcMint = await createMint(
      provider.connection,
      authority,
      poolStatePda,
      null,
      8,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("   zBTC Mint:", sbbtcMint.toString());

    // Create pool vault
    const poolVaultAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      sbbtcMint,
      poolStatePda,
      true,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Create frost vault
    const frostVault = await createAccount(
      provider.connection,
      authority,
      sbbtcMint,
      authority.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const privacyCashPool = Keypair.generate();

    await program.methods
      .initialize(poolStateBump)
      .accounts({
        poolState: poolStatePda,
        sbbtcMint: sbbtcMint,
        poolVault: poolVaultAccount.address,
        frostVault: frostVault,
        privacyCashPool: privacyCashPool.publicKey,
        authority: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("   Pool initialized!");
  } else {
    const poolAccount = await program.account.poolState.fetch(poolStatePda);
    sbbtcMint = poolAccount.sbbtcMint;
    authority = (provider.wallet as any).payer as Keypair;
    console.log("   Pool already initialized. Mint:", sbbtcMint.toString());
  }

  // 2. Initialize commitment tree
  console.log("\n2. Checking commitment tree...");
  const [treePda, treeBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment_tree")],
    program.programId
  );

  const treeInfo = await provider.connection.getAccountInfo(treePda);
  if (!treeInfo) {
    console.log("   Tree not initialized. Initializing...");

    await program.methods
      .initCommitmentTree(treeBump)
      .accounts({
        poolState: poolStatePda,
        commitmentTree: treePda,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("   Tree initialized!");
  } else {
    console.log("   Tree already initialized.");
  }

  // 3. Add demo commitment
  console.log("\n3. Adding demo commitment...");

  // Compute commitment placeholder (circuit computes real value)
  const commitment = new Uint8Array(32);
  // Just use a simple placeholder for now
  commitment[31] = 1;

  try {
    await program.methods
      .addDemoCommitment(Array.from(commitment) as number[], new anchor.BN(amount.toString()))
      .accounts({
        poolState: poolStatePda,
        commitmentTree: treePda,
        authority: authority.publicKey,
      })
      .rpc();
    console.log("   Demo commitment added!");
  } catch (e: any) {
    if (e.message?.includes("already")) {
      console.log("   Commitment already exists (OK for repeated test)");
    } else {
      console.log("   Warning:", e.message);
    }
  }

  // 4. Generate Noir proof using test values
  console.log("\n4. Generating Noir proof...");
  console.log("   Note: Using pre-computed test values from claim/Prover.toml");

  const proof = generateClaimProofWithTestValues();

  if (!proof) {
    console.log("   Failed to generate proof!");
    process.exit(1);
  }

  console.log("   Proof generated!");
  console.log("     - Proof size:", proof.proof.length, "bytes");
  console.log("     - Public inputs:", proof.publicInputs.length);
  console.log("     - VK hash:", Buffer.from(proof.vkHash).toString("hex").slice(0, 16) + "...");

  // 5. Call claim_noir instruction
  console.log("\n5. Calling claim_noir instruction...");

  // Public inputs from proof:
  // [0] merkle_root
  // [1] nullifier_hash
  // [2] amount
  const merkleRoot = proof.publicInputs[0];
  const nullifierHash = proof.publicInputs[1];
  const proofAmount = proof.publicInputs[2];

  // Extract amount as u64 (from big-endian 32 bytes)
  let amountBN = 0n;
  for (let i = 0; i < proofAmount.length; i++) {
    amountBN = (amountBN << 8n) | BigInt(proofAmount[i]);
  }
  console.log("   Proof amount:", amountBN.toString(), "satoshis");

  // Compute proof hash (SHA256 of proof bytes)
  const { createHash } = await import("crypto");
  const proofHash = createHash("sha256").update(proof.proof).digest();
  console.log("   Proof hash:", proofHash.toString("hex").slice(0, 16) + "...");

  // Get user token account
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    (provider.wallet as any).payer,
    sbbtcMint,
    provider.wallet.publicKey,
    false,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  // Derive nullifier record PDA
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    program.programId
  );

  console.log("   Merkle root:", Buffer.from(merkleRoot).toString("hex").slice(0, 16) + "...");
  console.log("   Nullifier hash:", Buffer.from(nullifierHash).toString("hex").slice(0, 16) + "...");

  // Convert public inputs to fixed array format
  const publicInputsArray: number[][] = [
    Array.from(merkleRoot),
    Array.from(nullifierHash),
    Array.from(proofAmount),
  ];

  // Use demo mode (zero VK hash) to bypass root check
  // In production, VK hash would be set to the actual circuit VK hash
  const demoVkHash = new Uint8Array(32); // All zeros = demo mode
  console.log("   Using demo mode (VK hash = zeros) to bypass root check");

  try {
    const tx = await program.methods
      .claimNoir(
        Array.from(proofHash) as number[],
        publicInputsArray as any,
        Array.from(demoVkHash) as number[],
        Array.from(nullifierHash) as number[],
        new anchor.BN(amountBN.toString())
      )
      .accounts({
        poolState: poolStatePda,
        commitmentTree: treePda,
        nullifierRecord: nullifierPda,
        sbbtcMint: sbbtcMint,
        userTokenAccount: userTokenAccount.address,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("   Success! TX:", tx);
  } catch (e: any) {
    console.log("   Transaction failed:", e.message);
    if (e.logs) {
      console.log("   Logs:");
      e.logs.forEach((log: string) => console.log("     ", log));
    }
  }

  console.log("\n==============================================");
  console.log("              Test Complete");
  console.log("==============================================");
}

main().catch((e) => {
  console.error("\nError:", e);
  process.exit(1);
});
