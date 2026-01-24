/**
 * ChadBuffer Client
 *
 * Helper functions to upload Bitcoin transaction data to ChadBuffer
 * for SPV verification on Solana.
 *
 * Networks: Bitcoin Testnet3, Solana Devnet
 *
 * Reference: https://github.com/deanmlittle/chadbuffer
 */
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, } from "@solana/web3.js";
// ChadBuffer Program ID
export const CHADBUFFER_PROGRAM_ID = new PublicKey("CHADqH6wybhBMB9RR2xQVu2XRjuLcNvffTjwvv3ygMyn");
// Buffer authority size (32 bytes)
const AUTHORITY_SIZE = 32;
// Maximum chunk size per transaction (keeping under tx size limit)
const MAX_CHUNK_SIZE = 900;
/**
 * ChadBuffer instruction discriminators
 */
var ChadBufferInstruction;
(function (ChadBufferInstruction) {
    ChadBufferInstruction[ChadBufferInstruction["Create"] = 0] = "Create";
    ChadBufferInstruction[ChadBufferInstruction["Write"] = 1] = "Write";
    ChadBufferInstruction[ChadBufferInstruction["Close"] = 2] = "Close";
    ChadBufferInstruction[ChadBufferInstruction["TransferAuthority"] = 3] = "TransferAuthority";
})(ChadBufferInstruction || (ChadBufferInstruction = {}));
/**
 * Create instruction data for ChadBuffer
 */
function createInstructionData(instruction, data) {
    if (data) {
        const buffer = Buffer.alloc(1 + data.length);
        buffer.writeUInt8(instruction, 0);
        buffer.set(data, 1);
        return buffer;
    }
    return Buffer.from([instruction]);
}
/**
 * Upload raw Bitcoin transaction to ChadBuffer
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param rawTx - Raw Bitcoin transaction bytes
 * @param seed - Optional seed for buffer PDA derivation
 * @returns Buffer public key
 */
export async function uploadTransactionToBuffer(connection, payer, rawTx, seed) {
    // Generate buffer keypair or derive from seed
    const bufferKeypair = seed
        ? Keypair.fromSeed(seed.slice(0, 32))
        : Keypair.generate();
    // Calculate required space: authority (32) + data
    const space = AUTHORITY_SIZE + rawTx.length;
    // Get rent exemption
    const rentExemption = await connection.getMinimumBalanceForRentExemption(space);
    // Split data into chunks
    const chunks = splitIntoChunks(rawTx, MAX_CHUNK_SIZE);
    // Create buffer account with first chunk
    const createIx = new TransactionInstruction({
        programId: CHADBUFFER_PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: bufferKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: createInstructionData(ChadBufferInstruction.Create, chunks[0]),
    });
    // Create account instruction
    const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: bufferKeypair.publicKey,
        lamports: rentExemption,
        space,
        programId: CHADBUFFER_PROGRAM_ID,
    });
    // Send create transaction
    const createTx = new Transaction().add(createAccountIx, createIx);
    await sendAndConfirmTransaction(connection, createTx, [payer, bufferKeypair]);
    // Write remaining chunks
    for (let i = 1; i < chunks.length; i++) {
        const writeIx = new TransactionInstruction({
            programId: CHADBUFFER_PROGRAM_ID,
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
            ],
            data: createInstructionData(ChadBufferInstruction.Write, chunks[i]),
        });
        const writeTx = new Transaction().add(writeIx);
        await sendAndConfirmTransaction(connection, writeTx, [payer]);
    }
    console.log(`Buffer created: ${bufferKeypair.publicKey.toBase58()}`);
    console.log(`Transaction size: ${rawTx.length} bytes`);
    console.log(`Chunks uploaded: ${chunks.length}`);
    return bufferKeypair.publicKey;
}
/**
 * Close buffer and reclaim rent
 */
export async function closeBuffer(connection, payer, bufferPubkey, recipient) {
    const closeIx = new TransactionInstruction({
        programId: CHADBUFFER_PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: bufferPubkey, isSigner: false, isWritable: true },
            {
                pubkey: recipient || payer.publicKey,
                isSigner: false,
                isWritable: true,
            },
        ],
        data: createInstructionData(ChadBufferInstruction.Close),
    });
    const tx = new Transaction().add(closeIx);
    return sendAndConfirmTransaction(connection, tx, [payer]);
}
/**
 * Read buffer data
 */
export async function readBufferData(connection, bufferPubkey) {
    const accountInfo = await connection.getAccountInfo(bufferPubkey);
    if (!accountInfo) {
        throw new Error("Buffer account not found");
    }
    const authority = new PublicKey(accountInfo.data.slice(0, AUTHORITY_SIZE));
    const data = accountInfo.data.slice(AUTHORITY_SIZE);
    return { authority, data };
}
/**
 * Split data into chunks of specified size
 */
function splitIntoChunks(data, chunkSize) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, Math.min(i + chunkSize, data.length)));
    }
    return chunks;
}
/**
 * Fetch raw Bitcoin transaction from Esplora/Blockstream API
 */
export async function fetchRawTransaction(txid, network = "testnet") {
    const baseUrl = network === "testnet"
        ? "https://blockstream.info/testnet/api"
        : "https://blockstream.info/api";
    const response = await fetch(`${baseUrl}/tx/${txid}/raw`);
    if (!response.ok) {
        throw new Error(`Failed to fetch transaction: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}
/**
 * Fetch merkle proof from Esplora/Blockstream API
 */
export async function fetchMerkleProof(txid, network = "testnet") {
    const baseUrl = network === "testnet"
        ? "https://blockstream.info/testnet/api"
        : "https://blockstream.info/api";
    const response = await fetch(`${baseUrl}/tx/${txid}/merkle-proof`);
    if (!response.ok) {
        throw new Error(`Failed to fetch merkle proof: ${response.statusText}`);
    }
    const data = (await response.json());
    // Parse merkle proof
    const merkleProof = data.merkle.map((hash) => {
        const bytes = hexToBytes(hash);
        // Reverse for internal byte order
        bytes.reverse();
        return bytes;
    });
    return {
        blockHeight: data.block_height,
        merkleProof,
        txIndex: data.pos,
    };
}
/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}
/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/**
 * Complete flow: Fetch tx, upload to buffer, return verification data
 */
export async function prepareVerifyDeposit(connection, payer, txid, network = "testnet") {
    console.log(`Preparing verification for txid: ${txid}`);
    // Fetch raw transaction
    console.log("Fetching raw transaction...");
    const rawTx = await fetchRawTransaction(txid, network);
    console.log(`Raw tx size: ${rawTx.length} bytes`);
    // Fetch merkle proof
    console.log("Fetching merkle proof...");
    const { blockHeight, merkleProof, txIndex } = await fetchMerkleProof(txid, network);
    console.log(`Block height: ${blockHeight}, tx index: ${txIndex}`);
    // Upload to ChadBuffer
    console.log("Uploading to ChadBuffer...");
    const bufferPubkey = await uploadTransactionToBuffer(connection, payer, rawTx);
    // Convert txid to bytes (reversed)
    const txidBytes = hexToBytes(txid);
    txidBytes.reverse();
    return {
        bufferPubkey,
        transactionSize: rawTx.length,
        merkleProof,
        blockHeight,
        txIndex,
        txidBytes,
    };
}
