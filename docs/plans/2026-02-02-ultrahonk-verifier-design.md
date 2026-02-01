# UltraHonk Verifier for Solana - Design Document

## Overview

This document outlines the design for adapting the miquelcabot/ultrahonk_verifier Rust implementation for Solana's runtime constraints.

## Reference Implementation Analysis

The reference verifier (miquelcabot/ultrahonk_verifier) implements full UltraHonk verification with:

### 1. Verification Flow

```
verify()
  └── verify_inner()
        ├── generate_transcript()      // Fiat-Shamir challenges via Keccak256
        ├── verify_sumcheck()          // Polynomial evaluation checks
        └── verify_shplemini()         // KZG batch opening + pairing check
```

### 2. Key Data Structures

**Verification Key (VK)** - 1760 bytes:
- circuit_size (u64), log_circuit_size (u64), num_public_inputs (u64), pub_inputs_offset (u64)
- 27 G1 commitment points (64 bytes each = 1728 bytes):
  - Selector polynomials: q_m, q_c, q_l, q_r, q_o, q_4, q_lookup, q_arith, q_deltarange, q_elliptic, q_aux, q_poseidon2external, q_poseidon2internal
  - Copy constraints: s_1, s_2, s_3, s_4
  - Identity permutations: id_1, id_2, id_3, id_4
  - Lookup tables: t_1, t_2, t_3, t_4
  - Lagrange: lagrange_first, lagrange_last

**Proof** - Two variants:
- PlainProof: ~8608 bytes (CONST_PROOF_SIZE_LOG_N = 28)
- ZKProof: ~9024 bytes (includes Libra commitments)

**Proof Structure:**
- Wire commitments: w1, w2, w3, w4 (4 × 128 bytes)
- Lookup helpers: lookup_read_counts, lookup_read_tags, lookup_inverses (3 × 128 bytes)
- Permutation: z_perm (128 bytes)
- Sumcheck univariates: 28 rounds × 8 scalars × 32 bytes
- Sumcheck evaluations: 40 × 32 bytes
- Gemini fold commitments: 27 × 128 bytes
- Gemini evaluations: 28 × 32 bytes
- Shplonk Q commitment: 128 bytes
- KZG quotient: 128 bytes

### 3. Cryptographic Operations

| Operation | Count per Verification | Solana Syscall |
|-----------|----------------------|----------------|
| Keccak256 | ~60+ hashes | `sol_keccak256` |
| Field operations | ~10000+ | Native Rust |
| EC scalar mul | ~70+ | `sol_alt_bn128_g1_multiply` |
| EC point add | ~70+ | `sol_alt_bn128_g1_add` |
| Pairing (2 pairs) | 1 | `sol_alt_bn128_pairing` |

### 4. Solana Constraints

| Resource | Limit | Impact |
|----------|-------|--------|
| Compute Units | 1.4M (with CU request) | Major constraint |
| Stack | 4KB | Requires heap allocation |
| Heap | 32KB | Sufficient for VK + proof |
| Account size | 10MB | VK storage OK |

## Design Options

### Option A: Full On-Chain Verification (NOT RECOMMENDED)

Implement complete verification algorithm on-chain.

**Pros:**
- Fully trustless
- Single transaction

**Cons:**
- MSM with 70+ points exceeds compute budget
- Each EC multiply: ~6000 CU, Total: 420,000 CU just for multiplies
- Plus pairing: ~330,000 CU
- Plus sumcheck: ~100,000 CU
- **Total: ~850,000+ CU** - might work but risky

### Option B: Split Transaction Verification (RECOMMENDED)

Split verification into multiple transactions with on-chain state.

**Phase 1: Setup + Transcript Generation**
- Parse proof and VK
- Generate Fiat-Shamir challenges
- Store intermediate state
- ~200,000 CU

**Phase 2: Sumcheck Verification**
- Verify all 28 sumcheck rounds
- Compute accumulated relation evaluation
- Store result
- ~300,000 CU

**Phase 3: Shplemini - Scalar Computation**
- Compute all scalar multipliers
- Compute batched evaluation
- Store for MSM
- ~200,000 CU

**Phase 4: Shplemini - MSM + Pairing**
- Perform MSM (or incremental accumulation)
- Execute final pairing check
- ~500,000 CU

**Pros:**
- Fits within compute budget
- Still fully trustless
- Each phase can be verified independently

**Cons:**
- Multiple transactions required
- State management complexity
- Higher total cost

### Option C: Optimized Single Transaction (AGGRESSIVE)

Aggressively optimize for single transaction.

**Optimizations:**
1. **Precompute VK commitments** - Store MSM-ready format
2. **Batched inversions** - Reduce field inversions
3. **Sparse MSM** - Skip zero scalars
4. **Circuit-specific optimizations** - Fixed log_circuit_size = 16

With `log_circuit_size = 16` (our circuits are small):
- Only 16 sumcheck rounds instead of 28
- Only 15 gemini fold commitments instead of 27
- Significantly reduced MSM size

**Estimated CU:**
- Transcript: ~50,000 CU
- Sumcheck (16 rounds): ~100,000 CU
- MSM (~50 points): ~350,000 CU
- Pairing: ~330,000 CU
- **Total: ~830,000 CU** - Feasible!

## Recommended Approach: Option C with Fallback to B

### Implementation Strategy

1. **Parameterize for small circuits**
   - Our circuits have `log_circuit_size ≤ 16`
   - Use compile-time constants for our circuit sizes
   - Avoid allocations - use fixed-size arrays

2. **Optimize field operations**
   - Use Montgomery representation
   - Batch inversions (already in reference)
   - Precompute common values

3. **Optimize MSM**
   ```rust
   // Instead of generic MSM:
   fn msm_optimized(
       vk_points: &[G1Affine; 27],      // Preloaded from account
       proof_points: &[G1Affine; 12],   // Parsed from proof
       scalars: &[Fr; 39],               // Computed on-chain
   ) -> G1 {
       // Use Solana syscalls directly
       let mut acc = G1::identity();
       for (point, scalar) in points.zip(scalars) {
           if !scalar.is_zero() {
               let prod = sol_alt_bn128_g1_multiply(point, scalar);
               acc = sol_alt_bn128_g1_add(acc, prod);
           }
       }
       acc
   }
   ```

4. **On-chain VK storage**
   - Store parsed VK in account (pre-validated G1 points)
   - VK account size: ~2KB (27 × 64 bytes + metadata)

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        zVault Program                           │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  spend_partial   │  │   spend_split    │  │     claim     │ │
│  │    _public       │  │                  │  │               │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘ │
│           │                     │                    │         │
│           └──────────────┬──────┴────────────────────┘         │
│                          │                                     │
│                          ▼                                     │
│            ┌─────────────────────────────┐                     │
│            │   UltraHonk Verifier CPI    │                     │
│            │   (with circuit-specific    │                     │
│            │    VK account)              │                     │
│            └─────────────┬───────────────┘                     │
│                          │                                     │
└──────────────────────────┼─────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                UltraHonk Verifier Program                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     verify_proof                          │  │
│  │                                                          │  │
│  │  1. Load VK from account (pre-validated G1 points)       │  │
│  │  2. Parse proof                                          │  │
│  │  3. Generate transcript (Keccak256 Fiat-Shamir)          │  │
│  │  4. Verify sumcheck                                      │  │
│  │  5. Verify shplemini (MSM + pairing)                     │  │
│  │  6. Return success/failure                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Accounts:                                                      │
│  - VK Account (per circuit type)                               │
│  - SRS G2 Account (shared)                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### VK Account Structure

```rust
#[account]
pub struct VerificationKeyAccount {
    /// Circuit identifier (claim, split, partial_public, etc.)
    pub circuit_type: CircuitType,

    /// Circuit metadata
    pub circuit_size: u64,
    pub log_circuit_size: u64,
    pub num_public_inputs: u64,
    pub pub_inputs_offset: u64,

    /// Pre-validated G1 points (affine coordinates)
    /// Each point: 64 bytes (32 for x, 32 for y)
    pub q_m: [u8; 64],
    pub q_c: [u8; 64],
    pub q_l: [u8; 64],
    pub q_r: [u8; 64],
    pub q_o: [u8; 64],
    pub q_4: [u8; 64],
    pub q_lookup: [u8; 64],
    pub q_arith: [u8; 64],
    pub q_deltarange: [u8; 64],
    pub q_elliptic: [u8; 64],
    pub q_aux: [u8; 64],
    pub q_poseidon2external: [u8; 64],
    pub q_poseidon2internal: [u8; 64],
    pub s_1: [u8; 64],
    pub s_2: [u8; 64],
    pub s_3: [u8; 64],
    pub s_4: [u8; 64],
    pub id_1: [u8; 64],
    pub id_2: [u8; 64],
    pub id_3: [u8; 64],
    pub id_4: [u8; 64],
    pub t_1: [u8; 64],
    pub t_2: [u8; 64],
    pub t_3: [u8; 64],
    pub t_4: [u8; 64],
    pub lagrange_first: [u8; 64],
    pub lagrange_last: [u8; 64],
}
// Total size: 8 + 32 + 27*64 = 1768 bytes
```

## Implementation Plan

### Phase 1: Core Verifier Module

1. **Port transcript generation** (~2 days)
   - Keccak256-based Fiat-Shamir
   - Challenge splitting (128-bit extraction)
   - All challenge derivations

2. **Port field operations** (~1 day)
   - BN254 Fr arithmetic
   - Batch inversion
   - Montgomery operations

3. **Port sumcheck verification** (~2 days)
   - Round-by-round verification
   - Barycentric evaluation
   - Relation accumulation

4. **Port shplemini verification** (~3 days)
   - Scalar computation
   - MSM using syscalls
   - Pairing check

### Phase 2: Solana Integration

1. **VK account management** (~1 day)
   - Create VK accounts per circuit
   - Validate and store G1 points

2. **Verifier program** (~2 days)
   - Instruction handlers
   - CPI interface
   - Error handling

3. **zVault integration** (~1 day)
   - Update CPI calls
   - Remove demo mode flag

### Phase 3: Testing & Optimization

1. **Unit tests** (~2 days)
   - Port reference tests
   - Edge cases

2. **Integration tests** (~2 days)
   - E2E with real proofs
   - CU measurement

3. **Optimization** (~2 days)
   - CU profiling
   - Hot path optimization
   - If needed, implement split-transaction fallback

## Files to Create/Modify

### New Files

```
contracts/programs/ultrahonk-verifier/src/
├── lib.rs              # Program entry + instructions
├── verifier.rs         # Main verification logic
├── transcript.rs       # Fiat-Shamir transcript
├── sumcheck.rs         # Sumcheck verification
├── shplemini.rs        # Shplemini verification
├── types.rs            # Proof, VK, Fr types
├── constants.rs        # Circuit constants
├── bn254/
│   ├── mod.rs          # BN254 operations
│   ├── field.rs        # Fr field operations
│   ├── g1.rs           # G1 point operations (syscall wrappers)
│   └── pairing.rs      # Pairing check (syscall wrapper)
└── state/
    ├── mod.rs
    └── vk_account.rs   # VK account structure
```

### Modified Files

```
contracts/programs/zvault/src/
├── instructions/claim.rs           # Update verifier CPI
├── instructions/spend_split.rs     # Update verifier CPI
├── instructions/spend_partial_public.rs  # Update verifier CPI
└── utils/ultrahonk.rs              # Update CPI helpers
```

## Compute Unit Budget Estimate

For a circuit with `log_circuit_size = 16`:

| Operation | Estimated CU |
|-----------|-------------|
| Parse proof | 10,000 |
| Generate transcript (Keccak) | 60,000 |
| Sumcheck (16 rounds) | 100,000 |
| Compute scalars | 50,000 |
| MSM (~45 points) | 300,000 |
| Pairing (2 pairs) | 330,000 |
| **Total** | **~850,000** |

With 1.4M CU budget and safety margin, this should work.

## Risk Mitigation

1. **CU Overflow Risk**
   - Mitigation: Implement split-transaction fallback
   - Early CU checks with graceful degradation

2. **Stack Overflow Risk**
   - Mitigation: Use heap allocation for large structures
   - `#[inline(never)]` on hot functions

3. **Proof Format Mismatch Risk**
   - Mitigation: Verify bb.js output format matches parser expectations
   - Add format version byte

## Success Criteria

1. Single-transaction verification for all circuit types
2. < 1.2M CU total (with margin)
3. No demo mode - full cryptographic verification
4. All existing tests pass
5. Compatible with bb.js proof format

## Next Steps

1. [ ] Create scaffold files with module structure
2. [ ] Port transcript generation
3. [ ] Port sumcheck verification
4. [ ] Port shplemini verification
5. [ ] Add VK account management
6. [ ] Integration testing
7. [ ] CU optimization
8. [ ] Deploy to devnet
