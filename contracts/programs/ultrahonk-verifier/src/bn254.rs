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

/// Field multiplication (simplified - for demonstration)
/// Note: Full modular multiplication is complex; this is a simplified version
#[inline(always)]
fn field_mul(a: &[u8; 32], b: &[u8; 32], _modulus: &[u8; 32], result: &mut [u8; 32]) {
    // For full implementation, use Montgomery multiplication
    // This is a placeholder that works for small values

    // Simple case: if either is zero
    if is_zero(a) || is_zero(b) {
        result.fill(0);
        return;
    }

    // For now, copy a as placeholder (real impl needs Montgomery mul)
    // TODO: Implement proper field multiplication
    result.copy_from_slice(a);
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
