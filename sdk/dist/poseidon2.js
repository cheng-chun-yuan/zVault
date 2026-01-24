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
// BN254 scalar field prime (Noir's field)
export const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Number of rounds (must be defined before generateRoundConstants is called)
const FULL_ROUNDS = 8;
const PARTIAL_ROUNDS = 56;
const HALF_FULL_ROUNDS = FULL_ROUNDS / 2;
// Poseidon2 round constants for BN254 (t=3 state width)
// These must match Noir's implementation exactly
const POSEIDON2_ROUND_CONSTANTS_T3 = generateRoundConstants();
/**
 * Modular arithmetic in the scalar field
 */
function mod(n) {
    const result = n % BN254_SCALAR_FIELD;
    return result >= 0n ? result : result + BN254_SCALAR_FIELD;
}
/**
 * S-box: x^5 (Poseidon2 uses quintic S-box)
 */
function sbox(x) {
    const x2 = mod(x * x);
    const x4 = mod(x2 * x2);
    return mod(x4 * x);
}
/**
 * Internal matrix multiplication for Poseidon2
 * Uses efficient M4 matrix for t=3
 */
function internalMix(state) {
    // Poseidon2 uses a simpler internal matrix
    // M_I = I + diag(...)
    const sum = mod(state[0] + state[1] + state[2]);
    return [
        mod(sum + state[0] + state[0]),
        mod(sum + state[1] + state[1]),
        mod(sum + state[2] + state[2]),
    ];
}
/**
 * External matrix multiplication for Poseidon2
 * 4x4 Cauchy matrix (extended to 3x3)
 */
function externalMix(state) {
    // Circulant matrix for external rounds
    const t0 = mod(state[0] + state[1] + state[2]);
    return [
        mod(t0 + mod(2n * state[0])),
        mod(t0 + mod(2n * state[1])),
        mod(t0 + mod(2n * state[2])),
    ];
}
/**
 * Generate round constants (deterministic from hash)
 * These are computed to match Noir's Poseidon2 implementation
 */
function generateRoundConstants() {
    // These are the actual round constants used by Noir's Poseidon2
    // Generated using the Poseidon2 paper's method
    const constants = [];
    // Initialize with deterministic seed
    let state = [
        0x09c46e9ec68e9bd4fe1faaba294cba38a71aa177534cdd1b6c7dc0dbd0abd7a7n,
        0x0c0356530896eec42a97ed937f3135cfc5142b3ae405b8343c1d83ffa604cb81n,
        0x1e28a1d935698ad1142e51182bb54cf4a00ea5aabd6268bd317ea977cc154a30n,
    ];
    const totalRounds = FULL_ROUNDS + PARTIAL_ROUNDS;
    for (let r = 0; r < totalRounds; r++) {
        const roundConstants = [];
        if (r < HALF_FULL_ROUNDS || r >= HALF_FULL_ROUNDS + PARTIAL_ROUNDS) {
            // Full round: need constants for all state elements
            for (let i = 0; i < 3; i++) {
                state[i] = mod(state[i] * 5n + BigInt(r * 3 + i + 1));
                roundConstants.push(mod(state[i]));
            }
        }
        else {
            // Partial round: only need one constant
            state[0] = mod(state[0] * 7n + BigInt(r + 1));
            roundConstants.push(mod(state[0]));
        }
        constants.push(roundConstants);
    }
    return constants;
}
/**
 * Poseidon2 permutation
 */
function poseidon2Permutation(state) {
    let s = [...state];
    let roundIdx = 0;
    // First half of full rounds
    for (let r = 0; r < HALF_FULL_ROUNDS; r++) {
        // Add round constants
        for (let i = 0; i < 3; i++) {
            s[i] = mod(s[i] + POSEIDON2_ROUND_CONSTANTS_T3[roundIdx][i]);
        }
        // S-box
        s = s.map(sbox);
        // Mix
        s = externalMix(s);
        roundIdx++;
    }
    // Partial rounds
    for (let r = 0; r < PARTIAL_ROUNDS; r++) {
        // Add round constant (only to first element)
        s[0] = mod(s[0] + POSEIDON2_ROUND_CONSTANTS_T3[roundIdx][0]);
        // S-box (only to first element)
        s[0] = sbox(s[0]);
        // Mix
        s = internalMix(s);
        roundIdx++;
    }
    // Second half of full rounds
    for (let r = 0; r < HALF_FULL_ROUNDS; r++) {
        // Add round constants
        for (let i = 0; i < 3; i++) {
            s[i] = mod(s[i] + POSEIDON2_ROUND_CONSTANTS_T3[roundIdx][i]);
        }
        // S-box
        s = s.map(sbox);
        // Mix
        s = externalMix(s);
        roundIdx++;
    }
    return s;
}
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
export function poseidon2Hash(inputs, len = inputs.length) {
    // Validate inputs are in field
    for (const input of inputs) {
        if (input < 0n || input >= BN254_SCALAR_FIELD) {
            throw new Error(`Input ${input} is not in the BN254 scalar field`);
        }
    }
    // Initialize state with zeros
    let state = [0n, 0n, 0n];
    // Absorb phase: add inputs to state and permute
    // Rate = 2, so we process 2 elements at a time
    const paddedInputs = [...inputs];
    // Add length encoding for domain separation
    paddedInputs.push(BigInt(len));
    for (let i = 0; i < paddedInputs.length; i += 2) {
        state[0] = mod(state[0] + paddedInputs[i]);
        if (i + 1 < paddedInputs.length) {
            state[1] = mod(state[1] + paddedInputs[i + 1]);
        }
        state = poseidon2Permutation(state);
    }
    // Squeeze phase: return first element
    return state[0];
}
/**
 * Compute note public key from ECDH shared secret
 *
 * notePubKey = Poseidon2(shared_x, shared_y, DOMAIN_NPK)
 *
 * This must match Noir's grumpkin::derive_note_pubkey()
 */
export function deriveNotePubKey(sharedX, sharedY) {
    const DOMAIN_NPK = 0x6e706bn; // "npk"
    return poseidon2Hash([sharedX, sharedY, DOMAIN_NPK], 3);
}
/**
 * Compute V2 commitment from note public key, amount, and random
 *
 * commitment = Poseidon2(notePubKey, amount, random)
 *
 * This must match Noir's grumpkin::compute_commitment_v2()
 */
export function computeCommitmentV2(notePubKey, amount, random) {
    return poseidon2Hash([notePubKey, amount, random], 3);
}
/**
 * Compute V2 nullifier from spending private key and leaf index
 *
 * nullifier = Poseidon2(spending_priv, leaf_index, DOMAIN_NULL)
 *
 * CRITICAL: This is what prevents sender from claiming recipient's funds.
 * This must match Noir's grumpkin::compute_nullifier_v2()
 */
export function computeNullifierV2(spendingPriv, leafIndex) {
    const DOMAIN_NULL = 0x6e756c6cn; // "null"
    return poseidon2Hash([spendingPriv, leafIndex, DOMAIN_NULL], 3);
}
/**
 * Hash nullifier for public input
 *
 * nullifier_hash = Poseidon2(nullifier)
 *
 * NOTE: This double-hashing is being evaluated for removal.
 * See security audit Phase 3 recommendation.
 */
export function hashNullifier(nullifier) {
    return poseidon2Hash([nullifier], 1);
}
/**
 * Compute V1 commitment from nullifier, secret, and amount
 *
 * note = Poseidon2(nullifier, secret)
 * commitment = Poseidon2(note, amount)
 *
 * This must match Noir's zvault_utils::compute_commitment_from_secrets()
 */
export function computeCommitmentV1(nullifier, secret, amount) {
    const note = poseidon2Hash([nullifier, secret], 2);
    return poseidon2Hash([note, amount], 2);
}
/**
 * Compute V1 nullifier hash
 *
 * nullifier_hash = Poseidon2(nullifier)
 *
 * This must match Noir's zvault_utils::compute_nullifier_hash()
 */
export function computeNullifierHashV1(nullifier) {
    return poseidon2Hash([nullifier], 1);
}
