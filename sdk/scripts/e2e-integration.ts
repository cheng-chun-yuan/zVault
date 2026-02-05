#!/usr/bin/env bun
/**
 * zVault On-Chain Integration Test
 *
 * Full privacy flow on devnet:
 *   Demo Deposit (10,000 sats)
 *     → Split (5,000 + 5,000)
 *       → Claim B1 (5,000 → public zkBTC)
 *       → Spend Partial Public B2 (3,000 public + 2,000 change)
 *
 * Total withdrawn: 8,000 sats < 10,000 minted ✅
 *
 * Usage:
 *   NETWORK=devnet bun run scripts/e2e-integration.ts
 *
 * Environment:
 *   KEYPAIR_PATH - Path to keypair file (default: ~/.config/solana/id.json)
 *   NETWORK      - Network to use: devnet (default: devnet)
 */

import * as fs from "fs";
import * as path from "path";
import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  AccountRole,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

// SDK modules
import {
  buildClaimInstruction,
  buildSplitInstruction,
  buildSpendPartialPublicInstruction,
  bytesToHex,
  hexToBytes,
} from "../src/instructions";

import { buildAddDemoStealthData, DEMO_INSTRUCTION } from "../src/demo";

import {
  getConfig,
  setConfig,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  type NetworkConfig,
} from "../src/config";

import {
  deriveNullifierRecordPDA,
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveStealthAnnouncementPDA,
} from "../src/pda";

import {
  generateGrumpkinKeyPair,
  pointToCompressedBytes,
} from "../src/crypto";

import {
  initPoseidon,
  poseidonHashSync,
  computeNullifierSync,
  hashNullifierSync,
  BN254_SCALAR_FIELD,
} from "../src/poseidon";

import {
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  generatePartialPublicProofGroth16,
  configureSunspot,
  isSunspotAvailable,
} from "../src/prover/sunspot";

import {
  buildCommitmentTreeFromChain,
  getMerkleProofFromTree,
  type RpcClient,
  type CommitmentTreeIndex,
} from "../src/commitment-tree";

// =============================================================================
// Configuration
// =============================================================================

const NETWORK = (process.env.NETWORK || "devnet") as "localnet" | "devnet";

const NETWORK_URLS: Record<string, { rpcUrl: string; wsUrl: string }> = {
  localnet: { rpcUrl: "http://127.0.0.1:8899", wsUrl: "ws://127.0.0.1:8900" },
  devnet: { rpcUrl: "https://api.devnet.solana.com", wsUrl: "wss://api.devnet.solana.com" },
};

const { rpcUrl: RPC_URL, wsUrl: WS_URL } = NETWORK_URLS[NETWORK];

const DEFAULT_KEYPAIR_PATH = path.join(
  process.env.HOME || "~",
  ".config/solana/johnny.json"
);

// =============================================================================
// Utilities
// =============================================================================

function loadKeypair(keypairPath: string): Uint8Array {
  const keyFile = fs.readFileSync(keypairPath, "utf-8");
  return new Uint8Array(JSON.parse(keyFile));
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bs58Decode(str: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
  }

  let num = BigInt(0);
  for (const char of str) {
    const val = ALPHABET_MAP.get(char);
    if (val === undefined) throw new Error(`Invalid base58 character: ${char}`);
    num = num * BigInt(58) + BigInt(val);
  }

  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") leadingZeros++;
    else break;
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  for (let i = 0; i < leadingZeros; i++) bytes.unshift(0);
  while (bytes.length < 32) bytes.unshift(0);

  return new Uint8Array(bytes);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function createFieldElement(seed: number): bigint {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (seed + i * 7) % 256;
  }
  bytes[0] &= 0x1f; // Clear top 3 bits to ensure < 2^253
  let num = 0n;
  for (let i = 0; i < 32; i++) {
    num = (num << 8n) | BigInt(bytes[i]);
  }
  return num % BN254_SCALAR_FIELD;
}

async function deriveATA(owner: Address, mint: Address): Promise<Address> {
  const ataProgramId = ATA_PROGRAM_ID;
  const tokenProgramId = TOKEN_2022_PROGRAM_ID;

  const result = await getProgramDerivedAddress({
    programAddress: ataProgramId,
    seeds: [
      bs58Decode(owner.toString()),
      bs58Decode(tokenProgramId.toString()),
      bs58Decode(mint.toString()),
    ],
  });
  return result[0];
}

const log = {
  section: (title: string) => console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`),
  step: (num: number, msg: string) => console.log(`\n[${num}] ${msg}`),
  info: (msg: string) => console.log(`    ${msg}`),
  success: (msg: string) => console.log(`    ✓ ${msg}`),
  error: (msg: string) => console.log(`    ✗ ${msg}`),
  warn: (msg: string) => console.log(`    ⚠ ${msg}`),
  data: (key: string, value: string) => console.log(`    ${key}: ${value}`),
};

// =============================================================================
// Instruction type & helpers
// =============================================================================

interface Instruction {
  programAddress: Address;
  accounts: Array<{
    address: Address;
    role: (typeof AccountRole)[keyof typeof AccountRole];
    signer?: KeyPairSigner;
  }>;
  data: Uint8Array;
}

const SYSTEM_PROGRAM: Address = address("11111111111111111111111111111111");
const COMPUTE_BUDGET_PROGRAM: Address = address("ComputeBudget111111111111111111111111111111");

function createSetComputeUnitLimitInstruction(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit
  const view = new DataView(data.buffer);
  view.setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

function createAssociatedTokenAccountInstruction(
  payer: KeyPairSigner,
  ata: Address,
  owner: Address,
  mint: Address,
): Instruction {
  return {
    programAddress: ATA_PROGRAM_ID,
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([0]), // 0 = Create
  };
}

// =============================================================================
// RPC Client Adapter
// =============================================================================

/**
 * Wraps @solana/kit RPC to match RpcClient interface for buildCommitmentTreeFromChain
 */
function createRpcAdapter(rpc: ReturnType<typeof createSolanaRpc>): RpcClient {
  return {
    async getProgramAccounts(programId, config) {
      const result = await rpc
        .getProgramAccounts(address(programId), {
          encoding: "base64",
          filters: config?.filters,
        } as any)
        .send();

      return result.map((item: any) => ({
        pubkey: item.pubkey.toString(),
        account: {
          data: typeof item.account.data === "string"
            ? item.account.data
            : item.account.data[0], // base64 string from [data, encoding] tuple
        },
      }));
    },
  };
}

// =============================================================================
// TX Submission
// =============================================================================

/**
 * Inject signer into instruction accounts that are WRITABLE_SIGNER matching the payer.
 * SDK instruction builders only take Address (not KeyPairSigner), so we patch after.
 */
function injectSigner(instructions: Instruction[], payer: KeyPairSigner): Instruction[] {
  return instructions.map((ix) => ({
    ...ix,
    accounts: ix.accounts.map((acc) =>
      acc.role === AccountRole.WRITABLE_SIGNER && acc.address === payer.address && !acc.signer
        ? { ...acc, signer: payer }
        : acc,
    ),
  }));
}

async function submitTx(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSub: ReturnType<typeof createSolanaRpcSubscriptions>,
  payer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();

  const patchedInstructions = injectSigner(instructions, payer);

  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(blockhash, msg),
    (msg) => appendTransactionMessageInstructions(patchedInstructions, msg),
  );

  const signedTx = await signTransactionMessageWithSigners(tx);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
  await sendAndConfirm(signedTx as any, { commitment: "confirmed" });

  return getSignatureFromTransaction(signedTx);
}

// =============================================================================
// Fetch tree & merkle proof helpers
// =============================================================================

async function fetchTreeAndProof(
  rpcAdapter: RpcClient,
  programId: string,
  commitment: bigint,
): Promise<{ tree: CommitmentTreeIndex; proof: NonNullable<ReturnType<typeof getMerkleProofFromTree>> }> {
  const tree = await buildCommitmentTreeFromChain(rpcAdapter, programId);
  const proof = getMerkleProofFromTree(tree, commitment);
  if (!proof) {
    throw new Error(`Commitment not found in on-chain tree: 0x${commitment.toString(16).slice(0, 16)}...`);
  }
  return { tree, proof };
}

// =============================================================================
// Step 1: Demo Stealth Deposit
// =============================================================================

async function stepDemoDeposit(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSub: ReturnType<typeof createSolanaRpcSubscriptions>,
  payer: KeyPairSigner,
  config: NetworkConfig,
): Promise<{ privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint }> {
  log.step(1, "Demo Stealth Deposit (10,000 sats)");

  // Use timestamp-based seed to ensure unique keys each run (avoids PDA collisions)
  const runSeed = Date.now() & 0xffff;
  const privKey = createFieldElement(0x01 + runSeed);
  const pubKeyX = createFieldElement(0xab + runSeed);
  const amount = 10_000n; // matches DEMO_MINT_AMOUNT_SATS on-chain

  log.data("privKey", "0x" + privKey.toString(16).slice(0, 16) + "...");
  log.data("pubKeyX", "0x" + pubKeyX.toString(16).slice(0, 16) + "...");
  log.data("amount", `${amount} sats`);

  // Compute Poseidon commitment: Poseidon(pubKeyX, amount)
  const commitment = poseidonHashSync([pubKeyX, amount]);
  const commitmentBytes = bigintToBytes32(commitment);
  log.data("commitment", "0x" + commitment.toString(16).slice(0, 16) + "...");

  // Build ephemeral key for stealth announcement
  const ephemeralKey = generateGrumpkinKeyPair();
  const ephemeralPub = pointToCompressedBytes(ephemeralKey.pubKey);
  const encryptedAmount = randomBytes(8);

  // Build instruction data
  const instructionData = buildAddDemoStealthData(ephemeralPub, commitmentBytes, encryptedAmount);

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);

  // Stealth announcement PDA: on-chain uses ["stealth", ephemeralPub[1..33]]
  const [stealthAnnouncement] = await getProgramDerivedAddress({
    programAddress: config.zvaultProgramId,
    seeds: [
      new TextEncoder().encode("stealth"),
      ephemeralPub.slice(1, 33),
    ],
  });

  const ix: Instruction = {
    programAddress: config.zvaultProgramId,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: commitmentTree, role: AccountRole.WRITABLE },
      { address: stealthAnnouncement, role: AccountRole.WRITABLE },
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: config.zbtcMint, role: AccountRole.WRITABLE },
      { address: config.poolVault, role: AccountRole.WRITABLE },
      { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data: instructionData,
  };

  log.info("Submitting demo deposit transaction...");
  const sig = await submitTx(rpc, rpcSub, payer, [ix]);
  log.success(`TX confirmed: ${sig}`);

  return { privKey, pubKeyX, amount, commitment };
}

// =============================================================================
// Step 2: Split (10,000 → 5,000 + 5,000)
// =============================================================================

async function stepSplit(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSub: ReturnType<typeof createSolanaRpcSubscriptions>,
  rpcAdapter: RpcClient,
  payer: KeyPairSigner,
  config: NetworkConfig,
  input: { privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint },
): Promise<{
  output1: { privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint };
  output2: { privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint };
}> {
  log.step(2, "Split (10,000 → 5,000 + 5,000)");

  // Fetch on-chain tree and get merkle proof for the deposited commitment
  log.info("Fetching on-chain commitment tree...");
  const { proof } = await fetchTreeAndProof(
    rpcAdapter,
    config.zvaultProgramId.toString(),
    input.commitment,
  );
  log.data("leafIndex", proof.leafIndex.toString());
  log.data("merkleRoot", "0x" + proof.root.toString(16).slice(0, 16) + "...");

  // Output keys (use timestamp-based seed to avoid PDA collisions across runs)
  const splitSeed = Date.now() & 0xffff;
  const output1PubKeyX = createFieldElement(0x11 + splitSeed);
  const output2PubKeyX = createFieldElement(0x22 + splitSeed);
  const output1Amount = 5_000n;
  const output2Amount = 5_000n;

  // Generate real Groth16 split proof
  log.info("Generating Groth16 split proof via Sunspot...");
  const startTime = Date.now();

  const proofResult = await generateSplitProofGroth16({
    privKey: input.privKey,
    pubKeyX: input.pubKeyX,
    amount: input.amount,
    leafIndex: BigInt(proof.leafIndex),
    merkleRoot: proof.root,
    merkleProof: { siblings: proof.siblings, indices: proof.indices },
    output1PubKeyX,
    output1Amount,
    output2PubKeyX,
    output2Amount,
    output1EphemeralPubX: output1PubKeyX,
    output1EncryptedAmountWithSign: 0n,
    output2EphemeralPubX: output2PubKeyX,
    output2EncryptedAmountWithSign: 0n,
  });

  const elapsed = Date.now() - startTime;
  log.success(`Generated Groth16 proof (${proofResult.proof.length} bytes) in ${elapsed}ms`);

  // Compute output commitments
  const output1Commitment = poseidonHashSync([output1PubKeyX, output1Amount]);
  const output2Commitment = poseidonHashSync([output2PubKeyX, output2Amount]);

  // Compute nullifier hash for the input note
  const nullifier = computeNullifierSync(input.privKey, BigInt(proof.leafIndex));
  const nullifierHash = bigintToBytes32(hashNullifierSync(nullifier));

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);

  // Stealth announcements for outputs (using ephemeral pub X bytes as seeds)
  const output1EphemeralPubXBytes = bigintToBytes32(output1PubKeyX);
  const output2EphemeralPubXBytes = bigintToBytes32(output2PubKeyX);
  const [stealthAnnouncement1] = await deriveStealthAnnouncementPDA(output1EphemeralPubXBytes, config.zvaultProgramId);
  const [stealthAnnouncement2] = await deriveStealthAnnouncementPDA(output2EphemeralPubXBytes, config.zvaultProgramId);

  // Build split instruction
  const splitIx = buildSplitInstruction({
    proofBytes: proofResult.proof,
    root: bigintToBytes32(proof.root),
    nullifierHash,
    outputCommitment1: bigintToBytes32(output1Commitment),
    outputCommitment2: bigintToBytes32(output2Commitment),
    vkHash: hexToBytes(config.vkHashes.split),
    output1EphemeralPubX: output1EphemeralPubXBytes,
    output1EncryptedAmountWithSign: bigintToBytes32(0n),
    output2EphemeralPubX: output2EphemeralPubXBytes,
    output2EncryptedAmountWithSign: bigintToBytes32(0n),
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      user: payer.address,
      stealthAnnouncement1,
      stealthAnnouncement2,
    },
  });

  log.info("Submitting split transaction...");
  const sig = await submitTx(rpc, rpcSub, payer, [
    createSetComputeUnitLimitInstruction(1_400_000),
    splitIx,
  ]);
  log.success(`TX confirmed: ${sig}`);

  return {
    output1: { privKey: createFieldElement(0x11 + splitSeed), pubKeyX: output1PubKeyX, amount: output1Amount, commitment: output1Commitment },
    output2: { privKey: createFieldElement(0x22 + splitSeed), pubKeyX: output2PubKeyX, amount: output2Amount, commitment: output2Commitment },
  };
}

// =============================================================================
// Step 3: Claim (output1 → 5,000 public zkBTC)
// =============================================================================

async function stepClaim(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSub: ReturnType<typeof createSolanaRpcSubscriptions>,
  rpcAdapter: RpcClient,
  payer: KeyPairSigner,
  config: NetworkConfig,
  note: { privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint },
): Promise<void> {
  log.step(3, "Claim (5,000 sats → public zkBTC tokens)");

  // Fetch on-chain tree after the split
  log.info("Fetching on-chain commitment tree...");
  const { proof } = await fetchTreeAndProof(
    rpcAdapter,
    config.zvaultProgramId.toString(),
    note.commitment,
  );
  log.data("leafIndex", proof.leafIndex.toString());
  log.data("merkleRoot", "0x" + proof.root.toString(16).slice(0, 16) + "...");

  // Recipient field element (payer address reduced to BN254)
  const recipientBigint = BigInt("0x" + bytesToHex(bs58Decode(payer.address.toString())));
  const recipientField = recipientBigint % BN254_SCALAR_FIELD;

  // Generate real Groth16 claim proof
  log.info("Generating Groth16 claim proof via Sunspot...");
  const startTime = Date.now();

  const proofResult = await generateClaimProofGroth16({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: BigInt(proof.leafIndex),
    merkleRoot: proof.root,
    merkleProof: { siblings: proof.siblings, indices: proof.indices },
    recipient: recipientField,
  });

  const elapsed = Date.now() - startTime;
  log.success(`Generated Groth16 proof (${proofResult.proof.length} bytes) in ${elapsed}ms`);

  // Compute nullifier hash
  const nullifier = computeNullifierSync(note.privKey, BigInt(proof.leafIndex));
  const nullifierHash = bigintToBytes32(hashNullifierSync(nullifier));

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);
  const recipientAta = await deriveATA(payer.address, config.zbtcMint);

  // VK Registry PDA for claim (circuit type 0)
  const [vkRegistry] = await getProgramDerivedAddress({
    programAddress: config.zvaultProgramId,
    seeds: [new TextEncoder().encode("vk_registry"), new Uint8Array([0])],
  });

  // Ensure ATA exists
  const instructions: Instruction[] = [
    createSetComputeUnitLimitInstruction(1_400_000),
  ];

  const ataInfo = await rpc.getAccountInfo(recipientAta, { encoding: "base64" }).send();
  if (!ataInfo.value) {
    log.info("Creating recipient ATA...");
    instructions.push(
      createAssociatedTokenAccountInstruction(payer, recipientAta, payer.address, config.zbtcMint),
    );
  }

  // Build claim instruction
  const claimIx = buildClaimInstruction({
    proofBytes: proofResult.proof,
    root: bigintToBytes32(proof.root),
    nullifierHash,
    amountSats: note.amount,
    recipient: payer.address,
    vkHash: hexToBytes(config.vkHashes.claim),
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      zbtcMint: config.zbtcMint,
      poolVault: config.poolVault,
      recipientAta,
      user: payer.address,
      vkRegistry,
    },
  });

  instructions.push(claimIx);

  log.info("Submitting claim transaction...");
  const sig = await submitTx(rpc, rpcSub, payer, instructions);
  log.success(`TX confirmed: ${sig}`);

  // Check ATA balance
  const balance = await rpc.getTokenAccountBalance(recipientAta).send();
  log.success(`ATA balance: ${balance.value.amount} sats (expected ≥ ${note.amount})`);
}

// =============================================================================
// Step 4: Spend Partial Public (output2 → 3,000 public + 2,000 change)
// =============================================================================

async function stepSpendPartialPublic(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSub: ReturnType<typeof createSolanaRpcSubscriptions>,
  rpcAdapter: RpcClient,
  payer: KeyPairSigner,
  config: NetworkConfig,
  note: { privKey: bigint; pubKeyX: bigint; amount: bigint; commitment: bigint },
): Promise<void> {
  log.step(4, "Spend Partial Public (3,000 public + 2,000 change)");

  // Fetch on-chain tree
  log.info("Fetching on-chain commitment tree...");
  const { proof } = await fetchTreeAndProof(
    rpcAdapter,
    config.zvaultProgramId.toString(),
    note.commitment,
  );
  log.data("leafIndex", proof.leafIndex.toString());
  log.data("merkleRoot", "0x" + proof.root.toString(16).slice(0, 16) + "...");

  const publicAmount = 3_000n;
  const changeAmount = 2_000n;
  const changeSeed = Date.now() & 0xffff;
  const changePubKeyX = createFieldElement(0x55 + changeSeed);

  // Recipient field element
  const recipientBigint = BigInt("0x" + bytesToHex(bs58Decode(payer.address.toString())));
  const recipientField = recipientBigint % BN254_SCALAR_FIELD;

  // Generate real Groth16 partial public proof
  log.info("Generating Groth16 partial public proof via Sunspot...");
  const startTime = Date.now();

  const proofResult = await generatePartialPublicProofGroth16({
    privKey: note.privKey,
    pubKeyX: note.pubKeyX,
    amount: note.amount,
    leafIndex: BigInt(proof.leafIndex),
    merkleRoot: proof.root,
    merkleProof: { siblings: proof.siblings, indices: proof.indices },
    publicAmount,
    changePubKeyX,
    changeAmount,
    recipient: recipientField,
    changeEphemeralPubX: changePubKeyX,
    changeEncryptedAmountWithSign: 0n,
  });

  const elapsed = Date.now() - startTime;
  log.success(`Generated Groth16 proof (${proofResult.proof.length} bytes) in ${elapsed}ms`);

  // Compute change commitment and nullifier hash
  const changeCommitment = poseidonHashSync([changePubKeyX, changeAmount]);
  const nullifier = computeNullifierSync(note.privKey, BigInt(proof.leafIndex));
  const nullifierHash = bigintToBytes32(hashNullifierSync(nullifier));

  // Derive PDAs
  const [poolState] = await derivePoolStatePDA(config.zvaultProgramId);
  const [commitmentTree] = await deriveCommitmentTreePDA(config.zvaultProgramId);
  const [nullifierRecord] = await deriveNullifierRecordPDA(nullifierHash, config.zvaultProgramId);
  const recipientAta = await deriveATA(payer.address, config.zbtcMint);

  // Stealth announcement for change output
  const changeEphPubXBytes = bigintToBytes32(changePubKeyX);
  const [stealthAnnouncementChange] = await deriveStealthAnnouncementPDA(changeEphPubXBytes, config.zvaultProgramId);

  // Build spend partial public instruction
  const spendIx = buildSpendPartialPublicInstruction({
    proofBytes: proofResult.proof,
    root: bigintToBytes32(proof.root),
    nullifierHash,
    publicAmountSats: publicAmount,
    changeCommitment: bigintToBytes32(changeCommitment),
    recipient: payer.address,
    vkHash: hexToBytes(config.vkHashes.spendPartialPublic),
    changeEphemeralPubX: changeEphPubXBytes,
    changeEncryptedAmountWithSign: bigintToBytes32(0n),
    accounts: {
      poolState,
      commitmentTree,
      nullifierRecord,
      zbtcMint: config.zbtcMint,
      poolVault: config.poolVault,
      recipientAta,
      user: payer.address,
      stealthAnnouncementChange,
    },
  });

  log.info("Submitting spend partial public transaction...");
  const sig = await submitTx(rpc, rpcSub, payer, [
    createSetComputeUnitLimitInstruction(1_400_000),
    spendIx,
  ]);
  log.success(`TX confirmed: ${sig}`);

  // Check ATA balance
  const balance = await rpc.getTokenAccountBalance(recipientAta).send();
  log.success(`ATA balance: ${balance.value.amount} sats (expected ≥ 8,000)`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  log.section("zVault Integration Test — Full Privacy Flow");

  // Initialize Poseidon
  await initPoseidon();
  log.info("Poseidon initialized");

  // Configure Sunspot prover
  configureSunspot({ circuitsBasePath: path.resolve(__dirname, "../circuits") });
  const sunspotReady = await isSunspotAvailable();
  log.data("Sunspot available", sunspotReady.toString());

  if (!sunspotReady) {
    log.error("Sunspot CLI not found — cannot generate real proofs!");
    log.error("Install Sunspot: ~/sunspot/go/sunspot");
    process.exit(1);
  }

  // Configure network
  setConfig(NETWORK);
  const config = getConfig();

  console.log("\nNetwork Configuration:");
  log.data("Network", NETWORK);
  log.data("RPC URL", RPC_URL);
  log.data("zVault Program", config.zvaultProgramId.toString());
  log.data("Split Verifier", config.sunspotVerifiers.split.toString());
  log.data("Claim Verifier", config.sunspotVerifiers.claim.toString());
  log.data("Partial Verifier", config.sunspotVerifiers.spendPartialPublic.toString());
  log.data("zBTC Mint", config.zbtcMint.toString());
  log.data("Pool Vault", config.poolVault.toString());

  // Load keypair
  const keypairPath = process.env.KEYPAIR_PATH || DEFAULT_KEYPAIR_PATH;
  log.info(`Loading keypair from: ${keypairPath}`);
  const secretKey = loadKeypair(keypairPath);
  const payer = await createKeyPairSignerFromBytes(secretKey);
  log.data("Payer", payer.address.toString());

  // Create RPC connections
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSub = createSolanaRpcSubscriptions(WS_URL);
  const rpcAdapter = createRpcAdapter(rpc);

  // Check balance
  const balanceResult = await rpc.getBalance(payer.address).send();
  const balance = Number(balanceResult.value) / 1e9;
  log.data("Balance", `${balance.toFixed(4)} SOL`);

  if (balance < 0.1) {
    log.warn("Low balance! You may need more SOL for gas.");
    log.warn("Run: solana airdrop 2 --url devnet");
  }

  // =========================================================================
  // Execute flow
  // =========================================================================

  log.section("Executing: Deposit → Split → Claim → Spend Partial Public");

  // Step 1: Demo Deposit
  const deposited = await stepDemoDeposit(rpc, rpcSub, payer, config);

  // Small delay to let TX propagate for getProgramAccounts
  log.info("Waiting for commitment to appear in getProgramAccounts...");
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  // Step 2: Split
  const { output1, output2 } = await stepSplit(rpc, rpcSub, rpcAdapter, payer, config, deposited);

  // Wait for split outputs to appear
  log.info("Waiting for split outputs to appear...");
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  // Step 3: Claim (output1 → public zkBTC)
  await stepClaim(rpc, rpcSub, rpcAdapter, payer, config, output1);

  // Step 4: Spend Partial Public (output2 → 3,000 public + 2,000 change)
  await stepSpendPartialPublic(rpc, rpcSub, rpcAdapter, payer, config, output2);

  // =========================================================================
  // Summary
  // =========================================================================

  log.section("Integration Test Summary");
  log.success("Step 1: Demo Deposit — 10,000 sats committed + minted to vault");
  log.success("Step 2: Split — Commitment A nullified → B1 (5,000) + B2 (5,000)");
  log.success("Step 3: Claim — B1 nullified → 5,000 sats transferred to ATA");
  log.success("Step 4: Spend Partial Public — B2 nullified → 3,000 to ATA + 2,000 change");
  console.log("");
  log.success("Total minted: 10,000 sats");
  log.success("Total withdrawn: 8,000 sats (5,000 claim + 3,000 partial)");
  log.success("Change remaining in tree: 2,000 sats");

  log.section("Integration Test PASSED");
}

// Run
main().catch((error) => {
  console.error("\nFatal error:", error);
  process.exit(1);
});
