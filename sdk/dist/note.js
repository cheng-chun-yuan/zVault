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
import { randomFieldElement, bigintToBytes, sha256Hash, bytesToBigint, BN254_FIELD_PRIME } from "./crypto";
/**
 * Generate a new note with random nullifier and secret
 *
 * Note: Hash values are NOT computed here. They will be computed
 * by the Noir circuits during proof generation.
 *
 * @param amountSats - Amount in satoshis
 * @returns Note with secrets (hashes are 0n until circuit execution)
 */
export function generateNote(amountSats) {
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();
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
export function createNoteFromSecrets(nullifier, secret, amountSats, commitment, nullifierHash) {
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
        nullifierBytes: bigintToBytes(nullifier),
        secretBytes: bigintToBytes(secret),
        commitmentBytes: bigintToBytes(comm),
        nullifierHashBytes: bigintToBytes(nullHash),
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
export function updateNoteWithHashes(note, commitment, nullifierHash) {
    return {
        ...note,
        commitment,
        nullifierHash,
        commitmentBytes: bigintToBytes(commitment),
        nullifierHashBytes: bigintToBytes(nullifierHash),
    };
}
/**
 * Serialize a note for storage or transmission
 *
 * Only stores the essential data (amount, nullifier, secret).
 * Optionally includes pre-computed hash values.
 */
export function serializeNote(note) {
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
export function deserializeNote(data) {
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
export function formatBtc(sats) {
    const btc = Number(sats) / 100000000;
    return btc.toFixed(8) + " BTC";
}
/**
 * Parse BTC string to satoshis
 */
export function parseBtc(btcString) {
    const btc = parseFloat(btcString.replace(" BTC", ""));
    return BigInt(Math.round(btc * 100000000));
}
/**
 * Check if a note has computed hash values
 */
export function noteHasComputedHashes(note) {
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
export function deriveNote(seed, index, amountSats) {
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
export function deriveMasterKey(seed) {
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(seed);
    return sha256Hash(seedBytes);
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
export function deriveNoteFromMaster(master, index, amountSats) {
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
    const hash = sha256Hash(input);
    return bytesToBigint(hash) % BN254_FIELD_PRIME;
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
export function deriveNotes(seed, amounts, startIndex = 0) {
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
export function estimateSeedStrength(seed) {
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
 * Create a simple note (alias for generateNote but returns NoteData)
 *
 * Use this to generate note data for Noir circuit inputs.
 *
 * @param amount - Amount in satoshis
 * @returns NoteData with nullifier, secret, and amount
 */
export function createNote(amount) {
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
export async function initPoseidon() {
    poseidonInitialized = true;
    // No actual initialization needed - Noir circuit handles Poseidon2
}
/**
 * Check if Poseidon is ready
 *
 * Always returns true after initPoseidon() is called (for API compatibility).
 */
export function isPoseidonReady() {
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
export function prepareWithdrawal(inputNote, withdrawAmount) {
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
/**
 * Create a stealth note from scanned announcement data
 *
 * @param amount - Decrypted amount
 * @param random - Decrypted random value
 * @param ephemeralSpendPub - Sender's ephemeral Grumpkin pubkey
 * @param leafIndex - Merkle tree leaf index
 * @returns StealthNote structure
 */
export function createStealthNote(amount, random, ephemeralSpendPub, leafIndex) {
    return {
        amount,
        random,
        ephemeralSpendPubX: ephemeralSpendPub.x,
        ephemeralSpendPubY: ephemeralSpendPub.y,
        leafIndex,
        notePubKey: 0n, // Computed in circuit
        commitment: 0n, // Computed in circuit
        randomBytes: bigintToBytes(random),
        commitmentBytes: new Uint8Array(32),
    };
}
/**
 * Update stealth note with computed values from circuit
 */
export function updateStealthNoteWithHashes(note, notePubKey, commitment) {
    return {
        ...note,
        notePubKey,
        commitment,
        commitmentBytes: bigintToBytes(commitment),
    };
}
/**
 * Serialize stealth note for storage
 */
export function serializeStealthNote(note) {
    const serialized = {
        amount: note.amount.toString(),
        random: note.random.toString(),
        ephemeralSpendPubX: note.ephemeralSpendPubX.toString(),
        ephemeralSpendPubY: note.ephemeralSpendPubY.toString(),
        leafIndex: note.leafIndex,
    };
    if (note.notePubKey !== 0n) {
        serialized.notePubKey = note.notePubKey.toString();
    }
    if (note.commitment !== 0n) {
        serialized.commitment = note.commitment.toString();
    }
    return serialized;
}
/**
 * Deserialize stealth note from storage
 */
export function deserializeStealthNote(data) {
    const note = createStealthNote(BigInt(data.amount), BigInt(data.random), {
        x: BigInt(data.ephemeralSpendPubX),
        y: BigInt(data.ephemeralSpendPubY),
    }, data.leafIndex);
    if (data.notePubKey && data.commitment) {
        return updateStealthNoteWithHashes(note, BigInt(data.notePubKey), BigInt(data.commitment));
    }
    return note;
}
/**
 * Check if stealth note has computed hashes
 */
export function stealthNoteHasComputedHashes(note) {
    return note.notePubKey !== 0n && note.commitment !== 0n;
}
/** @deprecated Use createStealthNote instead */
export const createNoteV2 = createStealthNote;
/** @deprecated Use updateStealthNoteWithHashes instead */
export const updateNoteV2WithHashes = updateStealthNoteWithHashes;
/** @deprecated Use serializeStealthNote instead */
export const serializeNoteV2 = serializeStealthNote;
/** @deprecated Use deserializeStealthNote instead */
export const deserializeNoteV2 = deserializeStealthNote;
/** @deprecated Use stealthNoteHasComputedHashes instead */
export const noteV2HasComputedHashes = stealthNoteHasComputedHashes;
