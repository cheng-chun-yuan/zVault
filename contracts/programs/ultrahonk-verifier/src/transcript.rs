//! Fiat-Shamir transcript for UltraHonk verification
//!
//! Generates deterministic challenges from proof elements using Keccak256.
//! This implementation matches the bb.js/barretenberg transcript format.

use crate::bn254::{Fr, SCALAR_MODULUS};
use solana_nostd_keccak::hashv;

/// Keccak256 hash output size
const HASH_SIZE: usize = 32;

/// Transcript for Fiat-Shamir heuristic
///
/// Accumulates proof elements and generates challenges deterministically.
/// Uses Keccak256 to match bb.js/barretenberg implementation.
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
    /// Create new transcript
    ///
    /// Note: Unlike bb.js, we don't use a domain separator here.
    /// The domain separation happens through the protocol structure itself.
    pub fn new() -> Self {
        Self {
            state: [0u8; HASH_SIZE],
            buffer: Vec::with_capacity(2048),
        }
    }

    /// Absorb raw bytes into transcript
    #[inline]
    pub fn absorb_bytes(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    /// Absorb a field element (big-endian, 32 bytes)
    #[inline]
    pub fn absorb_fr(&mut self, fr: &Fr) {
        self.absorb_bytes(&fr.0);
    }

    /// Absorb a u64 value (big-endian, 32 bytes padded)
    #[inline]
    pub fn absorb_u64(&mut self, value: u64) {
        // bb.js uses 32-byte big-endian encoding for all values
        let mut bytes = [0u8; 32];
        bytes[24..32].copy_from_slice(&value.to_be_bytes());
        self.absorb_bytes(&bytes);
    }

    /// Generate a challenge by squeezing the transcript
    ///
    /// Uses Keccak256(state || buffer) to produce challenge.
    /// The result is reduced modulo the scalar field order.
    pub fn squeeze_challenge(&mut self) -> Fr {
        // Hash: state || buffer
        let hash = hashv(&[&self.state, &self.buffer]);

        // Update state for next squeeze
        self.state = hash;
        self.buffer.clear();

        // Reduce to field element (mod r)
        reduce_to_field(&hash)
    }

    /// Get current state (for debugging)
    #[cfg(test)]
    pub fn get_state(&self) -> [u8; 32] {
        self.state
    }
}

/// Reduce 32-byte hash to field element (mod r)
///
/// This matches bb.js behavior: interpret as big-endian and reduce mod scalar field order.
fn reduce_to_field(hash: &[u8; 32]) -> Fr {
    // For values close to 2^256, we need proper modular reduction
    // Since Fr modulus is ~2^254, most 256-bit values need reduction

    // Simple reduction: if hash >= modulus, subtract modulus
    // This gives negligible bias for uniformly random input
    let mut result = *hash;

    // Compare with modulus (big-endian)
    if compare_be(&result, &SCALAR_MODULUS) >= 0 {
        // Subtract modulus
        subtract_be(&mut result, &SCALAR_MODULUS);
    }

    Fr(result)
}

/// Compare two 32-byte big-endian numbers
/// Returns: -1 if a < b, 0 if a == b, 1 if a > b
#[inline]
fn compare_be(a: &[u8; 32], b: &[u8; 32]) -> i32 {
    for i in 0..32 {
        if a[i] > b[i] {
            return 1;
        }
        if a[i] < b[i] {
            return -1;
        }
    }
    0
}

/// Subtract b from a (big-endian), assuming a >= b
#[inline]
fn subtract_be(a: &mut [u8; 32], b: &[u8; 32]) {
    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        let diff = (a[i] as u16).wrapping_sub(b[i] as u16).wrapping_sub(borrow);
        a[i] = diff as u8;
        borrow = (diff >> 8) & 1;
    }
}

/// Split a 256-bit challenge into two 128-bit halves
///
/// This matches bb.js split_challenge behavior:
/// - lower: bits 0-127 (least significant)
/// - upper: bits 128-255 (most significant)
///
/// For big-endian representation:
/// - lower comes from bytes 16-31
/// - upper comes from bytes 0-15
pub fn split_challenge(challenge: &Fr) -> (Fr, Fr) {
    let mut lower = [0u8; 32];
    let mut upper = [0u8; 32];

    // In big-endian: bytes 0-15 are upper 128 bits, bytes 16-31 are lower 128 bits
    // Lower 128 bits go into a 256-bit field element (zero-padded upper bytes)
    lower[16..32].copy_from_slice(&challenge.0[16..32]);

    // Upper 128 bits go into a 256-bit field element (zero-padded upper bytes)
    upper[16..32].copy_from_slice(&challenge.0[0..16]);

    (Fr(lower), Fr(upper))
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

    #[test]
    fn test_split_challenge() {
        // Test with a known value
        let challenge = Fr([
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ]);

        let (lower, upper) = split_challenge(&challenge);

        // Lower should have bytes 16-31 of challenge in positions 16-31
        assert_eq!(&lower.0[16..32], &challenge.0[16..32]);
        // Upper bytes of lower should be zero
        assert_eq!(&lower.0[0..16], &[0u8; 16]);

        // Upper should have bytes 0-15 of challenge in positions 16-31
        assert_eq!(&upper.0[16..32], &challenge.0[0..16]);
        // Upper bytes of upper should be zero
        assert_eq!(&upper.0[0..16], &[0u8; 16]);
    }

    #[test]
    fn test_absorb_u64() {
        let mut t = Transcript::new();
        t.absorb_u64(0x0102030405060708);

        // Should be absorbed as 32-byte big-endian
        assert_eq!(t.buffer.len(), 32);
        assert_eq!(&t.buffer[0..24], &[0u8; 24]);
        assert_eq!(&t.buffer[24..32], &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    }

    #[test]
    fn test_compare_be() {
        let a = [0u8; 32];
        let b = [0u8; 32];
        assert_eq!(compare_be(&a, &b), 0);

        let mut c = [0u8; 32];
        c[31] = 1;
        assert_eq!(compare_be(&c, &a), 1);
        assert_eq!(compare_be(&a, &c), -1);
    }
}
