//! Fiat-Shamir transcript for UltraHonk verification
//!
//! Generates deterministic challenges from proof elements using Keccak256.
//! This implementation matches the bb.js/barretenberg transcript format.
//!
//! On-chain: uses sol_keccak256 syscall (runs in validator, ~100 CU).
//! Off-chain (tests): uses software keccak via solana_nostd_keccak.

use crate::bn254::{Fr, SCALAR_MODULUS};

/// Keccak256 hash output size
const HASH_SIZE: usize = 32;

/// Keccak256 hash of multiple byte slices.
///
/// On Solana: uses the sol_keccak256 syscall which runs in the validator
/// and is dramatically cheaper than software keccak (~100 CU vs thousands).
/// Off-chain: falls back to solana_nostd_keccak software implementation.
/// FFI-safe byte slice descriptor matching Solana's SolBytes layout
#[repr(C)]
#[allow(dead_code)]
struct SolBytes {
    addr: *const u8,
    len: u64,
}

#[cfg(target_os = "solana")]
pub fn keccak_hashv(slices: &[&[u8]]) -> [u8; 32] {
    // Stack-allocated array for SolBytes (max 3 slices; avoids heap alloc per call)
    let mut sol_bytes = [
        SolBytes { addr: core::ptr::null(), len: 0 },
        SolBytes { addr: core::ptr::null(), len: 0 },
        SolBytes { addr: core::ptr::null(), len: 0 },
    ];
    let n = slices.len().min(3);
    let mut i = 0;
    while i < n {
        sol_bytes[i] = SolBytes {
            addr: slices[i].as_ptr(),
            len: slices[i].len() as u64,
        };
        i += 1;
    }
    let mut result = [0u8; 32];
    unsafe {
        extern "C" {
            fn sol_keccak256(
                vals: *const SolBytes,
                val_len: u64,
                hash_result: *mut u8,
            ) -> u64;
        }
        sol_keccak256(
            sol_bytes.as_ptr(),
            n as u64,
            result.as_mut_ptr(),
        );
    }
    result
}

#[cfg(not(target_os = "solana"))]
pub fn keccak_hashv(slices: &[&[u8]]) -> [u8; 32] {
    solana_nostd_keccak::hashv(slices)
}

/// Transcript for Fiat-Shamir heuristic (barretenberg duplex protocol)
///
/// Matches barretenberg's BaseTranscript / Solidity Transcript.sol:
/// - First squeeze: hash(buffer) — no prefix
/// - Subsequent squeezes: hash(previous_challenge_bytes || buffer)
/// - previous_challenge stored as REDUCED Fr (mod scalar field order)
#[derive(Clone)]
pub struct Transcript {
    /// Previous challenge as reduced Fr bytes (None for first squeeze)
    previous_challenge: Option<[u8; HASH_SIZE]>,
    /// Buffer for data to be hashed in the current round
    buffer: Vec<u8>,
}

impl Default for Transcript {
    fn default() -> Self {
        Self::new()
    }
}

impl Transcript {
    /// Create new transcript (no initial state)
    pub fn new() -> Self {
        Self {
            previous_challenge: None,
            buffer: Vec::with_capacity(2048),
        }
    }

    /// Absorb raw bytes into transcript
    #[inline]
    pub fn absorb_bytes(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    /// Absorb a field element (as big-endian 32 bytes)
    #[inline]
    pub fn absorb_fr(&mut self, fr: &Fr) {
        let bytes = fr.to_bytes();
        self.absorb_bytes(&bytes);
    }

    /// Absorb a u64 value (big-endian, 32 bytes padded)
    #[inline]
    pub fn absorb_u64(&mut self, value: u64) {
        let mut bytes = [0u8; 32];
        bytes[24..32].copy_from_slice(&value.to_be_bytes());
        self.absorb_bytes(&bytes);
    }

    /// Generate a challenge by squeezing the transcript
    ///
    /// Barretenberg duplex protocol:
    /// - First squeeze: keccak256(buffer)
    /// - Subsequent: keccak256(previous_challenge || buffer)
    /// - Result reduced mod scalar field order
    /// - Reduced value stored as state for next squeeze
    pub fn squeeze_challenge(&mut self) -> Fr {
        let hash = if let Some(prev) = &self.previous_challenge {
            // Subsequent: hash(previous_challenge || buffer)
            keccak_hashv(&[prev, &self.buffer])
        } else {
            // First: hash(buffer) — no zero prefix
            keccak_hashv(&[&self.buffer])
        };

        self.buffer.clear();

        // Reduce to field element (mod r)
        let challenge = reduce_to_field(&hash);

        // Store REDUCED Fr as state for next squeeze (not raw hash)
        self.previous_challenge = Some(challenge.to_bytes());

        challenge
    }
}

/// Reduce 32-byte hash to field element (mod r)
///
/// Interprets hash as big-endian uint256, reduces mod scalar field order.
/// Uses single subtraction (sufficient since keccak256 output < 2*r for BN254).
pub fn reduce_to_field(hash: &[u8; 32]) -> Fr {
    let mut result = *hash;

    // Compare with modulus (big-endian) and subtract once if >= modulus
    // This matches bb.js behavior for Fiat-Shamir transcript compatibility
    if compare_be(&result, &SCALAR_MODULUS) >= 0 {
        subtract_be(&mut result, &SCALAR_MODULUS);
    }

    // Convert reduced bytes to Montgomery form
    // from_bytes handles any remaining reduction via Montgomery multiplication
    Fr::from_bytes(&result).unwrap_or(Fr::zero())
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

/// Split a challenge into two halves at the 127-bit boundary
///
/// Matches barretenberg Solidity Transcript.sol `splitChallenge`:
///   lo = value & 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF   (lower 127 bits)
///   hi = value >> 127                                  (upper bits)
///
/// Both halves fit in ~127 bits. Cost: 3 mont_muls (1 deconvert + 2 reconvert).
pub fn split_challenge(challenge: &Fr) -> (Fr, Fr) {
    // Convert from Montgomery to standard limbs (little-endian u64 limbs)
    // standard[0] = bits 0-63, standard[1] = bits 64-127,
    // standard[2] = bits 128-191, standard[3] = bits 192-255
    let s = challenge.to_limbs_standard();

    // lo = bits 0..126 (127 bits)
    let lo_limb0 = s[0];                        // bits 0-63 (full 64 bits)
    let lo_limb1 = s[1] & 0x7FFFFFFFFFFFFFFF;   // bits 64-126 (63 bits, mask bit 127)
    let lower = Fr::from_limbs_standard([lo_limb0, lo_limb1, 0, 0]);

    // hi = bits 127..255 (value >> 127)
    let hi_limb0 = (s[1] >> 63) | (s[2] << 1);  // bit 127 → bit 0, bits 128-190 → bits 1-63
    let hi_limb1 = (s[2] >> 63) | (s[3] << 1);  // bits 191-253
    let hi_limb2 = s[3] >> 63;                    // bit 255 (usually 0 for reduced values)
    let upper = Fr::from_limbs_standard([hi_limb0, hi_limb1, hi_limb2, 0]);

    (lower, upper)
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
    fn test_transcript_first_squeeze_no_prefix() {
        // First squeeze should hash just the buffer (no zero prefix)
        let mut t = Transcript::new();
        t.absorb_bytes(b"hello");
        let c1 = t.squeeze_challenge();

        // Manually compute expected: keccak256("hello") reduced mod r
        let hash = keccak_hashv(&[b"hello"]);
        let expected = reduce_to_field(&hash);
        assert_eq!(c1, expected);
    }

    #[test]
    fn test_transcript_subsequent_squeeze_uses_prev_challenge() {
        // Second squeeze should hash(prev_challenge || buffer)
        let mut t = Transcript::new();
        t.absorb_bytes(b"round0");
        let c0 = t.squeeze_challenge();

        t.absorb_bytes(b"round1");
        let c1 = t.squeeze_challenge();

        // Manually compute: keccak256(c0.to_bytes() || "round1") reduced mod r
        let c0_bytes = c0.to_bytes();
        let hash = keccak_hashv(&[&c0_bytes, b"round1"]);
        let expected = reduce_to_field(&hash);
        assert_eq!(c1, expected);
    }

    #[test]
    fn test_split_challenge_127bit() {
        // Test the 127-bit split (Solidity: lo = value & 0x7FFF...F, hi = value >> 127)
        // Value in little-endian limbs: [0xFFFF..., 0x8000..., 0x0003, 0x0000]
        // bit 127 = MSB of limbs[1] = 1
        // lo = bits 0..126 = [0xFFFF..., 0x7FFF...] (bit 127 masked off)
        // hi = bits 127..255 = (1 from bit 127) | (3 << 1 from limbs[2]) = 7
        let val = Fr::from_limbs_standard([0xFFFF_FFFF_FFFF_FFFF, 0x8000_0000_0000_0000, 3, 0]);
        let (lo, hi) = split_challenge(&val);
        let lo_limbs = lo.to_limbs_standard();
        let hi_limbs = hi.to_limbs_standard();

        // lo should have lower 127 bits (bit 127 masked off from limbs[1])
        assert_eq!(lo_limbs[0], 0xFFFF_FFFF_FFFF_FFFF);
        assert_eq!(lo_limbs[1], 0x0000_0000_0000_0000); // bit 127 (MSB of limbs[1]) goes to hi
        assert_eq!(lo_limbs[2], 0);
        assert_eq!(lo_limbs[3], 0);

        // hi = value >> 127: bit 127 → bit 0, limbs[2]=3 → bits 1-64
        assert_eq!(hi_limbs[0], 1 | (3 << 1)); // = 7
        assert_eq!(hi_limbs[1], 0);
        assert_eq!(hi_limbs[2], 0);
        assert_eq!(hi_limbs[3], 0);
    }

    #[test]
    fn test_split_challenge_roundtrip() {
        // lo + hi * 2^127 should equal the original value
        let bytes: [u8; 32] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ];
        let challenge = Fr::from_bytes(&bytes).unwrap();
        let (lo, hi) = split_challenge(&challenge);

        // Reconstruct: challenge = lo + hi * 2^127
        let two_127 = Fr::from_limbs_standard([0, 1 << 63, 0, 0]);
        let reconstructed = lo.add(&hi.mul(&two_127));
        assert_eq!(reconstructed, challenge);
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

    #[test]
    fn test_absorb_fr_roundtrip() {
        // Absorbing an Fr should produce the same bytes as to_bytes
        let val = Fr::from_u64(42);
        let mut t = Transcript::new();
        t.absorb_fr(&val);
        assert_eq!(t.buffer.len(), 32);
        assert_eq!(&t.buffer[..], &val.to_bytes()[..]);
    }
}
