//! UltraHonk verification constants
//!
//! These constants match the barretenberg Solidity UltraHonk verifier
//! for keccak non-ZK mode (bb.js `{ keccak: true }`).

/// Maximum log of circuit size we support
/// Our circuits are small, so we use 16 instead of the full 28
pub const MAX_LOG_CIRCUIT_SIZE: usize = 16;

/// Number of subrelations in UltraHonk
pub const NUMBER_OF_SUBRELATIONS: usize = 28;

/// Batched relation partial length for non-ZK proofs
pub const BATCHED_RELATION_PARTIAL_LENGTH: usize = 8;

/// Number of entities (polynomials evaluated at sumcheck challenge point)
/// Matches barretenberg Solidity verifier WIRE enum (41 entries, 0-40):
///   0-13:  14 selectors (Q_M, Q_C, Q_L, Q_R, Q_O, Q_4, Q_ARITH, Q_RANGE,
///          Q_ELLIPTIC, Q_AUX, Q_LOOKUP, Q_NNF, Q_POSEIDON2_EXT, Q_POSEIDON2_INT)
///   14-17: sigma_1-4
///   18-21: id_1-4
///   22-25: table_1-4
///   26-27: lagrange_first, lagrange_last
///   28-35: w_l, w_r, w_o, w_4, z_perm, lookup_inverses, lookup_read_counts, lookup_read_tags
///   36-40: shifted (w_l_shift, w_r_shift, w_o_shift, w_4_shift, z_perm_shift)
pub const NUMBER_OF_ENTITIES: usize = 41;

/// Number of unshifted polynomials (entities 0-35)
pub const NUMBER_UNSHIFTED: usize = 36;

/// Number of shifted polynomials (entities 36-40)
pub const NUMBER_TO_BE_SHIFTED: usize = 5;

/// Number of alpha challenges (relation separators)
/// = NUMBER_OF_SUBRELATIONS - 1 = 27
pub const NUMBER_OF_ALPHAS: usize = NUMBER_OF_SUBRELATIONS - 1; // 27

/// Number of VK commitment points (14 selectors + 4 sigma + 4 id + 4 table + 2 lagrange = 28)
/// Includes Q_NNF at position 11 (which was previously excluded).
pub const VK_NUM_COMMITMENTS: usize = 28;

/// Maximum proof size log_n from barretenberg Solidity verifier.
/// bb.js keccak non-ZK proofs use ACTUAL logN (not padded), so this is
/// only used as a maximum bound. ProofSlice reads actual logN from VK.
pub const CONST_PROOF_SIZE_LOG_N: usize = 28;

/// Aggregation object preamble size in Fr elements (proof preamble)
/// bb.js keccak non-ZK proofs: 16 Fr = 512 bytes preamble
/// (Calculated by working backwards from proof end)
pub const PAIRING_POINTS_SIZE: usize = 16;

/// Scalar size (BN254 Fr)
pub const SCALAR_SIZE: usize = 32;

/// G1 point size in proof format (4 × 32 bytes for split coordinates)
pub const G1_PROOF_POINT_SIZE: usize = 128;

/// G1 point size in affine format (2 × 32 bytes)
pub const G1_AFFINE_SIZE: usize = 64;

/// G2 point size in affine format (4 × 32 bytes)
pub const G2_AFFINE_SIZE: usize = 128;

/// VK metadata size for keccak format (3 × 32-byte BE fields):
/// log_circuit_size, num_public_inputs, pub_inputs_offset
pub const VK_METADATA_SIZE: usize = 3 * SCALAR_SIZE; // 96 bytes

/// Total VK size for bb.js keccak format:
/// metadata(96) + 28 G1 split points(128 each) = 96 + 3584 = 3680
pub const VK_SIZE: usize = VK_METADATA_SIZE + VK_NUM_COMMITMENTS * G1_PROOF_POINT_SIZE;

/// Number of witness G1 commitments in the proof
/// w_l, w_r, w_o, w_4, z_perm, lookup_inverses, lookup_read_counts, lookup_read_tags
pub const NUM_WITNESS_COMMITMENTS: usize = 8;

/// Barycentric Lagrange denominators for sumcheck evaluation
/// These are precomputed: d_i = prod_{j != i}(i - j) for i in 0..8
pub const BARYCENTRIC_LAGRANGE_DENOMINATORS: [i64; BATCHED_RELATION_PARTIAL_LENGTH] = [
    1,    // d_0 = 1 * 2 * 3 * 4 * 5 * 6 * 7 = 5040
    -1,   // d_1 = (-1) * 1 * 2 * 3 * 4 * 5 * 6 = -720
    2,    // d_2 = (-2) * (-1) * 1 * 2 * 3 * 4 * 5 = 240
    -6,   // d_3 = ...
    24,
    -120,
    720,
    -5040,
];

// Note: BN254 field moduli are defined in bn254.rs as SCALAR_MODULUS and FIELD_MODULUS

/// SRS G2 generator (from Aztec Ignition trusted setup, big-endian)
/// This is [1]_2, the standard BN254 G2 generator
/// Format per EIP-197: (x_im, x_re, y_im, y_re) = (x.c1, x.c0, y.c1, y.c0)
/// Values from: https://github.com/matter-labs/solidity_plonk_verifier
pub const SRS_G2_GENERATOR: [u8; 128] = [
    // x.c1 (imaginary part of x) = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2
    0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a,
    0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25,
    0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12,
    0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2,
    // x.c0 (real part of x) = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed
    0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76,
    0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79,
    0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd,
    0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed,
    // y.c1 (imaginary part of y) = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b
    0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75,
    0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95,
    0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3,
    0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b,
    // y.c0 (real part of y) = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa
    0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb,
    0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f,
    0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b,
    0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
];

/// SRS G2 [x]_2 element (from Aztec Ignition trusted setup, big-endian)
/// This is the tau-th power of the G2 generator from the SRS ceremony
/// Format per EIP-197: (x_im, x_re, y_im, y_re) = (x.c1, x.c0, y.c1, y.c0)
/// Values from: https://github.com/matter-labs/solidity_plonk_verifier
pub const SRS_G2_X: [u8; 128] = [
    // x.c1 (imaginary part of x) = 0x260e01b251f6f1c7e7ff4e580791dee8ea51d87a358e038b4efe30fac09383c1
    0x26, 0x0e, 0x01, 0xb2, 0x51, 0xf6, 0xf1, 0xc7,
    0xe7, 0xff, 0x4e, 0x58, 0x07, 0x91, 0xde, 0xe8,
    0xea, 0x51, 0xd8, 0x7a, 0x35, 0x8e, 0x03, 0x8b,
    0x4e, 0xfe, 0x30, 0xfa, 0xc0, 0x93, 0x83, 0xc1,
    // x.c0 (real part of x) = 0x0118c4d5b837bcc2bc89b5b398b5974e9f5944073b32078b7e231fec938883b0
    0x01, 0x18, 0xc4, 0xd5, 0xb8, 0x37, 0xbc, 0xc2,
    0xbc, 0x89, 0xb5, 0xb3, 0x98, 0xb5, 0x97, 0x4e,
    0x9f, 0x59, 0x44, 0x07, 0x3b, 0x32, 0x07, 0x8b,
    0x7e, 0x23, 0x1f, 0xec, 0x93, 0x88, 0x83, 0xb0,
    // y.c1 (imaginary part of y) = 0x04fc6369f7110fe3d25156c1bb9a72859cf2a04641f99ba4ee413c80da6a5fe4
    0x04, 0xfc, 0x63, 0x69, 0xf7, 0x11, 0x0f, 0xe3,
    0xd2, 0x51, 0x56, 0xc1, 0xbb, 0x9a, 0x72, 0x85,
    0x9c, 0xf2, 0xa0, 0x46, 0x41, 0xf9, 0x9b, 0xa4,
    0xee, 0x41, 0x3c, 0x80, 0xda, 0x6a, 0x5f, 0xe4,
    // y.c0 (real part of y) = 0x22febda3c0c0632a56475b4214e5615e11e6dd3f96e6cea2854a87d4dacc5e55
    0x22, 0xfe, 0xbd, 0xa3, 0xc0, 0xc0, 0x63, 0x2a,
    0x56, 0x47, 0x5b, 0x42, 0x14, 0xe5, 0x61, 0x5e,
    0x11, 0xe6, 0xdd, 0x3f, 0x96, 0xe6, 0xce, 0xa2,
    0x85, 0x4a, 0x87, 0xd4, 0xda, 0xcc, 0x5e, 0x55,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vk_size() {
        // VK size for bb.js keccak format: 96 + 28*128 = 3680 bytes
        assert_eq!(VK_SIZE, 3680);
    }

    #[test]
    fn test_constants_match_solidity_verifier() {
        // These match barretenberg Solidity UltraHonk verifier (keccak mode)
        assert_eq!(NUMBER_OF_SUBRELATIONS, 28);
        assert_eq!(BATCHED_RELATION_PARTIAL_LENGTH, 8);
        assert_eq!(NUMBER_OF_ENTITIES, 41);
        assert_eq!(NUMBER_OF_ALPHAS, 27);
        assert_eq!(VK_NUM_COMMITMENTS, 28);
        assert_eq!(NUMBER_UNSHIFTED, 36);
        assert_eq!(NUMBER_TO_BE_SHIFTED, 5);
        assert_eq!(CONST_PROOF_SIZE_LOG_N, 28);
        // bb.js encodes PIs as 4 limbs: 4 PIs × 4 = 16 Fr preamble
        assert_eq!(PAIRING_POINTS_SIZE, 16);
        assert_eq!(NUM_WITNESS_COMMITMENTS, 8);
    }
}
