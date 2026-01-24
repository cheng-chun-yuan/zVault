/**
 * Poseidon2 Hash Implementation for BN254
 *
 * Uses @aztec/foundation which matches Noir's Poseidon2 exactly.
 *
 * VERIFIED: aztec/foundation output matches Noir circuit output.
 */
export declare const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Poseidon2 hash matching Noir's implementation
 *
 * @param inputs - Array of field elements to hash
 * @param len - Optional length (defaults to inputs.length)
 * @returns Hash result as bigint
 */
export declare function poseidon2Hash(inputs: bigint[], len?: number): Promise<bigint>;
export declare function poseidon2HashSync(inputs: bigint[]): bigint;
/**
 * Initialize synchronous Poseidon2 (preloads WASM)
 */
export declare function initPoseidon2Sync(): Promise<void>;
/**
 * Compute note from nullifier and secret
 * note = poseidon2([nullifier, secret])
 */
export declare function computeNote(nullifier: bigint, secret: bigint): Promise<bigint>;
/**
 * Compute commitment from note and amount
 * commitment = poseidon2([note, amount])
 */
export declare function computeCommitment(note: bigint, amount: bigint): Promise<bigint>;
/**
 * Compute nullifier hash for double-spend prevention
 * nullifier_hash = poseidon2([nullifier])
 */
export declare function hashNullifier(nullifier: bigint): Promise<bigint>;
/**
 * V1 Commitment: commitment = hash(hash(nullifier, secret), amount)
 *
 * Used by: claim, split, transfer circuits
 * Matches: zvault_utils::compute_commitment_from_secrets()
 */
export declare function computeCommitmentV1(nullifier: bigint, secret: bigint, amount: bigint): Promise<bigint>;
/**
 * V1 Nullifier Hash
 * Matches: zvault_utils::compute_nullifier_hash()
 */
export declare function computeNullifierHashV1(nullifier: bigint): Promise<bigint>;
/**
 * Derive note public key from ECDH shared secret
 * notePubKey = poseidon2([sharedX, sharedY])
 */
export declare function deriveNotePubKey(sharedX: bigint, sharedY: bigint): Promise<bigint>;
/**
 * V2 Commitment: commitment = hash(notePubKey, amount, random)
 *
 * Used by: ECDH stealth circuits
 * Matches: grumpkin::compute_commitment_v2()
 */
export declare function computeCommitmentV2(notePubKey: bigint, amount: bigint, random: bigint): Promise<bigint>;
/**
 * V2 Nullifier: nullifier = hash(spendingPriv, leafIndex)
 *
 * Used by: ECDH stealth circuits
 */
export declare function computeNullifierV2(spendingPriv: bigint, leafIndex: bigint): Promise<bigint>;
