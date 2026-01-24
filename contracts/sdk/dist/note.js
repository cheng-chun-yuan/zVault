"use strict";
/**
 * Note (shielded commitment) utilities for zVault
 *
 * A Note represents a shielded deposit with:
 * - nullifier: Random secret for spending
 * - secret: Additional entropy
 * - amount: Value in satoshis
 *
 * Hash values (commitment, nullifierHash) are computed by Noir circuits
 * using Poseidon2. This SDK stores the raw secrets and optionally
 * accepts pre-computed hash values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNote = generateNote;
exports.createNoteFromSecrets = createNoteFromSecrets;
exports.updateNoteWithHashes = updateNoteWithHashes;
exports.serializeNote = serializeNote;
exports.deserializeNote = deserializeNote;
exports.formatBtc = formatBtc;
exports.parseBtc = parseBtc;
exports.noteHasComputedHashes = noteHasComputedHashes;
exports.deriveNote = deriveNote;
exports.deriveMasterKey = deriveMasterKey;
exports.deriveNoteFromMaster = deriveNoteFromMaster;
exports.deriveNotes = deriveNotes;
exports.estimateSeedStrength = estimateSeedStrength;
exports.computeCommitment = computeCommitment;
exports.computeNullifierHash = computeNullifierHash;
exports.createNote = createNote;
exports.initPoseidon = initPoseidon;
exports.isPoseidonReady = isPoseidonReady;
exports.prepareWithdrawal = prepareWithdrawal;
const crypto_1 = require("./crypto");
/**
 * Generate a new note with random nullifier and secret
 *
 * Note: Hash values are NOT computed here. They will be computed
 * by the Noir circuits during proof generation.
 *
 * @param amountSats - Amount in satoshis
 * @returns Note with secrets (hashes are 0n until circuit execution)
 */
function generateNote(amountSats) {
    const nullifier = (0, crypto_1.randomFieldElement)();
    const secret = (0, crypto_1.randomFieldElement)();
    return createNoteFromSecrets(nullifier, secret, amountSats);
}
/**
 * Create a note from known secrets
 *
 * @param nullifier - Nullifier field element
 * @param secret - Secret field element
 * @param amountSats - Amount in satoshis
 * @param commitment - Optional pre-computed commitment (from circuit)
 * @param nullifierHash - Optional pre-computed nullifier hash (from circuit)
 * @returns Note structure
 */
function createNoteFromSecrets(nullifier, secret, amountSats, commitment, nullifierHash) {
    // Computed values are 0n until provided from circuit outputs
    const comm = commitment ?? 0n;
    const nullHash = nullifierHash ?? 0n;
    const noteHash = 0n; // Intermediate hash not typically exposed
    return {
        amount: amountSats,
        nullifier,
        secret,
        note: noteHash,
        commitment: comm,
        nullifierHash: nullHash,
        nullifierBytes: (0, crypto_1.bigintToBytes)(nullifier),
        secretBytes: (0, crypto_1.bigintToBytes)(secret),
        commitmentBytes: (0, crypto_1.bigintToBytes)(comm),
        nullifierHashBytes: (0, crypto_1.bigintToBytes)(nullHash),
    };
}
/**
 * Update note with computed hash values from Noir circuit execution
 *
 * @param note - Note to update
 * @param commitment - Commitment from circuit output
 * @param nullifierHash - Nullifier hash from circuit output
 * @returns Updated note
 */
function updateNoteWithHashes(note, commitment, nullifierHash) {
    return {
        ...note,
        commitment,
        nullifierHash,
        commitmentBytes: (0, crypto_1.bigintToBytes)(commitment),
        nullifierHashBytes: (0, crypto_1.bigintToBytes)(nullifierHash),
    };
}
/**
 * Serialize a note for storage or transmission
 *
 * Only stores the essential data (amount, nullifier, secret).
 * Optionally includes pre-computed hash values.
 */
function serializeNote(note) {
    const serialized = {
        amount: note.amount.toString(),
        nullifier: note.nullifier.toString(),
        secret: note.secret.toString(),
    };
    // Include computed values if available
    if (note.commitment !== 0n) {
        serialized.commitment = note.commitment.toString();
    }
    if (note.nullifierHash !== 0n) {
        serialized.nullifierHash = note.nullifierHash.toString();
    }
    return serialized;
}
/**
 * Deserialize and restore a note from stored data
 */
function deserializeNote(data) {
    const amount = BigInt(data.amount);
    const nullifier = BigInt(data.nullifier);
    const secret = BigInt(data.secret);
    const commitment = data.commitment ? BigInt(data.commitment) : undefined;
    const nullifierHash = data.nullifierHash
        ? BigInt(data.nullifierHash)
        : undefined;
    return createNoteFromSecrets(nullifier, secret, amount, commitment, nullifierHash);
}
/**
 * Format satoshis as BTC string
 */
function formatBtc(sats) {
    const btc = Number(sats) / 100000000;
    return btc.toFixed(8) + " BTC";
}
/**
 * Parse BTC string to satoshis
 */
function parseBtc(btcString) {
    const btc = parseFloat(btcString.replace(" BTC", ""));
    return BigInt(Math.round(btc * 100000000));
}
/**
 * Check if a note has computed hash values
 */
function noteHasComputedHashes(note) {
    return note.commitment !== 0n && note.nullifierHash !== 0n;
}
// ============================================================================
// Deterministic Note Derivation (HD-style)
// ============================================================================
/**
 * Derive a note deterministically from a seed phrase/name and index.
 *
 * This allows recovery of all notes from just the seed + index.
 * Similar to HD wallets in Bitcoin.
 *
 * The seed is first hashed to create a 32-byte master key, then
 * nullifier and secret are derived from that master key.
 *
 * @param seed - Seed phrase, name, or password (any string)
 * @param index - Note index (0, 1, 2, ...)
 * @param amountSats - Amount in satoshis
 * @returns Note with deterministically derived secrets
 *
 * @example
 * ```typescript
 * // Derive notes from a name
 * const note0 = deriveNote("albertgogogo", 0, 100_000n);
 * const note1 = deriveNote("albertgogogo", 1, 50_000n);
 *
 * // Later: recover the same notes
 * const recovered = deriveNote("albertgogogo", 0, 100_000n);
 * // recovered.nullifier === note0.nullifier ✓
 * ```
 */
function deriveNote(seed, index, amountSats) {
    // Step 1: Hash seed to get 32-byte master key (normalizes any input)
    const master = deriveMasterKey(seed);
    // Step 2: Derive nullifier and secret from master + index
    const nullifier = deriveFromMaster(master, index, 0); // 0 = nullifier domain
    const secret = deriveFromMaster(master, index, 1); // 1 = secret domain
    return createNoteFromSecrets(nullifier, secret, amountSats);
}
/**
 * Derive master key from seed (32 bytes)
 *
 * master = SHA256(seed)
 *
 * You can cache this and use deriveNoteFromMaster() for efficiency.
 */
function deriveMasterKey(seed) {
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(seed);
    return (0, crypto_1.sha256Hash)(seedBytes);
}
/**
 * Derive a note from a pre-computed master key
 *
 * More efficient if deriving many notes from the same seed.
 *
 * @example
 * ```typescript
 * const master = deriveMasterKey("albertgogogo");
 * const note0 = deriveNoteFromMaster(master, 0, 100_000n);
 * const note1 = deriveNoteFromMaster(master, 1, 50_000n);
 * ```
 */
function deriveNoteFromMaster(master, index, amountSats) {
    const nullifier = deriveFromMaster(master, index, 0);
    const secret = deriveFromMaster(master, index, 1);
    return createNoteFromSecrets(nullifier, secret, amountSats);
}
/**
 * Derive field element from master key + index + domain
 *
 * result = SHA256(master || index || domain) mod BN254_PRIME
 *
 * @param master - 32-byte master key
 * @param index - Note index
 * @param domain - 0 for nullifier, 1 for secret
 */
function deriveFromMaster(master, index, domain) {
    // Build input: master (32) || index (4) || domain (1) = 37 bytes
    const input = new Uint8Array(37);
    input.set(master, 0);
    // Index as 4 bytes little-endian
    const view = new DataView(input.buffer);
    view.setUint32(32, index, true);
    // Domain as 1 byte
    input[36] = domain;
    // Hash and reduce to field
    const hash = (0, crypto_1.sha256Hash)(input);
    return (0, crypto_1.bytesToBigint)(hash) % crypto_1.BN254_FIELD_PRIME;
}
/**
 * Derive multiple notes at once from a seed
 *
 * More efficient than calling deriveNote() multiple times
 * because master key is computed only once.
 *
 * @param seed - Seed phrase
 * @param amounts - Array of amounts for each note
 * @param startIndex - Starting index (default 0)
 * @returns Array of derived notes
 *
 * @example
 * ```typescript
 * // Create a wallet with 3 notes
 * const notes = deriveNotes("albertgogogo", [100_000n, 50_000n, 25_000n]);
 * ```
 */
function deriveNotes(seed, amounts, startIndex = 0) {
    // Compute master once, derive all notes from it
    const master = deriveMasterKey(seed);
    return amounts.map((amount, i) => deriveNoteFromMaster(master, startIndex + i, amount));
}
/**
 * Check the strength of a seed phrase
 *
 * Returns estimated bits of entropy.
 * Recommended: >= 80 bits for moderate security, >= 128 bits for high security
 */
function estimateSeedStrength(seed) {
    // Very rough entropy estimation
    const length = seed.length;
    const hasLower = /[a-z]/.test(seed);
    const hasUpper = /[A-Z]/.test(seed);
    const hasDigit = /[0-9]/.test(seed);
    const hasSpecial = /[^a-zA-Z0-9]/.test(seed);
    let charsetSize = 0;
    if (hasLower)
        charsetSize += 26;
    if (hasUpper)
        charsetSize += 26;
    if (hasDigit)
        charsetSize += 10;
    if (hasSpecial)
        charsetSize += 32;
    // Entropy = length * log2(charsetSize)
    const bits = Math.floor(length * Math.log2(charsetSize || 1));
    let strength;
    let warning;
    if (bits < 40) {
        strength = "weak";
        warning = "DANGER: This seed can be easily brute-forced. Use a longer passphrase!";
    }
    else if (bits < 80) {
        strength = "moderate";
        warning = "Consider using a longer passphrase for better security.";
    }
    else if (bits < 128) {
        strength = "strong";
    }
    else {
        strength = "very_strong";
    }
    return { bits, strength, warning };
}
// Poseidon initialization state (for API compatibility)
let poseidonInitialized = false;
/**
 * Compute commitment from note data
 *
 * NOTE: In Noir mode, commitments are computed INSIDE the Noir circuit.
 * This function is a placeholder that throws an error to guide developers.
 *
 * For Noir: Pass note data directly to your Noir circuit, which will compute:
 *   commitment = poseidon2(nullifier, secret, amount)
 *
 * @deprecated Use Noir circuit for commitment computation
 */
function computeCommitment(note) {
    throw new Error("computeCommitment is not available in Noir mode. " +
        "Commitments are computed inside the Noir circuit using Poseidon2. " +
        "Pass note data (nullifier, secret, amount) directly to your Noir circuit.");
}
/**
 * Compute nullifier hash (for double-spend prevention)
 *
 * NOTE: In Noir mode, nullifier hashes are computed INSIDE the Noir circuit.
 *
 * @deprecated Use Noir circuit for nullifier hash computation
 */
function computeNullifierHash(nullifier) {
    throw new Error("computeNullifierHash is not available in Noir mode. " +
        "Nullifier hashes are computed inside the Noir circuit using Poseidon2. " +
        "Pass nullifier directly to your Noir circuit.");
}
/**
 * Create a simple note (alias for generateNote but returns NoteData)
 *
 * Use this to generate note data for Noir circuit inputs.
 *
 * @param amount - Amount in satoshis
 * @returns NoteData with nullifier, secret, and amount
 */
function createNote(amount) {
    const note = generateNote(amount);
    return {
        nullifier: note.nullifier,
        secret: note.secret,
        amount: note.amount,
    };
}
/**
 * Initialize Poseidon (no-op for Noir - hashing is done in circuit)
 *
 * Kept for API compatibility. In Noir mode, this is a no-op.
 */
async function initPoseidon() {
    poseidonInitialized = true;
    // No actual initialization needed - Noir circuit handles Poseidon2
}
/**
 * Check if Poseidon is ready
 *
 * Always returns true after initPoseidon() is called (for API compatibility).
 */
function isPoseidonReady() {
    return poseidonInitialized;
}
/**
 * Prepare withdrawal - creates change note for remaining balance
 *
 * PRIVACY: All withdrawals are indistinguishable on-chain.
 * Change amount can be >= 0, and the commitment always looks random.
 *
 * @param inputNote - Note being spent
 * @param withdrawAmount - Amount to withdraw
 * @returns Change note with remaining balance (can be 0)
 */
function prepareWithdrawal(inputNote, withdrawAmount) {
    if (withdrawAmount <= 0n) {
        throw new Error("Withdraw amount must be positive");
    }
    if (withdrawAmount > inputNote.amount) {
        throw new Error("Withdraw amount exceeds note balance");
    }
    const changeAmount = inputNote.amount - withdrawAmount;
    const changeNote = createNote(changeAmount);
    return { changeNote, changeAmount };
}
