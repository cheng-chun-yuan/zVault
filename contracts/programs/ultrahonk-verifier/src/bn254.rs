//! BN254 curve operations using Solana's alt_bn128 syscalls
//!
//! Provides G1/G2 point arithmetic and pairing operations for UltraHonk verification.
//! Field elements (Fr) use Montgomery form with u64 limbs for ~500-1000x faster arithmetic.

use crate::error::UltraHonkError;
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

/// G1 point size in bytes (x, y coordinates)
pub const G1_POINT_SIZE: usize = 64;

/// G2 point size in bytes (x, y coordinates, each 64 bytes)
pub const G2_POINT_SIZE: usize = 128;

/// Field element size in bytes
pub const FR_SIZE: usize = 32;

/// BN254 base field modulus p (big-endian bytes, used only for G1 point negation)
pub const FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// BN254 scalar field modulus r (big-endian bytes, kept for transcript compatibility)
pub const SCALAR_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

// ============================================================================
// Montgomery form constants for BN254 scalar field Fr
// ============================================================================

/// Scalar field modulus r as u64 limbs (little-endian)
/// r = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
const MODULUS: [u64; 4] = [
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
];

/// Montgomery constant: -r^(-1) mod 2^64
const INV: u64 = 0xc2e1f593efffffff;

/// Montgomery R = 2^256 mod r (this is "1" in Montgomery form)
const R: [u64; 4] = [
    0xac96341c4ffffffb,
    0x36fc76959f60cd29,
    0x666ea36f7879462e,
    0x0e0a77c19a07df2f,
];

/// Montgomery R^2 = 2^512 mod r (used to convert standard → Montgomery)
const R2: [u64; 4] = [
    0x1bb8e645ae216da7,
    0x53fe3ab1e35c59e3,
    0x8c49833d53bb8085,
    0x0216d0b17f4e44a5,
];

/// Precomputed barycentric denominator inverses 1/d_i in Montgomery form
/// d_i = prod_{j != i}(i - j) for i in 0..8
/// d = [5040, -720, 240, -120, 48, -24, 6, -1]
pub const BARY_DENOM_INV: [[u64; 4]; 8] = [
    [0x3ec563f20e5fe5ff, 0xfff2f39b0a4c26b4, 0xddbb8c4f314c040f, 0x1e509c567954ac7e], // 1/5040
    [0x9c0410454b60b60c, 0xc95ee02d188a23e8, 0x897086662e729d61, 0x1dc141e114a76958], // 1/(-720)
    [0xb3b7ba57fdddddde, 0xf44b3009a9d47568, 0xd44ef83a77aad894, 0x0784d742846d0449], // 1/240
    [0xdc7280e3f4444445, 0x3f9d8835261085bf, 0x0fb25541922ba733, 0x215a9fedd8579796], // 1/(-120)
    [0x8296a3b7f5555556, 0xc577f03051264b0b, 0x258ad92456563ae8, 0x2598344c96211571], // 1/48
    [0x8296a3b7f5555556, 0xc577f03051264b0b, 0x258ad92456563ae8, 0x1598344c96211571], // 1/(-24)
    [0x7d695c480aaaaaaa, 0x3a880fcfaed9b4f4, 0xda7526dba9a9c517, 0x0a67cbb369deea8e], // 1/6
    [0x974bc177a0000006, 0xf13771b2da58a367, 0x51e1a2470908122e, 0x2259d6b14729c0fa], // 1/(-1)
];

/// Precomputed domain values i=0..7 in Montgomery form
pub const BARY_DOMAIN: [[u64; 4]; 8] = [
    [0x0000000000000000, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000], // 0
    [0xac96341c4ffffffb, 0x36fc76959f60cd29, 0x666ea36f7879462e, 0x0e0a77c19a07df2f], // 1
    [0x592c68389ffffff6, 0x6df8ed2b3ec19a53, 0xccdd46def0f28c5c, 0x1c14ef83340fbe5e], // 2
    [0x05c29c54effffff1, 0xa4f563c0de22677d, 0x334bea4e696bd28a, 0x2a1f6744ce179d8e], // 3
    [0x6e76dadd4fffffeb, 0xb3bdf20e03c9c415, 0xe16a48076063c05b, 0x07c5909386eddc93], // 4
    [0x1b0d0ef99fffffe6, 0xeaba68a3a32a913f, 0x47d8eb76d8dd0689, 0x15d0085520f5bbc3], // 5
    [0xc7a34315efffffe1, 0x21b6df39428b5e68, 0xae478ee651564cb8, 0x23da8016bafd9af2], // 6
    [0x3057819e4fffffdb, 0x307f6d866832bb01, 0x5c65ec9f484e3a89, 0x0180a96573d3d9f8], // 7
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
        // Compute -y = p - y (base field subtraction on raw bytes)
        fq_sub(&FIELD_MODULUS, &self.0[32..64], &mut result[32..64]);
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

    /// Scalar multiplication (takes big-endian 32-byte scalar)
    pub fn mul(&self, scalar: &[u8; FR_SIZE]) -> Result<Self, UltraHonkError> {
        if scalar.iter().all(|&b| b == 0) || self.is_identity() {
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

    /// Scalar multiplication taking an Fr (converts from Montgomery form)
    pub fn mul_fr(&self, scalar: &Fr) -> Result<Self, UltraHonkError> {
        if scalar.is_zero() || self.is_identity() {
            return Ok(Self::identity());
        }
        let scalar_bytes = scalar.to_bytes();
        self.mul(&scalar_bytes)
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

// ============================================================================
// Fr: Scalar field element in Montgomery form [u64; 4]
// ============================================================================

/// A scalar field element in Montgomery form.
///
/// Internally stored as `[u64; 4]` little-endian limbs in Montgomery form:
///   stored value = actual_value * R mod r, where R = 2^256 mod r
///
/// All arithmetic (add, sub, mul, inverse) operates directly on Montgomery form.
/// Use `from_bytes` / `to_bytes` for I/O (automatic conversion).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fr(pub [u64; 4]);

impl Default for Fr {
    fn default() -> Self {
        Self([0u64; 4])
    }
}

impl Fr {
    /// Create from 32-byte big-endian representation (standard form → Montgomery form)
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UltraHonkError> {
        if bytes.len() < FR_SIZE {
            return Err(UltraHonkError::InvalidFieldElement);
        }
        // Parse big-endian bytes into u64 limbs (little-endian limb order)
        let limbs = be_bytes_to_limbs(bytes);
        // Convert to Montgomery form: mont = limbs * R2 mod r (via Montgomery mul)
        Ok(Self(mont_mul(&limbs, &R2)))
    }

    /// Convert to 32-byte big-endian representation (Montgomery form → standard form)
    pub fn to_bytes(&self) -> [u8; FR_SIZE] {
        // Convert from Montgomery: standard = mont * 1 mod r (via Montgomery mul)
        let standard = mont_mul(&self.0, &[1, 0, 0, 0]);
        limbs_to_be_bytes(&standard)
    }

    /// Check if zero
    #[inline(always)]
    pub fn is_zero(&self) -> bool {
        self.0[0] == 0 && self.0[1] == 0 && self.0[2] == 0 && self.0[3] == 0
    }

    /// Zero element
    #[inline(always)]
    pub fn zero() -> Self {
        Self([0u64; 4])
    }

    /// One element (in Montgomery form)
    #[inline(always)]
    pub fn one() -> Self {
        Self(R)
    }

    /// Add two field elements (mod r)
    #[inline(always)]
    pub fn add(&self, other: &Self) -> Self {
        Self(mont_add(&self.0, &other.0))
    }

    /// Subtract two field elements (mod r)
    #[inline(always)]
    pub fn sub(&self, other: &Self) -> Self {
        Self(mont_sub(&self.0, &other.0))
    }

    /// Multiply two field elements (mod r)
    #[inline(always)]
    pub fn mul(&self, other: &Self) -> Self {
        Self(mont_mul(&self.0, &other.0))
    }

    /// Negate field element
    #[inline(always)]
    pub fn negate(&self) -> Self {
        if self.is_zero() {
            return *self;
        }
        Self(mont_sub(&MODULUS, &self.0))
    }

    /// Square the field element
    #[inline(always)]
    pub fn square(&self) -> Self {
        Self(mont_mul(&self.0, &self.0))
    }

    /// Compute modular inverse using Fermat's little theorem: a^(-1) = a^(r-2) mod r
    /// Uses an optimized addition chain for BN254 Fr.
    pub fn inverse(&self) -> Option<Self> {
        if self.is_zero() {
            return None;
        }
        Some(self.pow_r_minus_2())
    }

    /// Compute a^(r-2) using 4-bit windowed exponentiation.
    /// r-2 = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593efffffff
    ///
    /// Uses a precomputed table of 15 powers to process the exponent 4 bits at a time.
    /// Cost: ~14 precompute + 252 squarings + 59 window multiplications = ~325 total
    /// vs generic binary: ~253 squarings + ~128 multiplications = ~381 total (~15% faster)
    #[inline(never)]
    fn pow_r_minus_2(&self) -> Self {
        let table = build_power_table(self);

        // r-2 as 64 nibbles (4-bit windows), MSB first
        const W: [u8; 64] = [
            3, 0, 6, 4, 4,14, 7, 2,14, 1, 3, 1,10, 0, 2, 9,
           11, 8, 5, 0, 4, 5,11, 6, 8, 1, 8, 1, 5, 8, 5,13,
            2, 8, 3, 3,14, 8, 4, 8, 7, 9,11, 9, 7, 0, 9, 1,
            4, 3,14, 1,15, 5, 9, 3,14,15,15,15,15,15,15,15,
        ];

        // First window (value 3) — no squaring needed
        let mut r = table[W[0] as usize];

        // Process remaining 63 windows
        let mut i = 1;
        while i < 64 {
            r = window_step(r, &table, W[i]);
            i += 1;
        }

        r
    }

    /// Compute a^exp using binary exponentiation (exp as big-endian bytes)
    pub fn pow(&self, exp: &[u8; 32]) -> Self {
        let mut result = Fr::one();

        // Left-to-right binary method on big-endian bytes
        let mut started = false;
        for &byte in exp.iter() {
            for bit_idx in (0..8).rev() {
                if started {
                    result = result.square();
                }
                if (byte >> bit_idx) & 1 == 1 {
                    if started {
                        result = result.mul(self);
                    } else {
                        result = *self;
                        started = true;
                    }
                }
            }
        }

        result
    }

    /// Create field element from u64 (converts to Montgomery form)
    #[inline]
    pub fn from_u64(value: u64) -> Self {
        let limbs = [value, 0, 0, 0];
        Self(mont_mul(&limbs, &R2))
    }

    /// Batch inversion using Montgomery's trick.
    /// Computes inverses of all elements using 3(n-1) multiplications + 1 inversion.
    /// Elements that are zero are left as zero in the output.
    pub fn batch_inverse(elements: &[Fr]) -> Vec<Fr> {
        let n = elements.len();
        if n == 0 {
            return Vec::new();
        }

        // Compute prefix products
        let mut products = Vec::with_capacity(n);
        let mut acc = Fr::one();
        for elem in elements {
            if elem.is_zero() {
                products.push(acc);
            } else {
                acc = acc.mul(elem);
                products.push(acc);
            }
        }

        // Invert the accumulated product
        let mut inv_acc = match acc.inverse() {
            Some(inv) => inv,
            None => return vec![Fr::zero(); n],
        };

        // Compute individual inverses by walking backwards
        let mut result = vec![Fr::zero(); n];
        for i in (0..n).rev() {
            if elements[i].is_zero() {
                continue;
            }
            if i == 0 {
                result[i] = inv_acc;
            } else {
                result[i] = products[i - 1].mul(&inv_acc);
                inv_acc = inv_acc.mul(&elements[i]);
            }
        }

        result
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

        let scalar_bytes = scalar.to_bytes();
        let term = point.mul(&scalar_bytes)?;
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
// Montgomery arithmetic on [u64; 4]
// ============================================================================

/// Build power table for windowed exponentiation: table[i] = a^i for i=1..=15
/// Isolated into its own stack frame for Solana's 4KB stack limit.
#[inline(never)]
fn build_power_table(a: &Fr) -> Vec<Fr> {
    let mut table = vec![Fr::zero(); 16];
    table[1] = *a;
    table[2] = a.square();
    let mut i = 3;
    while i <= 15 {
        table[i] = table[i - 1].mul(a);
        i += 1;
    }
    table
}

/// Process one 4-bit window of exponentiation: square 4 times then multiply if w != 0.
/// Separated into its own stack frame to prevent the compiler from unrolling the loop
/// and inlining all mont_mul calls into a single giant frame that exceeds Solana's 4KB limit.
#[inline(never)]
fn window_step(r: Fr, table: &[Fr], w: u8) -> Fr {
    let mut result = r.square().square().square().square();
    if w != 0 {
        result = result.mul(&table[w as usize]);
    }
    result
}

/// Montgomery multiplication using CIOS (Coarsely Integrated Operand Scanning)
///
/// Computes: (a * b * R^(-1)) mod MODULUS
/// With a, b in Montgomery form, this gives (aR * bR * R^(-1)) mod r = (ab)R mod r
#[inline(always)]
fn mont_mul(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    // CIOS algorithm: interleaves multiplication and reduction
    let mut t = [0u64; 5]; // 5 limbs for intermediate result

    for i in 0..4 {
        // Step 1: t += a[i] * b
        let mut carry: u64 = 0;
        for j in 0..4 {
            let (lo, hi) = mac(t[j], a[i], b[j], carry);
            t[j] = lo;
            carry = hi;
        }
        let (sum, _) = t[4].overflowing_add(carry);
        t[4] = sum;

        // Step 2: Montgomery reduction
        let m = t[0].wrapping_mul(INV);
        let (lo, hi) = mac(t[0], m, MODULUS[0], 0);
        let mut carry: u64 = hi;
        let _ = lo; // t[0] becomes 0 (by design of INV)

        for j in 1..4 {
            let (lo, hi) = mac(t[j], m, MODULUS[j], carry);
            t[j - 1] = lo;
            carry = hi;
        }
        let (sum, overflow) = t[4].overflowing_add(carry);
        t[3] = sum;
        t[4] = overflow as u64;
    }

    // Final conditional subtraction
    let mut result = [t[0], t[1], t[2], t[3]];
    if t[4] != 0 || gte(&result, &MODULUS) {
        sub_assign(&mut result, &MODULUS);
    }
    result
}

/// Modular addition: (a + b) mod MODULUS
#[inline(always)]
fn mont_add(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    let mut result = [0u64; 4];
    let mut carry = 0u64;

    for i in 0..4 {
        let (sum, c1) = a[i].overflowing_add(b[i]);
        let (sum2, c2) = sum.overflowing_add(carry);
        result[i] = sum2;
        carry = (c1 as u64) + (c2 as u64);
    }

    // Reduce if result >= MODULUS
    if carry != 0 || gte(&result, &MODULUS) {
        sub_assign(&mut result, &MODULUS);
    }
    result
}

/// Modular subtraction: (a - b) mod MODULUS
#[inline(always)]
fn mont_sub(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    let mut result = [0u64; 4];
    let mut borrow = 0u64;

    for i in 0..4 {
        let (diff, b1) = a[i].overflowing_sub(b[i]);
        let (diff2, b2) = diff.overflowing_sub(borrow);
        result[i] = diff2;
        borrow = (b1 as u64) + (b2 as u64);
    }

    // If a < b, add MODULUS
    if borrow != 0 {
        let mut carry = 0u64;
        for i in 0..4 {
            let (sum, c1) = result[i].overflowing_add(MODULUS[i]);
            let (sum2, c2) = sum.overflowing_add(carry);
            result[i] = sum2;
            carry = (c1 as u64) + (c2 as u64);
        }
    }
    result
}

/// Multiply-accumulate: returns (lo, hi) where lo + hi*2^64 = a + b*c + d
#[inline(always)]
fn mac(a: u64, b: u64, c: u64, d: u64) -> (u64, u64) {
    let full = (a as u128) + (b as u128) * (c as u128) + (d as u128);
    (full as u64, (full >> 64) as u64)
}

/// Check if a >= b (little-endian limbs)
#[inline(always)]
fn gte(a: &[u64; 4], b: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] > b[i] {
            return true;
        }
        if a[i] < b[i] {
            return false;
        }
    }
    true // equal
}

/// Subtract b from a in place (a -= b), assumes a >= b
#[inline(always)]
fn sub_assign(a: &mut [u64; 4], b: &[u64; 4]) {
    let mut borrow = 0u64;
    for i in 0..4 {
        let (diff, b1) = a[i].overflowing_sub(b[i]);
        let (diff2, b2) = diff.overflowing_sub(borrow);
        a[i] = diff2;
        borrow = (b1 as u64) + (b2 as u64);
    }
}

// ============================================================================
// Byte conversion helpers
// ============================================================================

/// Convert 32-byte big-endian to [u64; 4] little-endian limbs
#[inline]
fn be_bytes_to_limbs(bytes: &[u8]) -> [u64; 4] {
    [
        u64::from_be_bytes([bytes[24], bytes[25], bytes[26], bytes[27],
                           bytes[28], bytes[29], bytes[30], bytes[31]]),
        u64::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19],
                           bytes[20], bytes[21], bytes[22], bytes[23]]),
        u64::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]]),
        u64::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3],
                           bytes[4], bytes[5], bytes[6], bytes[7]]),
    ]
}

/// Convert [u64; 4] little-endian limbs to 32-byte big-endian
#[inline]
fn limbs_to_be_bytes(limbs: &[u64; 4]) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    let b3 = limbs[3].to_be_bytes();
    let b2 = limbs[2].to_be_bytes();
    let b1 = limbs[1].to_be_bytes();
    let b0 = limbs[0].to_be_bytes();
    bytes[0..8].copy_from_slice(&b3);
    bytes[8..16].copy_from_slice(&b2);
    bytes[16..24].copy_from_slice(&b1);
    bytes[24..32].copy_from_slice(&b0);
    bytes
}

/// Base field subtraction for G1 point negation: result = a - b (big-endian bytes)
#[inline(always)]
fn fq_sub(a: &[u8], b: &[u8], result: &mut [u8]) {
    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        let diff = (a[i] as u16).wrapping_sub(b[i] as u16).wrapping_sub(borrow);
        borrow = (diff >> 8) & 1;
        result[i] = diff as u8;
    }
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
    fn test_fr_zero_one() {
        let zero = Fr::zero();
        let one = Fr::one();
        assert!(zero.is_zero());
        assert!(!one.is_zero());
    }

    #[test]
    fn test_fr_add() {
        let one = Fr::one();
        let two = one.add(&one);
        let three = two.add(&one);
        assert_eq!(three, Fr::from_u64(3));
    }

    #[test]
    fn test_fr_sub() {
        let five = Fr::from_u64(5);
        let three = Fr::from_u64(3);
        let two = five.sub(&three);
        assert_eq!(two, Fr::from_u64(2));
    }

    #[test]
    fn test_fr_sub_underflow() {
        let three = Fr::from_u64(3);
        let five = Fr::from_u64(5);
        let result = three.sub(&five); // should be r - 2
        let back = result.add(&five);
        assert_eq!(back, three);
    }

    #[test]
    fn test_fr_mul() {
        let three = Fr::from_u64(3);
        let seven = Fr::from_u64(7);
        let twenty_one = three.mul(&seven);
        assert_eq!(twenty_one, Fr::from_u64(21));
    }

    #[test]
    fn test_fr_negate() {
        let five = Fr::from_u64(5);
        let neg_five = five.negate();
        let zero = five.add(&neg_five);
        assert!(zero.is_zero());
    }

    #[test]
    fn test_fr_inverse() {
        let seven = Fr::from_u64(7);
        let inv = seven.inverse().unwrap();
        let product = seven.mul(&inv);
        assert_eq!(product, Fr::one());
    }

    #[test]
    fn test_fr_inverse_larger() {
        let val = Fr::from_u64(123456789);
        let inv = val.inverse().unwrap();
        let product = val.mul(&inv);
        assert_eq!(product, Fr::one());
    }

    #[test]
    fn test_fr_zero_inverse() {
        assert!(Fr::zero().inverse().is_none());
    }

    #[test]
    fn test_fr_from_to_bytes_roundtrip() {
        // Test with a known value
        let mut bytes = [0u8; 32];
        bytes[31] = 42;
        let fr = Fr::from_bytes(&bytes).unwrap();
        let back = fr.to_bytes();
        assert_eq!(bytes, back);
    }

    #[test]
    fn test_fr_from_to_bytes_larger() {
        let bytes: [u8; 32] = [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef,
            0xca, 0xfe, 0xba, 0xbe, 0x12, 0x34, 0x56, 0x78,
        ];
        let fr = Fr::from_bytes(&bytes).unwrap();
        let back = fr.to_bytes();
        assert_eq!(bytes, back);
    }

    #[test]
    fn test_fr_one_bytes() {
        let one = Fr::one();
        let bytes = one.to_bytes();
        let mut expected = [0u8; 32];
        expected[31] = 1;
        assert_eq!(bytes, expected);
    }

    #[test]
    fn test_fr_from_u64() {
        let val = Fr::from_u64(42);
        let bytes = val.to_bytes();
        let mut expected = [0u8; 32];
        expected[31] = 42;
        assert_eq!(bytes, expected);
    }

    #[test]
    fn test_batch_inverse() {
        let vals = [Fr::from_u64(3), Fr::from_u64(7), Fr::from_u64(11)];
        let inverses = Fr::batch_inverse(&vals);
        for (v, inv) in vals.iter().zip(inverses.iter()) {
            assert_eq!(v.mul(inv), Fr::one());
        }
    }

    #[test]
    fn test_batch_inverse_with_zero() {
        let vals = [Fr::from_u64(3), Fr::zero(), Fr::from_u64(11)];
        let inverses = Fr::batch_inverse(&vals);
        assert_eq!(vals[0].mul(&inverses[0]), Fr::one());
        assert!(inverses[1].is_zero());
        assert_eq!(vals[2].mul(&inverses[2]), Fr::one());
    }

    #[test]
    fn test_fr_square() {
        let five = Fr::from_u64(5);
        assert_eq!(five.square(), Fr::from_u64(25));
    }

    #[test]
    fn test_fr_operations_combined() {
        let one = Fr::one();
        let zero = Fr::zero();
        let sum = zero.add(&one);
        assert_eq!(sum, one);

        let diff = one.sub(&one);
        assert!(diff.is_zero());
    }

    #[test]
    fn test_g1_negate() {
        let id = G1Point::identity();
        let neg_id = id.negate();
        assert!(neg_id.is_identity());
    }

    #[test]
    fn test_montgomery_constants() {
        // Verify R is 1 in Montgomery form by converting back
        let one_mont = Fr(R);
        let one_bytes = one_mont.to_bytes();
        let mut expected = [0u8; 32];
        expected[31] = 1;
        assert_eq!(one_bytes, expected, "R should decode to 1");
    }

    #[test]
    fn test_bary_domain_constants() {
        // Verify precomputed domain values match Fr::from_u64(i)
        for i in 0..8 {
            let computed = Fr::from_u64(i as u64);
            let precomputed = Fr(BARY_DOMAIN[i]);
            assert_eq!(computed, precomputed, "BARY_DOMAIN[{i}] mismatch");
        }
    }

    #[test]
    fn test_bary_denom_inv_constants() {
        // Verify precomputed denominator inverses
        let denoms: [i64; 8] = [5040, -720, 240, -120, 48, -24, 6, -1];
        for i in 0..8 {
            let d_fr = if denoms[i] >= 0 {
                Fr::from_u64(denoms[i] as u64)
            } else {
                Fr::from_u64((-denoms[i]) as u64).negate()
            };
            let inv = Fr(BARY_DENOM_INV[i]);
            let product = d_fr.mul(&inv);
            assert_eq!(product, Fr::one(), "BARY_DENOM_INV[{i}] * d[{i}] != 1");
        }
    }
}
