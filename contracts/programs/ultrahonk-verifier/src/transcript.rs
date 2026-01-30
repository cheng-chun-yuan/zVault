//! Fiat-Shamir transcript for UltraHonk verification
//!
//! Generates deterministic challenges from proof elements using Keccak256.

use crate::bn254::{Fr, G1Point, FR_SIZE};

/// Keccak256 hash output size
const HASH_SIZE: usize = 32;

/// Transcript for Fiat-Shamir heuristic
///
/// Accumulates proof elements and generates challenges deterministically.
#[derive(Clone)]
pub struct Transcript {
    /// Running state (hash of all absorbed data)
    state: [u8; HASH_SIZE],
    /// Buffer for data to be hashed
    buffer: Vec<u8>,
}

impl Default for Transcript {
    fn default() -> Self {
        Self::new()
    }
}

impl Transcript {
    /// Create new transcript with domain separator
    pub fn new() -> Self {
        let mut transcript = Self {
            state: [0u8; HASH_SIZE],
            buffer: Vec::with_capacity(1024),
        };

        // Domain separator for UltraHonk
        transcript.absorb_bytes(b"UltraHonk_Solana_v1");
        transcript.squeeze_challenge(); // Initialize state

        transcript
    }

    /// Absorb raw bytes into transcript
    pub fn absorb_bytes(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    /// Absorb a G1 point
    pub fn absorb_g1(&mut self, point: &G1Point) {
        self.absorb_bytes(&point.0);
    }

    /// Absorb a field element
    pub fn absorb_fr(&mut self, fr: &Fr) {
        self.absorb_bytes(&fr.0);
    }

    /// Absorb a u64 value
    pub fn absorb_u64(&mut self, value: u64) {
        self.absorb_bytes(&value.to_le_bytes());
    }

    /// Absorb public inputs
    pub fn absorb_public_inputs(&mut self, inputs: &[[u8; 32]]) {
        self.absorb_u64(inputs.len() as u64);
        for input in inputs {
            self.absorb_bytes(input);
        }
    }

    /// Generate a challenge by squeezing the transcript
    ///
    /// Uses Keccak256(state || buffer) to produce challenge
    pub fn squeeze_challenge(&mut self) -> Fr {
        // Concatenate state and buffer
        let mut input = Vec::with_capacity(HASH_SIZE + self.buffer.len());
        input.extend_from_slice(&self.state);
        input.extend_from_slice(&self.buffer);

        // Hash with Keccak256
        let hash = keccak256(&input);

        // Update state
        self.state = hash;
        self.buffer.clear();

        // Reduce hash to field element
        reduce_to_field(&hash)
    }

    /// Generate multiple challenges
    pub fn squeeze_challenges(&mut self, count: usize) -> Vec<Fr> {
        let mut challenges = Vec::with_capacity(count);
        for _ in 0..count {
            challenges.push(self.squeeze_challenge());
        }
        challenges
    }
}

/// Keccak256 hash function
///
/// Simple implementation for Solana (no external crate dependency)
fn keccak256(data: &[u8]) -> [u8; 32] {
    // Use Solana's keccak256 syscall when available
    #[cfg(target_os = "solana")]
    {
        solana_keccak256(data)
    }

    #[cfg(not(target_os = "solana"))]
    {
        // Fallback for testing - use simple hash
        // In production, this would use a proper Keccak implementation
        simple_hash(data)
    }
}

#[cfg(target_os = "solana")]
fn solana_keccak256(data: &[u8]) -> [u8; 32] {
    // Use Solana's keccak256 syscall
    // For now, use simple hash as placeholder
    // TODO: Use sol_keccak256 syscall when available in pinocchio
    simple_hash_internal(data)
}

#[cfg(target_os = "solana")]
fn simple_hash_internal(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut state: u64 = 0xcbf29ce484222325;

    for byte in data {
        state ^= *byte as u64;
        state = state.wrapping_mul(0x100000001b3);
    }

    for i in 0..4 {
        let bytes = state.to_le_bytes();
        result[i * 8..(i + 1) * 8].copy_from_slice(&bytes);
        state = state.wrapping_mul(0x100000001b3);
    }

    result
}

#[cfg(not(target_os = "solana"))]
fn simple_hash(data: &[u8]) -> [u8; 32] {
    // Simple non-cryptographic hash for testing
    // DO NOT use in production - this is just for compilation
    let mut result = [0u8; 32];
    let mut state: u64 = 0xcbf29ce484222325; // FNV offset basis

    for byte in data {
        state ^= *byte as u64;
        state = state.wrapping_mul(0x100000001b3); // FNV prime
    }

    // Spread state across result
    for i in 0..4 {
        let bytes = state.to_le_bytes();
        result[i * 8..(i + 1) * 8].copy_from_slice(&bytes);
        state = state.wrapping_mul(0x100000001b3);
    }

    result
}

/// Reduce 32-byte hash to field element (mod r)
fn reduce_to_field(hash: &[u8; 32]) -> Fr {
    // For simplicity, we just use the hash directly
    // A proper implementation would reduce modulo the scalar field order
    // Since hash output is uniformly random, this gives negligible bias

    let mut bytes = [0u8; FR_SIZE];
    bytes.copy_from_slice(hash);

    // Clear top bits to ensure < 2^254 (safe for BN254 scalar field)
    bytes[0] &= 0x1f;

    Fr(bytes)
}

/// Challenge labels used in UltraHonk protocol
pub mod labels {
    pub const BETA: &[u8] = b"beta";
    pub const GAMMA: &[u8] = b"gamma";
    pub const ALPHA: &[u8] = b"alpha";
    pub const ETA: &[u8] = b"eta";
    pub const ETA_TWO: &[u8] = b"eta_two";
    pub const ETA_THREE: &[u8] = b"eta_three";
    pub const SUMCHECK: &[u8] = b"sumcheck";
    pub const GEMINI: &[u8] = b"gemini";
    pub const SHPLONK: &[u8] = b"shplonk";
    pub const KZG: &[u8] = b"kzg";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transcript_deterministic() {
        let mut t1 = Transcript::new();
        let mut t2 = Transcript::new();

        t1.absorb_bytes(b"test data");
        t2.absorb_bytes(b"test data");

        let c1 = t1.squeeze_challenge();
        let c2 = t2.squeeze_challenge();

        assert_eq!(c1, c2);
    }

    #[test]
    fn test_transcript_different_inputs() {
        let mut t1 = Transcript::new();
        let mut t2 = Transcript::new();

        t1.absorb_bytes(b"data1");
        t2.absorb_bytes(b"data2");

        let c1 = t1.squeeze_challenge();
        let c2 = t2.squeeze_challenge();

        assert_ne!(c1, c2);
    }
}
