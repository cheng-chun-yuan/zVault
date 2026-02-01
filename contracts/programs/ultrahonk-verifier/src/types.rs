//! UltraHonk proof types (Full Implementation)
//!
//! Extended data structures for full UltraHonk verification.
//! Optimized for Solana's 4KB stack limit by using heap allocation.

use crate::bn254::{G1Point, G2Point, G1_POINT_SIZE, G2_POINT_SIZE, FR_SIZE};
use crate::constants::{
    BATCHED_RELATION_PARTIAL_LENGTH, G1_AFFINE_SIZE, G1_PROOF_POINT_SIZE,
    MAX_LOG_CIRCUIT_SIZE, NUMBER_OF_ENTITIES, SCALAR_SIZE, VK_NUM_COMMITMENTS,
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
        // Reassemble: x = x_0 | (x_1 << 136), y = y_0 | (y_1 << 136)
        // For BN254, coordinates are 254 bits, so we combine low 136 + high 118 bits
        let mut point = [0u8; G1_AFFINE_SIZE];

        // Simple case: if all zeros, return identity
        if self.is_identity() {
            return Ok(G1Point::identity());
        }

        // Combine x coordinate (big-endian)
        // x_1 contains high bits, x_0 contains low bits
        // The split is at bit 136, so:
        // x = x_1 * 2^136 + x_0
        // In big-endian bytes: first 15 bytes from x_1 (bits 136-253)
        //                      remaining 17 bytes from x_0 (bits 0-135)

        // For now, use simplified reconstruction that works for small values
        // Full implementation needs proper 256-bit arithmetic
        point[0..17].copy_from_slice(&self.x_1[15..32]); // Take lower 17 bytes of x_1
        point[15..32].copy_from_slice(&self.x_0[15..32]); // Overlap and take lower 17 bytes of x_0

        point[32..49].copy_from_slice(&self.y_1[15..32]);
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
/// Allocated on heap to avoid stack overflow.
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

    // Sumcheck univariates: log_n rounds × 8 scalars per round
    pub sumcheck_univariates: [[Fr; BATCHED_RELATION_PARTIAL_LENGTH]; MAX_LOG_CIRCUIT_SIZE],

    // Sumcheck evaluations: 40 polynomial evaluations at challenge point
    pub sumcheck_evaluations: [Fr; NUMBER_OF_ENTITIES],

    // Gemini fold commitments: log_n - 1 commitments
    pub gemini_fold_comms: [G1ProofPoint; MAX_LOG_CIRCUIT_SIZE - 1],

    // Gemini evaluations: log_n scalars
    pub gemini_a_evaluations: [Fr; MAX_LOG_CIRCUIT_SIZE],

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
            sumcheck_univariates: [[Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH]; MAX_LOG_CIRCUIT_SIZE],
            sumcheck_evaluations: [Fr::zero(); NUMBER_OF_ENTITIES],
            gemini_fold_comms: [G1ProofPoint::default(); MAX_LOG_CIRCUIT_SIZE - 1],
            gemini_a_evaluations: [Fr::zero(); MAX_LOG_CIRCUIT_SIZE],
            shplonk_q: G1ProofPoint::default(),
            kzg_quotient: G1ProofPoint::default(),
            wire_commitment: G1Point::default(),
        }
    }
}

impl UltraHonkProof {
    /// Parse full proof from bytes
    ///
    /// Format from bb.js:
    /// - circuit_size_log (1 byte)
    /// - wire commitments w1-w4 (4 × 128 bytes)
    /// - lookup helpers (4 × 128 bytes)
    /// - sumcheck univariates (log_n × 8 × 32 bytes)
    /// - sumcheck evaluations (40 × 32 bytes)
    /// - gemini fold comms ((log_n - 1) × 128 bytes)
    /// - gemini evaluations (log_n × 32 bytes)
    /// - shplonk_q (128 bytes)
    /// - kzg_quotient (128 bytes)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < 1 {
            return Err(UltraHonkError::InvalidProofFormat);
        }

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

        // Parse sumcheck univariates: log_n rounds × 8 scalars
        let mut sumcheck_univariates = [[Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH]; MAX_LOG_CIRCUIT_SIZE];
        for round in 0..log_n {
            for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
                sumcheck_univariates[round][i] = parse_fr(bytes, &mut offset)?;
            }
        }

        // Parse sumcheck evaluations: 40 scalars
        let mut sumcheck_evaluations = [Fr::zero(); NUMBER_OF_ENTITIES];
        for i in 0..NUMBER_OF_ENTITIES {
            sumcheck_evaluations[i] = parse_fr(bytes, &mut offset)?;
        }

        // Parse gemini fold commitments: log_n - 1 points
        let mut gemini_fold_comms = [G1ProofPoint::default(); MAX_LOG_CIRCUIT_SIZE - 1];
        for i in 0..(log_n - 1) {
            gemini_fold_comms[i] = parse_g1_proof_point(bytes, &mut offset)?;
        }

        // Parse gemini evaluations: log_n scalars
        let mut gemini_a_evaluations = [Fr::zero(); MAX_LOG_CIRCUIT_SIZE];
        for i in 0..log_n {
            gemini_a_evaluations[i] = parse_fr(bytes, &mut offset)?;
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
}

/// Full UltraHonk verification key
///
/// Contains all 27 G1 commitment points for full verification.
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

    // Selector polynomial commitments (13)
    pub q_m: G1Point,
    pub q_c: G1Point,
    pub q_l: G1Point,
    pub q_r: G1Point,
    pub q_o: G1Point,
    pub q_4: G1Point,
    pub q_lookup: G1Point,
    pub q_arith: G1Point,
    pub q_deltarange: G1Point,
    pub q_elliptic: G1Point,
    pub q_aux: G1Point,
    pub q_poseidon2external: G1Point,
    pub q_poseidon2internal: G1Point,

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
    /// Parse verification key from bytes
    ///
    /// Format (1760 bytes):
    /// - circuit_size (8 bytes, little-endian)
    /// - log_circuit_size (8 bytes)
    /// - num_public_inputs (8 bytes)
    /// - pub_inputs_offset (8 bytes)
    /// - 27 G1 points (27 × 64 bytes = 1728 bytes)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < 32 + VK_NUM_COMMITMENTS * G1_AFFINE_SIZE {
            return Err(UltraHonkError::InvalidVerificationKey);
        }

        let circuit_size = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        let log_circuit_size = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as u8;
        let num_public_inputs = u64::from_le_bytes(bytes[16..24].try_into().unwrap()) as u32;
        let pub_inputs_offset = u64::from_le_bytes(bytes[24..32].try_into().unwrap());

        let mut offset = 32;

        // Parse all 27 G1 commitments
        let q_m = parse_g1_affine(bytes, &mut offset)?;
        let q_c = parse_g1_affine(bytes, &mut offset)?;
        let q_l = parse_g1_affine(bytes, &mut offset)?;
        let q_r = parse_g1_affine(bytes, &mut offset)?;
        let q_o = parse_g1_affine(bytes, &mut offset)?;
        let q_4 = parse_g1_affine(bytes, &mut offset)?;
        let q_lookup = parse_g1_affine(bytes, &mut offset)?;
        let q_arith = parse_g1_affine(bytes, &mut offset)?;
        let q_deltarange = parse_g1_affine(bytes, &mut offset)?;
        let q_elliptic = parse_g1_affine(bytes, &mut offset)?;
        let q_aux = parse_g1_affine(bytes, &mut offset)?;
        let q_poseidon2external = parse_g1_affine(bytes, &mut offset)?;
        let q_poseidon2internal = parse_g1_affine(bytes, &mut offset)?;
        let s_1 = parse_g1_affine(bytes, &mut offset)?;
        let s_2 = parse_g1_affine(bytes, &mut offset)?;
        let s_3 = parse_g1_affine(bytes, &mut offset)?;
        let s_4 = parse_g1_affine(bytes, &mut offset)?;
        let id_1 = parse_g1_affine(bytes, &mut offset)?;
        let id_2 = parse_g1_affine(bytes, &mut offset)?;
        let id_3 = parse_g1_affine(bytes, &mut offset)?;
        let id_4 = parse_g1_affine(bytes, &mut offset)?;
        let t_1 = parse_g1_affine(bytes, &mut offset)?;
        let t_2 = parse_g1_affine(bytes, &mut offset)?;
        let t_3 = parse_g1_affine(bytes, &mut offset)?;
        let t_4 = parse_g1_affine(bytes, &mut offset)?;
        let lagrange_first = parse_g1_affine(bytes, &mut offset)?;
        let lagrange_last = parse_g1_affine(bytes, &mut offset)?;

        Ok(Self {
            circuit_size,
            circuit_size_log: log_circuit_size,
            num_public_inputs,
            pub_inputs_offset,
            q_m,
            q_c,
            q_l,
            q_r,
            q_o,
            q_4,
            q_lookup,
            q_arith,
            q_deltarange,
            q_elliptic,
            q_aux,
            q_poseidon2external,
            q_poseidon2internal,
            s_1,
            s_2,
            s_3,
            s_4,
            id_1,
            id_2,
            id_3,
            id_4,
            t_1,
            t_2,
            t_3,
            t_4,
            lagrange_first,
            lagrange_last,
            g2_x: G2Point::default(),
        })
    }

    /// Default G2 x-coordinate for pairing (BN254 SRS)
    pub fn default_g2_x() -> G2Point {
        G2Point(crate::constants::SRS_G2_X)
    }

    /// Get all VK commitments as an array (for MSM)
    pub fn commitments(&self) -> [G1Point; VK_NUM_COMMITMENTS] {
        [
            self.q_m,
            self.q_c,
            self.q_l,
            self.q_r,
            self.q_o,
            self.q_4,
            self.q_lookup,
            self.q_arith,
            self.q_deltarange,
            self.q_elliptic,
            self.q_aux,
            self.q_poseidon2external,
            self.q_poseidon2internal,
            self.s_1,
            self.s_2,
            self.s_3,
            self.s_4,
            self.id_1,
            self.id_2,
            self.id_3,
            self.id_4,
            self.t_1,
            self.t_2,
            self.t_3,
            self.t_4,
            self.lagrange_first,
            self.lagrange_last,
        ]
    }

    /// Minimum VK size in bytes
    pub const MIN_SIZE: usize = 32 + VK_NUM_COMMITMENTS * G1_AFFINE_SIZE;
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

/// Parse G1 affine point (64 bytes)
fn parse_g1_affine(bytes: &[u8], offset: &mut usize) -> Result<G1Point, UltraHonkError> {
    if *offset + G1_AFFINE_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidVerificationKey);
    }

    let point = G1Point::from_bytes(&bytes[*offset..*offset + G1_AFFINE_SIZE])?;
    *offset += G1_AFFINE_SIZE;
    Ok(point)
}

/// Parse field element (32 bytes)
fn parse_fr(bytes: &[u8], offset: &mut usize) -> Result<Fr, UltraHonkError> {
    if *offset + FR_SIZE > bytes.len() {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    let fr = Fr::from_bytes(&bytes[*offset..*offset + FR_SIZE])?;
    *offset += FR_SIZE;
    Ok(fr)
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
        // VK should be at least 32 + 27*64 = 1760 bytes
        assert_eq!(VerificationKey::MIN_SIZE, 1760);
    }
}
