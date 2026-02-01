//! BN254 curve operations using Solana's alt_bn128 syscalls
//!
//! Provides G1/G2 point arithmetic and pairing operations for UltraHonk verification.

use crate::error::UltraHonkError;
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

/// G1 point size in bytes (x, y coordinates)
pub const G1_POINT_SIZE: usize = 64;

/// G2 point size in bytes (x, y coordinates, each 64 bytes)
pub const G2_POINT_SIZE: usize = 128;

/// Field element size in bytes
pub const FR_SIZE: usize = 32;

/// BN254 base field modulus p
pub const FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// BN254 scalar field modulus r
pub const SCALAR_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x18, 0x1f, 0x85, 0xd2,
    0x83, 0x3e, 0x84, 0x87, 0x9b, 0x97, 0x09, 0x14,
    0x3e, 0x1f, 0x59, 0x3f, 0x00, 0x00, 0x00, 0x01,
];

/// G1 generator point
pub const G1_GENERATOR: [u8; 64] = [
    // x = 1
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    // y = 2
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
];

/// Identity point (point at infinity) in G1
pub const G1_IDENTITY: [u8; 64] = [0u8; 64];

/// A G1 affine point (64 bytes)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct G1Point(pub [u8; G1_POINT_SIZE]);

impl Default for G1Point {
    fn default() -> Self {
        Self([0u8; G1_POINT_SIZE])
    }
}

impl G1Point {
    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < G1_POINT_SIZE {
            return Err(UltraHonkError::InvalidG1Point);
        }
        let mut arr = [0u8; G1_POINT_SIZE];
        arr.copy_from_slice(&bytes[..G1_POINT_SIZE]);
        Ok(Self(arr))
    }

    /// Convert to bytes
    pub fn to_bytes(&self) -> [u8; G1_POINT_SIZE] {
        self.0
    }

    /// Check if point is identity (zero)
    pub fn is_identity(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }

    /// Get generator point
    pub fn generator() -> Self {
        Self(G1_GENERATOR)
    }

    /// Get identity point
    pub fn identity() -> Self {
        Self(G1_IDENTITY)
    }

    /// Negate point: -P = (x, -y) where -y = p - y
    pub fn negate(&self) -> Self {
        if self.is_identity() {
            return *self;
        }

        let mut result = [0u8; G1_POINT_SIZE];
        // Copy x unchanged
        result[..32].copy_from_slice(&self.0[..32]);
        // Compute -y = p - y
        field_sub(&FIELD_MODULUS, &self.0[32..64], &mut result[32..64]);
        Self(result)
    }

    /// Add two G1 points
    pub fn add(&self, other: &Self) -> Result<Self, UltraHonkError> {
        if self.is_identity() {
            return Ok(*other);
        }
        if other.is_identity() {
            return Ok(*self);
        }

        let mut input = [0u8; 128];
        input[..64].copy_from_slice(&self.0);
        input[64..128].copy_from_slice(&other.0);

        let result = alt_bn128_addition(&input)
            .map_err(|_| UltraHonkError::Bn254SyscallError)?;

        let mut arr = [0u8; G1_POINT_SIZE];
        arr.copy_from_slice(&result);
        Ok(Self(arr))
    }

    /// Scalar multiplication
    pub fn mul(&self, scalar: &[u8; FR_SIZE]) -> Result<Self, UltraHonkError> {
        if is_zero(scalar) || self.is_identity() {
            return Ok(Self::identity());
        }

        let mut input = [0u8; 96];
        input[..64].copy_from_slice(&self.0);
        input[64..96].copy_from_slice(scalar);

        let result = alt_bn128_multiplication(&input)
            .map_err(|_| UltraHonkError::Bn254SyscallError)?;

        let mut arr = [0u8; G1_POINT_SIZE];
        arr.copy_from_slice(&result);
        Ok(Self(arr))
    }
}

/// A G2 affine point (128 bytes)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct G2Point(pub [u8; G2_POINT_SIZE]);

impl Default for G2Point {
    fn default() -> Self {
        Self([0u8; G2_POINT_SIZE])
    }
}

impl G2Point {
    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < G2_POINT_SIZE {
            return Err(UltraHonkError::InvalidG2Point);
        }
        let mut arr = [0u8; G2_POINT_SIZE];
        arr.copy_from_slice(&bytes[..G2_POINT_SIZE]);
        Ok(Self(arr))
    }

    /// Convert to bytes
    pub fn to_bytes(&self) -> [u8; G2_POINT_SIZE] {
        self.0
    }

    /// Check if point is identity
    pub fn is_identity(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }
}

/// A field element (32 bytes, big-endian)
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fr(pub [u8; FR_SIZE]);

impl Fr {
    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < FR_SIZE {
            return Err(UltraHonkError::InvalidFieldElement);
        }
        let mut arr = [0u8; FR_SIZE];
        arr.copy_from_slice(&bytes[..FR_SIZE]);
        Ok(Self(arr))
    }

    /// Convert to bytes
    pub fn to_bytes(&self) -> [u8; FR_SIZE] {
        self.0
    }

    /// Check if zero
    pub fn is_zero(&self) -> bool {
        is_zero(&self.0)
    }

    /// Zero element
    pub fn zero() -> Self {
        Self([0u8; FR_SIZE])
    }

    /// One element
    pub fn one() -> Self {
        let mut arr = [0u8; FR_SIZE];
        arr[31] = 1;
        Self(arr)
    }

    /// Add two field elements (mod r)
    pub fn add(&self, other: &Self) -> Self {
        let mut result = [0u8; FR_SIZE];
        field_add(&self.0, &other.0, &SCALAR_MODULUS, &mut result);
        Self(result)
    }

    /// Subtract two field elements (mod r)
    pub fn sub(&self, other: &Self) -> Self {
        let mut result = [0u8; FR_SIZE];
        field_sub_mod(&self.0, &other.0, &SCALAR_MODULUS, &mut result);
        Self(result)
    }

    /// Multiply two field elements (mod r)
    pub fn mul(&self, other: &Self) -> Self {
        let mut result = [0u8; FR_SIZE];
        field_mul(&self.0, &other.0, &SCALAR_MODULUS, &mut result);
        Self(result)
    }

    /// Negate field element
    pub fn negate(&self) -> Self {
        if self.is_zero() {
            return *self;
        }
        let mut result = [0u8; FR_SIZE];
        field_sub(&SCALAR_MODULUS, &self.0, &mut result);
        Self(result)
    }

    /// Square the field element
    pub fn square(&self) -> Self {
        self.mul(self)
    }

    /// Compute modular inverse using Fermat's little theorem
    /// a^(-1) = a^(r-2) mod r
    /// Returns None if self is zero
    pub fn inverse(&self) -> Option<Self> {
        if self.is_zero() {
            return None;
        }

        // r - 2 for BN254 scalar field
        // r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
        // r - 2 = 21888242871839275222246405745257275088548364400416034343698204186575808495615
        let r_minus_2: [u8; 32] = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
            0xb8, 0x50, 0x45, 0xb6, 0x18, 0x1f, 0x85, 0xd2,
            0x83, 0x3e, 0x84, 0x87, 0x9b, 0x97, 0x09, 0x14,
            0x3e, 0x1f, 0x59, 0x3e, 0xff, 0xff, 0xff, 0xff,
        ];

        Some(self.pow(&r_minus_2))
    }

    /// Compute a^exp using binary exponentiation
    pub fn pow(&self, exp: &[u8; 32]) -> Self {
        let mut result = Fr::one();
        let mut base = *self;

        // Process each bit from LSB to MSB
        for byte_idx in (0..32).rev() {
            for bit_idx in 0..8 {
                if (exp[byte_idx] >> bit_idx) & 1 == 1 {
                    result = result.mul(&base);
                }
                base = base.square();
            }
        }

        result
    }

    /// Create field element from u64
    pub fn from_u64(value: u64) -> Self {
        let mut arr = [0u8; FR_SIZE];
        arr[24..32].copy_from_slice(&value.to_be_bytes());
        Self(arr)
    }
}

/// Multi-scalar multiplication (MSM)
/// Computes: sum(scalars[i] * points[i])
pub fn msm(points: &[G1Point], scalars: &[Fr]) -> Result<G1Point, UltraHonkError> {
    if points.len() != scalars.len() {
        return Err(UltraHonkError::InvalidG1Point);
    }

    let mut acc = G1Point::identity();

    for (point, scalar) in points.iter().zip(scalars.iter()) {
        if scalar.is_zero() || point.is_identity() {
            continue;
        }

        let term = point.mul(&scalar.0)?;
        acc = acc.add(&term)?;
    }

    Ok(acc)
}

/// Pairing check: e(P1, Q1) * e(P2, Q2) * ... == 1
/// Returns true if the product of pairings equals identity
pub fn pairing_check(pairs: &[(G1Point, G2Point)]) -> Result<bool, UltraHonkError> {
    if pairs.is_empty() {
        return Ok(true);
    }

    // Build pairing input: concatenate (G1, G2) pairs
    // Each pair: 64 (G1) + 128 (G2) = 192 bytes
    let input_size = pairs.len() * 192;
    let mut input = vec![0u8; input_size];

    for (i, (g1, g2)) in pairs.iter().enumerate() {
        let offset = i * 192;
        input[offset..offset + 64].copy_from_slice(&g1.0);
        input[offset + 64..offset + 192].copy_from_slice(&g2.0);
    }

    let result = alt_bn128_pairing(&input)
        .map_err(|_| UltraHonkError::Bn254SyscallError)?;

    // Pairing returns 32 bytes, last byte is 1 if successful
    Ok(result.len() == 32 && result[31] == 1)
}

// ============================================================================
// Field arithmetic helpers
// ============================================================================

/// Check if bytes are all zero
#[inline(always)]
fn is_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| b == 0)
}

/// Field subtraction: result = a - b (assumes a >= b)
#[inline(always)]
fn field_sub(a: &[u8], b: &[u8], result: &mut [u8]) {
    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        let ai = a[i] as u16;
        let bi = b[i] as u16;
        let diff = ai.wrapping_sub(bi).wrapping_sub(borrow);
        borrow = (diff >> 8) & 1;
        result[i] = diff as u8;
    }
}

/// Field addition with modular reduction
#[inline(always)]
fn field_add(a: &[u8; 32], b: &[u8; 32], modulus: &[u8; 32], result: &mut [u8; 32]) {
    let mut carry: u16 = 0;
    let mut sum = [0u8; 32];

    // Add
    for i in (0..32).rev() {
        let s = (a[i] as u16) + (b[i] as u16) + carry;
        sum[i] = s as u8;
        carry = s >> 8;
    }

    // Reduce if >= modulus
    if carry > 0 || compare_bytes(&sum, modulus) >= 0 {
        field_sub(&sum, modulus, result);
    } else {
        result.copy_from_slice(&sum);
    }
}

/// Field subtraction with modular reduction
#[inline(always)]
fn field_sub_mod(a: &[u8; 32], b: &[u8; 32], modulus: &[u8; 32], result: &mut [u8; 32]) {
    if compare_bytes(a, b) >= 0 {
        field_sub(a, b, result);
    } else {
        // a < b: result = modulus - (b - a)
        let mut diff = [0u8; 32];
        field_sub(b, a, &mut diff);
        field_sub(modulus, &diff, result);
    }
}

/// Field multiplication (mod r)
/// Uses schoolbook multiplication with Barrett reduction
#[inline(never)]
fn field_mul(a: &[u8; 32], b: &[u8; 32], modulus: &[u8; 32], result: &mut [u8; 32]) {
    // Simple case: if either is zero
    if is_zero(a) || is_zero(b) {
        result.fill(0);
        return;
    }

    // Schoolbook multiplication producing 64-byte result
    let mut product = [0u8; 64];
    schoolbook_mul_256(a, b, &mut product);

    // Reduce mod r using repeated subtraction (not optimal but correct)
    // For production, use Barrett or Montgomery reduction
    reduce_512_mod(product, modulus, result);
}

/// Schoolbook multiplication of two 256-bit numbers
/// Produces a 512-bit result
#[inline(never)]
fn schoolbook_mul_256(a: &[u8; 32], b: &[u8; 32], result: &mut [u8; 64]) {
    result.fill(0);

    // Multiply byte by byte (big-endian)
    for i in (0..32).rev() {
        let mut carry: u32 = 0;
        for j in (0..32).rev() {
            let idx = (31 - i) + (31 - j);
            if idx < 64 {
                let pos = 63 - idx;
                let prod = (a[i] as u32) * (b[j] as u32) + (result[pos] as u32) + carry;
                result[pos] = prod as u8;
                carry = prod >> 8;
            }
        }
        // Propagate remaining carry
        let mut pos = 63 - (31 - i) - 32;
        while carry > 0 && pos < 64 {
            let sum = (result[pos] as u32) + carry;
            result[pos] = sum as u8;
            carry = sum >> 8;
            if pos == 0 { break; }
            pos -= 1;
        }
    }
}

/// Reduce 512-bit number mod 256-bit modulus
/// Uses repeated subtraction (simple but O(n) where n is quotient size)
#[inline(never)]
fn reduce_512_mod(product: [u8; 64], modulus: &[u8; 32], result: &mut [u8; 32]) {
    // Check if product fits in 256 bits
    let high_zero = product[0..32].iter().all(|&b| b == 0);

    if high_zero {
        // Product is < 2^256, just need simple reduction
        result.copy_from_slice(&product[32..64]);
        // Reduce if >= modulus
        while compare_bytes(result, modulus) >= 0 {
            let mut borrow: u16 = 0;
            for i in (0..32).rev() {
                let diff = (result[i] as u16).wrapping_sub(modulus[i] as u16).wrapping_sub(borrow);
                result[i] = diff as u8;
                borrow = (diff >> 8) & 1;
            }
        }
    } else {
        // Product is >= 2^256, need full reduction
        // Use shift-and-subtract division algorithm
        let mut remainder = product;

        // Shift modulus left to align with product
        // Then repeatedly subtract and shift right
        let mut shifted_mod = [0u8; 64];
        shifted_mod[32..64].copy_from_slice(modulus);

        // Find how many bits to shift (simplification: shift by 256 bits max)
        // For each position from high to low, if remainder >= shifted_mod, subtract

        for shift in (0..=256).rev() {
            // Compare remainder with shifted modulus
            let mut shifted = [0u8; 64];
            shift_left_512(&shifted_mod, shift, &mut shifted);

            if compare_512(&remainder, &shifted) >= 0 {
                sub_512(&mut remainder, &shifted);
            }
        }

        // Result is in lower 32 bytes
        result.copy_from_slice(&remainder[32..64]);
    }
}

/// Shift 512-bit number left by n bits
fn shift_left_512(a: &[u8; 64], n: usize, result: &mut [u8; 64]) {
    result.fill(0);
    if n >= 512 { return; }

    let byte_shift = n / 8;
    let bit_shift = n % 8;

    for i in 0..64 {
        if i + byte_shift < 64 {
            let src_idx = i + byte_shift;
            result[i] = a[src_idx] << bit_shift;
            if bit_shift > 0 && src_idx + 1 < 64 {
                result[i] |= a[src_idx + 1] >> (8 - bit_shift);
            }
        }
    }
}

/// Compare two 512-bit numbers
fn compare_512(a: &[u8; 64], b: &[u8; 64]) -> i32 {
    for i in 0..64 {
        if a[i] > b[i] { return 1; }
        if a[i] < b[i] { return -1; }
    }
    0
}

/// Subtract 512-bit numbers: a -= b (assumes a >= b)
fn sub_512(a: &mut [u8; 64], b: &[u8; 64]) {
    let mut borrow: u16 = 0;
    for i in (0..64).rev() {
        let diff = (a[i] as u16).wrapping_sub(b[i] as u16).wrapping_sub(borrow);
        a[i] = diff as u8;
        borrow = (diff >> 8) & 1;
    }
}

/// Compare two byte arrays (big-endian)
#[inline(always)]
fn compare_bytes(a: &[u8], b: &[u8]) -> i32 {
    for i in 0..a.len().min(b.len()) {
        if a[i] > b[i] {
            return 1;
        }
        if a[i] < b[i] {
            return -1;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_g1_identity() {
        let id = G1Point::identity();
        assert!(id.is_identity());
    }

    #[test]
    fn test_fr_operations() {
        let one = Fr::one();
        let zero = Fr::zero();

        assert!(!one.is_zero());
        assert!(zero.is_zero());

        let sum = zero.add(&one);
        assert_eq!(sum, one);
    }

    #[test]
    fn test_g1_negate() {
        let id = G1Point::identity();
        let neg_id = id.negate();
        assert!(neg_id.is_identity());
    }
}
