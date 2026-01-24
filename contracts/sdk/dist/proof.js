"use strict";
/**
 * ZK Proof generation utilities for zVault
 *
 * Uses Noir UltraHonk proofs for all circuits:
 * - Claim (direct minting)
 * - Transfer (commitment refresh)
 * - Split (1-in-2-out)
 * - Partial Withdraw (withdraw with change)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNoirCircuitsDir = getNoirCircuitsDir;
exports.isNargoAvailable = isNargoAvailable;
exports.isBbAvailable = isBbAvailable;
exports.isProofGenerationAvailable = isProofGenerationAvailable;
exports.generateProof = generateProof;
exports.verifyProof = verifyProof;
exports.generateClaimProof = generateClaimProof;
exports.generateTransferProof = generateTransferProof;
exports.generateSplitProof = generateSplitProof;
exports.generatePartialWithdrawProof = generatePartialWithdrawProof;
exports.serializeProof = serializeProof;
exports.deserializeProof = deserializeProof;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Get the path to noir circuits directory
 */
function getNoirCircuitsDir() {
    // Try relative path from SDK (development)
    const devPath = (0, path_1.join)(__dirname, "../../noir-circuits");
    if ((0, fs_1.existsSync)(devPath)) {
        return devPath;
    }
    // Try node_modules path (installed)
    const nodePath = (0, path_1.join)(__dirname, "../../../noir-circuits");
    if ((0, fs_1.existsSync)(nodePath)) {
        return nodePath;
    }
    throw new Error("Noir circuits directory not found. Make sure noir-circuits is available.");
}
/**
 * Check if nargo is available
 */
function isNargoAvailable() {
    try {
        (0, child_process_1.execSync)("nargo --version", { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if bb CLI is available
 */
function isBbAvailable() {
    try {
        const circuitsDir = getNoirCircuitsDir();
        const bbPath = (0, path_1.join)(circuitsDir, "node_modules/.bin/bb");
        if (!(0, fs_1.existsSync)(bbPath))
            return false;
        (0, child_process_1.execSync)(`"${bbPath}" --version`, { stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if proof generation is available
 */
function isProofGenerationAvailable() {
    return isNargoAvailable() && isBbAvailable();
}
/**
 * Convert inputs to Prover.toml format
 */
function toProverToml(inputs) {
    const lines = [];
    const keys = Object.keys(inputs).sort();
    for (const key of keys) {
        const value = inputs[key];
        if (Array.isArray(value)) {
            lines.push(`${key} = [${value.map((v) => `"${v}"`).join(", ")}]`);
        }
        else {
            lines.push(`${key} = "${value}"`);
        }
    }
    return lines.join("\n") + "\n";
}
/**
 * Generate a Noir proof for a circuit
 *
 * @param circuitType - The type of circuit to prove
 * @param inputs - Input values for the circuit
 * @returns The generated proof
 */
async function generateProof(circuitType, inputs) {
    if (!isProofGenerationAvailable()) {
        throw new Error("Proof generation not available. Install nargo and run 'bun install' in noir-circuits/");
    }
    const circuitsDir = getNoirCircuitsDir();
    const circuitPath = (0, path_1.join)(circuitsDir, circuitType);
    const bbPath = (0, path_1.join)(circuitsDir, "node_modules/.bin/bb");
    // Write Prover.toml with inputs
    const proverToml = toProverToml(inputs);
    (0, fs_1.writeFileSync)((0, path_1.join)(circuitPath, "Prover.toml"), proverToml);
    // Execute circuit to generate witness
    (0, child_process_1.execSync)("nargo execute", {
        cwd: circuitPath,
        stdio: "pipe",
    });
    // Create proofs directory
    const proofsDir = (0, path_1.join)(circuitPath, "proofs");
    if (!(0, fs_1.existsSync)(proofsDir)) {
        (0, fs_1.mkdirSync)(proofsDir, { recursive: true });
    }
    // Generate proof with bb
    const bytecode = (0, path_1.join)(circuitPath, "target", `zvault_${circuitType}.json`);
    const witness = (0, path_1.join)(circuitPath, "target", `zvault_${circuitType}.gz`);
    const proofOutputDir = (0, path_1.join)(proofsDir, "proof");
    (0, child_process_1.execSync)(`"${bbPath}" prove -b "${bytecode}" -w "${witness}" -o "${proofOutputDir}" --write_vk`, { cwd: circuitPath, stdio: "pipe" });
    // Read proof files
    const proof = (0, fs_1.readFileSync)((0, path_1.join)(proofOutputDir, "proof"));
    const publicInputsBinary = (0, fs_1.readFileSync)((0, path_1.join)(proofOutputDir, "public_inputs"));
    // Parse binary public inputs (each is 32 bytes)
    const publicInputs = [];
    for (let i = 0; i < publicInputsBinary.length; i += 32) {
        const fieldBytes = publicInputsBinary.slice(i, i + 32);
        const hex = "0x" +
            Array.from(fieldBytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        publicInputs.push(hex);
    }
    const verificationKey = (0, fs_1.readFileSync)((0, path_1.join)(proofOutputDir, "vk"));
    const vkHash = (0, fs_1.readFileSync)((0, path_1.join)(proofOutputDir, "vk_hash"));
    return {
        proof: new Uint8Array(proof),
        publicInputs,
        verificationKey: new Uint8Array(verificationKey),
        vkHash: new Uint8Array(vkHash),
    };
}
/**
 * Verify a Noir proof using bb CLI
 */
async function verifyProof(circuitType, proof) {
    const circuitsDir = getNoirCircuitsDir();
    const circuitPath = (0, path_1.join)(circuitsDir, circuitType);
    const bbPath = (0, path_1.join)(circuitsDir, "node_modules/.bin/bb");
    const proofsDir = (0, path_1.join)(circuitPath, "proofs", "proof");
    // Write proof and vk files
    (0, fs_1.writeFileSync)((0, path_1.join)(proofsDir, "proof"), proof.proof);
    (0, fs_1.writeFileSync)((0, path_1.join)(proofsDir, "vk"), proof.verificationKey);
    try {
        (0, child_process_1.execSync)(`"${bbPath}" verify -p "${(0, path_1.join)(proofsDir, "proof")}" -k "${(0, path_1.join)(proofsDir, "vk")}"`, { cwd: circuitPath, stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Generate a claim proof
 *
 * Proves:
 * - Knowledge of (nullifier, secret) for commitment
 * - Commitment exists in Merkle tree at given root
 * - Outputs correct nullifier hash
 */
async function generateClaimProof(note, merkleProof) {
    const inputs = {
        nullifier: note.nullifier.toString(),
        secret: note.secret.toString(),
        amount: note.amount.toString(),
        merkle_path: merkleProof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: merkleProof.pathIndices.map((i) => i.toString()),
        merkle_root: "0x" + Buffer.from(merkleProof.root).toString("hex"),
        nullifier_hash: "0x" + note.nullifierHash.toString(16).padStart(64, "0"),
        amount_pub: note.amount.toString(),
    };
    return generateProof("claim", inputs);
}
/**
 * Generate a transfer proof (commitment refresh)
 *
 * 1-in-1-out: Spends input commitment, creates new output commitment
 * with same amount but new secrets
 */
async function generateTransferProof(inputNote, outputNote, merkleProof) {
    if (inputNote.amount !== outputNote.amount) {
        throw new Error("Transfer must preserve amount (input == output)");
    }
    const inputs = {
        nullifier: inputNote.nullifier.toString(),
        secret: inputNote.secret.toString(),
        amount: inputNote.amount.toString(),
        merkle_path: merkleProof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: merkleProof.pathIndices.map((i) => i.toString()),
        output_nullifier: outputNote.nullifier.toString(),
        output_secret: outputNote.secret.toString(),
        merkle_root: "0x" + Buffer.from(merkleProof.root).toString("hex"),
        nullifier_hash: "0x" + inputNote.nullifierHash.toString(16).padStart(64, "0"),
        output_commitment: "0x" + outputNote.commitment.toString(16).padStart(64, "0"),
    };
    return generateProof("transfer", inputs);
}
/**
 * Generate a split proof
 *
 * 1-in-2-out: Spends input commitment, creates two output commitments
 * Individual output amounts are private (only conservation proven)
 */
async function generateSplitProof(inputNote, output1Note, output2Note, merkleProof) {
    if (inputNote.amount !== output1Note.amount + output2Note.amount) {
        throw new Error("Split must conserve amount (input == output1 + output2)");
    }
    const inputs = {
        input_nullifier: inputNote.nullifier.toString(),
        input_secret: inputNote.secret.toString(),
        input_amount: inputNote.amount.toString(),
        merkle_path: merkleProof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: merkleProof.pathIndices.map((i) => i.toString()),
        output1_nullifier: output1Note.nullifier.toString(),
        output1_secret: output1Note.secret.toString(),
        output1_amount: output1Note.amount.toString(),
        output2_nullifier: output2Note.nullifier.toString(),
        output2_secret: output2Note.secret.toString(),
        output2_amount: output2Note.amount.toString(),
        merkle_root: "0x" + Buffer.from(merkleProof.root).toString("hex"),
        input_nullifier_hash: "0x" + inputNote.nullifierHash.toString(16).padStart(64, "0"),
        output_commitment1: "0x" + output1Note.commitment.toString(16).padStart(64, "0"),
        output_commitment2: "0x" + output2Note.commitment.toString(16).padStart(64, "0"),
    };
    return generateProof("split", inputs);
}
/**
 * Generate a partial withdraw proof
 *
 * Withdraw any amount with change returned as a new commitment
 */
async function generatePartialWithdrawProof(inputNote, withdrawAmount, changeNote, merkleProof, recipient) {
    const changeAmount = inputNote.amount - withdrawAmount;
    if (changeNote.amount !== changeAmount) {
        throw new Error("Change amount mismatch");
    }
    const inputs = {
        nullifier: inputNote.nullifier.toString(),
        secret: inputNote.secret.toString(),
        amount: inputNote.amount.toString(),
        merkle_path: merkleProof.pathElements.map((el) => "0x" + Buffer.from(el).toString("hex")),
        path_indices: merkleProof.pathIndices.map((i) => i.toString()),
        change_nullifier: changeNote.nullifier.toString(),
        change_secret: changeNote.secret.toString(),
        change_amount: changeAmount.toString(),
        merkle_root: "0x" + Buffer.from(merkleProof.root).toString("hex"),
        nullifier_hash: "0x" + inputNote.nullifierHash.toString(16).padStart(64, "0"),
        withdraw_amount: withdrawAmount.toString(),
        change_commitment: "0x" + changeNote.commitment.toString(16).padStart(64, "0"),
        recipient: "0x" + Buffer.from(recipient).toString("hex"),
    };
    return generateProof("partial_withdraw", inputs);
}
/**
 * Serialize NoirProof for transport/storage
 */
function serializeProof(proof) {
    // Format: proof_len (4) | proof | vk_len (4) | vk | vk_hash (32) | public_inputs_count (4) | public_inputs
    const encoder = new TextEncoder();
    const publicInputsEncoded = proof.publicInputs.map((pi) => encoder.encode(pi + "\n"));
    const publicInputsLen = publicInputsEncoded.reduce((acc, arr) => acc + arr.length, 0);
    const totalLen = 4 +
        proof.proof.length +
        4 +
        proof.verificationKey.length +
        32 +
        4 +
        publicInputsLen;
    const buffer = new Uint8Array(totalLen);
    const view = new DataView(buffer.buffer);
    let offset = 0;
    // Proof length and data
    view.setUint32(offset, proof.proof.length, true);
    offset += 4;
    buffer.set(proof.proof, offset);
    offset += proof.proof.length;
    // VK length and data
    view.setUint32(offset, proof.verificationKey.length, true);
    offset += 4;
    buffer.set(proof.verificationKey, offset);
    offset += proof.verificationKey.length;
    // VK hash (always 32 bytes)
    buffer.set(proof.vkHash, offset);
    offset += 32;
    // Public inputs count and data
    view.setUint32(offset, proof.publicInputs.length, true);
    offset += 4;
    for (const pi of publicInputsEncoded) {
        buffer.set(pi, offset);
        offset += pi.length;
    }
    return buffer;
}
/**
 * Deserialize NoirProof from bytes
 */
function deserializeProof(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;
    // Read proof
    const proofLen = view.getUint32(offset, true);
    offset += 4;
    const proof = data.slice(offset, offset + proofLen);
    offset += proofLen;
    // Read VK
    const vkLen = view.getUint32(offset, true);
    offset += 4;
    const verificationKey = data.slice(offset, offset + vkLen);
    offset += vkLen;
    // Read VK hash
    const vkHash = data.slice(offset, offset + 32);
    offset += 32;
    // Read public inputs
    const publicInputsCount = view.getUint32(offset, true);
    offset += 4;
    const publicInputsData = decoder.decode(data.slice(offset));
    const publicInputs = publicInputsData
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(0, publicInputsCount);
    return {
        proof: new Uint8Array(proof),
        publicInputs,
        verificationKey: new Uint8Array(verificationKey),
        vkHash: new Uint8Array(vkHash),
    };
}
