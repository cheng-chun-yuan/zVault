//! UltraHonk proof types (Full Implementation)
//!
//! Extended data structures for full UltraHonk verification.
//! Optimized for Solana's 4KB stack limit by using heap allocation.

use crate::bn254::{G1Point, G2Point, FR_SIZE};
use crate::constants::{
    BATCHED_RELATION_PARTIAL_LENGTH, G1_AFFINE_SIZE,
    G1_PROOF_POINT_SIZE, MAX_LOG_CIRCUIT_SIZE, NUMBER_OF_ENTITIES, VK_NUM_COMMITMENTS,
    PAIRING_POINTS_SIZE, NUM_WITNESS_COMMITMENTS, SCALAR_SIZE, VK_METADATA_SIZE,
};
use crate::error::UltraHonkError;

// Re-export scalar field type
pub use crate::bn254::Fr;

/// G1 proof point with split coordinates (from bb.js proof format)
/// Each coordinate is split into low/high 136-bit parts
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct G1ProofPoint {
    pub x_0: [u8; 32], // x low bits
    pub x_1: [u8; 32], // x high bits
    pub y_0: [u8; 32], // y low bits
    pub y_1: [u8; 32], // y high bits
}

impl G1ProofPoint {
    /// Parse from 128-byte proof format
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < G1_PROOF_POINT_SIZE {
            return Err(UltraHonkError::InvalidG1Point);
        }

        let mut x_0 = [0u8; 32];
        let mut x_1 = [0u8; 32];
        let mut y_0 = [0u8; 32];
        let mut y_1 = [0u8; 32];

        x_0.copy_from_slice(&bytes[0..32]);
        x_1.copy_from_slice(&bytes[32..64]);
        y_0.copy_from_slice(&bytes[64..96]);
        y_1.copy_from_slice(&bytes[96..128]);

        Ok(Self { x_0, x_1, y_0, y_1 })
    }

    /// Convert to affine G1Point (combines split coordinates)
    pub fn to_affine(&self) -> Result<G1Point, UltraHonkError> {
        // Reassemble: x = x_1 * 2^136 + x_0, y = y_1 * 2^136 + y_0
        // BN254 Fq coordinates are 254 bits.
        // x_0 holds the low 136 bits (17 bytes), right-aligned in 32-byte BE field.
        // x_1 holds the high 118 bits (15 bytes), right-aligned in 32-byte BE field.
        //
        // In big-endian 32-byte result:
        //   point[0..15]  = x_1[17..32]  (high 15 bytes = 118 bits)
        //   point[15..32] = x_0[15..32]  (low 17 bytes = 136 bits)
        let mut point = [0u8; G1_AFFINE_SIZE];

        if self.is_identity() {
            return Ok(G1Point::identity());
        }

        // Combine x coordinate
        point[0..15].copy_from_slice(&self.x_1[17..32]);
        point[15..32].copy_from_slice(&self.x_0[15..32]);

        // Combine y coordinate
        point[32..47].copy_from_slice(&self.y_1[17..32]);
        point[47..64].copy_from_slice(&self.y_0[15..32]);

        Ok(G1Point::from_bytes(&point)?)
    }

    /// Check if point is identity (all zeros)
    pub fn is_identity(&self) -> bool {
        self.x_0.iter().all(|&b| b == 0) &&
        self.x_1.iter().all(|&b| b == 0) &&
        self.y_0.iter().all(|&b| b == 0) &&
        self.y_1.iter().all(|&b| b == 0)
    }
}

/// Full UltraHonk proof structure
///
/// Contains all elements needed for verification.
/// Uses Vec for large arrays to avoid stack overflow on Solana (4KB limit).
#[derive(Clone, Debug)]
pub struct UltraHonkProof {
    /// Log of circuit size
    pub circuit_size_log: u8,

    // Wire commitments
    pub w1: G1ProofPoint,
    pub w2: G1ProofPoint,
    pub w3: G1ProofPoint,
    pub w4: G1ProofPoint,

    // Lookup helpers
    pub lookup_read_counts: G1ProofPoint,
    pub lookup_read_tags: G1ProofPoint,
    pub lookup_inverses: G1ProofPoint,

    // Permutation
    pub z_perm: G1ProofPoint,

    // Sumcheck univariates: log_n rounds × 8 scalars per round (raw bytes, lazy Fr conversion)
    pub sumcheck_univariates: Vec<[[u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH]>,

    // Sumcheck evaluations: NUMBER_OF_ENTITIES polynomial evaluations at challenge point (raw bytes)
    pub sumcheck_evaluations: Vec<[u8; 32]>,

    // Gemini fold commitments: log_n - 1 commitments (heap allocated)
    pub gemini_fold_comms: Vec<G1ProofPoint>,

    // Gemini evaluations: log_n scalars (raw bytes, lazy Fr conversion)
    pub gemini_a_evaluations: Vec<[u8; 32]>,

    // Shplonk Q commitment
    pub shplonk_q: G1ProofPoint,

    // KZG quotient commitment
    pub kzg_quotient: G1ProofPoint,

    // For backwards compatibility with simplified verifier
    pub wire_commitment: G1Point,
}

impl Default for UltraHonkProof {
    fn default() -> Self {
        Self {
            circuit_size_log: 0,
            w1: G1ProofPoint::default(),
            w2: G1ProofPoint::default(),
            w3: G1ProofPoint::default(),
            w4: G1ProofPoint::default(),
            lookup_read_counts: G1ProofPoint::default(),
            lookup_read_tags: G1ProofPoint::default(),
            lookup_inverses: G1ProofPoint::default(),
            z_perm: G1ProofPoint::default(),
            sumcheck_univariates: Vec::new(),
            sumcheck_evaluations: Vec::new(),
            gemini_fold_comms: Vec::new(),
            gemini_a_evaluations: Vec::new(),
            shplonk_q: G1ProofPoint::default(),
            kzg_quotient: G1ProofPoint::default(),
            wire_commitment: G1Point::default(),
        }
    }
}

impl UltraHonkProof {
    /// Parse full proof from bytes
    ///
    /// Supports TWO formats:
    ///
    /// 1. bb.js format (no circuit_size_log prefix):
    ///    - Starts directly with G1 proof points (128 bytes each)
    ///    - circuit_size_log must be provided externally (from VK)
    ///
    /// 2. Legacy format (1-byte circuit_size_log prefix):
    ///    - First byte is circuit_size_log
    ///    - Then G1 proof points
    ///
    /// Detection: bb.js proofs are typically > 10KB and don't start with a valid log value
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < 1 {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        // Detect bb.js format: proof > 10KB and first byte is 0 (not a valid circuit_size_log)
        // bb.js proofs don't include circuit_size_log - they start with G1 points
        if bytes.len() > 10000 && bytes[0] == 0 {
            // bb.js format - need to infer circuit_size_log from proof size
            // For a typical claim circuit with log_n=15:
            // Expected size = 8*128 (G1s) + 15*8*32 (sumcheck) + 40*32 (evals)
            //                + 14*128 (gemini comms) + 15*32 (gemini evals) + 2*128 (final)
            // = 1024 + 3840 + 1280 + 1792 + 480 + 256 = 8672 bytes
            // But bb.js proofs are ~16KB which suggests different format
            //
            // For now, assume log_n = 15 for bb.js proofs
            return Self::from_bytes_bbjs(bytes, 15);
        }

        // Legacy format with circuit_size_log prefix
        let circuit_size_log = bytes[0];
        let log_n = circuit_size_log as usize;

        if log_n > MAX_LOG_CIRCUIT_SIZE {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        let mut offset = 1;

        // Parse wire commitments
        let w1 = parse_g1_proof_point(bytes, &mut offset)?;
        let w2 = parse_g1_proof_point(bytes, &mut offset)?;
        let w3 = parse_g1_proof_point(bytes, &mut offset)?;
        let w4 = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse lookup helpers
        let lookup_read_counts = parse_g1_proof_point(bytes, &mut offset)?;
        let lookup_read_tags = parse_g1_proof_point(bytes, &mut offset)?;
        let lookup_inverses = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse z_perm
        let z_perm = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse sumcheck univariates: log_n rounds × 8 scalars (raw bytes, lazy Fr)
        let mut sumcheck_univariates = Vec::with_capacity(log_n);
        for _round in 0..log_n {
            let mut round_univariates = [[0u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH];
            for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
                round_univariates[i] = parse_fr_raw(bytes, &mut offset)?;
            }
            sumcheck_univariates.push(round_univariates);
        }

        // Parse sumcheck evaluations: 40 scalars (raw bytes)
        let mut sumcheck_evaluations = Vec::with_capacity(NUMBER_OF_ENTITIES);
        for _i in 0..NUMBER_OF_ENTITIES {
            sumcheck_evaluations.push(parse_fr_raw(bytes, &mut offset)?);
        }

        // Parse gemini fold commitments: log_n - 1 points (heap allocated)
        let mut gemini_fold_comms = Vec::with_capacity(log_n.saturating_sub(1));
        for _i in 0..(log_n.saturating_sub(1)) {
            gemini_fold_comms.push(parse_g1_proof_point(bytes, &mut offset)?);
        }

        // Parse gemini evaluations: log_n scalars (raw bytes)
        let mut gemini_a_evaluations = Vec::with_capacity(log_n);
        for _i in 0..log_n {
            gemini_a_evaluations.push(parse_fr_raw(bytes, &mut offset)?);
        }

        // Parse shplonk_q
        let shplonk_q = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse kzg_quotient
        let kzg_quotient = parse_g1_proof_point(bytes, &mut offset)?;

        // Convert w1 to affine for backwards compatibility
        let wire_commitment = w1.to_affine().unwrap_or_default();

        Ok(Self {
            circuit_size_log,
            w1,
            w2,
            w3,
            w4,
            lookup_read_counts,
            lookup_read_tags,
            lookup_inverses,
            z_perm,
            sumcheck_univariates,
            sumcheck_evaluations,
            gemini_fold_comms,
            gemini_a_evaluations,
            shplonk_q,
            kzg_quotient,
            wire_commitment,
        })
    }

    /// Parse proof from bb.js format (inline helper to reduce stack usage)
    #[inline(never)]
    fn from_bytes_bbjs(bytes: &[u8], circuit_size_log: u8) -> Result<Self, UltraHonkError> {
        Self::from_bytes_bbjs_impl(bytes, circuit_size_log)
    }

    /// Inner implementation split to reduce stack frame size
    fn from_bytes_bbjs_impl(bytes: &[u8], circuit_size_log: u8) -> Result<Self, UltraHonkError> {
        let log_n = circuit_size_log as usize;
        let mut offset = 0;

        // Parse wire commitments (8 G1 points in 128-byte split format)
        let w1 = parse_g1_proof_point(bytes, &mut offset)?;
        let w2 = parse_g1_proof_point(bytes, &mut offset)?;
        let w3 = parse_g1_proof_point(bytes, &mut offset)?;
        let w4 = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse lookup helpers
        let lookup_read_counts = parse_g1_proof_point(bytes, &mut offset)?;
        let lookup_read_tags = parse_g1_proof_point(bytes, &mut offset)?;
        let lookup_inverses = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse z_perm
        let z_perm = parse_g1_proof_point(bytes, &mut offset)?;

        // Parse sumcheck univariates and evaluations using helper
        let (sumcheck_univariates, sumcheck_evaluations) =
            Self::parse_sumcheck_data(bytes, &mut offset, log_n)?;

        // Parse gemini data
        let (gemini_fold_comms, gemini_a_evaluations) =
            Self::parse_gemini_data(bytes, &mut offset, log_n)?;

        // Parse final commitments
        let shplonk_q = parse_g1_proof_point(bytes, &mut offset)?;
        let kzg_quotient = parse_g1_proof_point(bytes, &mut offset)?;

        // Convert w1 to affine for backwards compatibility
        let wire_commitment = w1.to_affine().unwrap_or_default();

        Ok(Self {
            circuit_size_log,
            w1, w2, w3, w4,
            lookup_read_counts, lookup_read_tags, lookup_inverses,
            z_perm,
            sumcheck_univariates,
            sumcheck_evaluations,
            gemini_fold_comms,
            gemini_a_evaluations,
            shplonk_q,
            kzg_quotient,
            wire_commitment,
        })
    }

    /// Parse sumcheck data (split to reduce stack usage)
    #[inline(never)]
    fn parse_sumcheck_data(
        bytes: &[u8],
        offset: &mut usize,
        log_n: usize,
    ) -> Result<(Vec<[[u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH]>, Vec<[u8; 32]>), UltraHonkError> {
        // Parse sumcheck univariates: log_n rounds × 8 scalars (raw bytes)
        let mut sumcheck_univariates = Vec::with_capacity(log_n);
        for _round in 0..log_n {
            let mut round_univariates = [[0u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH];
            for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
                round_univariates[i] = parse_fr_raw(bytes, offset)?;
            }
            sumcheck_univariates.push(round_univariates);
        }

        // Parse sumcheck evaluations: NUMBER_OF_ENTITIES scalars (raw bytes)
        let mut sumcheck_evaluations = Vec::with_capacity(NUMBER_OF_ENTITIES);
        for _i in 0..NUMBER_OF_ENTITIES {
            sumcheck_evaluations.push(parse_fr_raw(bytes, offset)?);
        }

        Ok((sumcheck_univariates, sumcheck_evaluations))
    }

    /// Parse gemini data (split to reduce stack usage)
    #[inline(never)]
    fn parse_gemini_data(
        bytes: &[u8],
        offset: &mut usize,
        log_n: usize,
    ) -> Result<(Vec<G1ProofPoint>, Vec<[u8; 32]>), UltraHonkError> {
        // Parse gemini fold commitments: log_n - 1 points
        let mut gemini_fold_comms = Vec::with_capacity(log_n.saturating_sub(1));
        for _i in 0..(log_n.saturating_sub(1)) {
            gemini_fold_comms.push(parse_g1_proof_point(bytes, offset)?);
        }

        // Parse gemini evaluations: log_n scalars (raw bytes)
        let mut gemini_a_evaluations = Vec::with_capacity(log_n);
        for _i in 0..log_n {
            gemini_a_evaluations.push(parse_fr_raw(bytes, offset)?);
        }

        Ok((gemini_fold_comms, gemini_a_evaluations))
    }

    /// Parse proof from bytes, returning boxed to avoid stack overflow on Solana (4KB limit)
    pub fn from_bytes_boxed(bytes: &[u8]) -> Result<Box<Self>, UltraHonkError> {
        Ok(Box::new(Self::from_bytes(bytes)?))
    }
}

/// Full UltraHonk verification key
///
/// Contains 27 active G1 commitment points for verification (entities 0-26)
/// plus q_nnf which exists in bb.js VK file but is not a sumcheck entity.
#[derive(Clone, Debug)]
pub struct VerificationKey {
    /// Circuit size (power of 2)
    pub circuit_size: u64,
    /// Log of circuit size
    pub circuit_size_log: u8,
    /// Number of public inputs
    pub num_public_inputs: u32,
    /// Public inputs offset
    pub pub_inputs_offset: u64,

    // Selector polynomial commitments (14) — matches WIRE enum 0-13
    pub q_m: G1Point,              // 0: Q_M
    pub q_c: G1Point,              // 1: Q_C
    pub q_l: G1Point,              // 2: Q_L
    pub q_r: G1Point,              // 3: Q_R
    pub q_o: G1Point,              // 4: Q_O
    pub q_4: G1Point,              // 5: Q_4
    pub q_lookup: G1Point,         // 6: Q_LOOKUP
    pub q_arith: G1Point,          // 7: Q_ARITH
    pub q_deltarange: G1Point,     // 8: Q_RANGE
    pub q_elliptic: G1Point,       // 9: Q_ELLIPTIC
    pub q_aux: G1Point,            // 10: Q_MEMORY (aka Q_AUX)
    pub q_nnf: G1Point,            // 11: Q_NNF (Non-Native Field)
    pub q_poseidon2external: G1Point, // 12: Q_POSEIDON2_EXTERNAL
    pub q_poseidon2internal: G1Point, // 13: Q_POSEIDON2_INTERNAL

    // Copy constraint commitments (4)
    pub s_1: G1Point,
    pub s_2: G1Point,
    pub s_3: G1Point,
    pub s_4: G1Point,

    // Identity permutation commitments (4)
    pub id_1: G1Point,
    pub id_2: G1Point,
    pub id_3: G1Point,
    pub id_4: G1Point,

    // Lookup table commitments (4)
    pub t_1: G1Point,
    pub t_2: G1Point,
    pub t_3: G1Point,
    pub t_4: G1Point,

    // Lagrange basis commitments (2)
    pub lagrange_first: G1Point,
    pub lagrange_last: G1Point,

    // SRS G2 element for pairing (for backwards compatibility)
    pub g2_x: G2Point,
}

impl Default for VerificationKey {
    fn default() -> Self {
        Self {
            circuit_size: 0,
            circuit_size_log: 0,
            num_public_inputs: 0,
            pub_inputs_offset: 0,
            q_m: G1Point::default(),
            q_c: G1Point::default(),
            q_l: G1Point::default(),
            q_r: G1Point::default(),
            q_o: G1Point::default(),
            q_4: G1Point::default(),
            q_lookup: G1Point::default(),
            q_arith: G1Point::default(),
            q_deltarange: G1Point::default(),
            q_elliptic: G1Point::default(),
            q_aux: G1Point::default(),
            q_nnf: G1Point::default(),
            q_poseidon2external: G1Point::default(),
            q_poseidon2internal: G1Point::default(),
            s_1: G1Point::default(),
            s_2: G1Point::default(),
            s_3: G1Point::default(),
            s_4: G1Point::default(),
            id_1: G1Point::default(),
            id_2: G1Point::default(),
            id_3: G1Point::default(),
            id_4: G1Point::default(),
            t_1: G1Point::default(),
            t_2: G1Point::default(),
            t_3: G1Point::default(),
            t_4: G1Point::default(),
            lagrange_first: G1Point::default(),
            lagrange_last: G1Point::default(),
            g2_x: G2Point::default(),
        }
    }
}

impl VerificationKey {
    /// Parse verification key from bb.js keccak format (3680 bytes).
    ///
    /// Format:
    /// - 3 header fields (32 bytes each, big-endian, right-aligned):
    ///   - log_circuit_size (byte 31)
    ///   - num_public_inputs (bytes 60-63 as u32 BE)
    ///   - pub_inputs_offset (bytes 88-95 as u64 BE)
    /// - 28 G1 split points (128 bytes each): matches Solidity WIRE entity order
    ///   Each G1: x_0(32) + x_1(32) + y_0(32) + y_1(32) with x = x_0 | (x_1 << 136)
    ///
    /// Total: 96 + 28 × 128 = 3680 bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        // Support both split format (3680) and affine format (1888)
        let use_split = bytes.len() >= VK_METADATA_SIZE + VK_NUM_COMMITMENTS * G1_PROOF_POINT_SIZE;
        let use_affine = bytes.len() >= VK_METADATA_SIZE + VK_NUM_COMMITMENTS * G1_AFFINE_SIZE;

        if !use_split && !use_affine {
            return Err(UltraHonkError::InvalidVerificationKey);
        }

        // Parse 3 × 32-byte big-endian header fields (values right-aligned)
        let circuit_size_log = bytes[31] as u8;
        let circuit_size = 1u64 << circuit_size_log;
        let num_public_inputs = u32::from_be_bytes([bytes[60], bytes[61], bytes[62], bytes[63]]);
        let pub_inputs_offset = u64::from_be_bytes([
            bytes[88], bytes[89], bytes[90], bytes[91],
            bytes[92], bytes[93], bytes[94], bytes[95],
        ]);

        let mut offset = VK_METADATA_SIZE; // 96

        if use_split {
            // bb.js keccak format: 28 G1 split points (128 bytes each) in WIRE enum order
            Self::parse_commitments_split(bytes, &mut offset, circuit_size, circuit_size_log, num_public_inputs, pub_inputs_offset)
        } else {
            // Legacy affine format: 28 G1 affine points (64 bytes each) in WIRE enum order
            Self::parse_commitments_affine(bytes, &mut offset, circuit_size, circuit_size_log, num_public_inputs, pub_inputs_offset)
        }
    }

    /// Parse VK commitments from split-format G1 points (128 bytes each)
    #[inline(never)]
    fn parse_commitments_split(
        bytes: &[u8],
        offset: &mut usize,
        circuit_size: u64,
        circuit_size_log: u8,
        num_public_inputs: u32,
        pub_inputs_offset: u64,
    ) -> Result<Self, UltraHonkError> {
        // Parse in Solidity WIRE entity order (0-27)
        let q_m = parse_g1_split_to_affine(bytes, offset)?;                 // 0: Q_M
        let q_c = parse_g1_split_to_affine(bytes, offset)?;                 // 1: Q_C
        let q_l = parse_g1_split_to_affine(bytes, offset)?;                 // 2: Q_L
        let q_r = parse_g1_split_to_affine(bytes, offset)?;                 // 3: Q_R
        let q_o = parse_g1_split_to_affine(bytes, offset)?;                 // 4: Q_O
        let q_4 = parse_g1_split_to_affine(bytes, offset)?;                 // 5: Q_4
        let q_lookup = parse_g1_split_to_affine(bytes, offset)?;            // 6: Q_LOOKUP
        let q_arith = parse_g1_split_to_affine(bytes, offset)?;             // 7: Q_ARITH
        let q_deltarange = parse_g1_split_to_affine(bytes, offset)?;        // 8: Q_RANGE
        let q_elliptic = parse_g1_split_to_affine(bytes, offset)?;          // 9: Q_ELLIPTIC
        let q_aux = parse_g1_split_to_affine(bytes, offset)?;               // 10: Q_MEMORY (Q_AUX)
        let q_nnf = parse_g1_split_to_affine(bytes, offset)?;               // 11: Q_NNF
        let q_poseidon2external = parse_g1_split_to_affine(bytes, offset)?;  // 12: Q_POSEIDON2_EXT
        let q_poseidon2internal = parse_g1_split_to_affine(bytes, offset)?;  // 13: Q_POSEIDON2_INT
        let s_1 = parse_g1_split_to_affine(bytes, offset)?;                 // 14: SIGMA_1
        let s_2 = parse_g1_split_to_affine(bytes, offset)?;                 // 15: SIGMA_2
        let s_3 = parse_g1_split_to_affine(bytes, offset)?;                 // 16: SIGMA_3
        let s_4 = parse_g1_split_to_affine(bytes, offset)?;                 // 17: SIGMA_4
        let id_1 = parse_g1_split_to_affine(bytes, offset)?;                // 18: ID_1
        let id_2 = parse_g1_split_to_affine(bytes, offset)?;                // 19: ID_2
        let id_3 = parse_g1_split_to_affine(bytes, offset)?;                // 20: ID_3
        let id_4 = parse_g1_split_to_affine(bytes, offset)?;                // 21: ID_4
        let t_1 = parse_g1_split_to_affine(bytes, offset)?;                 // 22: TABLE_1
        let t_2 = parse_g1_split_to_affine(bytes, offset)?;                 // 23: TABLE_2
        let t_3 = parse_g1_split_to_affine(bytes, offset)?;                 // 24: TABLE_3
        let t_4 = parse_g1_split_to_affine(bytes, offset)?;                 // 25: TABLE_4
        let lagrange_first = parse_g1_split_to_affine(bytes, offset)?;      // 26: LAGRANGE_FIRST
        let lagrange_last = parse_g1_split_to_affine(bytes, offset)?;       // 27: LAGRANGE_LAST

        Ok(Self {
            circuit_size, circuit_size_log, num_public_inputs, pub_inputs_offset,
            q_m, q_c, q_l, q_r, q_o, q_4,
            q_lookup, q_arith, q_deltarange, q_elliptic, q_aux,
            q_nnf, q_poseidon2external, q_poseidon2internal,
            s_1, s_2, s_3, s_4, id_1, id_2, id_3, id_4,
            t_1, t_2, t_3, t_4, lagrange_first, lagrange_last,
            g2_x: G2Point::default(),
        })
    }

    /// Parse VK commitments from affine-format G1 points (64 bytes each)
    #[inline(never)]
    fn parse_commitments_affine(
        bytes: &[u8],
        offset: &mut usize,
        circuit_size: u64,
        circuit_size_log: u8,
        num_public_inputs: u32,
        pub_inputs_offset: u64,
    ) -> Result<Self, UltraHonkError> {
        // Parse in Solidity WIRE entity order (0-27)
        let q_m = parse_g1_affine(bytes, offset)?;                 // 0: Q_M
        let q_c = parse_g1_affine(bytes, offset)?;                 // 1: Q_C
        let q_l = parse_g1_affine(bytes, offset)?;                 // 2: Q_L
        let q_r = parse_g1_affine(bytes, offset)?;                 // 3: Q_R
        let q_o = parse_g1_affine(bytes, offset)?;                 // 4: Q_O
        let q_4 = parse_g1_affine(bytes, offset)?;                 // 5: Q_4
        let q_lookup = parse_g1_affine(bytes, offset)?;            // 6: Q_LOOKUP
        let q_arith = parse_g1_affine(bytes, offset)?;             // 7: Q_ARITH
        let q_deltarange = parse_g1_affine(bytes, offset)?;        // 8: Q_RANGE
        let q_elliptic = parse_g1_affine(bytes, offset)?;          // 9: Q_ELLIPTIC
        let q_aux = parse_g1_affine(bytes, offset)?;               // 10: Q_MEMORY (Q_AUX)
        let q_nnf = parse_g1_affine(bytes, offset)?;               // 11: Q_NNF
        let q_poseidon2external = parse_g1_affine(bytes, offset)?;  // 12: Q_POSEIDON2_EXT
        let q_poseidon2internal = parse_g1_affine(bytes, offset)?;  // 13: Q_POSEIDON2_INT
        let s_1 = parse_g1_affine(bytes, offset)?;                 // 14: SIGMA_1
        let s_2 = parse_g1_affine(bytes, offset)?;                 // 15: SIGMA_2
        let s_3 = parse_g1_affine(bytes, offset)?;                 // 16: SIGMA_3
        let s_4 = parse_g1_affine(bytes, offset)?;                 // 17: SIGMA_4
        let id_1 = parse_g1_affine(bytes, offset)?;                // 18: ID_1
        let id_2 = parse_g1_affine(bytes, offset)?;                // 19: ID_2
        let id_3 = parse_g1_affine(bytes, offset)?;                // 20: ID_3
        let id_4 = parse_g1_affine(bytes, offset)?;                // 21: ID_4
        let t_1 = parse_g1_affine(bytes, offset)?;                 // 22: TABLE_1
        let t_2 = parse_g1_affine(bytes, offset)?;                 // 23: TABLE_2
        let t_3 = parse_g1_affine(bytes, offset)?;                 // 24: TABLE_3
        let t_4 = parse_g1_affine(bytes, offset)?;                 // 25: TABLE_4
        let lagrange_first = parse_g1_affine(bytes, offset)?;      // 26: LAGRANGE_FIRST
        let lagrange_last = parse_g1_affine(bytes, offset)?;       // 27: LAGRANGE_LAST

        Ok(Self {
            circuit_size, circuit_size_log, num_public_inputs, pub_inputs_offset,
            q_m, q_c, q_l, q_r, q_o, q_4,
            q_lookup, q_arith, q_deltarange, q_elliptic, q_aux,
            q_nnf, q_poseidon2external, q_poseidon2internal,
            s_1, s_2, s_3, s_4, id_1, id_2, id_3, id_4,
            t_1, t_2, t_3, t_4, lagrange_first, lagrange_last,
            g2_x: G2Point::default(),
        })
    }

    /// Default G2 x-coordinate for pairing (BN254 SRS)
    pub fn default_g2_x() -> G2Point {
        G2Point(crate::constants::SRS_G2_X)
    }

    /// Get all VK commitments as an array (for MSM).
    /// Ordered by Solidity WIRE enum (entities 0-27):
    ///   0-13: 14 selectors (q_m..q_poseidon2internal, INCLUDING q_nnf at 11)
    ///   14-17: sigma_1-4
    ///   18-21: id_1-4
    ///   22-25: table_1-4
    ///   26-27: lagrange_first, lagrange_last
    /// Get all VK commitments ordered by Solidity WIRE enum (entities 0-27).
    ///
    /// NOTE: VK bytes from bb.js use C++ member order which differs from the WIRE enum.
    /// This method reorders to match the WIRE enum so scalars[i] = rho^i * factor
    /// correctly pairs with the right commitment.
    ///
    /// WIRE enum order for selectors:
    ///   0-5:  Q_M, Q_C, Q_L, Q_R, Q_O, Q_4
    ///   6-13: Q_LOOKUP, Q_ARITH, Q_RANGE, Q_ELLIPTIC, Q_MEMORY, Q_NNF, Q_POS2_EXT, Q_POS2_INT
    pub fn commitments(&self) -> [G1Point; VK_NUM_COMMITMENTS] {
        [
            self.q_m,                   // 0: Q_M
            self.q_c,                   // 1: Q_C
            self.q_l,                   // 2: Q_L
            self.q_r,                   // 3: Q_R
            self.q_o,                   // 4: Q_O
            self.q_4,                   // 5: Q_4
            self.q_lookup,              // 6: Q_LOOKUP
            self.q_arith,               // 7: Q_ARITH
            self.q_deltarange,          // 8: Q_RANGE (aka Q_DELTA_RANGE)
            self.q_elliptic,            // 9: Q_ELLIPTIC
            self.q_aux,                 // 10: Q_MEMORY (aka Q_AUX)
            self.q_nnf,                 // 11: Q_NNF
            self.q_poseidon2external,   // 12: Q_POSEIDON2_EXTERNAL
            self.q_poseidon2internal,   // 13: Q_POSEIDON2_INTERNAL
            self.s_1,                   // 14: SIGMA_1
            self.s_2,                   // 15: SIGMA_2
            self.s_3,                   // 16: SIGMA_3
            self.s_4,                   // 17: SIGMA_4
            self.id_1,                  // 18: ID_1
            self.id_2,                  // 19: ID_2
            self.id_3,                  // 20: ID_3
            self.id_4,                  // 21: ID_4
            self.t_1,                   // 22: TABLE_1
            self.t_2,                   // 23: TABLE_2
            self.t_3,                   // 24: TABLE_3
            self.t_4,                   // 25: TABLE_4
            self.lagrange_first,        // 26: LAGRANGE_FIRST
            self.lagrange_last,         // 27: LAGRANGE_LAST
        ]
    }

    /// Minimum VK size in bytes (96-byte header + 28 × 64-byte affine G1)
    pub const MIN_SIZE: usize = VK_METADATA_SIZE + VK_NUM_COMMITMENTS * G1_AFFINE_SIZE;

    /// Create a boxed verification key with specified parameters
    /// Allocates directly on heap to avoid stack overflow
    pub fn boxed_with_params(circuit_size_log: u8, num_public_inputs: u32) -> Box<Self> {
        let mut vk = Box::new(Self::default());
        vk.circuit_size_log = circuit_size_log;
        vk.circuit_size = 1u64 << circuit_size_log;
        vk.num_public_inputs = num_public_inputs;
        vk.g2_x = Self::default_g2_x();
        vk
    }

    /// Parse verification key from bytes, returning boxed to avoid stack overflow
    pub fn from_bytes_boxed(bytes: &[u8]) -> Result<Box<Self>, UltraHonkError> {
        Ok(Box::new(Self::from_bytes(bytes)?))
    }
}

// ============================================================================
// Parsing helpers
// ============================================================================

/// Parse G1 proof point (128 bytes, split coordinates)
fn parse_g1_proof_point(bytes: &[u8], offset: &mut usize) -> Result<G1ProofPoint, UltraHonkError> {
    if *offset + G1_PROOF_POINT_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    let point = G1ProofPoint::from_bytes(&bytes[*offset..*offset + G1_PROOF_POINT_SIZE])?;
    *offset += G1_PROOF_POINT_SIZE;
    Ok(point)
}

/// Parse G1 split-format point (128 bytes) and convert to affine G1Point (64 bytes)
fn parse_g1_split_to_affine(bytes: &[u8], offset: &mut usize) -> Result<G1Point, UltraHonkError> {
    if *offset + G1_PROOF_POINT_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidVerificationKey);
    }

    let proof_point = G1ProofPoint::from_bytes(&bytes[*offset..*offset + G1_PROOF_POINT_SIZE])?;
    *offset += G1_PROOF_POINT_SIZE;
    proof_point.to_affine()
}

/// Parse G1 affine point (64 bytes)
fn parse_g1_affine(bytes: &[u8], offset: &mut usize) -> Result<G1Point, UltraHonkError> {
    if *offset + G1_AFFINE_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidVerificationKey);
    }

    let point = G1Point::from_bytes(&bytes[*offset..*offset + G1_AFFINE_SIZE])?;
    *offset += G1_AFFINE_SIZE;
    Ok(point)
}

/// Parse field element as raw bytes (no Montgomery conversion).
/// Used for lazy parsing: field elements are kept as raw bytes and only
/// converted to Montgomery form when arithmetic is needed.
/// Saves ~900 CU per element during parse + ~900 CU during transcript absorb.
#[inline]
fn parse_fr_raw(bytes: &[u8], offset: &mut usize) -> Result<[u8; 32], UltraHonkError> {
    if *offset + FR_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    let mut raw = [0u8; 32];
    raw.copy_from_slice(&bytes[*offset..*offset + FR_SIZE]);
    *offset += FR_SIZE;
    Ok(raw)
}

// ============================================================================
// Zero-copy proof view
// ============================================================================

/// Zero-copy proof view — ~72 bytes on stack, no heap allocation.
///
/// Stores a reference to the raw proof bytes plus precomputed section offsets.
/// All accessor methods return slices directly into the buffer.
///
/// Byte layout for keccak non-ZK format (actual logN, no padding):
/// ```text
/// [0..256):          8 × 32 = 256 bytes    — aggregation object preamble (2 G1 × 4 limbs)
/// [256..768):        8 × 64 = 512 bytes    — 8 G1 affine witness commitments
/// [1024..1024+L*8*32):  logN×8×32 bytes   — sumcheck univariates
/// [.....+41*32):     41 × 32 bytes          — sumcheck evaluations
/// [.....+(L-1)*64):  (logN-1)×64 bytes     — gemini fold commitments (G1 affine)
/// [.....+L*32):      logN × 32 bytes        — gemini evaluations
/// [.....+64):        64 bytes               — shplonk_Q (G1 affine)
/// [.....+64):        64 bytes               — kzg_quotient (G1 affine)
/// ```
pub struct ProofSlice<'a> {
    data: &'a [u8],
    pub circuit_size_log: u8,
    // Precomputed byte offsets
    #[allow(dead_code)]
    preamble_end: usize,
    witness_start: usize,
    sumcheck_univ_start: usize,
    sumcheck_eval_start: usize,
    gemini_comms_start: usize,
    gemini_evals_start: usize,
    shplonk_q_start: usize,
    kzg_quotient_start: usize,
}

impl<'a> ProofSlice<'a> {
    /// Construct from keccak non-ZK proof bytes.
    ///
    /// `circuit_size_log`: from VK (actual logN, used for section sizes)
    pub fn new(bytes: &'a [u8], circuit_size_log: u8) -> Result<Self, UltraHonkError> {
        let log_n = circuit_size_log as usize;
        if log_n == 0 || log_n > MAX_LOG_CIRCUIT_SIZE {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        // Fixed preamble: aggregation object = 16 Fr = 512 bytes
        let preamble_size = PAIRING_POINTS_SIZE * SCALAR_SIZE;
        let witness_start = preamble_size;
        // 8 G1 affine witness commitments
        let sumcheck_univ_start = witness_start + NUM_WITNESS_COMMITMENTS * G1_AFFINE_SIZE;
        // logN rounds × 8 scalars × 32 bytes
        let sumcheck_eval_start = sumcheck_univ_start + log_n * BATCHED_RELATION_PARTIAL_LENGTH * FR_SIZE;
        // 41 entity evaluations
        let gemini_comms_start = sumcheck_eval_start + NUMBER_OF_ENTITIES * FR_SIZE;
        // (logN - 1) G1 affine gemini fold commitments
        let gemini_evals_start = gemini_comms_start + (log_n - 1) * G1_AFFINE_SIZE;
        // logN gemini evaluations
        let shplonk_q_start = gemini_evals_start + log_n * FR_SIZE;
        let kzg_quotient_start = shplonk_q_start + G1_AFFINE_SIZE;
        let expected_len = kzg_quotient_start + G1_AFFINE_SIZE;

        if bytes.len() < expected_len {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        Ok(Self {
            data: bytes,
            circuit_size_log,
            preamble_end: preamble_size,
            witness_start,
            sumcheck_univ_start,
            sumcheck_eval_start,
            gemini_comms_start,
            gemini_evals_start,
            shplonk_q_start,
            kzg_quotient_start,
        })
    }

    /// Get the i-th preamble Fr element as a 32-byte slice (i in 0..PAIRING_POINTS_SIZE).
    #[inline]
    pub fn preamble_fr_bytes(&self, index: usize) -> &'a [u8] {
        let start = index * SCALAR_SIZE;
        &self.data[start..start + SCALAR_SIZE]
    }

    /// Get the i-th witness G1 point as a 64-byte affine slice (i in 0..8).
    #[inline]
    pub fn g1_point_bytes(&self, index: usize) -> &'a [u8] {
        let start = self.witness_start + index * G1_AFFINE_SIZE;
        &self.data[start..start + G1_AFFINE_SIZE]
    }

    /// Get sumcheck univariate scalar (round, i) as a 32-byte slice.
    #[inline]
    pub fn sumcheck_univariate_bytes(&self, round: usize, i: usize) -> &'a [u8] {
        let start = self.sumcheck_univ_start
            + round * BATCHED_RELATION_PARTIAL_LENGTH * FR_SIZE
            + i * FR_SIZE;
        &self.data[start..start + FR_SIZE]
    }

    /// Get sumcheck evaluation i as a 32-byte slice.
    #[inline]
    pub fn sumcheck_evaluation_bytes(&self, i: usize) -> &'a [u8] {
        let start = self.sumcheck_eval_start + i * FR_SIZE;
        &self.data[start..start + FR_SIZE]
    }

    /// Get gemini fold commitment i as a 64-byte affine slice.
    #[inline]
    pub fn gemini_fold_comm_bytes(&self, i: usize) -> &'a [u8] {
        let start = self.gemini_comms_start + i * G1_AFFINE_SIZE;
        &self.data[start..start + G1_AFFINE_SIZE]
    }

    /// Get gemini a-evaluation i as a 32-byte slice.
    #[inline]
    pub fn gemini_a_evaluation_bytes(&self, i: usize) -> &'a [u8] {
        let start = self.gemini_evals_start + i * FR_SIZE;
        &self.data[start..start + FR_SIZE]
    }

    /// Get shplonk_q as a 64-byte affine slice.
    #[inline]
    pub fn shplonk_q_bytes(&self) -> &'a [u8] {
        &self.data[self.shplonk_q_start..self.shplonk_q_start + G1_AFFINE_SIZE]
    }

    /// Get kzg_quotient as a 64-byte affine slice.
    #[inline]
    pub fn kzg_quotient_bytes(&self) -> &'a [u8] {
        &self.data[self.kzg_quotient_start..self.kzg_quotient_start + G1_AFFINE_SIZE]
    }

    /// Parse shplonk_q to G1Point on demand.
    pub fn shplonk_q_point(&self) -> Result<G1Point, UltraHonkError> {
        G1Point::from_bytes(self.shplonk_q_bytes())
    }

    /// Parse kzg_quotient to G1Point on demand.
    pub fn kzg_quotient_point(&self) -> Result<G1Point, UltraHonkError> {
        G1Point::from_bytes(self.kzg_quotient_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_default() {
        let proof = UltraHonkProof::default();
        assert_eq!(proof.circuit_size_log, 0);
    }

    #[test]
    fn test_vk_default() {
        let vk = VerificationKey::default();
        assert_eq!(vk.circuit_size_log, 0);
        assert_eq!(vk.num_public_inputs, 0);
    }

    #[test]
    fn test_g1_proof_point_identity() {
        let point = G1ProofPoint::default();
        assert!(point.is_identity());
    }

    #[test]
    fn test_vk_min_size() {
        // VK should be at least 96 + 28*64 = 1888 bytes
        assert_eq!(VerificationKey::MIN_SIZE, 1888);
    }

    #[test]
    fn test_vk_commitments_count() {
        let vk = VerificationKey::default();
        assert_eq!(vk.commitments().len(), 28);
    }

    #[test]
    fn test_proof_slice_construction() {
        // Build a keccak non-ZK proof for log_n=2
        // Layout: preamble(512) + 8*64 witness + 2*8*32 univ + 41*32 eval
        //         + 1*64 gemini fold + 2*32 gemini eval + 64 shplonk_q + 64 kzg_quotient
        let log_n: usize = 2;
        let total = 16 * 32                              // preamble (PAIRING_POINTS_SIZE=16)
            + 8 * 64                                     // witness
            + log_n * 8 * 32                             // sumcheck univ
            + 41 * 32                                    // sumcheck eval
            + (log_n - 1) * 64                           // gemini fold
            + log_n * 32                                 // gemini eval
            + 64                                         // shplonk_q
            + 64;                                        // kzg_quotient
        let buf = vec![0u8; total];

        let ps = ProofSlice::new(&buf, 2).unwrap();
        assert_eq!(ps.circuit_size_log, 2);
    }

    #[test]
    fn test_proof_slice_accessors() {
        // Build keccak non-ZK proof for log_n=2 with marker bytes
        // Preamble = 16*32 = 512, witness = 8*64 = 512
        let log_n: usize = 2;
        let preamble = 16 * 32;       // 512
        let witness = 8 * 64;         // 512
        let univ = log_n * 8 * 32;    // 512
        let evals = 41 * 32;          // 1312
        let fold = (log_n - 1) * 64;  // 64
        let ge = log_n * 32;          // 64
        let sq = 64;
        let kq = 64;
        let total = preamble + witness + univ + evals + fold + ge + sq + kq;
        let mut buf = vec![0u8; total];

        // g1[0] at preamble_end (512)
        buf[512] = 0xAA;
        // sumcheck univariate (round 0, scalar 0) at 512 + 512 = 1024
        buf[1024] = 0xBB;
        // sumcheck eval 0 at 1024 + 512 = 1536
        buf[1536] = 0xCC;
        // gemini fold 0 at 1536 + 1312 = 2848
        buf[2848] = 0xDD;
        // gemini eval 0 at 2848 + 64 = 2912
        buf[2912] = 0xEE;
        // shplonk_q at 2912 + 64 = 2976
        buf[2976] = 0xF1;
        // kzg_quotient at 2976 + 64 = 3040
        buf[3040] = 0xF2;

        let ps = ProofSlice::new(&buf, 2).unwrap();

        assert_eq!(ps.g1_point_bytes(0)[0], 0xAA);
        assert_eq!(ps.sumcheck_univariate_bytes(0, 0)[0], 0xBB);
        assert_eq!(ps.sumcheck_evaluation_bytes(0)[0], 0xCC);
        assert_eq!(ps.gemini_fold_comm_bytes(0)[0], 0xDD);
        assert_eq!(ps.gemini_a_evaluation_bytes(0)[0], 0xEE);
        assert_eq!(ps.shplonk_q_bytes()[0], 0xF1);
        assert_eq!(ps.kzg_quotient_bytes()[0], 0xF2);
    }

    #[test]
    fn test_proof_slice_log15_size() {
        // Verify the expected size for log_n=15 (our claim circuit)
        // bb.js keccak non-ZK: preamble(16*32) + witness(8*64) + sumcheck + gemini + final G1
        // Calculated by working backwards from proof end: 7680 bytes
        let log_n: usize = 15;
        let expected = 16 * 32 + 8 * 64 + log_n * 8 * 32 + 41 * 32
            + (log_n - 1) * 64 + log_n * 32 + 64 + 64;
        assert_eq!(expected, 7680);
        let buf = vec![0u8; expected];
        let ps = ProofSlice::new(&buf, 15).unwrap();
        assert_eq!(ps.circuit_size_log, 15);
    }

    #[test]
    fn test_proof_slice_too_small() {
        let buf = vec![0u8; 10];
        assert!(ProofSlice::new(&buf, 15).is_err());
    }
}
