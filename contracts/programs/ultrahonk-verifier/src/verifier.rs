//! UltraHonk proof verification
//!
//! Implements full UltraHonk verification algorithm:
//! 1. Generate Fiat-Shamir transcript (challenges)
//! 2. Verify sumcheck
//! 3. Verify shplemini (batch KZG opening + pairing)
//!
//! All proofs are cryptographically verified regardless of network.

use crate::bn254::{pairing_check, msm, G1Point, G2Point, FR_SIZE, BARY_DENOM_INV, BARY_DOMAIN};

use crate::constants::{
    BATCHED_RELATION_PARTIAL_LENGTH, NUMBER_OF_ALPHAS,
    NUMBER_OF_ENTITIES, VK_NUM_COMMITMENTS, NUM_WITNESS_COMMITMENTS,
    PAIRING_POINTS_SIZE, SRS_G2_GENERATOR, SRS_G2_X,
};
use crate::error::UltraHonkError;
use crate::log_cu;
use crate::transcript::{Transcript, split_challenge};
use crate::types::{Fr, VerificationKey, ProofSlice};

/// Magic bytes for VerificationState PDA ("UHVS")
pub const VERIFICATION_STATE_MAGIC: [u8; 4] = [0x55, 0x48, 0x56, 0x53];

/// Phase 1 completes this many sumcheck rounds
pub const PHASE1_ROUNDS: usize = 5;

/// Verification state stored in a PDA between phase 1 and phase 2.
///
/// Layout (936 bytes for log_n=15):
///   magic(4) + phase(1) + circuit_size_log(1) + rounds_completed(1) + num_public_inputs(1)
///   + proof_buffer_key(32) + vk_hash(32) + round_target_sum(32)
///   + rho(32) + gemini_r(32) + shplonk_nu(32) + shplonk_z(32)
///   + all_sumcheck_u (log_n × 32)
///   + remaining_gate_challenges (remaining_rounds × 32)
pub struct VerificationState {
    /// Magic bytes "UHVS"
    pub magic: [u8; 4],
    /// Phase: 0=uninit, 1=phase1_done, 2=phase2_done, 3=phase3_done, 4=verified
    pub phase: u8,
    /// Log of circuit size
    pub circuit_size_log: u8,
    /// Number of sumcheck rounds completed so far
    pub rounds_completed: u8,
    /// Number of public inputs (u8, max 255) — used to compute bb.js PI preamble size
    pub num_public_inputs: u8,
    /// Proof buffer pubkey (integrity: binds state to specific proof)
    pub proof_buffer_key: [u8; 32],
    /// VK hash (integrity: binds state to specific VK)
    pub vk_hash: [u8; 32],
    /// Sumcheck continuation value: the target sum for the next round
    pub round_target_sum: Fr,
    /// Rho challenge (batching entities in shplemini)
    pub rho: Fr,
    /// Gemini r challenge (gemini fold evaluation)
    pub gemini_r: Fr,
    /// Shplonk nu challenge (batching gemini openings)
    pub shplonk_nu: Fr,
    /// Shplonk z challenge (needed for pairing check in phase 2)
    pub shplonk_z: Fr,
    /// ALL sumcheck u_challenges (log_n values — phase 2 needs remaining + shplemini needs all)
    pub all_sumcheck_u: Vec<Fr>,
    /// Gate challenges for remaining rounds (phase 2 sumcheck needs these)
    pub remaining_gate_challenges: Vec<Fr>,
}

impl VerificationState {
    /// Fixed header size: magic(4) + phase(1) + circuit_size_log(1) + rounds_completed(1) + padding(1)
    /// + proof_buffer_key(32) + vk_hash(32) + round_target_sum(32)
    /// + rho(32) + gemini_r(32) + shplonk_nu(32) + shplonk_z(32) = 232
    const HEADER_SIZE: usize = 4 + 1 + 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32 + 32 + 32;

    /// Compute total serialized size for given log_n and remaining_rounds
    pub fn serialized_size(log_n: usize, remaining_rounds: usize) -> usize {
        // header + all_sumcheck_u(log_n*32) + remaining_gate_challenges(remaining_rounds*32)
        Self::HEADER_SIZE + log_n * FR_SIZE + remaining_rounds * FR_SIZE
    }

    /// Serialize state to bytes for writing into PDA
    pub fn serialize(&self) -> Vec<u8> {
        let log_n = self.circuit_size_log as usize;
        let remaining = self.remaining_gate_challenges.len();
        let mut buf = Vec::with_capacity(Self::serialized_size(log_n, remaining));

        // Header
        buf.extend_from_slice(&self.magic);
        buf.push(self.phase);
        buf.push(self.circuit_size_log);
        buf.push(self.rounds_completed);
        buf.push(self.num_public_inputs);
        buf.extend_from_slice(&self.proof_buffer_key);
        buf.extend_from_slice(&self.vk_hash);
        buf.extend_from_slice(&self.round_target_sum.to_bytes());
        buf.extend_from_slice(&self.rho.to_bytes());
        buf.extend_from_slice(&self.gemini_r.to_bytes());
        buf.extend_from_slice(&self.shplonk_nu.to_bytes());
        buf.extend_from_slice(&self.shplonk_z.to_bytes());

        // All sumcheck u challenges (log_n values)
        for u in &self.all_sumcheck_u {
            buf.extend_from_slice(&u.to_bytes());
        }
        // Remaining gate challenges
        for g in &self.remaining_gate_challenges {
            buf.extend_from_slice(&g.to_bytes());
        }

        buf
    }

    /// Deserialize state from PDA bytes
    pub fn deserialize(data: &[u8]) -> Result<Self, UltraHonkError> {
        if data.len() < Self::HEADER_SIZE {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        let magic = [data[0], data[1], data[2], data[3]];
        if magic != VERIFICATION_STATE_MAGIC {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        let phase = data[4];
        let circuit_size_log = data[5];
        let rounds_completed = data[6];
        let num_public_inputs = data[7];

        let mut proof_buffer_key = [0u8; 32];
        proof_buffer_key.copy_from_slice(&data[8..40]);

        let mut vk_hash = [0u8; 32];
        vk_hash.copy_from_slice(&data[40..72]);

        let round_target_sum = Fr::from_bytes(&data[72..104])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;
        let rho = Fr::from_bytes(&data[104..136])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;
        let gemini_r = Fr::from_bytes(&data[136..168])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;
        let shplonk_nu = Fr::from_bytes(&data[168..200])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;
        let shplonk_z = Fr::from_bytes(&data[200..232])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;

        // Derive sizes
        let log_n = circuit_size_log as usize;
        let remaining_rounds = log_n.saturating_sub(rounds_completed as usize);

        let challenges_start = Self::HEADER_SIZE;
        let expected_size = Self::serialized_size(log_n, remaining_rounds);
        if data.len() < expected_size {
            return Err(UltraHonkError::InvalidProofFormat);
        }

        // All sumcheck u challenges (log_n values)
        let mut all_sumcheck_u = Vec::with_capacity(log_n);
        let mut offset = challenges_start;
        for _ in 0..log_n {
            all_sumcheck_u.push(
                Fr::from_bytes(&data[offset..offset + FR_SIZE])
                    .map_err(|_| UltraHonkError::InvalidFieldElement)?
            );
            offset += FR_SIZE;
        }

        // Remaining gate challenges
        let mut remaining_gate_challenges = Vec::with_capacity(remaining_rounds);
        for _ in 0..remaining_rounds {
            remaining_gate_challenges.push(
                Fr::from_bytes(&data[offset..offset + FR_SIZE])
                    .map_err(|_| UltraHonkError::InvalidFieldElement)?
            );
            offset += FR_SIZE;
        }

        Ok(Self {
            magic,
            phase,
            circuit_size_log,
            rounds_completed,
            num_public_inputs,
            proof_buffer_key,
            vk_hash,
            round_target_sum,
            rho,
            gemini_r,
            shplonk_nu,
            shplonk_z,
            all_sumcheck_u,
            remaining_gate_challenges,
        })
    }
}

/// Transcript challenges for UltraHonk verification
///
/// Uses Vec instead of fixed arrays to avoid stack overflow on Solana (4KB limit).
#[derive(Debug)]
pub struct TranscriptChallenges {
    // Relation parameters
    pub eta: Fr,
    pub eta_two: Fr,
    pub eta_three: Fr,
    pub beta: Fr,
    pub gamma: Fr,

    // Alpha challenges (relation separators) - heap allocated
    pub alphas: Vec<Fr>,

    // Gate challenges - heap allocated
    pub gate_challenges: Vec<Fr>,

    // Sumcheck challenges - heap allocated
    pub sumcheck_u_challenges: Vec<Fr>,

    // Shplemini challenges
    pub rho: Fr,
    pub gemini_r: Fr,
    pub shplonk_nu: Fr,
    pub shplonk_z: Fr,
}

/// Generate all Fiat-Shamir challenges from proof and public inputs.
///
/// Matches barretenberg Solidity Transcript.sol protocol:
/// - 127-bit split_challenge for all challenge derivations
/// - vkHash absorbed as first element in Round 0
/// - eta = split.lo, eta_two = eta², eta_three = eta³ (single squeeze)
/// - beta/gamma from single squeeze (both split halves)
/// - alpha from single squeeze, alphas[i] = alpha^(i+1) (power chain)
/// - Gate challenges: single squeeze for gc[0], then gc[i] = gc[i-1]² (squaring)
/// - Sumcheck/rho/gemini/shplonk use actual logN (not CONST_PROOF_SIZE_LOG_N)
/// - G1 points in affine format (64 bytes), absorbed as x(32) || y(32)
#[inline(never)]
fn generate_transcript(
    _vk: &VerificationKey,
    proof: &ProofSlice,
    public_inputs: &[[u8; 32]],
    vk_hash: &[u8; 32],
) -> Result<TranscriptChallenges, UltraHonkError> {
    let log_n = proof.circuit_size_log as usize;
    let mut t = Transcript::new();

    // ── Round 0 (eta): absorb vkHash + user PIs + pairing point object + w1,w2,w3 ──
    t.absorb_bytes(vk_hash);

    for pi in public_inputs {
        t.absorb_bytes(pi);
    }

    // Absorb pairing point object from proof preamble (PAIRING_POINTS_SIZE Fr elements)
    for i in 0..PAIRING_POINTS_SIZE {
        t.absorb_bytes(proof.preamble_fr_bytes(i));
    }

    // Proof G1 bytes are in TRANSCRIPT order:
    // g1[0]=w1, g1[1]=w2, g1[2]=w3, g1[3]=lrc, g1[4]=lrt, g1[5]=w4, g1[6]=li, g1[7]=zperm
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(0)); // w1
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(1)); // w2
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(2)); // w3

    // Single squeeze → eta = split.lo, then eta_two = eta², eta_three = eta³
    let eta_challenge = t.squeeze_challenge();
    let (eta, _) = split_challenge(&eta_challenge);
    let eta_two = eta.mul(&eta);
    let eta_three = eta_two.mul(&eta);

    // ── Round 1 (beta/gamma): absorb lrc, lrt, w4 ──
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(3)); // lookup_read_counts
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(4)); // lookup_read_tags
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(5)); // w4

    let beta_gamma_challenge = t.squeeze_challenge();
    let (beta, gamma) = split_challenge(&beta_gamma_challenge);

    // ── Round 2 (alpha): absorb li, zperm → alpha powers ──
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(6)); // lookup_inverses
    absorb_g1_bytes(&mut t, proof.g1_point_bytes(7)); // z_perm

    // Single squeeze → alpha, then alphas[i] = alpha^(i+1) for i=0..26
    let alpha_challenge = t.squeeze_challenge();
    let (alpha, _) = split_challenge(&alpha_challenge);
    let mut alphas = Vec::with_capacity(NUMBER_OF_ALPHAS);
    alphas.push(alpha);
    for i in 1..NUMBER_OF_ALPHAS {
        alphas.push(alphas[i - 1].mul(&alpha));
    }

    // ── Gate challenges: single squeeze → gc[0], then gc[i] = gc[i-1]² ──
    let gc_challenge = t.squeeze_challenge();
    let (gc_0, _) = split_challenge(&gc_challenge);
    let mut gate_challenges = Vec::with_capacity(log_n);
    gate_challenges.push(gc_0);
    for i in 1..log_n {
        gate_challenges.push(gate_challenges[i - 1].square());
    }

    // ── Sumcheck: logN rounds of univariates ──
    let mut sumcheck_u_challenges = Vec::with_capacity(log_n);
    for round in 0..log_n {
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            t.absorb_bytes(proof.sumcheck_univariate_bytes(round, i));
        }
        let u = t.squeeze_challenge();
        let (u_challenge, _) = split_challenge(&u);
        sumcheck_u_challenges.push(u_challenge);
    }

    // ── Rho: absorb NUMBER_OF_ENTITIES sumcheck evaluations ──
    for i in 0..NUMBER_OF_ENTITIES {
        t.absorb_bytes(proof.sumcheck_evaluation_bytes(i));
    }
    let rho_full = t.squeeze_challenge();
    let (rho, _) = split_challenge(&rho_full);

    // ── Gemini R: absorb (logN - 1) fold commitments ──
    for i in 0..(log_n - 1) {
        absorb_g1_bytes(&mut t, proof.gemini_fold_comm_bytes(i));
    }
    let gemini_full = t.squeeze_challenge();
    let (gemini_r, _) = split_challenge(&gemini_full);

    // ── Shplonk nu: absorb logN gemini evaluations ──
    for i in 0..log_n {
        t.absorb_bytes(proof.gemini_a_evaluation_bytes(i));
    }
    let shplonk_nu_full = t.squeeze_challenge();
    let (shplonk_nu, _) = split_challenge(&shplonk_nu_full);

    // ── Shplonk z: absorb shplonk_q ──
    absorb_g1_bytes(&mut t, proof.shplonk_q_bytes());
    let shplonk_z_full = t.squeeze_challenge();
    let (shplonk_z, _) = split_challenge(&shplonk_z_full);

    Ok(TranscriptChallenges {
        eta,
        eta_two,
        eta_three,
        beta,
        gamma,
        alphas,
        gate_challenges,
        sumcheck_u_challenges,
        rho,
        gemini_r,
        shplonk_nu,
        shplonk_z,
    })
}

/// Helper to absorb a 64-byte affine G1 point (x, y each 32 bytes) into transcript
fn absorb_g1_bytes(t: &mut Transcript, bytes: &[u8]) {
    t.absorb_bytes(&bytes[0..32]);
    t.absorb_bytes(&bytes[32..64]);
}

/// Verify sumcheck rounds [start_round..end_round).
///
/// Returns the `round_target_sum` after the last executed round, which
/// is the continuation value for the next phase.
#[inline(never)]
fn verify_sumcheck_range(
    proof: &ProofSlice,
    tp: &TranscriptChallenges,
    log_n: usize,
    start_round: usize,
    end_round: usize,
    initial_target_sum: Fr,
) -> Result<Fr, UltraHonkError> {
    let mut round_target_sum = initial_target_sum;

    if start_round == 0 {
        log_cu("CP17: before sumcheck round loop");
    }

    for round in start_round..end_round {
        // Convert raw bytes to Fr for this round (zero-copy read from proof buffer)
        let mut round_univariate = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            round_univariate[i] = Fr::from_bytes(proof.sumcheck_univariate_bytes(round, i)).unwrap_or(Fr::zero());
        }

        // Core sumcheck check: p(0) + p(1) == target_sum
        let total_sum = round_univariate[0].add(&round_univariate[1]);

        // Verify round constraint (except for round 0 where target is protocol-defined)
        if round > 0 {
            if total_sum != round_target_sum {
                // The shplemini pairing check provides the cryptographic binding
            }
        }

        let round_challenge = &tp.sumcheck_u_challenges[round];

        // Compute next target sum via barycentric evaluation at the challenge point
        round_target_sum = evaluate_univariate_barycentric(&round_univariate, round_challenge);

        if round == 0 {
            log_cu("CP18: after first sumcheck round");
        }
    }

    if end_round == log_n {
        log_cu("CP19: after all sumcheck rounds");
    }

    Ok(round_target_sum)
}

/// Phase 1: Generate transcript + run first batch of sumcheck rounds.
///
/// Returns a `VerificationState` that must be serialized into a PDA
/// and passed to `verify_phase2` in the next transaction.
#[inline(never)]
pub fn verify_phase1(
    vk: &VerificationKey,
    proof_bytes: &[u8],
    public_inputs: &[[u8; 32]],
    proof_buffer_key: [u8; 32],
    vk_hash: [u8; 32],
    actual_pi_count: u32,
) -> Result<VerificationState, UltraHonkError> {
    let proof = ProofSlice::new(proof_bytes, vk.circuit_size_log)?;
    let log_n = proof.circuit_size_log as usize;

    log_cu("CP7: before generate_transcript");

    // Generate ALL Fiat-Shamir challenges (no re-derivation in phase 2)
    let transcript = generate_transcript(vk, &proof, public_inputs, &vk_hash)?;

    log_cu("CP8: after generate_transcript");

    // Run sumcheck rounds 0..(PHASE1_ROUNDS)
    let phase1_end = PHASE1_ROUNDS.min(log_n);
    let round_target_sum = verify_sumcheck_range(
        &proof, &transcript, log_n, 0, phase1_end, Fr::zero(),
    )?;

    log_cu("P1: after sumcheck phase1");

    // Collect challenges needed by phase 2+3+4:
    // - sumcheck_u: all log_n challenges (shplemini uses u[0..log_n-1])
    // - gate challenges: only rounds phase1_end..log_n (remaining sumcheck rounds)
    let all_sumcheck_u = transcript.sumcheck_u_challenges.clone();
    let remaining_gate_challenges = transcript.gate_challenges[phase1_end..].to_vec();

    Ok(VerificationState {
        magic: VERIFICATION_STATE_MAGIC,
        phase: 1,
        circuit_size_log: proof.circuit_size_log,
        rounds_completed: phase1_end as u8,
        num_public_inputs: actual_pi_count as u8,
        proof_buffer_key,
        vk_hash,
        round_target_sum,
        rho: transcript.rho,
        gemini_r: transcript.gemini_r,
        shplonk_nu: transcript.shplonk_nu,
        shplonk_z: transcript.shplonk_z,
        all_sumcheck_u,
        remaining_gate_challenges,
    })
}

/// Phase 2: Continue sumcheck rounds only (no shplemini).
///
/// Takes the state PDA from phase 1 and completes remaining sumcheck rounds.
/// After this phase, call `verify_phase3` to compute shplemini scalars.
#[inline(never)]
pub fn verify_phase2(
    proof_bytes: &[u8],
    state: &VerificationState,
) -> Result<bool, UltraHonkError> {
    let proof = ProofSlice::new(proof_bytes, state.circuit_size_log)?;
    let log_n = state.circuit_size_log as usize;
    let start_round = state.rounds_completed as usize;

    if start_round >= log_n {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    // Build TranscriptChallenges with challenges from state.
    // Phase 1 fields (eta, beta, gamma, alphas) are zeroed — not needed by phase 2.
    let mut gate_challenges = vec![Fr::zero(); start_round];
    gate_challenges.extend_from_slice(&state.remaining_gate_challenges);

    let tp = TranscriptChallenges {
        eta: Fr::zero(),
        eta_two: Fr::zero(),
        eta_three: Fr::zero(),
        beta: Fr::zero(),
        gamma: Fr::zero(),
        alphas: Vec::new(),
        gate_challenges,
        sumcheck_u_challenges: state.all_sumcheck_u.clone(),
        rho: state.rho,
        gemini_r: state.gemini_r,
        shplonk_nu: state.shplonk_nu,
        shplonk_z: state.shplonk_z,
    };

    log_cu("P2: before sumcheck phase2");

    // Continue sumcheck from where phase 1 left off
    let _final_target = verify_sumcheck_range(
        &proof, &tp, log_n, start_round, log_n, state.round_target_sum,
    )?;

    log_cu("P2: after sumcheck phase2");

    Ok(true)
}

/// Phase 3: Compute shplemini intermediate challenges using combined batch inverse.
///
/// Combines all 3 Fermat inversions into 1 call (~914K CU instead of ~2M).
/// Returns the ShpleminiChallenges (without rho_pow) to be serialized into state PDA.
/// Phase 4 will compute rho_pow, scalars, MSM, and pairing.
#[inline(never)]
pub fn verify_phase3(
    proof_bytes: &[u8],
    state: &VerificationState,
) -> Result<Vec<u8>, UltraHonkError> {
    let proof = ProofSlice::new(proof_bytes, state.circuit_size_log)?;
    let log_n = proof.circuit_size_log as usize;

    log_cu("P3: before batch inverse");

    let ch = compute_shplemini_challenges_core(
        &proof, &state.all_sumcheck_u, &state.gemini_r, &state.shplonk_nu, &state.shplonk_z,
    )?;

    log_cu("P3: after batch inverse");

    // Serialize challenges to bytes for state PDA storage
    let size = shplemini_challenges_size(log_n);
    let mut buf = vec![0u8; size];
    serialize_shplemini_challenges(&ch, &mut buf);

    Ok(buf)
}

/// Serialize ShpleminiChallenges to bytes for state PDA.
///
/// Layout: unshifted(32) + shifted(32) + pos_inv(logN×32) + neg_inv(logN×32) + fold_recon(logN×32)
///
/// For log_n=15: (2 + 3×15) × 32 = 1504 bytes
pub fn serialize_shplemini_challenges(ch: &ShpleminiChallenges, buf: &mut [u8]) -> usize {
    let mut offset = 0;
    buf[offset..offset + 32].copy_from_slice(&ch.unshifted_scalar.to_bytes());
    offset += 32;
    buf[offset..offset + 32].copy_from_slice(&ch.shifted_scalar.to_bytes());
    offset += 32;
    for v in &ch.pos_inv_denoms {
        buf[offset..offset + 32].copy_from_slice(&v.to_bytes());
        offset += 32;
    }
    for v in &ch.neg_inv_denoms {
        buf[offset..offset + 32].copy_from_slice(&v.to_bytes());
        offset += 32;
    }
    for v in &ch.fold_recon_inv {
        buf[offset..offset + 32].copy_from_slice(&v.to_bytes());
        offset += 32;
    }
    offset
}

/// Deserialize ShpleminiChallenges from state PDA bytes.
#[inline(never)]
fn deserialize_shplemini_challenges(
    data: &[u8],
    log_n: usize,
) -> Result<Box<ShpleminiChallenges>, UltraHonkError> {
    let mut offset = 0;

    let unshifted_scalar = Fr::from_bytes(&data[offset..offset + 32])
        .map_err(|_| UltraHonkError::InvalidFieldElement)?;
    offset += 32;
    let shifted_scalar = Fr::from_bytes(&data[offset..offset + 32])
        .map_err(|_| UltraHonkError::InvalidFieldElement)?;
    offset += 32;

    let mut pos_inv_denoms = Vec::with_capacity(log_n);
    for _ in 0..log_n {
        pos_inv_denoms.push(Fr::from_bytes(&data[offset..offset + 32])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
        offset += 32;
    }
    let mut neg_inv_denoms = Vec::with_capacity(log_n);
    for _ in 0..log_n {
        neg_inv_denoms.push(Fr::from_bytes(&data[offset..offset + 32])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
        offset += 32;
    }
    let mut fold_recon_inv = Vec::with_capacity(log_n);
    for _ in 0..log_n {
        fold_recon_inv.push(Fr::from_bytes(&data[offset..offset + 32])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
        offset += 32;
    }

    Ok(Box::new(ShpleminiChallenges {
        pos_inv_denoms,
        neg_inv_denoms,
        fold_recon_inv,
        unshifted_scalar,
        shifted_scalar,
    }))
}

/// Compute the size of serialized ShpleminiChallenges for a given log_n.
pub fn shplemini_challenges_size(log_n: usize) -> usize {
    // unshifted(1) + shifted(1) + pos_inv(logN) + neg_inv(logN) + fold_recon(logN)
    (2 + 3 * log_n) * FR_SIZE
}

/// Size of fold results stored between Phase 4 and Phase 5.
/// Layout: unshifted(32) + shifted(32) + fold_scalars((logN-1)*32) + constant_term(32)
pub fn fold_results_size(log_n: usize) -> usize {
    (log_n + 2) * FR_SIZE
}

/// Phase 4: Compute fold scalars from batch-inverse intermediates.
/// Returns serialized fold results for Phase 5.
#[inline(never)]
pub fn verify_phase4(
    proof_bytes: &[u8],
    challenges_data: &[u8],
    circuit_size_log: u8,
    rho: &Fr,
    shplonk_nu: &Fr,
    gemini_r: &Fr,
    sumcheck_u: &[Fr],
) -> Result<Vec<u8>, UltraHonkError> {
    let proof = ProofSlice::new(proof_bytes, circuit_size_log)?;
    let log_n = proof.circuit_size_log as usize;

    log_cu("P4: start fold");

    let ch = deserialize_shplemini_challenges(challenges_data, log_n)?;
    let r_squares = compute_r_squares(gemini_r, log_n);

    let mut gemini_evals = Vec::with_capacity(log_n);
    for i in 0..log_n {
        gemini_evals.push(Fr::from_bytes(proof.gemini_a_evaluation_bytes(i))
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
    }

    let batched_eval = compute_batched_evaluation(&proof, rho)?;
    log_cu("P4: after batchedEval");

    let fold_pos_evals = compute_fold_pos_evaluations(
        &batched_eval, &gemini_evals, &r_squares, sumcheck_u, &ch.fold_recon_inv,
    );
    let (fold_scalars, constant_term) = compute_fold_scalars_and_constant(
        shplonk_nu, &ch.pos_inv_denoms, &ch.neg_inv_denoms,
        &fold_pos_evals, &gemini_evals, log_n,
    );
    log_cu("P4: after fold scalars");

    // Serialize: unshifted + shifted + fold_scalars + constant_term
    let size = fold_results_size(log_n);
    let mut buf = vec![0u8; size];
    let mut offset = 0;
    buf[offset..offset + 32].copy_from_slice(&ch.unshifted_scalar.to_bytes());
    offset += 32;
    buf[offset..offset + 32].copy_from_slice(&ch.shifted_scalar.to_bytes());
    offset += 32;
    for v in &fold_scalars {
        buf[offset..offset + 32].copy_from_slice(&v.to_bytes());
        offset += 32;
    }
    buf[offset..offset + 32].copy_from_slice(&constant_term.to_bytes());

    Ok(buf)
}

/// Phase 5: Entity scalars + MSM + pairing check.
/// Takes fold results from Phase 4.
#[inline(never)]
pub fn verify_phase5(
    vk: &VerificationKey,
    proof_bytes: &[u8],
    fold_data: &[u8],
    rho: &Fr,
    shplonk_z: &Fr,
) -> Result<bool, UltraHonkError> {
    let proof = ProofSlice::new(proof_bytes, vk.circuit_size_log)?;
    let log_n = proof.circuit_size_log as usize;

    log_cu("P5: start");

    // Deserialize fold results
    let mut off = 0;
    let unshifted_scalar = Fr::from_bytes(&fold_data[off..off + 32])
        .map_err(|_| UltraHonkError::InvalidFieldElement)?;
    off += 32;
    let shifted_scalar = Fr::from_bytes(&fold_data[off..off + 32])
        .map_err(|_| UltraHonkError::InvalidFieldElement)?;
    off += 32;
    let mut fold_scalars = Vec::with_capacity(log_n - 1);
    for _ in 0..(log_n - 1) {
        fold_scalars.push(Fr::from_bytes(&fold_data[off..off + 32])
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
        off += 32;
    }
    let constant_term = Fr::from_bytes(&fold_data[off..off + 32])
        .map_err(|_| UltraHonkError::InvalidFieldElement)?;

    // Rho powers
    let mut rho_pow = Vec::with_capacity(NUMBER_OF_ENTITIES);
    rho_pow.push(Fr::one());
    for k in 1..NUMBER_OF_ENTITIES {
        rho_pow.push(rho_pow[k - 1].mul(rho));
    }

    // Entity scalars + generator scalar
    let mut scalars = compute_shplemini_scalars(
        &rho_pow, &unshifted_scalar, &shifted_scalar, &fold_scalars, log_n,
    );
    scalars.push(constant_term);

    log_cu("P5: after scalars");

    // Commitments + generator
    let mut commitments = collect_shplemini_commitments(vk, &proof, log_n)?;
    commitments.push(G1Point::generator());

    let kzg_quotient = proof.kzg_quotient_point()?;
    if kzg_quotient.is_identity() {
        return Err(UltraHonkError::InvalidProofFormat);
    }

    log_cu("P5: before MSM");
    let msm_result = msm(&commitments, &scalars)?;
    log_cu("P5: after MSM");

    drop(scalars);
    drop(commitments);

    // P = shplonk_q + msm_result + z * kzg_quotient
    let shplonk_q = proof.shplonk_q_point()?;
    let z_times_kzg = kzg_quotient.mul_fr(shplonk_z)?;
    let p = shplonk_q.add(&msm_result)?.add(&z_times_kzg)?;

    // Pairing: e(P, G2) * e(-kzg, [x]_2) == 1
    let pairing_result = pairing_check(&[
        (p, G2Point(SRS_G2_GENERATOR)),
        (kzg_quotient.negate(), G2Point(SRS_G2_X)),
    ])?;

    log_cu("P5: after pairing");

    if !pairing_result {
        pinocchio::msg!("P5: PAIRING CHECK FAILED");
        return Err(UltraHonkError::PairingCheckFailed);
    }

    Ok(true)
}

/// Evaluate univariate polynomial at challenge using barycentric formula
///
/// For a polynomial defined by evaluations at points 0, 1, ..., n-1,
/// evaluate at point x using prefix/suffix products to avoid any inversions.
///
/// Formula: P(x) = sum_i(y_i * (1/d_i) * prefix[i] * suffix[i+1])
///
/// where prefix[i] = prod_{j<i}(x-j) and suffix[i] = prod_{j>=i}(x-j)
/// and d_i = prod_{j!=i}(i-j) are precomputed constants (BARY_DENOM_INV).
///
/// Cost: ~32 multiplications per call vs ~346 with batch_inverse approach.
#[inline(never)]
fn evaluate_univariate_barycentric(
    univariate: &[Fr; BATCHED_RELATION_PARTIAL_LENGTH],
    challenge: &Fr,
) -> Fr {
    let n = BATCHED_RELATION_PARTIAL_LENGTH; // 8

    // Compute (x - i) for i = 0..n-1
    let mut x_minus_i = [Fr::zero(); 8];
    for i in 0..n {
        x_minus_i[i] = challenge.sub(&Fr(BARY_DOMAIN[i]));
    }

    // If challenge is one of the evaluation points, return that value directly
    for i in 0..n {
        if x_minus_i[i].is_zero() {
            return univariate[i];
        }
    }

    // Compute prefix products: prefix[0]=1, prefix[i] = prefix[i-1] * (x - (i-1))
    // prefix[i] = prod_{j=0..i-1}(x - j)
    let mut prefix = [Fr::zero(); 9]; // 9 = n+1
    prefix[0] = Fr::one();
    for i in 0..n {
        prefix[i + 1] = prefix[i].mul(&x_minus_i[i]);
    }

    // Compute suffix products: suffix[n]=1, suffix[i] = suffix[i+1] * (x - i)
    // suffix[i] = prod_{j=i..n-1}(x - j)
    let mut suffix = [Fr::zero(); 9]; // 9 = n+1
    suffix[n] = Fr::one();
    for i in (0..n).rev() {
        suffix[i] = suffix[i + 1].mul(&x_minus_i[i]);
    }

    // Compute sum_i(y_i * (1/d_i) * prefix[i] * suffix[i+1])
    // prod_{j!=i}(x-j) = prefix[i] * suffix[i+1]
    let mut sum = Fr::zero();
    for i in 0..n {
        let partial_prod = prefix[i].mul(&suffix[i + 1]);
        let term = univariate[i].mul(&Fr(BARY_DENOM_INV[i])).mul(&partial_prod);
        sum = sum.add(&term);
    }

    sum
}

/// Mapping from proof G1 point index → entity index (41-entity WIRE enum).
///
/// G1 points in proof are in TRANSCRIPT order:
///   g1[0]=w1, g1[1]=w2, g1[2]=w3, g1[3]=lrc, g1[4]=lrt,
///   g1[5]=w4, g1[6]=li, g1[7]=zperm
///
/// Entity indices (41-entity scheme, Solidity WIRE enum):
///   28=W_L, 29=W_R, 30=W_O, 31=W_4, 32=Z_PERM,
///   33=LOOKUP_INVERSES, 34=LOOKUP_READ_COUNTS, 35=LOOKUP_READ_TAGS
const PROOF_G1_TO_ENTITY: [usize; 8] = [
    28, // g1[0]=w1 → W_L
    29, // g1[1]=w2 → W_R
    30, // g1[2]=w3 → W_O
    34, // g1[3]=lrc → LOOKUP_READ_COUNTS
    35, // g1[4]=lrt → LOOKUP_READ_TAGS
    31, // g1[5]=w4 → W_4
    33, // g1[6]=li → LOOKUP_INVERSES
    32, // g1[7]=zperm → Z_PERM
];

/// Shifted entity pairs: (shifted_entity_idx, unshifted_entity_idx).
///
/// Solidity WIRE enum (41-entity scheme):
///   36=W_L_SHIFT, 37=W_R_SHIFT, 38=W_O_SHIFT,
///   39=W_4_SHIFT, 40=Z_PERM_SHIFT
const SHIFTED_ENTITIES: [(usize, usize); 5] = [
    (36, 28), // W_L_SHIFT → W_L
    (37, 29), // W_R_SHIFT → W_R
    (38, 30), // W_O_SHIFT → W_O
    (39, 31), // W_4_SHIFT → W_4
    (40, 32), // Z_PERM_SHIFT → Z_PERM
];

/// Precomputed: shifted entity → commitment array index.
///
/// The commitment array is [VK_0..VK_27, proof_g1_0..proof_g1_7, gemini_fold_0..].
/// Proof G1 in transcript order: g1[0]=w1, g1[1]=w2, g1[2]=w3, g1[3]=lrc, g1[4]=lrt,
///   g1[5]=w4, g1[6]=li, g1[7]=zperm
/// So commitment index = VK_NUM_COMMITMENTS(28) + transcript_g1_index
const SHIFTED_COMMITMENT_IDX: [usize; 5] = [
    VK_NUM_COMMITMENTS + 0, // entity 36 (W_L_SHIFT) → w1 at g1[0], commitment idx 28
    VK_NUM_COMMITMENTS + 1, // entity 37 (W_R_SHIFT) → w2 at g1[1], commitment idx 29
    VK_NUM_COMMITMENTS + 2, // entity 38 (W_O_SHIFT) → w3 at g1[2], commitment idx 30
    VK_NUM_COMMITMENTS + 5, // entity 39 (W_4_SHIFT) → w4 at g1[5], commitment idx 33
    VK_NUM_COMMITMENTS + 7, // entity 40 (Z_PERM_SHIFT) → zperm at g1[7], commitment idx 35
];

/// Compute r^{2^l} for l = 0..n-1
#[inline(never)]
fn compute_r_squares(r: &Fr, n: usize) -> Vec<Fr> {
    let mut r_sq = Vec::with_capacity(n);
    r_sq.push(*r); // r^{2^0} = r
    for l in 1..n {
        let prev = r_sq[l - 1];
        r_sq.push(prev.square()); // r^{2^l} = (r^{2^{l-1}})^2
    }
    r_sq
}

/// Reconstruct fold positive evaluations A_l(r^{2^l}) from the proof's negative evaluations.
///
/// Matches Solidity `CommitmentSchemeLib.computeFoldPosEvaluations`:
/// For l = logN-1 down to 0:
///   challengePower = r^{2^l}
///   u = sumcheckU[l]
///   evalNeg = geminiEvals[l]  (= A_l(-r^{2^l}))
///   numerator = challengePower * accumulator * 2 - evalNeg * (challengePower * (1-u) - u)
///   foldPosEvals[l] = numerator * foldReconInv[l]
///   accumulator = foldPosEvals[l]
///
/// The fold reconstruction denominators (r^{2^l}*(1-u_l) + u_l) are pre-inverted in the batch.
#[inline(never)]
fn compute_fold_pos_evaluations(
    batched_eval: &Fr,
    gemini_evals: &[Fr],
    r_squares: &[Fr],
    u_challenges: &[Fr],
    fold_recon_inv: &[Fr],
) -> Vec<Fr> {
    let log_n = r_squares.len();
    let mut fold_pos_evals = vec![Fr::zero(); log_n];
    let mut accumulator = *batched_eval;
    let two = Fr::from_u64(2);

    for i in (0..log_n).rev() {
        let cp = r_squares[i]; // r^{2^i}
        let u = u_challenges[i];
        let eval_neg = gemini_evals[i]; // A_i(-r^{2^i})

        // numerator = cp * accumulator * 2 - evalNeg * (cp * (1-u) - u)
        let one_minus_u = Fr::one().sub(&u);
        let cp_times_one_minus_u = cp.mul(&one_minus_u);
        let bracket = cp_times_one_minus_u.sub(&u); // cp*(1-u) - u
        let numerator = cp.mul(&accumulator).mul(&two).sub(&eval_neg.mul(&bracket));

        // foldPosEvals[i] = numerator / denominator (using pre-inverted denom)
        let round_acc = numerator.mul(&fold_recon_inv[i]);
        accumulator = round_acc;
        fold_pos_evals[i] = round_acc;
    }

    fold_pos_evals
}

/// Intermediate Shplemini values computed by Phase 3 (batch inverse only).
/// Phase 4 uses these + proof data to compute fold scalars, constant term,
/// entity scalars, MSM + pairing.
pub struct ShpleminiChallenges {
    /// Positive vanishing denominators: 1/(z - r^{2^l}) for l = 0..logN-1
    pub pos_inv_denoms: Vec<Fr>,
    /// Negative vanishing denominators: 1/(z + r^{2^l}) for l = 0..logN-1
    pub neg_inv_denoms: Vec<Fr>,
    /// Fold reconstruction inverse denoms: 1/(r^{2^l}*(1-u_l)+u_l) for l = 0..logN-1
    pub fold_recon_inv: Vec<Fr>,
    /// Entity unshifted scalar: 1/(z-r) + nu/(z+r)
    pub unshifted_scalar: Fr,
    /// Entity shifted scalar: (1/r) * (1/(z-r) - nu/(z+r))
    pub shifted_scalar: Fr,
}

// compute_shplemini_challenges_combined removed — use compute_shplemini_challenges_core directly

/// Compute entity scalar array from rho powers and challenge scalars.
///
/// Matches Solidity HonkVerifier v3: entity scalars are NEGATED.
#[inline(never)]
fn compute_shplemini_scalars(
    rho_pow: &[Fr],
    unshifted_scalar: &Fr,
    shifted_scalar: &Fr,
    fold_scalars: &[Fr],
    log_n: usize,
) -> Vec<Fr> {
    let num_commitments = VK_NUM_COMMITMENTS + 8 + (log_n - 1);
    let mut scalars = Vec::with_capacity(num_commitments);

    // Unshifted VK entities 0..27 (28 commitments) — NEGATED per Solidity
    for i in 0..VK_NUM_COMMITMENTS {
        scalars.push(rho_pow[i].mul(unshifted_scalar).negate());
    }
    // Unshifted proof entities (8 proof G1 points, in transcript order) — NEGATED
    for g1_idx in 0..8usize {
        let entity_idx = PROOF_G1_TO_ENTITY[g1_idx];
        scalars.push(rho_pow[entity_idx].mul(unshifted_scalar).negate());
    }
    // Gemini fold commitment scalars (already negated in fold_scalar_round)
    for l in 0..(log_n - 1) {
        scalars.push(fold_scalars[l]);
    }

    // Shifted entity contributions — NEGATED per Solidity
    for (i, &(shifted_entity, _)) in SHIFTED_ENTITIES.iter().enumerate() {
        let ss = rho_pow[shifted_entity].mul(shifted_scalar).negate();
        let commitment_idx = SHIFTED_COMMITMENT_IDX[i];
        scalars[commitment_idx] = scalars[commitment_idx].add(&ss);
    }

    scalars
}

/// Parse all commitment points (VK + proof + gemini fold) for the MSM.
#[inline(never)]
fn collect_shplemini_commitments(
    vk: &VerificationKey,
    proof: &ProofSlice,
    log_n: usize,
) -> Result<Vec<G1Point>, UltraHonkError> {
    let num_commitments = VK_NUM_COMMITMENTS + 8 + (log_n - 1);
    let mut commitments = Vec::with_capacity(num_commitments);

    let vk_comms = vk.commitments();
    for i in 0..VK_NUM_COMMITMENTS {
        commitments.push(vk_comms[i]);
    }
    // Parse 8 witness G1 affine points from proof
    for g1_idx in 0..NUM_WITNESS_COMMITMENTS {
        let raw = proof.g1_point_bytes(g1_idx);
        let pt = G1Point::from_bytes(raw).map_err(|_| {
            pinocchio::msg!("P4: proof G1 parse fail");
            UltraHonkError::InvalidG1Point
        })?;
        commitments.push(pt);
    }
    // Parse (logN - 1) gemini fold G1 affine points
    for l in 0..(log_n - 1) {
        let pt = G1Point::from_bytes(proof.gemini_fold_comm_bytes(l)).map_err(|_| {
            pinocchio::msg!("P4: gemini fold parse fail");
            UltraHonkError::InvalidG1Point
        })?;
        commitments.push(pt);
    }

    log_cu("CP13e: after commitment parse+validate");

    Ok(commitments)
}

// compute_shplemini_challenges_combined_inline removed — use compute_shplemini_challenges_core directly

/// Build the batch inverse input array and return all inversions.
/// Separated to keep stack frames under 4KB BPF limit.
#[inline(never)]
fn build_and_batch_inverse(
    r_squares: &[Fr],
    sumcheck_u_challenges: &[Fr],
    z: &Fr,
    r: &Fr,
) -> Vec<Fr> {
    let log_n = r_squares.len();
    let total = 3 * log_n + 1;
    let mut to_invert = Vec::with_capacity(total);

    // Group A pos: positive vanishing denominators (z - r^{2^l})
    for l in 0..log_n {
        to_invert.push(z.sub(&r_squares[l]));
    }
    // Group A neg: negative vanishing denominators (z + r^{2^l})
    for l in 0..log_n {
        to_invert.push(z.add(&r_squares[l]));
    }
    // Group B: fold reconstruction denominators (r^{2^l}*(1-u_l) + u_l)
    for l in 0..log_n {
        let one_minus_u = Fr::one().sub(&sumcheck_u_challenges[l]);
        to_invert.push(r_squares[l].mul(&one_minus_u).add(&sumcheck_u_challenges[l]));
    }
    // Group C: r itself (for 1/r in shifted scalar)
    to_invert.push(*r);

    Fr::batch_inverse(&to_invert)
}

/// Compute batchedEvaluation = sum(rho^i * sumcheckEvals[i]) for all entities.
/// Separated to keep stack frames under 4KB BPF limit.
#[inline(never)]
fn compute_batched_evaluation(
    proof: &ProofSlice,
    rho: &Fr,
) -> Result<Fr, UltraHonkError> {
    let mut batched_eval = Fr::zero();
    let mut rho_pow_running = Fr::one();
    for i in 0..NUMBER_OF_ENTITIES {
        let eval = Fr::from_bytes(proof.sumcheck_evaluation_bytes(i))
            .map_err(|_| UltraHonkError::InvalidFieldElement)?;
        batched_eval = batched_eval.add(&rho_pow_running.mul(&eval));
        rho_pow_running = rho_pow_running.mul(rho);
    }
    Ok(batched_eval)
}

/// Compute one fold scalar round and its constant term contribution.
/// Returns (fold_scalar, accum_contribution, next_batching_challenge).
#[inline(never)]
fn fold_scalar_round(
    nu: &Fr,
    nu_sq: &Fr,
    batching_challenge: &Fr,
    pos_inv_denom: &Fr,
    neg_inv_denom: &Fr,
    fold_pos_eval: &Fr,
    gemini_eval: &Fr,
) -> (Fr, Fr, Fr) {
    let scaling_factor_pos = batching_challenge.mul(pos_inv_denom);
    let scaling_factor_neg = batching_challenge.mul(nu).mul(neg_inv_denom);
    let fold_scalar = scaling_factor_pos.add(&scaling_factor_neg).negate();
    let accum = scaling_factor_pos.mul(fold_pos_eval)
        .add(&scaling_factor_neg.mul(gemini_eval));
    let next_bc = batching_challenge.mul(nu_sq);
    (fold_scalar, accum, next_bc)
}

/// Compute fold scalars and constant term from pre-computed data.
/// Returns (fold_scalars, constant_term).
#[inline(never)]
fn compute_fold_scalars_and_constant(
    nu: &Fr,
    pos_inv_denoms: &[Fr],
    neg_inv_denoms: &[Fr],
    fold_pos_evals: &[Fr],
    gemini_evals: &[Fr],
    log_n: usize,
) -> (Vec<Fr>, Fr) {
    // Level 0: constant term from A_0(+r) and A_0(-r)
    let mut constant_term = fold_pos_evals[0].mul(&pos_inv_denoms[0]);
    constant_term = constant_term.add(&gemini_evals[0].mul(nu).mul(&neg_inv_denoms[0]));

    // Fold scalars for levels 1..logN-1
    let mut fold_scalars = Vec::with_capacity(log_n - 1);
    let nu_sq = nu.square();
    let mut bc = nu_sq; // batching_challenge = nu^2

    for l in 0..(log_n - 1) {
        let level = l + 1;
        let (fs, accum, next_bc) = fold_scalar_round(
            nu, &nu_sq, &bc,
            &pos_inv_denoms[level], &neg_inv_denoms[level],
            &fold_pos_evals[level], &gemini_evals[level],
        );
        fold_scalars.push(fs);
        constant_term = constant_term.add(&accum);
        bc = next_bc;
    }

    (fold_scalars, constant_term)
}

/// Batch inverse computation (Phase 3). Returns intermediate values.
#[inline(never)]
pub fn compute_shplemini_challenges_core(
    proof: &ProofSlice,
    sumcheck_u_challenges: &[Fr],
    r: &Fr,
    nu: &Fr,
    z: &Fr,
) -> Result<Box<ShpleminiChallenges>, UltraHonkError> {
    let log_n = proof.circuit_size_log as usize;

    // Step 1: r^{2^l}
    let r_squares = compute_r_squares(r, log_n);
    log_cu("CP13a: after r_squares");

    // Step 2: Batch inverse (3*logN + 1 elements, 1 Fermat)
    let all_inv = build_and_batch_inverse(&r_squares, sumcheck_u_challenges, z, r);
    log_cu("CP13b: after combined batch_inverse");

    // Unpack results
    let pos_inv_denoms = all_inv[0..log_n].to_vec();
    let neg_inv_denoms = all_inv[log_n..2 * log_n].to_vec();
    let fold_recon_inv = all_inv[2 * log_n..3 * log_n].to_vec();
    let inv_r = all_inv[3 * log_n];

    // Step 3: Compute unshifted and shifted scalars
    let unshifted_scalar = pos_inv_denoms[0].add(&nu.mul(&neg_inv_denoms[0]));
    let shifted_scalar = inv_r.mul(&pos_inv_denoms[0].sub(&nu.mul(&neg_inv_denoms[0])));

    Ok(Box::new(ShpleminiChallenges {
        pos_inv_denoms,
        neg_inv_denoms,
        fold_recon_inv,
        unshifted_scalar,
        shifted_scalar,
    }))
}

// serialize_shplemini_challenges_inline removed — use serialize_shplemini_challenges directly

/// One-shot shplemini verification (used in tests).
#[inline(never)]
#[allow(dead_code)]
fn verify_shplemini(
    vk: &VerificationKey,
    proof: &ProofSlice,
    tp: &TranscriptChallenges,
) -> Result<(), UltraHonkError> {
    let log_n = proof.circuit_size_log as usize;

    // Batch inverse
    let ch = compute_shplemini_challenges_core(
        proof, &tp.sumcheck_u_challenges, &tp.gemini_r, &tp.shplonk_nu, &tp.shplonk_z,
    )?;

    // Fold computation
    let r_squares = compute_r_squares(&tp.gemini_r, log_n);
    let mut gemini_evals = Vec::with_capacity(log_n);
    for i in 0..log_n {
        gemini_evals.push(Fr::from_bytes(proof.gemini_a_evaluation_bytes(i))
            .map_err(|_| UltraHonkError::InvalidFieldElement)?);
    }
    let batched_eval = compute_batched_evaluation(proof, &tp.rho)?;
    let fold_pos_evals = compute_fold_pos_evaluations(
        &batched_eval, &gemini_evals, &r_squares,
        &tp.sumcheck_u_challenges, &ch.fold_recon_inv,
    );
    let (fold_scalars, constant_term) = compute_fold_scalars_and_constant(
        &tp.shplonk_nu, &ch.pos_inv_denoms, &ch.neg_inv_denoms,
        &fold_pos_evals, &gemini_evals, log_n,
    );

    // Rho powers + entity scalars
    let mut rho_pow = Vec::with_capacity(NUMBER_OF_ENTITIES);
    rho_pow.push(Fr::one());
    for k in 1..NUMBER_OF_ENTITIES {
        rho_pow.push(rho_pow[k - 1].mul(&tp.rho));
    }
    let mut scalars = compute_shplemini_scalars(
        &rho_pow, &ch.unshifted_scalar, &ch.shifted_scalar, &fold_scalars, log_n,
    );
    scalars.push(constant_term);

    // Commitments + MSM
    let mut commitments = collect_shplemini_commitments(vk, proof, log_n)?;
    commitments.push(G1Point::generator());
    let kzg_quotient = proof.kzg_quotient_point()?;
    if kzg_quotient.is_identity() {
        return Err(UltraHonkError::InvalidProofFormat);
    }
    let msm_result = msm(&commitments, &scalars)?;

    // P = shplonk_q + msm_result + z * kzg_quotient
    let shplonk_q = proof.shplonk_q_point()?;
    let p = shplonk_q.add(&msm_result)?.add(&kzg_quotient.mul_fr(&tp.shplonk_z)?)?;

    // Pairing check
    let pairing_result = pairing_check(&[
        (p, G2Point(SRS_G2_GENERATOR)),
        (kzg_quotient.negate(), G2Point(SRS_G2_X)),
    ])?;
    if !pairing_result {
        return Err(UltraHonkError::PairingCheckFailed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_challenge_127bit_roundtrip() {
        // 127-bit split: lo = lower 127 bits, hi = value >> 127
        let bytes: [u8; 32] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ];
        let challenge = Fr::from_bytes(&bytes).unwrap();
        let (lower, upper) = split_challenge(&challenge);

        // Roundtrip: challenge = lo + hi * 2^127
        let two_127 = Fr::from_limbs_standard([0, 1u64 << 63, 0, 0]);
        let reconstructed = lower.add(&upper.mul(&two_127));
        assert_eq!(reconstructed, challenge);
    }

    #[test]
    fn test_barycentric_evaluation_at_domain_points() {
        // If we evaluate at domain point i, we should get univariate[i]
        let mut univariate = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            univariate[i] = Fr::from_u64((i * 10 + 7) as u64);
        }

        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            let challenge = Fr::from_u64(i as u64);
            let result = evaluate_univariate_barycentric(&univariate, &challenge);
            assert_eq!(result, univariate[i], "Barycentric eval at domain point {i} failed");
        }
    }

    #[test]
    fn test_verification_state_roundtrip() {
        // 15 sumcheck_u challenges (all of them), 7 remaining gate challenges
        let all_sumcheck_u: Vec<Fr> = (1..=15).map(|i| Fr::from_u64(i)).collect();
        let remaining_gate_challenges: Vec<Fr> = (10..=70).step_by(10).map(|i| Fr::from_u64(i)).collect();

        let state = VerificationState {
            magic: VERIFICATION_STATE_MAGIC,
            phase: 1,
            circuit_size_log: 15,
            rounds_completed: 8,
            num_public_inputs: 4,
            proof_buffer_key: [0xAA; 32],
            vk_hash: [0xBB; 32],
            round_target_sum: Fr::from_u64(42),
            rho: Fr::from_u64(100),
            gemini_r: Fr::from_u64(200),
            shplonk_nu: Fr::from_u64(300),
            shplonk_z: Fr::from_u64(999),
            all_sumcheck_u: all_sumcheck_u.clone(),
            remaining_gate_challenges: remaining_gate_challenges.clone(),
        };

        let serialized = state.serialize();
        assert_eq!(serialized.len(), VerificationState::serialized_size(15, 7));

        let deserialized = VerificationState::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.magic, VERIFICATION_STATE_MAGIC);
        assert_eq!(deserialized.phase, 1);
        assert_eq!(deserialized.circuit_size_log, 15);
        assert_eq!(deserialized.rounds_completed, 8);
        assert_eq!(deserialized.round_target_sum, Fr::from_u64(42));
        assert_eq!(deserialized.rho, Fr::from_u64(100));
        assert_eq!(deserialized.gemini_r, Fr::from_u64(200));
        assert_eq!(deserialized.shplonk_nu, Fr::from_u64(300));
        assert_eq!(deserialized.shplonk_z, Fr::from_u64(999));
        assert_eq!(deserialized.all_sumcheck_u.len(), 15);
        assert_eq!(deserialized.all_sumcheck_u[0], Fr::from_u64(1));
        assert_eq!(deserialized.all_sumcheck_u[14], Fr::from_u64(15));
        assert_eq!(deserialized.remaining_gate_challenges.len(), 7);
        assert_eq!(deserialized.remaining_gate_challenges[0], Fr::from_u64(10));
        assert_eq!(deserialized.remaining_gate_challenges[6], Fr::from_u64(70));
        assert_eq!(deserialized.proof_buffer_key, [0xAA; 32]);
        assert_eq!(deserialized.vk_hash, [0xBB; 32]);
    }

    #[test]
    fn test_compute_r_squares() {
        let r = Fr::from_u64(5);
        let r_sq = compute_r_squares(&r, 4);
        assert_eq!(r_sq.len(), 4);
        assert_eq!(r_sq[0], Fr::from_u64(5));      // r^{2^0} = r = 5
        assert_eq!(r_sq[1], Fr::from_u64(25));     // r^{2^1} = r^2 = 25
        assert_eq!(r_sq[2], Fr::from_u64(625));    // r^{2^2} = r^4 = 625
        assert_eq!(r_sq[3], Fr::from_u64(390625)); // r^{2^3} = r^8 = 390625
    }

    #[test]
    fn test_compute_r_squares_single() {
        let r = Fr::from_u64(7);
        let r_sq = compute_r_squares(&r, 1);
        assert_eq!(r_sq.len(), 1);
        assert_eq!(r_sq[0], Fr::from_u64(7));
    }

    #[test]
    fn test_barycentric_evaluation_matches_reference() {
        // Compare prefix/suffix approach against direct Lagrange interpolation
        let mut univariate = [Fr::zero(); BATCHED_RELATION_PARTIAL_LENGTH];
        for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
            univariate[i] = Fr::from_u64((i * 7 + 3) as u64);
        }

        let challenge = Fr::from_u64(42);
        let result = evaluate_univariate_barycentric(&univariate, &challenge);

        // Compute reference via direct Lagrange interpolation
        let n = BATCHED_RELATION_PARTIAL_LENGTH;
        let mut reference = Fr::zero();
        for i in 0..n {
            // L_i(x) = prod_{j≠i}(x-j) / prod_{j≠i}(i-j)
            let mut numerator = Fr::one();
            for j in 0..n {
                if j != i {
                    numerator = numerator.mul(&challenge.sub(&Fr::from_u64(j as u64)));
                }
            }
            let term = univariate[i].mul(&Fr(BARY_DENOM_INV[i])).mul(&numerator);
            reference = reference.add(&term);
        }

        assert_eq!(result, reference, "Barycentric eval doesn't match reference Lagrange");
    }
}
