/**
 * BTC Deposit Test Data Generator
 *
 * Generates test data for verify_deposit instruction including:
 * - Nullifier, secret, note, commitment (Poseidon hashes)
 * - Taproot address derived from commitment
 * - Mock raw Bitcoin transaction
 * - Mock merkle proof
 *
 * Usage: bun run scripts/generate-btc-deposit-test-data.ts
 */

import { createHash } from "crypto";
import { buildPoseidon, Poseidon } from "circomlibjs";
import { Point, etc } from "@noble/secp256k1";

// ============================================================================
// Constants
// ============================================================================

// BN254 field prime (for Poseidon)
const BN254_FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// secp256k1 curve order
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// TapTweak tag hash: SHA256("TapTweak")
const TAP_TWEAK_TAG = Buffer.from([
  0xe8, 0x0f, 0xe1, 0x63, 0x9c, 0x9c, 0xa0, 0x50, 0xe3, 0xaf, 0x1b, 0x39, 0xc1,
  0x43, 0xc6, 0x3e, 0x42, 0x9c, 0xbc, 0xeb, 0x15, 0xd9, 0x40, 0xfb, 0xb5, 0xc5,
  0xa1, 0xf4, 0xaf, 0x57, 0xc5, 0xe9,
]);

// ============================================================================
// Types
// ============================================================================

interface Note {
  nullifier: bigint;
  nullifierBytes: Uint8Array;
  secret: bigint;
  secretBytes: Uint8Array;
  note: bigint; // Poseidon(nullifier, secret)
  noteBytes: Uint8Array;
  amount: bigint;
  commitment: bigint; // Poseidon(note, amount)
  commitmentBytes: Uint8Array;
}

interface TaprootAddress {
  internalKey: Uint8Array; // 32-byte x-only pubkey
  outputKey: Uint8Array; // 32-byte x-only pubkey (Q)
  tweak: Uint8Array; // 32-byte tweak scalar
  address: string; // bech32m address
  scriptPubKey: Uint8Array; // 34-byte P2TR script
}

interface MockBtcTransaction {
  version: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  locktime: number;
  rawTx: Uint8Array;
  txid: Uint8Array; // reversed double SHA256
  wtxid: Uint8Array;
}

interface TxInput {
  prevTxid: Uint8Array;
  prevVout: number;
  scriptSig: Uint8Array;
  sequence: number;
  witness: Uint8Array[];
}

interface TxOutput {
  value: bigint; // satoshis
  scriptPubKey: Uint8Array;
}

interface MerkleProof {
  txid: Uint8Array;
  siblings: Uint8Array[];
  indices: number[]; // 0 = left, 1 = right
  merkleRoot: Uint8Array;
}

interface TestDepositData {
  // Note data
  note: Note;

  // Taproot address
  taproot: TaprootAddress;

  // Bitcoin transaction
  transaction: MockBtcTransaction;

  // SPV proof
  merkleProof: MerkleProof;
  blockHeight: number;
  blockHeader: Uint8Array;

  // Data for Solana instruction
  instructionData: {
    txid: string;
    merkleProof: {
      txid: string;
      siblings: string[];
      indices: number[];
    };
    blockHeight: number;
    txOutput: {
      value: string;
      expectedPubkey: string;
      vout: number;
    };
    transactionSize: number;
    commitment: string;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

function bigintToBytes32(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let temp = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return bytes;
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomFieldElement(): bigint {
  const bytes = randomBytes(32);
  return bytesToBigint(bytes) % BN254_FIELD_PRIME;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function writeVarInt(value: number): Uint8Array {
  if (value < 0xfd) {
    return new Uint8Array([value]);
  } else if (value <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = value & 0xff;
    buf[2] = (value >> 8) & 0xff;
    return buf;
  } else if (value <= 0xffffffff) {
    const buf = new Uint8Array(5);
    buf[0] = 0xfe;
    new DataView(buf.buffer).setUint32(1, value, true);
    return buf;
  } else {
    throw new Error("VarInt too large");
  }
}

function writeUint32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

function writeUint64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return buf;
}

// ============================================================================
// Taproot Functions (BIP340/341)
// ============================================================================

/**
 * Compute BIP340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg)
 */
function taggedHash(tag: string, ...msgs: Uint8Array[]): Uint8Array {
  const tagHash =
    tag === "TapTweak"
      ? TAP_TWEAK_TAG
      : sha256(new TextEncoder().encode(tag));

  const combined: number[] = [...tagHash, ...tagHash];
  for (const msg of msgs) {
    combined.push(...msg);
  }
  return sha256(new Uint8Array(combined));
}

/**
 * Derive taproot output key: Q = P + H_TapTweak(P || commitment) * G
 */
function deriveTaprootOutputKey(
  internalKey: Uint8Array,
  commitment: Uint8Array
): { outputKey: Uint8Array; tweak: Uint8Array } {
  // Compute tweak: t = H_TapTweak(P || commitment)
  const tweak = taggedHash("TapTweak", internalKey, commitment);

  // Convert tweak to scalar (mod n)
  let tweakScalar = bytesToBigint(tweak);
  if (tweakScalar >= SECP256K1_ORDER) {
    tweakScalar = tweakScalar % SECP256K1_ORDER;
  }

  // Compute t*G
  const tweakPoint = Point.BASE.multiply(tweakScalar);

  // Lift internal key to point (assume even y)
  // For x-only keys, we need to reconstruct the full point
  const internalPoint = Point.fromHex(
    "02" + toHex(internalKey)
  );

  // Q = P + t*G
  const outputPoint = internalPoint.add(tweakPoint);

  // Get x-only (32 bytes) - if y is odd, negate
  const outputKeyFull = outputPoint.toBytes(true); // compressed
  const outputKey = outputKeyFull.slice(1); // x-only (remove prefix)

  return { outputKey, tweak };
}

/**
 * Encode bech32m address for P2TR
 */
function encodeBech32m(hrp: string, data: Uint8Array): string {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const BECH32M_CONST = 0x2bc830a3;

  function polymod(values: number[]): number {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) {
        if ((top >> i) & 1) {
          chk ^= GEN[i];
        }
      }
    }
    return chk;
  }

  function hrpExpand(hrp: string): number[] {
    const ret: number[] = [];
    for (const c of hrp) {
      ret.push(c.charCodeAt(0) >> 5);
    }
    ret.push(0);
    for (const c of hrp) {
      ret.push(c.charCodeAt(0) & 31);
    }
    return ret;
  }

  function convertBits(
    data: number[],
    fromBits: number,
    toBits: number,
    pad: boolean
  ): number[] | null {
    let acc = 0;
    let bits = 0;
    const ret: number[] = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
      if (value < 0 || value >> fromBits !== 0) {
        return null;
      }
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad) {
      if (bits > 0) {
        ret.push((acc << (toBits - bits)) & maxv);
      }
    } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
      return null;
    }
    return ret;
  }

  // Convert 8-bit data to 5-bit groups
  const data5bit = convertBits([...data], 8, 5, true);
  if (!data5bit) throw new Error("Failed to convert bits");

  // Add witness version (1 for taproot)
  const values = [1, ...data5bit];

  // Compute checksum
  const polymodInput = [...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(polymodInput) ^ BECH32M_CONST;

  const checksumChars: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksumChars.push((checksum >> (5 * (5 - i))) & 31);
  }

  // Encode
  let result = hrp + "1";
  for (const v of values) {
    result += CHARSET[v];
  }
  for (const v of checksumChars) {
    result += CHARSET[v];
  }

  return result;
}

/**
 * Create P2TR scriptPubKey: OP_1 OP_PUSHBYTES_32 <pubkey>
 */
function createP2TRScript(outputKey: Uint8Array): Uint8Array {
  const script = new Uint8Array(34);
  script[0] = 0x51; // OP_1
  script[1] = 0x20; // OP_PUSHBYTES_32
  script.set(outputKey, 2);
  return script;
}

// ============================================================================
// Note Generation
// ============================================================================

async function generateNote(
  poseidon: Poseidon,
  amountSats: bigint
): Promise<Note> {
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();

  // note = Poseidon(nullifier, secret)
  const noteHash = poseidon.F.toObject(poseidon([nullifier, secret]));

  // commitment = Poseidon(note, amount)
  const commitment = poseidon.F.toObject(poseidon([noteHash, amountSats]));

  return {
    nullifier,
    nullifierBytes: bigintToBytes32(nullifier),
    secret,
    secretBytes: bigintToBytes32(secret),
    note: noteHash,
    noteBytes: bigintToBytes32(noteHash),
    amount: amountSats,
    commitment,
    commitmentBytes: bigintToBytes32(commitment),
  };
}

// ============================================================================
// Mock Bitcoin Transaction
// ============================================================================

function createMockBtcTransaction(
  taproot: TaprootAddress,
  amountSats: bigint,
  commitment: Uint8Array
): MockBtcTransaction {
  // Create inputs (mock - one input spending from a fake previous tx)
  const prevTxid = randomBytes(32);
  const input: TxInput = {
    prevTxid,
    prevVout: 0,
    scriptSig: new Uint8Array(0), // Empty for segwit
    sequence: 0xffffffff,
    witness: [randomBytes(64), randomBytes(33)], // Mock signature + pubkey
  };

  // Create outputs
  // Output 0: Payment to taproot address
  const paymentOutput: TxOutput = {
    value: amountSats,
    scriptPubKey: taproot.scriptPubKey,
  };

  // Output 1: OP_RETURN with commitment
  // Format: OP_RETURN OP_PUSHBYTES_32 <commitment>
  const opReturnScript = new Uint8Array(34);
  opReturnScript[0] = 0x6a; // OP_RETURN
  opReturnScript[1] = 0x20; // OP_PUSHBYTES_32
  opReturnScript.set(commitment, 2);

  const opReturnOutput: TxOutput = {
    value: 0n,
    scriptPubKey: opReturnScript,
  };

  const outputs = [paymentOutput, opReturnOutput];

  // Serialize transaction (with witness)
  const rawTx = serializeTransaction(2, [input], outputs, 0, true);

  // Compute txid (double SHA256 of non-witness serialization, reversed)
  const nonWitnessTx = serializeTransaction(2, [input], outputs, 0, false);
  const txHash = doubleSha256(nonWitnessTx);
  const txid = new Uint8Array(txHash).reverse();

  // Compute wtxid
  const wtxHash = doubleSha256(rawTx);
  const wtxid = new Uint8Array(wtxHash).reverse();

  return {
    version: 2,
    inputs: [input],
    outputs,
    locktime: 0,
    rawTx,
    txid,
    wtxid,
  };
}

function serializeTransaction(
  version: number,
  inputs: TxInput[],
  outputs: TxOutput[],
  locktime: number,
  includeWitness: boolean
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Version (4 bytes LE)
  parts.push(writeUint32LE(version));

  // Marker and flag (only for witness)
  if (includeWitness) {
    parts.push(new Uint8Array([0x00, 0x01]));
  }

  // Input count
  parts.push(writeVarInt(inputs.length));

  // Inputs
  for (const input of inputs) {
    // Previous txid (32 bytes, internal byte order)
    parts.push(input.prevTxid);
    // Previous vout (4 bytes LE)
    parts.push(writeUint32LE(input.prevVout));
    // ScriptSig length + script
    parts.push(writeVarInt(input.scriptSig.length));
    if (input.scriptSig.length > 0) {
      parts.push(input.scriptSig);
    }
    // Sequence (4 bytes LE)
    parts.push(writeUint32LE(input.sequence));
  }

  // Output count
  parts.push(writeVarInt(outputs.length));

  // Outputs
  for (const output of outputs) {
    // Value (8 bytes LE)
    parts.push(writeUint64LE(output.value));
    // ScriptPubKey length + script
    parts.push(writeVarInt(output.scriptPubKey.length));
    parts.push(output.scriptPubKey);
  }

  // Witness data (only if including witness)
  if (includeWitness) {
    for (const input of inputs) {
      parts.push(writeVarInt(input.witness.length));
      for (const item of input.witness) {
        parts.push(writeVarInt(item.length));
        parts.push(item);
      }
    }
  }

  // Locktime (4 bytes LE)
  parts.push(writeUint32LE(locktime));

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

// ============================================================================
// Mock Merkle Proof
// ============================================================================

function createMockMerkleProof(txid: Uint8Array): MerkleProof {
  // Create a mock merkle tree with 8 transactions
  // Our tx is at position 3 (0-indexed)
  const txPosition = 3;
  const treeDepth = 3; // log2(8) = 3

  const siblings: Uint8Array[] = [];
  const indices: number[] = [];

  let currentHash = new Uint8Array(txid).reverse(); // Internal byte order

  for (let level = 0; level < treeDepth; level++) {
    const sibling = randomBytes(32);
    siblings.push(sibling);

    // Position at this level determines if we're left or right
    const isRight = ((txPosition >> level) & 1) === 1;
    indices.push(isRight ? 1 : 0);

    // Compute next level hash
    if (isRight) {
      currentHash = doubleSha256(new Uint8Array([...sibling, ...currentHash]));
    } else {
      currentHash = doubleSha256(new Uint8Array([...currentHash, ...sibling]));
    }
  }

  return {
    txid,
    siblings,
    indices,
    merkleRoot: currentHash,
  };
}

// ============================================================================
// Mock Block Header
// ============================================================================

function createMockBlockHeader(
  merkleRoot: Uint8Array,
  height: number
): Uint8Array {
  const header = new Uint8Array(80);

  // Version (4 bytes)
  new DataView(header.buffer).setUint32(0, 0x20000000, true);

  // Previous block hash (32 bytes) - mock
  header.set(randomBytes(32), 4);

  // Merkle root (32 bytes)
  header.set(merkleRoot, 36);

  // Timestamp (4 bytes) - current time minus some blocks
  const timestamp = Math.floor(Date.now() / 1000) - (100 - height) * 600;
  new DataView(header.buffer).setUint32(68, timestamp, true);

  // Bits (4 bytes) - testnet difficulty
  header.set([0xff, 0xff, 0x00, 0x1d], 72);

  // Nonce (4 bytes)
  new DataView(header.buffer).setUint32(76, height, true);

  return header;
}

// ============================================================================
// Main Generator
// ============================================================================

async function generateTestDepositData(
  amountSats: bigint = 100_000n,
  network: "mainnet" | "testnet" = "testnet"
): Promise<TestDepositData> {
  console.log("Initializing Poseidon...");
  const poseidon = await buildPoseidon();

  console.log("Generating note...");
  const note = await generateNote(poseidon, amountSats);

  // Generate a random internal key for the pool
  // In production, this would be the pool's known internal key
  const internalKeyPrivate = randomBytes(32);
  const internalKeyFull = Point.BASE.multiply(
    bytesToBigint(internalKeyPrivate)
  ).toBytes(true);
  const internalKey = internalKeyFull.slice(1); // x-only

  console.log("Deriving taproot address...");
  const { outputKey, tweak } = deriveTaprootOutputKey(
    internalKey,
    note.commitmentBytes
  );

  const hrp = network === "mainnet" ? "bc" : "tb";
  const address = encodeBech32m(hrp, outputKey);
  const scriptPubKey = createP2TRScript(outputKey);

  const taproot: TaprootAddress = {
    internalKey,
    outputKey,
    tweak,
    address,
    scriptPubKey,
  };

  console.log("Creating mock Bitcoin transaction...");
  const transaction = createMockBtcTransaction(
    taproot,
    amountSats,
    note.commitmentBytes
  );

  console.log("Creating mock merkle proof...");
  const merkleProof = createMockMerkleProof(transaction.txid);

  const blockHeight = 850000;
  const blockHeader = createMockBlockHeader(merkleProof.merkleRoot, blockHeight);

  // Prepare instruction data
  const instructionData = {
    txid: toHex(transaction.txid),
    merkleProof: {
      txid: toHex(transaction.txid),
      siblings: merkleProof.siblings.map(toHex),
      indices: merkleProof.indices,
    },
    blockHeight,
    txOutput: {
      value: amountSats.toString(),
      expectedPubkey: toHex(outputKey),
      vout: 0,
    },
    transactionSize: transaction.rawTx.length,
    commitment: toHex(note.commitmentBytes),
  };

  return {
    note,
    taproot,
    transaction,
    merkleProof,
    blockHeight,
    blockHeader,
    instructionData,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("\n========================================");
  console.log("  BTC Deposit Test Data Generator");
  console.log("========================================\n");

  const amountSats = 100_000n; // 0.001 BTC
  const data = await generateTestDepositData(amountSats, "testnet");

  console.log("\n========================================");
  console.log("  Generated Test Data");
  console.log("========================================\n");

  console.log("=== Note Data ===");
  console.log(`  Nullifier:   ${toHex(data.note.nullifierBytes).slice(0, 32)}...`);
  console.log(`  Secret:      ${toHex(data.note.secretBytes).slice(0, 32)}...`);
  console.log(`  Note Hash:   ${toHex(data.note.noteBytes).slice(0, 32)}...`);
  console.log(`  Amount:      ${data.note.amount} sats (${Number(data.note.amount) / 1e8} BTC)`);
  console.log(`  Commitment:  ${toHex(data.note.commitmentBytes)}`);

  console.log("\n=== Taproot Address ===");
  console.log(`  Internal Key:  ${toHex(data.taproot.internalKey)}`);
  console.log(`  Output Key:    ${toHex(data.taproot.outputKey)}`);
  console.log(`  Tweak:         ${toHex(data.taproot.tweak)}`);
  console.log(`  Address:       ${data.taproot.address}`);
  console.log(`  ScriptPubKey:  ${toHex(data.taproot.scriptPubKey)}`);

  console.log("\n=== Bitcoin Transaction ===");
  console.log(`  TXID:          ${toHex(data.transaction.txid)}`);
  console.log(`  WTXID:         ${toHex(data.transaction.wtxid)}`);
  console.log(`  Raw Tx Size:   ${data.transaction.rawTx.length} bytes`);
  console.log(`  Outputs:       ${data.transaction.outputs.length}`);
  console.log(`    [0] Payment: ${data.transaction.outputs[0].value} sats to ${data.taproot.address}`);
  console.log(`    [1] OP_RETURN: commitment`);

  console.log("\n=== Merkle Proof ===");
  console.log(`  Merkle Root:   ${toHex(data.merkleProof.merkleRoot)}`);
  console.log(`  Proof Depth:   ${data.merkleProof.siblings.length}`);
  console.log(`  Indices:       [${data.merkleProof.indices.join(", ")}]`);

  console.log("\n=== Block Header ===");
  console.log(`  Height:        ${data.blockHeight}`);
  console.log(`  Header (hex):  ${toHex(data.blockHeader).slice(0, 64)}...`);

  console.log("\n========================================");
  console.log("  Solana Instruction Data (JSON)");
  console.log("========================================\n");

  console.log(JSON.stringify(data.instructionData, null, 2));

  console.log("\n========================================");
  console.log("  Full Test Data (for programmatic use)");
  console.log("========================================\n");

  // Output full data as JSON for use in tests
  const fullData = {
    note: {
      nullifier: data.note.nullifier.toString(),
      nullifierHex: toHex(data.note.nullifierBytes),
      secret: data.note.secret.toString(),
      secretHex: toHex(data.note.secretBytes),
      noteHash: data.note.note.toString(),
      noteHashHex: toHex(data.note.noteBytes),
      amount: data.note.amount.toString(),
      commitment: data.note.commitment.toString(),
      commitmentHex: toHex(data.note.commitmentBytes),
    },
    taproot: {
      internalKeyHex: toHex(data.taproot.internalKey),
      outputKeyHex: toHex(data.taproot.outputKey),
      tweakHex: toHex(data.taproot.tweak),
      address: data.taproot.address,
      scriptPubKeyHex: toHex(data.taproot.scriptPubKey),
    },
    transaction: {
      txidHex: toHex(data.transaction.txid),
      wtxidHex: toHex(data.transaction.wtxid),
      rawTxHex: toHex(data.transaction.rawTx),
      rawTxSize: data.transaction.rawTx.length,
    },
    merkleProof: {
      merkleRootHex: toHex(data.merkleProof.merkleRoot),
      siblingsHex: data.merkleProof.siblings.map(toHex),
      indices: data.merkleProof.indices,
    },
    blockHeader: {
      height: data.blockHeight,
      headerHex: toHex(data.blockHeader),
    },
  };

  console.log(JSON.stringify(fullData, null, 2));

  // Write to file for tests
  const fs = await import("fs");
  const outputPath = "./test-deposit-data.json";
  fs.writeFileSync(outputPath, JSON.stringify(fullData, null, 2));
  console.log(`\nTest data written to: ${outputPath}`);
}

main().catch(console.error);
