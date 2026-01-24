/**
 * Verify Deposit Client
 *
 * Helper to call verify_deposit instruction with ChadBuffer data
 * Uses native Solana web3.js (no Anchor - using Pinocchio contracts)
 */
import { Connection, Keypair, PublicKey, } from "@solana/web3.js";
import { prepareVerifyDeposit, bytesToHex } from "./chadbuffer";
// Program ID (Solana Devnet)
const ZVAULT_PROGRAM_ID = new PublicKey("AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf");
/**
 * Derive PDA addresses
 */
export function derivePoolStatePDA(programId) {
    return PublicKey.findProgramAddressSync([Buffer.from("pool")], programId);
}
export function deriveLightClientPDA(programId) {
    return PublicKey.findProgramAddressSync([Buffer.from("btc_light_client")], programId);
}
export function deriveBlockHeaderPDA(programId, blockHeight) {
    const heightBuffer = Buffer.alloc(8);
    heightBuffer.writeBigUInt64LE(BigInt(blockHeight));
    return PublicKey.findProgramAddressSync([Buffer.from("block_header"), heightBuffer], programId);
}
export function deriveCommitmentTreePDA(programId) {
    return PublicKey.findProgramAddressSync([Buffer.from("commitment_tree")], programId);
}
export function deriveDepositRecordPDA(programId, txid) {
    return PublicKey.findProgramAddressSync([Buffer.from("deposit"), txid], programId);
}
/**
 * Build TxMerkleProof structure for the instruction
 */
export function buildMerkleProof(txidBytes, merkleProof, txIndex) {
    // Convert txid to array
    const txid = Array.from(txidBytes);
    // Convert siblings
    const siblings = merkleProof.map((proof) => Array.from(proof));
    // Compute path from txIndex
    const path = [];
    let index = txIndex;
    for (let i = 0; i < merkleProof.length; i++) {
        path.push((index & 1) === 1);
        index = index >> 1;
    }
    return { txid, siblings, path, txIndex };
}
/**
 * Complete verify deposit flow
 *
 * 1. Fetch raw tx and merkle proof from Esplora
 * 2. Upload raw tx to ChadBuffer
 * 3. Call verify_deposit instruction
 */
export async function verifyDeposit(connection, payer, txid, expectedValue, network = "testnet", programId = ZVAULT_PROGRAM_ID) {
    console.log("=== Verify Deposit ===");
    console.log(`Txid: ${txid}`);
    console.log(`Expected value: ${expectedValue} sats`);
    // Step 1 & 2: Fetch tx, upload to buffer
    const { bufferPubkey, transactionSize, merkleProof, blockHeight, txIndex, txidBytes, } = await prepareVerifyDeposit(connection, payer, txid, network);
    console.log(`Buffer: ${bufferPubkey.toBase58()}`);
    console.log(`Block height: ${blockHeight}`);
    // Step 3: Derive PDAs
    const [poolState] = derivePoolStatePDA(programId);
    const [lightClient] = deriveLightClientPDA(programId);
    const [blockHeader] = deriveBlockHeaderPDA(programId, blockHeight);
    const [commitmentTree] = deriveCommitmentTreePDA(programId);
    const [depositRecord] = deriveDepositRecordPDA(programId, txidBytes);
    console.log("PDAs derived:");
    console.log(`  Pool: ${poolState.toBase58()}`);
    console.log(`  Light Client: ${lightClient.toBase58()}`);
    console.log(`  Block Header: ${blockHeader.toBase58()}`);
    console.log(`  Commitment Tree: ${commitmentTree.toBase58()}`);
    console.log(`  Deposit Record: ${depositRecord.toBase58()}`);
    // Build merkle proof
    const merkleProofData = buildMerkleProof(txidBytes, merkleProof, txIndex);
    // Build tx_output
    const txOutput = {
        value: BigInt(expectedValue),
        expectedPubkey: new Array(32).fill(0), // Not used for OP_RETURN verification
        vout: 0,
    };
    // Build instruction data
    // Note: This would use the Anchor program interface
    // For now, showing the structure
    console.log("\nInstruction parameters:");
    console.log(`  txid: ${bytesToHex(txidBytes)}`);
    console.log(`  merkle_proof: ${merkleProofData.siblings.length} siblings`);
    console.log(`  block_height: ${blockHeight}`);
    console.log(`  transaction_size: ${transactionSize}`);
    // TODO: Call actual program instruction using Anchor
    // const program = new Program(IDL, programId, provider);
    // const tx = await program.methods
    //   .verifyDeposit(
    //     Array.from(txidBytes),
    //     merkleProofData,
    //     new BN(blockHeight),
    //     txOutput,
    //     new BN(transactionSize)
    //   )
    //   .accounts({
    //     poolState,
    //     lightClient,
    //     blockHeader,
    //     commitmentTree,
    //     depositRecord,
    //     txBuffer: bufferPubkey,
    //     submitter: payer.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .signers([payer])
    //   .rpc();
    console.log("\n=== Ready to call verify_deposit ===");
    console.log("Use the Anchor program interface to submit the instruction");
    return depositRecord.toBase58();
}
/**
 * Example usage
 */
export async function exampleUsage() {
    const connection = new Connection("https://api.devnet.solana.com");
    const payer = Keypair.generate(); // Replace with actual keypair
    // Example Bitcoin txid (replace with actual)
    const txid = "abc123..."; // 64 char hex
    try {
        const depositRecordPDA = await verifyDeposit(connection, payer, txid, 100000, // 0.001 BTC in sats
        "testnet");
        console.log(`Deposit record will be at: ${depositRecordPDA}`);
    }
    catch (error) {
        console.error("Error:", error);
    }
}
