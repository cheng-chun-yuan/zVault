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
/**
 * Note structure for shielded amounts
 *
 * Core secrets (always required):
 * - amount, nullifier, secret
 *
 * Computed values (from Noir circuits):
 * - note, commitment, nullifierHash
 * These are 0n until computed by circuits
 */
export interface Note {
    amount: bigint;
    nullifier: bigint;
    secret: bigint;
    note: bigint;
    commitment: bigint;
    nullifierHash: bigint;
    nullifierBytes: Uint8Array;
    secretBytes: Uint8Array;
    commitmentBytes: Uint8Array;
    nullifierHashBytes: Uint8Array;
}
/**
 * Serializable note data (for storage/transmission)
 * Only stores essential secrets - hashes recomputed by circuits
 */
export interface SerializedNote {
    amount: string;
    nullifier: string;
    secret: string;
    commitment?: string;
    nullifierHash?: string;
}
/**
 * Generate a new note with random nullifier and secret
 *
 * Note: Hash values are NOT computed here. They will be computed
 * by the Noir circuits during proof generation.
 *
 * @param amountSats - Amount in satoshis
 * @returns Note with secrets (hashes are 0n until circuit execution)
 */
export declare function generateNote(amountSats: bigint): Note;
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
export declare function createNoteFromSecrets(nullifier: bigint, secret: bigint, amountSats: bigint, commitment?: bigint, nullifierHash?: bigint): Note;
/**
 * Update note with computed hash values from Noir circuit execution
 *
 * @param note - Note to update
 * @param commitment - Commitment from circuit output
 * @param nullifierHash - Nullifier hash from circuit output
 * @returns Updated note
 */
export declare function updateNoteWithHashes(note: Note, commitment: bigint, nullifierHash: bigint): Note;
/**
 * Serialize a note for storage or transmission
 *
 * Only stores the essential data (amount, nullifier, secret).
 * Optionally includes pre-computed hash values.
 */
export declare function serializeNote(note: Note): SerializedNote;
/**
 * Deserialize and restore a note from stored data
 */
export declare function deserializeNote(data: SerializedNote): Note;
/**
 * Format satoshis as BTC string
 */
export declare function formatBtc(sats: bigint): string;
/**
 * Parse BTC string to satoshis
 */
export declare function parseBtc(btcString: string): bigint;
/**
 * Check if a note has computed hash values
 */
export declare function noteHasComputedHashes(note: Note): boolean;
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
export declare function deriveNote(seed: string, index: number, amountSats: bigint): Note;
/**
 * Derive master key from seed (32 bytes)
 *
 * master = SHA256(seed)
 *
 * You can cache this and use deriveNoteFromMaster() for efficiency.
 */
export declare function deriveMasterKey(seed: string): Uint8Array;
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
export declare function deriveNoteFromMaster(master: Uint8Array, index: number, amountSats: bigint): Note;
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
export declare function deriveNotes(seed: string, amounts: bigint[], startIndex?: number): Note[];
/**
 * Check the strength of a seed phrase
 *
 * Returns estimated bits of entropy.
 * Recommended: >= 80 bits for moderate security, >= 128 bits for high security
 */
export declare function estimateSeedStrength(seed: string): {
    bits: number;
    strength: "weak" | "moderate" | "strong" | "very_strong";
    warning?: string;
};
/**
 * Simple note data structure (for Noir circuit inputs)
 *
 * NOTE: When using Noir circuits, the commitment is computed INSIDE the circuit
 * using Poseidon2. The SDK just provides the raw note data.
 */
export interface NoteData {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
}
/**
 * Create a simple note (alias for generateNote but returns NoteData)
 *
 * Use this to generate note data for Noir circuit inputs.
 *
 * @param amount - Amount in satoshis
 * @returns NoteData with nullifier, secret, and amount
 */
export declare function createNote(amount: bigint): NoteData;
/**
 * Initialize Poseidon (no-op for Noir - hashing is done in circuit)
 *
 * Kept for API compatibility. In Noir mode, this is a no-op.
 */
export declare function initPoseidon(): Promise<void>;
/**
 * Check if Poseidon is ready
 *
 * Always returns true after initPoseidon() is called (for API compatibility).
 */
export declare function isPoseidonReady(): boolean;
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
export declare function prepareWithdrawal(inputNote: NoteData, withdrawAmount: bigint): {
    changeNote: NoteData;
    changeAmount: bigint;
};
/**
 * V2 Note structure for dual-key ECDH system
 *
 * Key differences from V1:
 * - Uses random value instead of nullifier/secret for commitment
 * - Stores ephemeral spending pubkey for proof generation
 * - Nullifier derived from (spendingPrivKey, leafIndex) in circuit
 */
export interface NoteV2 {
    /** Amount in satoshis */
    amount: bigint;
    /** Random value for commitment (replaces nullifier/secret) */
    random: bigint;
    /** Ephemeral Grumpkin spending public key (from sender) */
    ephemeralSpendPubX: bigint;
    ephemeralSpendPubY: bigint;
    /** Leaf index in Merkle tree (set when commitment added on-chain) */
    leafIndex: number;
    /** Note public key = Poseidon2(ECDHShared.x, ECDHShared.y, DOMAIN_NPK) */
    notePubKey: bigint;
    /** Commitment = Poseidon2(notePubKey, amount, random) */
    commitment: bigint;
    /** Byte representations */
    randomBytes: Uint8Array;
    commitmentBytes: Uint8Array;
}
/**
 * Serializable V2 note data
 */
export interface SerializedNoteV2 {
    amount: string;
    random: string;
    ephemeralSpendPubX: string;
    ephemeralSpendPubY: string;
    leafIndex: number;
    notePubKey?: string;
    commitment?: string;
}
/**
 * Create a V2 note from scanned announcement data
 *
 * @param amount - Decrypted amount
 * @param random - Decrypted random value
 * @param ephemeralSpendPub - Sender's ephemeral Grumpkin pubkey
 * @param leafIndex - Merkle tree leaf index
 * @returns NoteV2 structure
 */
export declare function createNoteV2(amount: bigint, random: bigint, ephemeralSpendPub: {
    x: bigint;
    y: bigint;
}, leafIndex: number): NoteV2;
/**
 * Update V2 note with computed values from circuit
 */
export declare function updateNoteV2WithHashes(note: NoteV2, notePubKey: bigint, commitment: bigint): NoteV2;
/**
 * Serialize V2 note for storage
 */
export declare function serializeNoteV2(note: NoteV2): SerializedNoteV2;
/**
 * Deserialize V2 note from storage
 */
export declare function deserializeNoteV2(data: SerializedNoteV2): NoteV2;
/**
 * Check if V2 note has computed hashes
 */
export declare function noteV2HasComputedHashes(note: NoteV2): boolean;
