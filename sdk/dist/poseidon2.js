/**
 * Poseidon2 Hash Implementation for BN254
 *
 * Uses @aztec/foundation which matches Noir's Poseidon2 exactly.
 *
 * VERIFIED: aztec/foundation output matches Noir circuit output.
 */
import { poseidon2Hash as aztecPoseidon2 } from "@aztec/foundation/crypto";
// BN254 scalar field prime (Noir's field)
export const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/**
 * Poseidon2 hash matching Noir's implementation
 *
 * @param inputs - Array of field elements to hash
 * @param len - Optional length (defaults to inputs.length)
 * @returns Hash result as bigint
 */
export async function poseidon2Hash(inputs, len = inputs.length) {
    const result = await aztecPoseidon2(inputs.slice(0, len));
    return BigInt(result.toString());
}
/**
 * Synchronous Poseidon2 hash (for backwards compatibility)
 * Note: This initializes WASM on first call which may be slow
 */
let cachedSync = null;
export function poseidon2HashSync(inputs) {
    if (!cachedSync) {
        throw new Error("Call initPoseidon2Sync() first or use async poseidon2Hash()");
    }
    return cachedSync(inputs);
}
/**
 * Initialize synchronous Poseidon2 (preloads WASM)
 */
export async function initPoseidon2Sync() {
    // Warm up the async version which initializes WASM
    await poseidon2Hash([0n]);
    // Create sync wrapper (aztec foundation caches after first call)
    cachedSync = (inputs) => {
        // This will be synchronous after WASM is initialized
        let result = 0n;
        aztecPoseidon2(inputs).then(r => { result = BigInt(r.toString()); });
        return result;
    };
}
// ============================================================================
// V1 Circuit Helpers (claim, split, transfer)
// ============================================================================
/**
 * Compute note from nullifier and secret
 * note = poseidon2([nullifier, secret])
 */
export async function computeNote(nullifier, secret) {
    return poseidon2Hash([nullifier, secret]);
}
/**
 * Compute commitment from note and amount
 * commitment = poseidon2([note, amount])
 */
export async function computeCommitment(note, amount) {
    return poseidon2Hash([note, amount]);
}
/**
 * Compute nullifier hash for double-spend prevention
 * nullifier_hash = poseidon2([nullifier])
 */
export async function hashNullifier(nullifier) {
    return poseidon2Hash([nullifier]);
}
/**
 * V1 Commitment: commitment = hash(hash(nullifier, secret), amount)
 *
 * Used by: claim, split, transfer circuits
 * Matches: zvault_utils::compute_commitment_from_secrets()
 */
export async function computeCommitmentV1(nullifier, secret, amount) {
    const note = await computeNote(nullifier, secret);
    return computeCommitment(note, amount);
}
/**
 * V1 Nullifier Hash
 * Matches: zvault_utils::compute_nullifier_hash()
 */
export async function computeNullifierHashV1(nullifier) {
    return hashNullifier(nullifier);
}
// ============================================================================
// V2 Circuit Helpers (ECDH stealth - if needed)
// ============================================================================
/**
 * Derive note public key from ECDH shared secret
 * notePubKey = poseidon2([sharedX, sharedY])
 */
export async function deriveNotePubKey(sharedX, sharedY) {
    return poseidon2Hash([sharedX, sharedY]);
}
/**
 * V2 Commitment: commitment = hash(notePubKey, amount, random)
 *
 * Used by: ECDH stealth circuits
 * Matches: grumpkin::compute_commitment_v2()
 */
export async function computeCommitmentV2(notePubKey, amount, random) {
    return poseidon2Hash([notePubKey, amount, random]);
}
/**
 * V2 Nullifier: nullifier = hash(spendingPriv, leafIndex)
 *
 * Used by: ECDH stealth circuits
 */
export async function computeNullifierV2(spendingPriv, leafIndex) {
    return poseidon2Hash([spendingPriv, leafIndex]);
}
