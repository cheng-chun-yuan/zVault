//! UltraHonk CPI verification utilities
//!
//! Cross-Program Invocation to the UltraHonk verifier program for
//! client-side (browser/mobile) ZK proof verification.
//!
//! # Architecture
//! ```text
//! Browser/Mobile (bb.js/mopro)    zVault Program         UltraHonk Verifier
//! ┌─────────────────────────┐    ┌──────────────┐       ┌─────────────────┐
//! │ Generate UltraHonk      │    │              │  CPI  │                 │
//! │ proof (~12KB)           │───>│ claim_ultra  │──────>│ verify_proof()  │
//! │                         │    │              │       │                 │
//! └─────────────────────────┘    └──────────────┘       └─────────────────┘
//! ```

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// UltraHonk verifier program ID (devnet deployment)
pub const ULTRAHONK_VERIFIER_PROGRAM_ID: Pubkey = [
    0x41, 0x7b, 0x8c, 0x9d, 0x2e, 0x3f, 0x4a, 0x5b,
    0x6c, 0x7d, 0x8e, 0x9f, 0xa0, 0xb1, 0xc2, 0xd3,
    0xe4, 0xf5, 0x06, 0x17, 0x28, 0x39, 0x4a, 0x5b,
    0x6c, 0x7d, 0x8e, 0x9f, 0xa0, 0xb1, 0xc2, 0xd3,
];

/// UltraHonk instruction discriminators (must match ultrahonk-verifier)
pub mod ultrahonk_instruction {
    pub const VERIFY: u8 = 0;
    pub const VERIFY_WITH_VK_ACCOUNT: u8 = 1;
}

/// Maximum UltraHonk proof size (typically 8-16KB)
pub const MAX_ULTRAHONK_PROOF_SIZE: usize = 20_000;

/// UltraHonk proof wrapper
pub struct UltraHonkProof<'a> {
    /// Raw proof bytes from bb.js/mopro
    pub proof_bytes: &'a [u8],
    /// Public inputs (each 32 bytes)
    pub public_inputs: &'a [[u8; 32]],
    /// VK hash for verification key lookup
    pub vk_hash: [u8; 32],
}

impl<'a> UltraHonkProof<'a> {
    /// Parse UltraHonk proof from instruction data
    ///
    /// Format:
    /// - proof_len (4 bytes, LE)
    /// - proof_bytes (proof_len bytes)
    /// - public_inputs_count (4 bytes, LE)
    /// - public_inputs (count × 32 bytes)
    /// - vk_hash (32 bytes)
    pub fn from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < 8 {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse proof length
        let proof_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

        if proof_len > MAX_ULTRAHONK_PROOF_SIZE {
            return Err(ProgramError::InvalidInstructionData);
        }

        if data.len() < 4 + proof_len + 4 {
            return Err(ProgramError::InvalidInstructionData);
        }

        let proof_bytes = &data[4..4 + proof_len];

        // Parse public inputs count
        let pi_offset = 4 + proof_len;
        let pi_count = u32::from_le_bytes([
            data[pi_offset],
            data[pi_offset + 1],
            data[pi_offset + 2],
            data[pi_offset + 3],
        ]) as usize;

        let pi_start = pi_offset + 4;
        let pi_end = pi_start + pi_count * 32;

        if data.len() < pi_end + 32 {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Parse VK hash
        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[pi_end..pi_end + 32]);

        // Note: public_inputs need to be parsed from contiguous bytes
        // For now, return empty - caller should parse separately
        Ok(Self {
            proof_bytes,
            public_inputs: &[], // Parsed separately due to lifetime constraints
            vk_hash,
        })
    }
}

/// Build instruction data for UltraHonk CPI verification
///
/// Format matches ultrahonk-verifier's VERIFY instruction
pub fn build_ultrahonk_verify_data(
    proof_bytes: &[u8],
    public_inputs: &[[u8; 32]],
    vk_hash: &[u8; 32],
) -> Vec<u8> {
    let proof_len = proof_bytes.len();
    let pi_count = public_inputs.len();

    // Total size: discriminator(1) + proof_len(4) + proof + pi_count(4) + pi_bytes + vk_hash(32)
    let total_size = 1 + 4 + proof_len + 4 + (pi_count * 32) + 32;
    let mut data = Vec::with_capacity(total_size);

    // Discriminator
    data.push(ultrahonk_instruction::VERIFY);

    // Proof length (little-endian)
    data.extend_from_slice(&(proof_len as u32).to_le_bytes());

    // Proof bytes
    data.extend_from_slice(proof_bytes);

    // Public inputs count (little-endian)
    data.extend_from_slice(&(pi_count as u32).to_le_bytes());

    // Public inputs
    for pi in public_inputs {
        data.extend_from_slice(pi);
    }

    // VK hash
    data.extend_from_slice(vk_hash);

    data
}

/// Verify UltraHonk proof via CPI to ultrahonk-verifier program
///
/// # Arguments
/// * `verifier_program` - The UltraHonk verifier program account
/// * `proof_bytes` - Raw proof from bb.js/mopro
/// * `public_inputs` - Public inputs for the circuit
/// * `vk_hash` - Hash of the verification key
///
/// # Returns
/// * `Ok(())` if proof is valid
/// * `Err(ProgramError)` if proof is invalid or CPI fails
pub fn verify_ultrahonk_proof_cpi(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    public_inputs: &[[u8; 32]],
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    // Build instruction data
    let ix_data = build_ultrahonk_verify_data(proof_bytes, public_inputs, vk_hash);

    // Create CPI instruction (no accounts needed for basic verification)
    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: &[],
        data: &ix_data,
    };

    // Invoke the verifier program
    // If verification fails, the verifier program returns an error
    invoke(&instruction, &[])?;

    Ok(())
}

/// Verify UltraHonk proof with VK account via CPI
///
/// This variant loads the verification key from an on-chain account
/// instead of using a VK hash lookup.
///
/// # Arguments
/// * `verifier_program` - The UltraHonk verifier program account
/// * `vk_account` - The verification key account
/// * `proof_bytes` - Raw proof from bb.js/mopro
/// * `public_inputs` - Public inputs for the circuit
pub fn verify_ultrahonk_proof_with_vk_cpi(
    verifier_program: &AccountInfo,
    vk_account: &AccountInfo,
    proof_bytes: &[u8],
    public_inputs: &[[u8; 32]],
) -> Result<(), ProgramError> {
    let proof_len = proof_bytes.len();
    let pi_count = public_inputs.len();

    // Build instruction data (without vk_hash)
    let total_size = 1 + 4 + proof_len + 4 + (pi_count * 32);
    let mut ix_data = Vec::with_capacity(total_size);

    // Discriminator
    ix_data.push(ultrahonk_instruction::VERIFY_WITH_VK_ACCOUNT);

    // Proof length
    ix_data.extend_from_slice(&(proof_len as u32).to_le_bytes());

    // Proof bytes
    ix_data.extend_from_slice(proof_bytes);

    // Public inputs count
    ix_data.extend_from_slice(&(pi_count as u32).to_le_bytes());

    // Public inputs
    for pi in public_inputs {
        ix_data.extend_from_slice(pi);
    }

    // Account meta for VK account
    let account_metas = [AccountMeta::readonly(vk_account.key())];

    // Create CPI instruction
    let instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: &account_metas,
        data: &ix_data,
    };

    // Invoke with VK account
    invoke(&instruction, &[vk_account])?;

    Ok(())
}

/// Verify claim proof for UltraHonk (browser/mobile generated)
///
/// Public inputs: [root, nullifier_hash, amount, recipient]
pub fn verify_ultrahonk_claim_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    amount: u64,
    recipient: &[u8; 32],
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    // Encode amount as 32-byte field element (big-endian)
    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..32].copy_from_slice(&amount.to_be_bytes());

    let public_inputs = [
        *root,
        *nullifier_hash,
        amount_bytes,
        *recipient,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

/// Verify split proof for UltraHonk
///
/// Public inputs: [root, nullifier_hash, output_commitment_1, output_commitment_2]
pub fn verify_ultrahonk_split_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    output_commitment_1: &[u8; 32],
    output_commitment_2: &[u8; 32],
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    let public_inputs = [
        *root,
        *nullifier_hash,
        *output_commitment_1,
        *output_commitment_2,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

/// Verify spend partial public proof for UltraHonk
///
/// Public inputs: [root, nullifier_hash, public_amount, change_commitment, recipient]
pub fn verify_ultrahonk_spend_partial_public_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    public_amount: u64,
    change_commitment: &[u8; 32],
    recipient: &[u8; 32],
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    // Encode amount as 32-byte field element
    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..32].copy_from_slice(&public_amount.to_be_bytes());

    let public_inputs = [
        *root,
        *nullifier_hash,
        amount_bytes,
        *change_commitment,
        *recipient,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

// =============================================================================
// Pool Proof Verification Functions
// =============================================================================

/// Verify pool deposit proof for UltraHonk
///
/// Public inputs: [input_merkle_root, input_nullifier_hash, pool_commitment, principal]
pub fn verify_ultrahonk_pool_deposit_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    input_merkle_root: &[u8; 32],
    input_nullifier_hash: &[u8; 32],
    pool_commitment: &[u8; 32],
    principal: u64,
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    let mut principal_bytes = [0u8; 32];
    principal_bytes[24..32].copy_from_slice(&principal.to_be_bytes());

    let public_inputs = [
        *input_merkle_root,
        *input_nullifier_hash,
        *pool_commitment,
        principal_bytes,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

/// Verify pool withdraw proof for UltraHonk
///
/// Public inputs: [pool_merkle_root, pool_nullifier_hash, output_commitment, current_epoch, yield_rate_bps]
pub fn verify_ultrahonk_pool_withdraw_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    pool_merkle_root: &[u8; 32],
    pool_nullifier_hash: &[u8; 32],
    output_commitment: &[u8; 32],
    current_epoch: u64,
    yield_rate_bps: u16,
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    let mut epoch_bytes = [0u8; 32];
    epoch_bytes[24..32].copy_from_slice(&current_epoch.to_be_bytes());

    let mut rate_bytes = [0u8; 32];
    rate_bytes[30..32].copy_from_slice(&yield_rate_bps.to_be_bytes());

    let public_inputs = [
        *pool_merkle_root,
        *pool_nullifier_hash,
        *output_commitment,
        epoch_bytes,
        rate_bytes,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

/// Verify pool claim yield proof for UltraHonk
///
/// Public inputs: [pool_merkle_root, old_nullifier_hash, new_pool_commitment, yield_commitment, current_epoch, yield_rate_bps]
#[allow(clippy::too_many_arguments)]
pub fn verify_ultrahonk_pool_claim_yield_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    pool_merkle_root: &[u8; 32],
    old_nullifier_hash: &[u8; 32],
    new_pool_commitment: &[u8; 32],
    yield_commitment: &[u8; 32],
    current_epoch: u64,
    yield_rate_bps: u16,
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    let mut epoch_bytes = [0u8; 32];
    epoch_bytes[24..32].copy_from_slice(&current_epoch.to_be_bytes());

    let mut rate_bytes = [0u8; 32];
    rate_bytes[30..32].copy_from_slice(&yield_rate_bps.to_be_bytes());

    let public_inputs = [
        *pool_merkle_root,
        *old_nullifier_hash,
        *new_pool_commitment,
        *yield_commitment,
        epoch_bytes,
        rate_bytes,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

/// Verify pool compound proof for UltraHonk
///
/// Public inputs: [pool_merkle_root, old_nullifier_hash, new_pool_commitment, current_epoch, yield_rate_bps]
pub fn verify_ultrahonk_pool_compound_proof(
    verifier_program: &AccountInfo,
    proof_bytes: &[u8],
    pool_merkle_root: &[u8; 32],
    old_nullifier_hash: &[u8; 32],
    new_pool_commitment: &[u8; 32],
    current_epoch: u64,
    yield_rate_bps: u16,
    vk_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    let mut epoch_bytes = [0u8; 32];
    epoch_bytes[24..32].copy_from_slice(&current_epoch.to_be_bytes());

    let mut rate_bytes = [0u8; 32];
    rate_bytes[30..32].copy_from_slice(&yield_rate_bps.to_be_bytes());

    let public_inputs = [
        *pool_merkle_root,
        *old_nullifier_hash,
        *new_pool_commitment,
        epoch_bytes,
        rate_bytes,
    ];

    verify_ultrahonk_proof_cpi(verifier_program, proof_bytes, &public_inputs, vk_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_verify_data() {
        let proof = [1u8; 100];
        let pi1 = [2u8; 32];
        let pi2 = [3u8; 32];
        let vk_hash = [4u8; 32];

        let data = build_ultrahonk_verify_data(&proof, &[pi1, pi2], &vk_hash);

        // Verify structure
        assert_eq!(data[0], ultrahonk_instruction::VERIFY);
        assert_eq!(u32::from_le_bytes([data[1], data[2], data[3], data[4]]), 100);
        assert_eq!(&data[5..105], &proof);
        assert_eq!(u32::from_le_bytes([data[105], data[106], data[107], data[108]]), 2);
    }
}
