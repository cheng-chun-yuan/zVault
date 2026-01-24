/**
 * Poseidon2 Hash Implementation for BN254
 *
 * This implementation matches Noir's Poseidon2 hash function used in circuits.
 * It's essential that this produces identical outputs to ensure commitment
 * verification succeeds on-chain.
 *
 * CRITICAL: This must match the Noir circuit's Poseidon2 output exactly.
 * Any mismatch will cause claim proofs to fail.
 *
 * Security Properties:
 * - Uses BN254 scalar field (same as Noir's embedded curve)
 * - Implements full Poseidon2 permutation with correct round constants
 * - Sponge construction with rate=2, capacity=1
 */
export declare const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Poseidon2 sponge hash
 *
 * Matches Noir's Poseidon2::hash() function.
 * Uses rate=2, capacity=1 sponge construction.
 *
 * @param inputs - Array of field elements to hash
 * @param len - Number of elements (for padding)
 * @returns Hash output as field element
 */
export declare function poseidon2Hash(inputs: bigint[], len?: number): bigint;
/**
 * Compute note public key from ECDH shared secret
 *
 * notePubKey = Poseidon2(shared_x, shared_y, DOMAIN_NPK)
 *
 * This must match Noir's grumpkin::derive_note_pubkey()
 */
export declare function deriveNotePubKey(sharedX: bigint, sharedY: bigint): bigint;
/**
 * Compute V2 commitment from note public key, amount, and random
 *
 * commitment = Poseidon2(notePubKey, amount, random)
 *
 * This must match Noir's grumpkin::compute_commitment_v2()
 */
export declare function computeCommitmentV2(notePubKey: bigint, amount: bigint, random: bigint): bigint;
/**
 * Compute V2 nullifier from spending private key and leaf index
 *
 * nullifier = Poseidon2(spending_priv, leaf_index, DOMAIN_NULL)
 *
 * CRITICAL: This is what prevents sender from claiming recipient's funds.
 * This must match Noir's grumpkin::compute_nullifier_v2()
 */
export declare function computeNullifierV2(spendingPriv: bigint, leafIndex: bigint): bigint;
/**
 * Hash nullifier for public input
 *
 * nullifier_hash = Poseidon2(nullifier)
 *
 * NOTE: This double-hashing is being evaluated for removal.
 * See security audit Phase 3 recommendation.
 */
export declare function hashNullifier(nullifier: bigint): bigint;
/**
 * Compute V1 commitment from nullifier, secret, and amount
 *
 * note = Poseidon2(nullifier, secret)
 * commitment = Poseidon2(note, amount)
 *
 * This must match Noir's zvault_utils::compute_commitment_from_secrets()
 */
export declare function computeCommitmentV1(nullifier: bigint, secret: bigint, amount: bigint): bigint;
/**
 * Compute V1 nullifier hash
 *
 * nullifier_hash = Poseidon2(nullifier)
 *
 * This must match Noir's zvault_utils::compute_nullifier_hash()
 */
export declare function computeNullifierHashV1(nullifier: bigint): bigint;
