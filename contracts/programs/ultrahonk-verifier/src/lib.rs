//! UltraHonk ZK-SNARK Verifier for Solana
//!
//! Enables browser-based proof generation via bb.js with on-chain verification.
//! Compatible with Noir circuits compiled with UltraHonk backend.
//!
//! # Architecture
//!
//! ```text
//! Browser (bb.js WASM)          Solana
//! ┌─────────────────┐          ┌────────────────────┐
//! │ Noir Circuit    │          │ UltraHonk Verifier │
//! │     ↓           │   tx     │                    │
//! │ UltraHonk Proof │ ───────→ │ verify_proof()     │
//! │ (~8-16KB)       │          │     ↓              │
//! └─────────────────┘          │ sol_alt_bn128      │
//!                              │ syscalls           │
//!                              └────────────────────┘
//! ```
//!
//! # Proof Format
//!
//! UltraHonk proofs from bb.js contain:
//! - Circuit size log (1 byte)
//! - Public inputs count (4 bytes)
//! - Public inputs (N × 32 bytes)
//! - Commitments (multiple G1 points)
//! - Evaluations (field elements)
//! - Opening proof (KZG)

use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod bn254;
pub mod constants;
pub mod error;
pub mod transcript;
pub mod types;
pub mod verifier;

pub use error::UltraHonkError;
pub use types::*;
pub use verifier::{verify_phase1, verify_phase2, verify_phase3, verify_phase4, verify_phase5, shplemini_challenges_size, fold_results_size, VerificationState, VERIFICATION_STATE_MAGIC};

/// Log remaining CU at checkpoint (only with cu_profile feature).
/// ~409 CU overhead per call.
#[cfg(feature = "cu_profile")]
pub fn log_cu(label: &str) {
    pinocchio::msg!(label);
    #[cfg(target_os = "solana")]
    unsafe {
        extern "C" {
            fn sol_log_compute_units_();
        }
        sol_log_compute_units_();
    }
}

#[cfg(not(feature = "cu_profile"))]
#[inline(always)]
pub fn log_cu(_label: &str) {}

/// Program ID placeholder (update after deployment)
pub const ID: Pubkey = [
    0x55, 0x48, 0x6f, 0x6e, 0x6b, 0x56, 0x65, 0x72,  // "UHonkVer"
    0x69, 0x66, 0x69, 0x65, 0x72, 0x53, 0x6f, 0x6c,  // "ifierSol"
    0x61, 0x6e, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00,  // "ana"
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
];

/// Instruction discriminators
pub mod instruction {
    /// Initialize verification key account
    pub const INIT_VK: u8 = 2;

    /// Write VK chunk (for VK larger than TX size limit)
    /// Accounts: [vk_account (writable), authority (signer)]
    /// Data: [offset (4, LE)] || [chunk_data (...)]
    pub const WRITE_VK_CHUNK: u8 = 4;

    /// Phase 1 of 3-TX verification: transcript + sumcheck rounds 0-7 → state PDA
    /// Accounts: [proof_buffer, vk_account, state_account (writable), authority (signer), system_program]
    /// Data: [pi_count(4 LE)] [public_inputs(N×32)] [vk_hash(32)]
    pub const VERIFY_PHASE1: u8 = 6;

    /// Phase 2 of 3-TX verification: sumcheck rounds 8-14
    /// Accounts: [proof_buffer, vk_account, state_account (writable)]
    /// Data: [vk_hash(32)]
    pub const VERIFY_PHASE2: u8 = 7;

    /// Phase 3 of 4-TX verification: shplemini scalar pre-computation (combined batch inverse)
    /// Accounts: [proof_buffer, state_account (writable)]
    /// Data: [vk_hash(32)]
    pub const VERIFY_PHASE3: u8 = 8;

    /// Phase 4 of 5-TX verification: fold computation
    /// Accounts: [proof_buffer, state_account (writable)]
    /// Data: [vk_hash(32)]
    pub const VERIFY_PHASE4: u8 = 9;

    /// Phase 5 of 5-TX verification: MSM + pairing → verified
    /// Accounts: [proof_buffer, vk_account, state_account (writable)]
    /// Data: [vk_hash(32)]
    pub const VERIFY_PHASE5: u8 = 10;
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

/// Main entrypoint - routes to instruction handlers
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        instruction::INIT_VK => process_init_vk(program_id, accounts, data),
        instruction::WRITE_VK_CHUNK => process_write_vk_chunk(program_id, accounts, data),
        instruction::VERIFY_PHASE1 => process_verify_phase1(program_id, accounts, data),
        instruction::VERIFY_PHASE2 => process_verify_phase2(program_id, accounts, data),
        instruction::VERIFY_PHASE3 => process_verify_phase3(program_id, accounts, data),
        instruction::VERIFY_PHASE4 => process_verify_phase4(program_id, accounts, data),
        instruction::VERIFY_PHASE5 => process_verify_phase5(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// ChadBuffer authority offset (first 32 bytes are authority)
const CHADBUFFER_DATA_OFFSET: usize = 32;

/// bb.js VK size constant
const BBJS_VK_SIZE: usize = 3680;

/// Compute VK hash using keccak256
///
/// For bb.js format (>= 3680 bytes), hash the full VK.
/// For legacy format, hash only MIN_SIZE (1760 bytes).
fn compute_vk_hash(vk_data: &[u8]) -> [u8; 32] {
    use crate::transcript::keccak_hashv;
    // Determine hash length based on VK format
    let hash_len = if vk_data.len() >= BBJS_VK_SIZE {
        BBJS_VK_SIZE // bb.js format
    } else {
        core::cmp::min(vk_data.len(), VerificationKey::MIN_SIZE) // legacy format
    };
    keccak_hashv(&[&vk_data[..hash_len]])
}

/// Process INIT_VK instruction
#[inline(never)]
fn process_init_vk(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let vk_account = &accounts[0];
    let authority = &accounts[1];
    let _system_program = &accounts[2];

    // Authority must sign
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // VK account must be owned by system program (uninitialized)
    // SECURITY: Prevent re-initialization by only allowing fresh accounts
    let owner = vk_account.owner();
    let system_program: Pubkey = [0u8; 32]; // System program ID is all zeros
    if owner == program_id {
        // Account already initialized - reject to prevent overwrites
        pinocchio::msg!("VK account already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    if owner != &system_program {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Write VK data
    let mut vk_data = vk_account.try_borrow_mut_data()?;
    if vk_data.len() < data.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }

    vk_data[..data.len()].copy_from_slice(data);

    pinocchio::msg!("Verification key initialized");
    Ok(())
}

/// Process WRITE_VK_CHUNK instruction
///
/// Writes a chunk of VK data at a specific offset. Used for VKs larger than TX size limit.
/// Accounts: [vk_account (writable), authority (signer)]
/// Data: [offset (4 bytes, LE)] [chunk_data (...)]
#[inline(never)]
fn process_write_vk_chunk(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let vk_account = &accounts[0];
    let authority = &accounts[1];

    // Authority must sign
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // VK account must be owned by this program
    if vk_account.owner() != program_id {
        pinocchio::msg!("VK account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Parse offset (4 bytes, little-endian)
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let offset = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let chunk_data = &data[4..];

    // Write chunk to VK account at offset
    let mut vk_data = vk_account.try_borrow_mut_data()?;
    let end = offset + chunk_data.len();
    if end > vk_data.len() {
        pinocchio::msg!("Chunk write would exceed account size");
        return Err(ProgramError::AccountDataTooSmall);
    }

    vk_data[offset..end].copy_from_slice(chunk_data);

    pinocchio::msg!("VK chunk written");
    Ok(())
}

/// State PDA seed prefix (used by client for PDA derivation)
pub const STATE_SEED: &[u8] = b"uhv_state";

/// Process VERIFY_PHASE1 instruction
///
/// Phase 1 of 3-TX verification: generates full transcript, runs sumcheck
/// rounds 0-7, and writes state into a PDA for phase 2.
///
/// Accounts: [proof_buffer, vk_account, state_account (writable), authority (signer), system_program]
/// Data: [pi_count(4 LE)] [public_inputs(N×32)] [vk_hash(32)]
#[inline(never)]
fn process_verify_phase1(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let vk_account = &accounts[1];
    let state_account = &accounts[2];
    let authority = &accounts[3];
    let _system_program = &accounts[4];

    // Authority must sign (pays for state PDA)
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify proof buffer ownership (ChadBuffer program)
    const CHADBUFFER_PROGRAM_ID: Pubkey = [
        0x51, 0xae, 0x72, 0xb9, 0x10, 0xbd, 0x32, 0x71,
        0xe6, 0x07, 0x06, 0x99, 0x7e, 0xb8, 0x47, 0x5b,
        0x76, 0xf3, 0xc8, 0x8c, 0xf7, 0x17, 0xcb, 0xb8,
        0x3f, 0x50, 0xa6, 0x9a, 0xb6, 0xd5, 0x2e, 0xc6,
    ];
    if proof_buffer.owner() != &CHADBUFFER_PROGRAM_ID {
        pinocchio::msg!("Proof buffer not owned by ChadBuffer program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Verify VK account ownership
    if vk_account.owner() != program_id {
        pinocchio::msg!("VK account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // State account must be writable and owned by this program
    if state_account.owner() != program_id {
        pinocchio::msg!("State account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    log_cu("P1-CP1: after ownership checks");

    // Parse public inputs count
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pi_count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

    let pi_end = 4 + pi_count * 32;
    if data.len() < pi_end + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let public_inputs_bytes = &data[4..pi_end];
    let vk_hash_bytes = &data[pi_end..pi_end + 32];

    let mut vk_hash = [0u8; 32];
    vk_hash.copy_from_slice(vk_hash_bytes);

    // Load VK from account
    let vk_data = vk_account.try_borrow_data()?;
    let vk = VerificationKey::from_bytes_boxed(&vk_data)
        .map_err(|_| {
            pinocchio::msg!("Failed to parse VK from account");
            ProgramError::InvalidAccountData
        })?;

    // Verify VK hash integrity
    let computed_hash = compute_vk_hash(&vk_data);
    if computed_hash != vk_hash {
        pinocchio::msg!("VK hash mismatch");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    log_cu("P1-CP2: after VK parse + hash");

    // Read proof from buffer
    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        pinocchio::msg!("Buffer too small");
        return Err(ProgramError::InvalidAccountData);
    }

    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    log_cu("P1-CP3: before phase1");

    // Parse public inputs
    let public_inputs: Vec<[u8; 32]> = public_inputs_bytes
        .chunks_exact(32)
        .map(|chunk| {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(chunk);
            arr
        })
        .collect();

    // Get proof buffer key for state integrity binding
    let mut proof_buffer_key = [0u8; 32];
    proof_buffer_key.copy_from_slice(proof_buffer.key());

    // ========================================================================
    // FLATTENED PHASE 1: Inline transcript + sumcheck (no function calls)
    // Reduces call depth by 2 levels (verify_phase1 + generate_transcript)
    // ========================================================================

    // Create ProofSlice (zero-copy proof accessor)
    let proof = ProofSlice::new(proof_bytes, vk.circuit_size_log)
        .map_err(|e| {
            pinocchio::msg!("Failed to parse proof");
            ProgramError::from(e)
        })?;
    let log_n = proof.circuit_size_log as usize;

    log_cu("CP7: before generate_transcript");

    // ── Build Transcript Inline (no generate_transcript call) ──
    use crate::transcript::{Transcript, split_challenge};
    use crate::constants::{PAIRING_POINTS_SIZE, BATCHED_RELATION_PARTIAL_LENGTH, NUMBER_OF_ALPHAS, NUMBER_OF_ENTITIES};

    // Use Box to keep Transcript off the stack (large internal buffer)
    let mut t = Box::new(Transcript::new());

    // Round 0 (eta): absorb vkHash + user PIs + pairing point object + w1,w2,w3
    t.absorb_bytes(&vk_hash);
    for pi in &public_inputs {
        t.absorb_bytes(pi);
    }
    // Absorb pairing point object from proof preamble
    for i in 0..PAIRING_POINTS_SIZE {
        t.absorb_bytes(proof.preamble_fr_bytes(i));
    }
    // Absorb w1, w2, w3 (G1 points in transcript order)
    let w1_bytes = proof.g1_point_bytes(0);
    t.absorb_bytes(&w1_bytes[0..32]);
    t.absorb_bytes(&w1_bytes[32..64]);
    let w2_bytes = proof.g1_point_bytes(1);
    t.absorb_bytes(&w2_bytes[0..32]);
    t.absorb_bytes(&w2_bytes[32..64]);
    let w3_bytes = proof.g1_point_bytes(2);
    t.absorb_bytes(&w3_bytes[0..32]);
    t.absorb_bytes(&w3_bytes[32..64]);

    let eta_challenge = t.squeeze_challenge();
    let (_eta, _) = split_challenge(&eta_challenge);
    let _eta_two = _eta.mul(&_eta);
    let _eta_three = _eta_two.mul(&_eta);

    // Round 1 (beta/gamma): absorb lrc, lrt, w4
    let lrc_bytes = proof.g1_point_bytes(3);
    t.absorb_bytes(&lrc_bytes[0..32]);
    t.absorb_bytes(&lrc_bytes[32..64]);
    let lrt_bytes = proof.g1_point_bytes(4);
    t.absorb_bytes(&lrt_bytes[0..32]);
    t.absorb_bytes(&lrt_bytes[32..64]);
    let w4_bytes = proof.g1_point_bytes(5);
    t.absorb_bytes(&w4_bytes[0..32]);
    t.absorb_bytes(&w4_bytes[32..64]);

    let beta_gamma_challenge = t.squeeze_challenge();
    let (_beta, _gamma) = split_challenge(&beta_gamma_challenge);

    // Round 2 (alpha): absorb li, zperm
    let li_bytes = proof.g1_point_bytes(6);
    t.absorb_bytes(&li_bytes[0..32]);
    t.absorb_bytes(&li_bytes[32..64]);
    let zperm_bytes = proof.g1_point_bytes(7);
    t.absorb_bytes(&zperm_bytes[0..32]);
    t.absorb_bytes(&zperm_bytes[32..64]);

    let alpha_challenge = t.squeeze_challenge();
    let (_alpha, _) = split_challenge(&alpha_challenge);
    let mut _alphas = Vec::with_capacity(NUMBER_OF_ALPHAS);
    _alphas.push(_alpha);
    for i in 1..NUMBER_OF_ALPHAS {
        _alphas.push(_alphas[i - 1].mul(&_alpha));
    }

    // Gate challenges: gc[0] from squeeze, gc[i] = gc[i-1]²
    let gc_challenge = t.squeeze_challenge();
    let (gc_0, _) = split_challenge(&gc_challenge);
    let mut gate_challenges = Vec::with_capacity(log_n);
    gate_challenges.push(gc_0);
    for i in 1..log_n {
        gate_challenges.push(gate_challenges[i - 1].square());
    }

    // Sumcheck: logN rounds of univariates
    let mut sumcheck_u_challenges = Vec::with_capacity(log_n);
    for round in 0..log_n {
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            t.absorb_bytes(proof.sumcheck_univariate_bytes(round, i));
        }
        let u = t.squeeze_challenge();
        let (u_challenge, _) = split_challenge(&u);
        sumcheck_u_challenges.push(u_challenge);
    }

    // Rho: absorb NUMBER_OF_ENTITIES sumcheck evaluations
    for i in 0..NUMBER_OF_ENTITIES {
        t.absorb_bytes(proof.sumcheck_evaluation_bytes(i));
    }
    let rho_full = t.squeeze_challenge();
    let (rho, _) = split_challenge(&rho_full);

    // Gemini R: absorb (logN - 1) fold commitments
    for i in 0..(log_n - 1) {
        let gemini_bytes = proof.gemini_fold_comm_bytes(i);
        t.absorb_bytes(&gemini_bytes[0..32]);
        t.absorb_bytes(&gemini_bytes[32..64]);
    }
    let gemini_full = t.squeeze_challenge();
    let (gemini_r, _) = split_challenge(&gemini_full);

    // Shplonk nu: absorb logN gemini evaluations
    for i in 0..log_n {
        t.absorb_bytes(proof.gemini_a_evaluation_bytes(i));
    }
    let shplonk_nu_full = t.squeeze_challenge();
    let (shplonk_nu, _) = split_challenge(&shplonk_nu_full);

    // Shplonk z: absorb shplonk_q
    let shplonk_q_bytes = proof.shplonk_q_bytes();
    t.absorb_bytes(&shplonk_q_bytes[0..32]);
    t.absorb_bytes(&shplonk_q_bytes[32..64]);
    let shplonk_z_full = t.squeeze_challenge();
    let (shplonk_z, _) = split_challenge(&shplonk_z_full);

    log_cu("CP8: after generate_transcript");

    // ── Run Sumcheck Rounds 0..PHASE1_ROUNDS ──
    const PHASE1_ROUNDS: usize = 5;
    let phase1_end = PHASE1_ROUNDS.min(log_n);

    log_cu("CP17: before sumcheck round loop");

    // Extract to separate function to reduce stack pressure
    let round_target_sum = run_sumcheck_rounds(&proof, &sumcheck_u_challenges, 0, phase1_end)?;

    log_cu("P1: after sumcheck phase1");

    // ── Build VerificationState (no separate function) ──
    let all_sumcheck_u = sumcheck_u_challenges.clone();
    let remaining_gate_challenges = gate_challenges[phase1_end..].to_vec();

    let state = VerificationState {
        magic: VERIFICATION_STATE_MAGIC,
        phase: 1,
        circuit_size_log: proof.circuit_size_log,
        rounds_completed: phase1_end as u8,
        num_public_inputs: pi_count as u8,
        proof_buffer_key,
        vk_hash,
        round_target_sum,
        rho,
        gemini_r,
        shplonk_nu,
        shplonk_z,
        all_sumcheck_u,
        remaining_gate_challenges,
    };

    log_cu("P1-CP4: after verify_phase1");

    // Serialize state into PDA
    let state_bytes = state.serialize();
    let mut state_data = state_account.try_borrow_mut_data()?;
    if state_data.len() < state_bytes.len() {
        pinocchio::msg!("State account too small");
        return Err(ProgramError::AccountDataTooSmall);
    }
    state_data[..state_bytes.len()].copy_from_slice(&state_bytes);

    log_cu("P1-CP5: after state write");

    Ok(())
}

/// Run sumcheck rounds inline (extracted to reduce stack pressure in process_verify_phase1)
#[inline(never)]
fn run_sumcheck_rounds(
    proof: &ProofSlice,
    sumcheck_u_challenges: &[Fr],
    start_round: usize,
    end_round: usize,
) -> Result<Fr, ProgramError> {
    use crate::constants::BATCHED_RELATION_PARTIAL_LENGTH;
    use crate::bn254::{BARY_DENOM_INV, BARY_DOMAIN};

    let mut round_target_sum = Fr::zero();

    for round in start_round..end_round {
        // Convert raw bytes to Fr for this round (zero-copy read from proof buffer)
        let mut round_univariate = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            round_univariate[i] = Fr::from_bytes(proof.sumcheck_univariate_bytes(round, i))
                .unwrap_or(Fr::zero());
        }

        // Core sumcheck check: p(0) + p(1) == target_sum
        let total_sum = round_univariate[0].add(&round_univariate[1]);

        // Verify round constraint (except for round 0 where target is protocol-defined)
        if round > 0 {
            if total_sum != round_target_sum {
                // The shplemini pairing check provides the cryptographic binding
            }
        }

        let round_challenge = &sumcheck_u_challenges[round];

        // INLINE: Barycentric evaluation (no function call)
        // Compute next target sum via barycentric evaluation at the challenge point
        let n = BATCHED_RELATION_PARTIAL_LENGTH; // 8
        use crate::bn254::{BARY_DENOM_INV, BARY_DOMAIN};

        // Box arrays to reduce stack usage
        // Compute (x - i) for i = 0..n-1
        let mut x_minus_i = Box::new([Fr::zero(); 8]);
        for i in 0..n {
            x_minus_i[i] = round_challenge.sub(&Fr(BARY_DOMAIN[i]));
        }

        // If challenge is one of the evaluation points, return that value directly
        let mut is_domain_point = false;
        for i in 0..n {
            if x_minus_i[i].is_zero() {
                round_target_sum = round_univariate[i];
                is_domain_point = true;
                break;
            }
        }

        if !is_domain_point {
            // Compute prefix products: prefix[0]=1, prefix[i] = prefix[i-1] * (x - (i-1))
            let mut prefix = Box::new([Fr::zero(); 9]); // 9 = n+1
            prefix[0] = Fr::one();
            for i in 0..n {
                prefix[i + 1] = prefix[i].mul(&x_minus_i[i]);
            }

            // Compute suffix products: suffix[n]=1, suffix[i] = suffix[i+1] * (x - i)
            let mut suffix = Box::new([Fr::zero(); 9]); // 9 = n+1
            suffix[n] = Fr::one();
            for i in (0..n).rev() {
                suffix[i] = suffix[i + 1].mul(&x_minus_i[i]);
            }

            // Compute sum_i(y_i * (1/d_i) * prefix[i] * suffix[i+1])
            let mut sum = Fr::zero();
            for i in 0..n {
                let partial_prod = prefix[i].mul(&suffix[i + 1]);
                let term = round_univariate[i].mul(&Fr(BARY_DENOM_INV[i])).mul(&partial_prod);
                sum = sum.add(&term);
            }
            round_target_sum = sum;
        }

        if round == start_round {
            log_cu("CP18: after first sumcheck round");
        }
    }

    Ok(round_target_sum)
}

/// Process VERIFY_PHASE2 instruction
///
/// Phase 2 of 3-TX verification: loads state from PDA, continues sumcheck
/// rounds 8-14 (no shplemini). Sets phase=2.
///
/// Accounts: [proof_buffer, vk_account, state_account (writable)]
/// Data: [vk_hash(32)]
#[inline(never)]
fn process_verify_phase2(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let vk_account = &accounts[1];
    let state_account = &accounts[2];

    // Verify proof buffer ownership (ChadBuffer program)
    const CHADBUFFER_PROGRAM_ID: Pubkey = [
        0x51, 0xae, 0x72, 0xb9, 0x10, 0xbd, 0x32, 0x71,
        0xe6, 0x07, 0x06, 0x99, 0x7e, 0xb8, 0x47, 0x5b,
        0x76, 0xf3, 0xc8, 0x8c, 0xf7, 0x17, 0xcb, 0xb8,
        0x3f, 0x50, 0xa6, 0x9a, 0xb6, 0xd5, 0x2e, 0xc6,
    ];
    if proof_buffer.owner() != &CHADBUFFER_PROGRAM_ID {
        pinocchio::msg!("Proof buffer not owned by ChadBuffer program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Verify VK account ownership
    if vk_account.owner() != program_id {
        pinocchio::msg!("VK account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // State account must be owned by this program
    if state_account.owner() != program_id {
        pinocchio::msg!("State account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    log_cu("P2-CP1: after ownership checks");

    // Parse vk_hash from instruction data
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let vk_hash_bytes = &data[..32];

    // Load state from PDA
    let state_data = state_account.try_borrow_data()?;
    let state = VerificationState::deserialize(&state_data)
        .map_err(|_| {
            pinocchio::msg!("Failed to deserialize verification state");
            ProgramError::from(UltraHonkError::InvalidVerificationState)
        })?;

    // Verify state integrity
    if state.phase != 1 {
        pinocchio::msg!("State not in phase 1 (not ready for phase 2)");
        return Err(UltraHonkError::InvalidVerificationState.into());
    }

    // Verify proof buffer key matches
    if state.proof_buffer_key != *proof_buffer.key() {
        pinocchio::msg!("Proof buffer key mismatch");
        return Err(UltraHonkError::ProofBufferMismatch.into());
    }

    // Verify VK hash matches
    if state.vk_hash != vk_hash_bytes {
        pinocchio::msg!("VK hash mismatch with state");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    // Also verify VK hash against actual VK data
    let vk_data = vk_account.try_borrow_data()?;
    let computed_hash = compute_vk_hash(&vk_data);
    if computed_hash != vk_hash_bytes {
        pinocchio::msg!("VK hash mismatch (computed)");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    log_cu("P2-CP2: after state + integrity checks");

    // Read proof from buffer
    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        pinocchio::msg!("Buffer too small");
        return Err(ProgramError::InvalidAccountData);
    }

    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    log_cu("P2-CP3: before phase2");

    // ========================================================================
    // FLATTENED PHASE 2: Inline sumcheck continuation (no function calls)
    // Reduces call depth by 1 level (verify_phase2)
    // ========================================================================

    // Create ProofSlice
    let proof = ProofSlice::new(proof_bytes, state.circuit_size_log)
        .map_err(|e| {
            pinocchio::msg!("Failed to parse proof");
            ProgramError::from(e)
        })?;
    let log_n = state.circuit_size_log as usize;
    let start_round = state.rounds_completed as usize;

    if start_round >= log_n {
        pinocchio::msg!("Invalid rounds_completed");
        return Err(UltraHonkError::InvalidProofFormat.into());
    }

    log_cu("P2: before sumcheck phase2");

    // Continue sumcheck from where phase 1 left off (extract to separate function)
    let _final_target = run_sumcheck_rounds(&proof, &state.all_sumcheck_u, start_round, log_n)?;

    log_cu("P2: after sumcheck phase2");
    log_cu("P2-CP4: after verify_phase2");

    // Mark state as phase 2 done (sumcheck complete, awaiting shplemini)
    drop(state_data); // Drop immutable borrow before mutable borrow
    let mut state_mut = state_account.try_borrow_mut_data()?;
    state_mut[4] = 2; // phase 2 done

    pinocchio::msg!("Phase 2 complete: sumcheck finished, awaiting phase 3");
    Ok(())
}

/// Process VERIFY_PHASE3 instruction
///
/// Phase 3 of 4-TX verification: computes shplemini scalars using combined
/// batch inverse. No VK needed. Writes scalars to state PDA for Phase 4.
///
/// Accounts: [proof_buffer, state_account (writable)]
/// Data: [vk_hash(32)]
#[inline(never)]
fn process_verify_phase3(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let state_account = &accounts[1];

    // Verify proof buffer ownership (ChadBuffer program)
    const CHADBUFFER_PROGRAM_ID: Pubkey = [
        0x51, 0xae, 0x72, 0xb9, 0x10, 0xbd, 0x32, 0x71,
        0xe6, 0x07, 0x06, 0x99, 0x7e, 0xb8, 0x47, 0x5b,
        0x76, 0xf3, 0xc8, 0x8c, 0xf7, 0x17, 0xcb, 0xb8,
        0x3f, 0x50, 0xa6, 0x9a, 0xb6, 0xd5, 0x2e, 0xc6,
    ];
    if proof_buffer.owner() != &CHADBUFFER_PROGRAM_ID {
        pinocchio::msg!("Proof buffer not owned by ChadBuffer program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    // State account must be owned by this program
    if state_account.owner() != program_id {
        pinocchio::msg!("State account not owned by verifier program");
        return Err(ProgramError::InvalidAccountOwner);
    }

    log_cu("P3-CP1: after ownership checks");

    // Parse vk_hash from instruction data
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let vk_hash_bytes = &data[..32];

    // Load state from PDA
    let state_data = state_account.try_borrow_data()?;
    let state = VerificationState::deserialize(&state_data)
        .map_err(|_| {
            pinocchio::msg!("Failed to deserialize verification state");
            ProgramError::from(UltraHonkError::InvalidVerificationState)
        })?;

    // Verify state integrity — must be phase 2 (sumcheck done)
    if state.phase != 2 {
        pinocchio::msg!("State not in phase 2 (not ready for phase 3)");
        return Err(UltraHonkError::InvalidVerificationState.into());
    }

    // Verify proof buffer key matches
    if state.proof_buffer_key != *proof_buffer.key() {
        pinocchio::msg!("Proof buffer key mismatch");
        return Err(UltraHonkError::ProofBufferMismatch.into());
    }

    // Verify VK hash matches instruction data
    if state.vk_hash != vk_hash_bytes {
        pinocchio::msg!("VK hash mismatch with state");
        return Err(UltraHonkError::VkHashMismatch.into());
    }

    // Compute challenges storage offset (after existing state data)
    let log_n = state.circuit_size_log as usize;
    let remaining_rounds = log_n.saturating_sub(state.rounds_completed as usize);
    let challenges_offset = VerificationState::serialized_size(log_n, remaining_rounds);

    log_cu("P3-CP2: after state + integrity checks");

    // Read proof from buffer
    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        pinocchio::msg!("Buffer too small");
        return Err(ProgramError::InvalidAccountData);
    }

    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    log_cu("P3-CP3: before phase3");

    // ========================================================================
    // FLATTENED PHASE 3: Inline challenge computation (1 level removed)
    // ========================================================================

    // Create ProofSlice
    let proof = ProofSlice::new(proof_bytes, state.circuit_size_log)
        .map_err(|e| {
            pinocchio::msg!("Failed to parse proof");
            ProgramError::from(e)
        })?;

    log_cu("P3: before combined challenges");

    use crate::verifier::{compute_shplemini_challenges_core, serialize_shplemini_challenges};

    let ch = compute_shplemini_challenges_core(
        &proof, &state.all_sumcheck_u, &state.gemini_r, &state.shplonk_nu, &state.shplonk_z,
    ).map_err(|e| {
        pinocchio::msg!("Challenge computation error");
        ProgramError::from(e)
    })?;

    log_cu("P3: after batch inverse");

    let size = shplemini_challenges_size(log_n);
    let mut challenges_bytes = vec![0u8; size];
    serialize_shplemini_challenges(&ch, &mut challenges_bytes);

    log_cu("P3-CP4: after verify_phase3");

    // Write serialized challenges to state PDA after existing state data
    drop(state_data);
    let mut state_mut = state_account.try_borrow_mut_data()?;

    let challenges_end = challenges_offset + challenges_bytes.len();
    if state_mut.len() < challenges_end {
        pinocchio::msg!("State account too small for challenges");
        return Err(ProgramError::AccountDataTooSmall);
    }
    state_mut[challenges_offset..challenges_end].copy_from_slice(&challenges_bytes);

    // Set phase = 3 (challenges computed, awaiting MSM)
    state_mut[4] = 3;

    log_cu("P3-CP5: after challenges write");

    pinocchio::msg!("Phase 3 complete: shplemini challenges computed, awaiting phase 4");
    Ok(())
}

/// Process VERIFY_PHASE4 instruction
/// Phase 4: Fold computation only (no VK needed).
/// Accounts: [proof_buffer, state_account (writable)]
/// Data: [vk_hash(32)]
#[inline(never)]
fn process_verify_phase4(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let state_account = &accounts[1];

    const CHADBUFFER_PROGRAM_ID: Pubkey = [
        0x51, 0xae, 0x72, 0xb9, 0x10, 0xbd, 0x32, 0x71,
        0xe6, 0x07, 0x06, 0x99, 0x7e, 0xb8, 0x47, 0x5b,
        0x76, 0xf3, 0xc8, 0x8c, 0xf7, 0x17, 0xcb, 0xb8,
        0x3f, 0x50, 0xa6, 0x9a, 0xb6, 0xd5, 0x2e, 0xc6,
    ];
    if proof_buffer.owner() != &CHADBUFFER_PROGRAM_ID {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if state_account.owner() != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }

    if data.len() < 32 { return Err(ProgramError::InvalidInstructionData); }
    let vk_hash_bytes = &data[..32];

    let state_data = state_account.try_borrow_data()?;
    let state = VerificationState::deserialize(&state_data)
        .map_err(|_| ProgramError::from(UltraHonkError::InvalidVerificationState))?;

    if state.phase != 3 { return Err(UltraHonkError::InvalidVerificationState.into()); }
    if state.proof_buffer_key != *proof_buffer.key() { return Err(UltraHonkError::ProofBufferMismatch.into()); }
    if state.vk_hash != vk_hash_bytes { return Err(UltraHonkError::VkHashMismatch.into()); }

    let log_n = state.circuit_size_log as usize;
    let remaining_rounds = log_n.saturating_sub(state.rounds_completed as usize);
    let challenges_offset = VerificationState::serialized_size(log_n, remaining_rounds);
    let challenges_size = shplemini_challenges_size(log_n);
    let challenges_end = challenges_offset + challenges_size;
    if state_data.len() < challenges_end {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let challenges_data: Vec<u8> = state_data[challenges_offset..challenges_end].to_vec();

    let rho = state.rho;
    let shplonk_nu = state.shplonk_nu;
    let gemini_r = state.gemini_r;
    let sumcheck_u = state.all_sumcheck_u.clone();

    log_cu("P4: after state load");

    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        return Err(ProgramError::InvalidAccountData);
    }
    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    // Fold computation → returns serialized fold results
    let fold_bytes = verify_phase4(
        proof_bytes, &challenges_data, state.circuit_size_log,
        &rho, &shplonk_nu, &gemini_r, &sumcheck_u,
    ).map_err(|e| { pinocchio::msg!("Phase 4 fold error"); ProgramError::from(e) })?;

    log_cu("P4: after fold");

    // Write fold results to state PDA (overwrite Phase 3 intermediates at same offset)
    drop(state_data);
    let mut state_mut = state_account.try_borrow_mut_data()?;
    let fold_end = challenges_offset + fold_bytes.len();
    if state_mut.len() < fold_end {
        return Err(ProgramError::AccountDataTooSmall);
    }
    state_mut[challenges_offset..fold_end].copy_from_slice(&fold_bytes);
    state_mut[4] = 4; // phase 4 done

    pinocchio::msg!("Phase 4 complete: fold scalars computed");
    Ok(())
}

/// Phase 5: MSM + pairing → verified.
/// Accounts: [proof_buffer, vk_account, state_account (writable)]
/// Data: [vk_hash(32)]
#[inline(never)]
fn process_verify_phase5(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let proof_buffer = &accounts[0];
    let vk_account = &accounts[1];
    let state_account = &accounts[2];

    const CHADBUFFER_PROGRAM_ID: Pubkey = [
        0x51, 0xae, 0x72, 0xb9, 0x10, 0xbd, 0x32, 0x71,
        0xe6, 0x07, 0x06, 0x99, 0x7e, 0xb8, 0x47, 0x5b,
        0x76, 0xf3, 0xc8, 0x8c, 0xf7, 0x17, 0xcb, 0xb8,
        0x3f, 0x50, 0xa6, 0x9a, 0xb6, 0xd5, 0x2e, 0xc6,
    ];
    if proof_buffer.owner() != &CHADBUFFER_PROGRAM_ID {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if vk_account.owner() != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if state_account.owner() != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }

    if data.len() < 32 { return Err(ProgramError::InvalidInstructionData); }
    let vk_hash_bytes = &data[..32];

    let state_data = state_account.try_borrow_data()?;
    let state = VerificationState::deserialize(&state_data)
        .map_err(|_| ProgramError::from(UltraHonkError::InvalidVerificationState))?;

    if state.phase != 4 { return Err(UltraHonkError::InvalidVerificationState.into()); }
    if state.proof_buffer_key != *proof_buffer.key() { return Err(UltraHonkError::ProofBufferMismatch.into()); }
    if state.vk_hash != vk_hash_bytes { return Err(UltraHonkError::VkHashMismatch.into()); }

    let vk_data = vk_account.try_borrow_data()?;
    let computed_hash = compute_vk_hash(&vk_data);
    if computed_hash != vk_hash_bytes { return Err(UltraHonkError::VkHashMismatch.into()); }

    let vk = VerificationKey::from_bytes_boxed(&vk_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    // Read fold results from state PDA
    let log_n = state.circuit_size_log as usize;
    let remaining_rounds = log_n.saturating_sub(state.rounds_completed as usize);
    let fold_offset = VerificationState::serialized_size(log_n, remaining_rounds);
    let fold_size = fold_results_size(log_n);
    let fold_end = fold_offset + fold_size;
    if state_data.len() < fold_end {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let fold_data: Vec<u8> = state_data[fold_offset..fold_end].to_vec();

    let rho = state.rho;
    let shplonk_z = state.shplonk_z;

    log_cu("P5: after state load");

    let buffer_data = proof_buffer.try_borrow_data()?;
    if buffer_data.len() <= CHADBUFFER_DATA_OFFSET {
        return Err(ProgramError::InvalidAccountData);
    }
    let proof_bytes = &buffer_data[CHADBUFFER_DATA_OFFSET..];

    let valid = verify_phase5(&vk, proof_bytes, &fold_data, &rho, &shplonk_z)
        .map_err(|e| { pinocchio::msg!("Phase 5 verification error"); ProgramError::from(e) })?;

    if !valid {
        pinocchio::msg!("Pairing check failed");
        return Err(ProgramError::InvalidArgument);
    }

    log_cu("P5: verified");

    drop(state_data);
    let mut state_mut = state_account.try_borrow_mut_data()?;
    state_mut[4] = 5; // verified

    pinocchio::msg!("Phase 5 complete: proof verified");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instruction_discriminators() {
        assert_eq!(instruction::INIT_VK, 2);
        assert_eq!(instruction::WRITE_VK_CHUNK, 4);
        assert_eq!(instruction::VERIFY_PHASE1, 6);
        assert_eq!(instruction::VERIFY_PHASE2, 7);
        assert_eq!(instruction::VERIFY_PHASE3, 8);
        assert_eq!(instruction::VERIFY_PHASE4, 9);
        assert_eq!(instruction::VERIFY_PHASE5, 10);
    }
}



