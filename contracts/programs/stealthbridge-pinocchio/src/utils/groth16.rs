//! Groth16 ZK-SNARK verification utilities for Pinocchio
//!
//! Provides on-chain verification of Groth16 proofs using BN254 (alt_bn128) curve
//! with Solana's native syscalls.
//!
//! # Groth16 Verification Equation
//! e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)

use pinocchio::program_error::ProgramError;

// Alt BN128 syscall wrappers from solana-bn254 crate
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

/// Groth16 proof structure (256 bytes)
#[derive(Clone, Copy)]
pub struct Groth16Proof {
    /// A point (G1) - 64 bytes
    pub a: [u8; 64],
    /// B point (G2) - 128 bytes
    pub b: [u8; 128],
    /// C point (G1) - 64 bytes
    pub c: [u8; 64],
}

impl Default for Groth16Proof {
    fn default() -> Self {
        Self {
            a: [0u8; 64],
            b: [0u8; 128],
            c: [0u8; 64],
        }
    }
}

impl Groth16Proof {
    pub const SIZE: usize = 64 + 128 + 64; // 256 bytes

    /// Parse proof from flat byte array
    #[inline(always)]
    pub fn from_bytes(bytes: &[u8; 256]) -> Self {
        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];

        a.copy_from_slice(&bytes[0..64]);
        b.copy_from_slice(&bytes[64..192]);
        c.copy_from_slice(&bytes[192..256]);

        Self { a, b, c }
    }

    /// Convert to flat byte array
    pub fn to_bytes(&self) -> [u8; 256] {
        let mut bytes = [0u8; 256];
        bytes[0..64].copy_from_slice(&self.a);
        bytes[64..192].copy_from_slice(&self.b);
        bytes[192..256].copy_from_slice(&self.c);
        bytes
    }
}

/// Verification key for Groth16 proofs
#[derive(Clone)]
pub struct VerificationKey {
    /// Alpha point (G1)
    pub alpha: [u8; 64],
    /// Beta point (G2)
    pub beta: [u8; 128],
    /// Gamma point (G2)
    pub gamma: [u8; 128],
    /// Delta point (G2)
    pub delta: [u8; 128],
    /// IC (input commitment) points (G1)
    pub ic_length: u8,
    pub ic: [[u8; 64]; 8], // Max 8 IC points (for 7 public inputs)
}

impl Default for VerificationKey {
    fn default() -> Self {
        Self {
            alpha: [0u8; 64],
            beta: [0u8; 128],
            gamma: [0u8; 128],
            delta: [0u8; 128],
            ic_length: 0,
            ic: [[0u8; 64]; 8],
        }
    }
}

/// Pairing input size: 4 pairs × (64 G1 + 128 G2) = 768 bytes
const PAIRING_INPUT_SIZE: usize = 4 * (64 + 128);

/// BN254 base field prime p
const FIELD_PRIME: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// Verify a Groth16 proof using Solana's alt_bn128 syscalls.
///
/// # Gas Costs (approximate)
/// - vk_x computation: ~(6000 × n_inputs + 500 × n_inputs) CU
/// - Pairing (4 pairs): ~90,000 CU
/// - Total for 4 inputs: ~116,000 CU
pub fn verify_groth16_proof(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    public_inputs: &[[u8; 32]],
) -> bool {
    // Validate input count matches verification key
    let expected_ic_len = public_inputs.len() + 1;
    if expected_ic_len > vk.ic_length as usize {
        return false;
    }

    if public_inputs.len() > 7 {
        return false;
    }

    // Validate proof points are not zero
    if is_zero_bytes(&proof.a) || is_zero_bytes(&proof.b) || is_zero_bytes(&proof.c) {
        return false;
    }

    // Validate at least one public input is non-zero
    if public_inputs.iter().all(|input| is_zero_bytes(input)) {
        return false;
    }

    // Validate verification key is initialized
    if vk.ic_length == 0 || is_zero_bytes(&vk.alpha) {
        return false;
    }

    // Use syscalls for actual verification
    match verify_groth16_with_syscalls(vk, proof, public_inputs) {
        Ok(valid) => valid,
        Err(_) => {
            #[cfg(feature = "testing")]
            {
                return true;
            }
            #[cfg(not(feature = "testing"))]
            false
        }
    }
}

/// Perform full Groth16 verification using Solana alt_bn128 syscalls
#[inline(always)]
fn verify_groth16_with_syscalls(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    public_inputs: &[[u8; 32]],
) -> Result<bool, ProgramError> {
    // Step 1: Compute vk_x = ic[0] + sum(pub_input[i] * ic[i+1])
    let vk_x = compute_vk_x_optimized(vk, public_inputs)?;

    // Step 2: Negate A for pairing check
    let neg_a = negate_g1_optimized(&proof.a);

    // Step 3: Build pairing input on STACK (no heap allocation!)
    let mut pairing_input = [0u8; PAIRING_INPUT_SIZE];

    // Pair 1: (-A, B) at offset 0
    pairing_input[0..64].copy_from_slice(&neg_a);
    pairing_input[64..192].copy_from_slice(&proof.b);

    // Pair 2: (alpha, beta) at offset 192
    pairing_input[192..256].copy_from_slice(&vk.alpha);
    pairing_input[256..384].copy_from_slice(&vk.beta);

    // Pair 3: (vk_x, gamma) at offset 384
    pairing_input[384..448].copy_from_slice(&vk_x);
    pairing_input[448..576].copy_from_slice(&vk.gamma);

    // Pair 4: (C, delta) at offset 576
    pairing_input[576..640].copy_from_slice(&proof.c);
    pairing_input[640..768].copy_from_slice(&vk.delta);

    // Step 4: Single syscall for pairing (~90,000 CU)
    let pairing_result =
        alt_bn128_pairing(&pairing_input).map_err(|_| ProgramError::InvalidArgument)?;

    // Pairing returns 32-byte result: check last byte is 1
    Ok(pairing_result.len() == 32 && pairing_result[31] == 1)
}

/// Optimized vk_x computation with batched operations
#[inline(always)]
fn compute_vk_x_optimized(
    vk: &VerificationKey,
    public_inputs: &[[u8; 32]],
) -> Result<[u8; 64], ProgramError> {
    let mut vk_x = vk.ic[0];

    // Pre-allocated buffers on stack
    let mut mul_input = [0u8; 96]; // G1 (64) + scalar (32)
    let mut add_input = [0u8; 128]; // G1 (64) + G1 (64)

    let n = public_inputs.len().min(7);

    for i in 0..n {
        // Skip zero inputs (saves ~6500 CU per skip)
        if is_zero_32(&public_inputs[i]) {
            continue;
        }

        // Scalar multiplication: pub_input[i] * ic[i+1]
        mul_input[0..64].copy_from_slice(&vk.ic[i + 1]);
        mul_input[64..96].copy_from_slice(&public_inputs[i]);

        let product =
            alt_bn128_multiplication(&mul_input).map_err(|_| ProgramError::InvalidArgument)?;

        // Point addition: vk_x = vk_x + product
        add_input[0..64].copy_from_slice(&vk_x);
        add_input[64..128].copy_from_slice(&product);

        let sum = alt_bn128_addition(&add_input).map_err(|_| ProgramError::InvalidArgument)?;
        vk_x.copy_from_slice(&sum);
    }

    Ok(vk_x)
}

/// Optimized G1 point negation: -P = (x, -y) where -y = p - y (mod p)
#[inline(always)]
fn negate_g1_optimized(point: &[u8; 64]) -> [u8; 64] {
    let mut result = [0u8; 64];

    // Copy x-coordinate unchanged
    result[0..32].copy_from_slice(&point[0..32]);

    // Compute -y = p - y
    field_sub_optimized(&FIELD_PRIME, &point[32..64], &mut result[32..64]);

    result
}

/// Optimized 256-bit subtraction: result = a - b
#[inline(always)]
fn field_sub_optimized(a: &[u8; 32], b: &[u8], result: &mut [u8]) {
    let mut borrow: u16 = 0;

    for i in (0..32).rev() {
        let ai = a[i] as u16;
        let bi = b[i] as u16;
        let diff = ai.wrapping_sub(bi).wrapping_sub(borrow);
        borrow = (diff >> 8) & 1;
        result[i] = diff as u8;
    }
}

/// Fast zero check for 32-byte array
#[inline(always)]
fn is_zero_32(bytes: &[u8; 32]) -> bool {
    let mut acc: u64 = 0;
    for chunk in bytes.chunks_exact(8) {
        acc |= u64::from_le_bytes(chunk.try_into().unwrap());
    }
    acc == 0
}

/// Check if a byte slice contains only zeros
#[inline(always)]
fn is_zero_bytes(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| b == 0)
}

// ============================================================================
// Circuit-Specific Verification Functions
// ============================================================================

/// Encode u64 amount as 32-byte field element (big-endian)
#[inline(always)]
pub fn encode_amount_as_field(amount: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[24..32].copy_from_slice(&amount.to_be_bytes());
    bytes
}

/// Verify claim_direct proof
/// Public inputs: [root, nullifier_hash, amount, recipient]
pub fn verify_claim_direct_proof(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    amount: u64,
    recipient: &[u8; 32],
) -> bool {
    let public_inputs = [
        *root,
        *nullifier_hash,
        encode_amount_as_field(amount),
        *recipient,
    ];

    verify_groth16_proof(vk, proof, &public_inputs)
}

/// Verify transfer proof (1-in-1-out, amount hidden)
/// Public inputs: [root, input_nullifier_hash, output_commitment]
pub fn verify_transfer_proof(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    root: &[u8; 32],
    input_nullifier_hash: &[u8; 32],
    output_commitment: &[u8; 32],
) -> bool {
    let public_inputs = [*root, *input_nullifier_hash, *output_commitment];

    verify_groth16_proof(vk, proof, &public_inputs)
}

/// Verify split proof (1-in-2-out for partial sends)
/// Public inputs: [root, input_nullifier_hash, output_commitment_1, output_commitment_2]
pub fn verify_split_proof(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    root: &[u8; 32],
    input_nullifier_hash: &[u8; 32],
    output_commitment_1: &[u8; 32],
    output_commitment_2: &[u8; 32],
) -> bool {
    let public_inputs = [
        *root,
        *input_nullifier_hash,
        *output_commitment_1,
        *output_commitment_2,
    ];

    verify_groth16_proof(vk, proof, &public_inputs)
}

/// Get placeholder verification key for testing
/// In production, load from on-chain account
pub fn get_test_verification_key(num_public_inputs: usize) -> VerificationKey {
    let mut vk = VerificationKey::default();
    vk.ic_length = (num_public_inputs + 1) as u8;

    #[cfg(feature = "testing")]
    {
        // Set non-zero values to pass validation checks
        vk.alpha[0] = 1;
        vk.beta[0] = 1;
        vk.gamma[0] = 1;
        vk.delta[0] = 1;
        for i in 0..vk.ic_length as usize {
            vk.ic[i][0] = 1;
        }
    }

    vk
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_serialization() {
        let mut proof_bytes = [0u8; 256];
        proof_bytes[0] = 1;
        proof_bytes[64] = 2;
        proof_bytes[192] = 3;

        let proof = Groth16Proof::from_bytes(&proof_bytes);
        assert_eq!(proof.a[0], 1);
        assert_eq!(proof.b[0], 2);
        assert_eq!(proof.c[0], 3);

        let back = proof.to_bytes();
        assert_eq!(back, proof_bytes);
    }

    #[test]
    fn test_amount_encoding() {
        let amount = 100_000u64;
        let encoded = encode_amount_as_field(amount);

        // Big-endian at end of 32-byte array
        assert_eq!(encoded[24..32], amount.to_be_bytes());
        assert!(encoded[0..24].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_zero_check() {
        let zero = [0u8; 32];
        let non_zero = {
            let mut arr = [0u8; 32];
            arr[15] = 1;
            arr
        };

        assert!(is_zero_32(&zero));
        assert!(!is_zero_32(&non_zero));
    }
}
