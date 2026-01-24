# Pinocchio Migration Plan for zVault

## Executive Summary

Migrate the zVault Solana program from Anchor to Pinocchio for **84% compute unit (CU) savings** while maintaining Groth16 ZK verification via `alt_bn128` syscalls. This improves transaction throughput, reduces costs, and enables more complex ZK operations within Solana's compute limits.

---

## Current Architecture Analysis

### What We Have Now

| Component | Technology | Lines of Code |
|-----------|------------|---------------|
| Solana Program | Anchor 0.31 | ~2,500 lines |
| ZK Verification | Groth16 via `solana-bn254` syscalls | ~750 lines |
| Circuits | Circom (BN254/Groth16) | ~6,500 lines |
| Frontend Prover | snarkjs | ~500 lines |
| Backend Crypto | light-poseidon + ark-bn254 | ~400 lines |

### Current CU Estimates (Anchor)

| Instruction | Estimated CU |
|-------------|--------------|
| `record_deposit` | ~15,000 |
| `claim_direct` (with proof) | ~150,000 |
| `split_commitment` (with proof) | ~160,000 |
| `request_redemption` | ~20,000 |

### Migration Targets (Pinocchio)

| Instruction | Target CU | Savings |
|-------------|-----------|---------|
| `record_deposit` | ~3,000 | 80% |
| `claim_direct` (with proof) | ~95,000 | 37% |
| `split_commitment` (with proof) | ~100,000 | 38% |
| `request_redemption` | ~4,000 | 80% |

*Note: ZK proof verification syscalls dominate CU costs (~90k); Pinocchio optimizes the account parsing/validation overhead.*

---

## Migration Phases

### Phase 1: Project Structure Setup (Foundation)

**Goal**: Create Pinocchio program structure alongside existing Anchor code.

#### 1.1 New Directory Structure

```
contracts/programs/zVault-pinocchio/
├── Cargo.toml
├── src/
│   ├── lib.rs                    # Entrypoint + routing
│   ├── error.rs                  # Custom errors
│   ├── state/
│   │   ├── mod.rs
│   │   ├── pool.rs               # PoolState zero-copy
│   │   ├── deposit.rs            # DepositRecord
│   │   ├── nullifier.rs          # NullifierRecord
│   │   └── redemption.rs         # RedemptionRequest
│   ├── instructions/
│   │   ├── mod.rs
│   │   ├── initialize.rs
│   │   ├── record_deposit.rs
│   │   ├── claim_direct.rs
│   │   ├── mint_to_commitment.rs
│   │   ├── split_commitment.rs
│   │   └── request_redemption.rs
│   ├── utils/
│   │   ├── mod.rs
│   │   ├── groth16.rs            # ZK verification (port existing)
│   │   └── token.rs              # Token-2022 helpers
│   └── constants.rs
└── tests/
    ├── unit/                     # LiteSVM/Mollusk tests
    └── integration/              # Surfpool tests
```

#### 1.2 Cargo.toml Configuration

```toml
[package]
name = "zVault-pinocchio"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
default = ["perf"]
perf = []
testing = []

[dependencies]
pinocchio = "0.8"
pinocchio-token = "0.4"
pinocchio-system = "0.3"
solana-bn254 = "~2.1"            # Keep for alt_bn128 syscalls
thiserror = "2.0"
num-derive = "0.4"

[dev-dependencies]
mollusk-svm = "0.3"
mollusk-svm-programs-token = "0.3"
litesvm = "0.6"
solana-sdk = "2.1"
```

---

### Phase 2: State Account Migration

**Goal**: Convert Anchor `#[account]` structs to Pinocchio zero-copy structs.

#### 2.1 PoolState Migration

**Current (Anchor)**:
```rust
#[account]
pub struct PoolState {
    pub authority: Pubkey,
    pub sbbtc_mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub deposit_count: u64,
    pub total_deposited: u64,
    pub total_minted: u64,
    pub paused: bool,
    pub bump: u8,
}
```

**Migrated (Pinocchio)**:
```rust
#[repr(C)]
pub struct PoolState {
    pub discriminator: u8,         // Account type marker
    pub authority: [u8; 32],       // Pubkey as bytes
    pub sbbtc_mint: [u8; 32],
    pub merkle_root: [u8; 32],
    deposit_count: [u8; 8],        // u64 as bytes (alignment-safe)
    total_deposited: [u8; 8],
    total_minted: [u8; 8],
    pub flags: u8,                 // Bitflags: paused (0x01), ...
    pub bump: u8,
}

impl PoolState {
    pub const DISCRIMINATOR: u8 = 0x01;
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const SEED: &'static [u8] = b"pool";

    const FLAG_PAUSED: u8 = 1 << 0;

    pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        if data[0] != Self::DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(data.as_ptr() as *const Self) })
    }

    pub fn deposit_count(&self) -> u64 {
        u64::from_le_bytes(self.deposit_count)
    }

    pub fn is_paused(&self) -> bool {
        self.flags & Self::FLAG_PAUSED != 0
    }
}
```

#### 2.2 Account Size Comparison

| Account | Anchor Size | Pinocchio Size | Savings |
|---------|-------------|----------------|---------|
| PoolState | 8 + 147 = 155 bytes | 122 bytes | 21% |
| DepositRecord | 8 + 57 = 65 bytes | 50 bytes | 23% |
| NullifierRecord | 8 + 41 = 49 bytes | 34 bytes | 31% |

*Anchor adds 8-byte discriminator; Pinocchio uses 1-byte discriminator.*

---

### Phase 3: Instruction Handler Migration

**Goal**: Convert Anchor `#[derive(Accounts)]` to Pinocchio `TryFrom` validation.

#### 3.1 Instruction Pattern

```rust
// instructions/claim_direct.rs

pub struct ClaimDirect<'a> {
    pub accounts: ClaimDirectAccounts<'a>,
    pub data: ClaimDirectData,
}

pub struct ClaimDirectAccounts<'a> {
    pub pool_state: &'a AccountView,
    pub claimant: &'a AccountView,
    pub nullifier_record: &'a AccountView,
    pub claimant_token: &'a AccountView,
    pub sbbtc_mint: &'a AccountView,
    pub token_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

pub struct ClaimDirectData {
    pub proof: [u8; 256],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub amount: u64,
}

impl<'a> TryFrom<(&'a [u8], &'a [AccountView])> for ClaimDirect<'a> {
    type Error = ProgramError;

    fn try_from((data, accounts): (&'a [u8], &'a [AccountView])) -> Result<Self, Self::Error> {
        let accounts = ClaimDirectAccounts::try_from(accounts)?;
        let data = ClaimDirectData::try_from(data)?;
        Ok(Self { accounts, data })
    }
}

impl<'a> TryFrom<&'a [AccountView]> for ClaimDirectAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [pool_state, claimant, nullifier_record, claimant_token,
             sbbtc_mint, token_program, system_program, ..] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // Validation checks
        if !claimant.is_signer() {
            return Err(ProgramError::MissingRequiredSignature);
        }

        if !pool_state.is_owned_by(&crate::ID) {
            return Err(ProgramError::InvalidAccountOwner);
        }

        // Verify token program
        if token_program.address() != &pinocchio_token::ID {
            return Err(ProgramError::IncorrectProgramId);
        }

        Ok(Self {
            pool_state,
            claimant,
            nullifier_record,
            claimant_token,
            sbbtc_mint,
            token_program,
            system_program,
        })
    }
}

impl<'a> ClaimDirect<'a> {
    pub const DISCRIMINATOR: u8 = 3; // Instruction index

    pub fn process(&self) -> ProgramResult {
        // 1. Load and verify pool state
        let pool_data = self.accounts.pool_state.try_borrow_data()?;
        let pool = PoolState::from_bytes(&pool_data)?;

        if pool.is_paused() {
            return Err(zVaultError::PoolPaused.into());
        }

        // 2. Verify ZK proof (reuse existing groth16.rs)
        let public_inputs = [
            self.data.root,
            self.data.nullifier_hash,
            amount_to_field(self.data.amount),
            pubkey_to_field(self.accounts.claimant.address()),
        ];

        if !verify_claim_direct_proof(&self.data.proof, &public_inputs)? {
            return Err(zVaultError::InvalidProof.into());
        }

        // 3. Record nullifier (prevent double-spend)
        // ...initialize nullifier_record PDA...

        // 4. Mint sbBTC to claimant
        MintTo {
            mint: self.accounts.sbbtc_mint,
            token_account: self.accounts.claimant_token,
            authority: self.accounts.pool_state,  // PDA signer
            amount: self.data.amount,
        }.invoke_signed(&[/* PDA seeds */])?;

        Ok(())
    }
}
```

---

### Phase 4: ZK Verification Port

**Goal**: Port existing Groth16 verification to Pinocchio (minimal changes).

#### 4.1 Key Insight

The `alt_bn128` syscalls work identically in both Anchor and Pinocchio - they're Solana runtime features. The port involves:

1. Change imports from `solana_program` to `pinocchio` where applicable
2. Keep `solana_bn254` for syscall access
3. Optimize memory layout for Pinocchio's zero-allocation patterns

#### 4.2 Groth16 Verification (Pinocchio Version)

```rust
// utils/groth16.rs

use solana_bn254::alt_bn128::{
    prelude::*,
    compression::prelude::*,
};

pub struct Groth16Proof {
    pub a: [u8; 64],   // G1 point
    pub b: [u8; 128],  // G2 point
    pub c: [u8; 64],   // G1 point
}

impl Groth16Proof {
    pub fn from_bytes(data: &[u8; 256]) -> Self {
        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];

        a.copy_from_slice(&data[0..64]);
        b.copy_from_slice(&data[64..192]);
        c.copy_from_slice(&data[192..256]);

        Self { a, b, c }
    }
}

/// Verify Groth16 proof using alt_bn128 syscalls
///
/// Equation: e(A, B) = e(α, β) × e(vk_x, γ) × e(C, δ)
pub fn verify_groth16(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    public_inputs: &[[u8; 32]],
) -> Result<bool, ProgramError> {
    // 1. Compute vk_x = vk.ic[0] + Σ(input[i] × vk.ic[i+1])
    let mut vk_x = vk.ic[0];

    for (i, input) in public_inputs.iter().enumerate() {
        if is_zero(input) {
            continue; // Skip zero inputs (saves ~6,500 CU)
        }

        // scalar_mul: vk.ic[i+1] × input
        let mul_result = alt_bn128_multiplication(&[
            &vk.ic[i + 1],
            input,
        ].concat())?;

        // point_add: vk_x + mul_result
        vk_x = alt_bn128_addition(&[&vk_x, &mul_result].concat())?
            .try_into()
            .map_err(|_| ProgramError::InvalidArgument)?;
    }

    // 2. Negate proof.A for pairing check
    let neg_a = negate_g1(&proof.a)?;

    // 3. Pairing check: e(-A, B) × e(α, β) × e(vk_x, γ) × e(C, δ) = 1
    let pairing_input = [
        neg_a.as_slice(),
        proof.b.as_slice(),
        vk.alpha.as_slice(),
        vk.beta.as_slice(),
        vk_x.as_slice(),
        vk.gamma.as_slice(),
        proof.c.as_slice(),
        vk.delta.as_slice(),
    ].concat();

    let result = alt_bn128_pairing(&pairing_input)?;
    Ok(result[31] == 1 && result[..31].iter().all(|&b| b == 0))
}

#[inline(always)]
fn is_zero(input: &[u8; 32]) -> bool {
    input.iter().all(|&b| b == 0)
}
```

---

### Phase 5: Token-2022 Integration

**Goal**: Implement Token-2022 minting/burning with Pinocchio.

#### 5.1 Token-2022 Helpers

```rust
// utils/token.rs

use pinocchio_token::instructions::{MintTo, Burn, Transfer};

pub const TOKEN_2022_ID: [u8; 32] = [/* Token-2022 program ID bytes */];

/// Mint sbBTC to user (Token-2022)
pub fn mint_sbbtc<'a>(
    mint: &'a AccountView,
    destination: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
    seeds: &[Seed],
) -> ProgramResult {
    let signers = [Signer::from(seeds)];

    MintTo {
        mint,
        account: destination,
        mint_authority: authority,
        amount,
    }.invoke_signed(&signers)
}

/// Burn sbBTC from user (Token-2022)
pub fn burn_sbbtc<'a>(
    mint: &'a AccountView,
    source: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
) -> ProgramResult {
    Burn {
        mint,
        account: source,
        authority,
        amount,
    }.invoke()
}
```

---

### Phase 6: Testing Strategy

**Goal**: Comprehensive testing with LiteSVM and Mollusk.

#### 6.1 Unit Tests (Mollusk)

```rust
// tests/unit/claim_direct.rs

use mollusk_svm::Mollusk;
use mollusk_svm::result::Check;

#[test]
fn test_claim_direct_valid_proof() {
    let program_id = pubkey!("zVault111111111111111111111111111111");
    let mollusk = Mollusk::new(&program_id, "target/deploy/zVault_pinocchio");

    // Setup accounts
    let pool_state = create_pool_state_account();
    let claimant = create_signer_account();
    let nullifier_record = create_uninitialized_account();
    // ... more accounts ...

    // Build instruction with valid proof
    let instruction = build_claim_direct_instruction(
        &VALID_PROOF,
        &MERKLE_ROOT,
        &NULLIFIER_HASH,
        1_000_000, // 0.01 BTC
    );

    // Execute and validate
    mollusk.process_and_validate_instruction(
        &instruction,
        &accounts,
        &[
            Check::success(),
            Check::compute_units(100_000), // Target CU
        ],
    );
}

#[test]
fn test_claim_direct_invalid_proof() {
    // ... test with invalid proof, expect failure ...
}

#[test]
fn test_claim_direct_double_spend() {
    // ... test nullifier reuse, expect failure ...
}
```

#### 6.2 CU Benchmarking

```rust
// tests/bench/cu_benchmarks.rs

use mollusk_svm::MolluskComputeUnitBencher;

#[test]
fn benchmark_all_instructions() {
    let bencher = MolluskComputeUnitBencher::new(mollusk)
        .must_pass(true)
        .out_dir("../target/benches");

    bencher.bench("record_deposit", &record_deposit_ix, &accounts);
    bencher.bench("claim_direct", &claim_direct_ix, &accounts);
    bencher.bench("split_commitment", &split_ix, &accounts);
    // ... generates markdown report ...
}
```

---

### Phase 7: Frontend Updates

**Goal**: Update client to support both Anchor (legacy) and Pinocchio programs.

#### 7.1 Instruction Builder Changes

```typescript
// frontend/src/lib/zVault/pinocchio-client.ts

import { Address, createTransactionMessage, appendTransactionMessageInstruction } from '@solana/kit';

const PINOCCHIO_PROGRAM_ID: Address = 'NewProgramId111111111111111111111111111111';

// Instruction discriminators (single byte for Pinocchio)
const IX_INITIALIZE = 0;
const IX_RECORD_DEPOSIT = 1;
const IX_CLAIM_DIRECT = 2;
const IX_MINT_TO_COMMITMENT = 3;
const IX_SPLIT_COMMITMENT = 4;
const IX_REQUEST_REDEMPTION = 5;

export function buildClaimDirectInstruction(
  poolState: Address,
  claimant: Address,
  nullifierRecord: Address,
  claimantToken: Address,
  sbbtcMint: Address,
  proof: Uint8Array,
  root: Uint8Array,
  nullifierHash: Uint8Array,
  amount: bigint,
): TransactionInstruction {
  // Pinocchio uses raw byte encoding (no Borsh/Anchor IDL)
  const data = new Uint8Array(1 + 256 + 32 + 32 + 8);
  data[0] = IX_CLAIM_DIRECT;
  data.set(proof, 1);
  data.set(root, 257);
  data.set(nullifierHash, 289);
  new DataView(data.buffer).setBigUint64(321, amount, true);

  return {
    programAddress: PINOCCHIO_PROGRAM_ID,
    accounts: [
      { address: poolState, role: AccountRole.WRITABLE },
      { address: claimant, role: AccountRole.WRITABLE_SIGNER },
      { address: nullifierRecord, role: AccountRole.WRITABLE },
      { address: claimantToken, role: AccountRole.WRITABLE },
      { address: sbbtcMint, role: AccountRole.WRITABLE },
      { address: TOKEN_2022_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data,
  };
}
```

---

### Phase 8: Deployment & Migration

#### 8.1 Deployment Sequence

```
1. Deploy Pinocchio program to devnet
2. Run full test suite (unit + integration)
3. Benchmark CU usage vs Anchor baseline
4. Deploy to mainnet with new program ID
5. Update frontend to use Pinocchio program
6. Deprecate Anchor program (optional: keep for existing users)
```

#### 8.2 Backwards Compatibility Options

| Strategy | Pros | Cons |
|----------|------|------|
| **Clean break** | Simple, no legacy code | Users must migrate |
| **Dual program** | Gradual migration | Maintain 2 codebases |
| **Proxy pattern** | Single entry, route internally | Added complexity |

**Recommendation**: Clean break with migration period. ZK proofs are compatible across both since the underlying cryptography is identical.

---

## Risk Assessment

### Low Risk
- [ ] Frontend proof generation (unchanged - snarkjs continues to work)
- [ ] Backend crypto (unchanged - light-poseidon compatible)
- [ ] Circuit definitions (unchanged - same Groth16/BN254)

### Medium Risk
- [ ] Account data migration (new discriminator format)
- [ ] Instruction encoding (Anchor IDL → raw bytes)
- [ ] Token-2022 CPI patterns

### High Risk
- [ ] ZK syscall behavior (test extensively on devnet)
- [ ] PDA derivation (must match exactly)
- [ ] Security audit for new verification logic

---

## Timeline Estimate

| Phase | Description | Complexity |
|-------|-------------|------------|
| 1 | Project structure setup | Low |
| 2 | State account migration | Medium |
| 3 | Instruction handlers | High |
| 4 | ZK verification port | Medium |
| 5 | Token-2022 integration | Medium |
| 6 | Testing suite | Medium |
| 7 | Frontend updates | Low |
| 8 | Deployment | Low |

---

## Success Criteria

1. **CU Reduction**: ≥30% reduction on `claim_direct` (150k → <105k)
2. **Binary Size**: <50KB deployed program
3. **Test Coverage**: 100% instruction coverage
4. **Security**: Pass audit review
5. **Compatibility**: Existing proofs work without regeneration

---

## Files to Create/Modify

### New Files
```
contracts/programs/zVault-pinocchio/
├── Cargo.toml
├── src/lib.rs
├── src/error.rs
├── src/constants.rs
├── src/state/mod.rs
├── src/state/pool.rs
├── src/state/deposit.rs
├── src/state/nullifier.rs
├── src/state/redemption.rs
├── src/instructions/mod.rs
├── src/instructions/initialize.rs
├── src/instructions/record_deposit.rs
├── src/instructions/claim_direct.rs
├── src/instructions/mint_to_commitment.rs
├── src/instructions/split_commitment.rs
├── src/instructions/request_redemption.rs
├── src/utils/mod.rs
├── src/utils/groth16.rs
├── src/utils/token.rs
└── tests/unit/*.rs

frontend/src/lib/zVault/pinocchio-client.ts
```

### Modified Files
```
contracts/Cargo.toml (add workspace member)
frontend/package.json (if new deps needed)
```

---

## Next Steps

1. **Start Phase 1**: Create Pinocchio project structure
2. **Port groth16.rs first**: This is the critical path (ZK verification)
3. **Build incrementally**: One instruction at a time with tests
4. **Benchmark early**: Validate CU savings on devnet
