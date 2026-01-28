# Production Security Roadmap

**Status:** Core cryptographic security implemented - Ready for audit

This document tracks security improvements for mainnet deployment.

---

## ✅ COMPLETED: Critical Security Fixes

### 1. Merkle Tree Implementation ✅ FIXED

**Previous Issue:** XOR-based root computation

**Fix Applied:**
- Implemented Poseidon2 hashing via `solana-poseidon` crate
- Created `utils/crypto.rs` with `poseidon2_hash()` function
- Uses Solana's native `sol_poseidon` syscall on-chain
- Proper collision-resistant, one-way hash function

```rust
// Now uses Poseidon2 hash (crypto.rs)
let new_root = poseidon2_hash(&self.current_root, commitment)?;
```

---

### 2. Verification Key Management ✅ FIXED

**Previous Issue:** Hardcoded test VK

**Fix Applied:**
- Created `state/vk_registry.rs` for on-chain VK storage
- Added `load_verification_key_from_account()` in `groth16.rs`
- Test VK (`get_test_verification_key`) only available with `devnet` feature
- Production builds use on-chain VK accounts

```rust
// Production: Load from on-chain account
let vk = load_verification_key_from_account(vk_account, program_id)?;

// Devnet only (requires --features devnet):
let vk = get_test_verification_key(num_inputs);
```

---

### 3. Split Commitment Root Update ✅ FIXED

**Previous Issue:** Only first output in tree

**Fix Applied:**
- Now properly inserts BOTH output commitments
- Uses `insert_leaf()` for each commitment

```rust
// Both commitments now inserted
tree.insert_leaf(&ix_data.output_commitment_1)?;
tree.insert_leaf(&ix_data.output_commitment_2)?;
```

---

### 4. Root History DOS Prevention ✅ FIXED

**Previous Issue:** Only 32 historical roots

**Fix Applied:**
- Increased `ROOT_HISTORY_SIZE` from 32 to 100
- Provides ~3x more protection against root invalidation attacks

---

## REMAINING: Pre-Audit Tasks

### 5. Nullifier Race Condition (MEDIUM)

**Current Pattern:**
```rust
// Check nullifier doesn't exist
if account.data[0] == DISCRIMINATOR { return Err(...) }
// ... other operations ...
// Create account later
```

**Note:** On Solana, transactions are atomic within a slot. This pattern is safe
because two transactions cannot interleave. However, for defense-in-depth,
consider making account creation the first operation.

**Status:** Low risk on Solana, but review recommended

---

### 6. Yield Calculation Bounds

**Current Issue:** `saturating_mul` silently caps at u64::MAX

**Risk:** Large stakes lose yield silently.

**Fix Required:**
```rust
// Add validation before calculation
if principal > MAX_STAKEABLE_AMOUNT {
    return Err(ZVaultError::AmountTooLarge.into());
}
```

---

## MEDIUM PRIORITY: Pre-Audit

### 7. Zero Amount Validation

Add consistent zero-amount checks to:
- [ ] `split_commitment.rs`
- [ ] `withdraw_from_pool.rs`
- [ ] `transfer_stealth.rs`

### 8. Epoch Validation

Add explicit check:
```rust
if ix_data.deposit_epoch > current_epoch {
    return Err(ZVaultError::InvalidEpoch.into());
}
```

### 9. Account Initialization Safety

Standardize pattern across all instructions:
```rust
// Preferred pattern
if account.data_len() > 0 {
    let data = account.try_borrow_data()?;
    if !data.is_empty() && data[0] != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
}
```

---

## Testing Requirements for Production

### Required Before Mainnet

1. **Fuzz Testing**
   - All instruction handlers
   - Edge cases for amounts (0, u64::MAX, overflow boundaries)
   - Merkle tree operations

2. **Integration Tests**
   - Full deposit → split → transfer → redeem flow
   - Concurrent transaction simulation
   - Nullifier double-spend attempts

3. **Security Audit**
   - External audit by reputable firm
   - Focus on ZK circuit ↔ on-chain logic consistency

4. **Bug Bounty**
   - Private bug bounty before launch
   - Public bug bounty after mainnet

---

## Implementation Priority

| Phase | Items | Timeline |
|-------|-------|----------|
| **Phase 1** | Merkle tree + VK management | Must complete |
| **Phase 2** | Split fix + Race condition | Must complete |
| **Phase 3** | Bounds + Validation | Before beta |
| **Phase 4** | Testing + Audit | Before mainnet |

---

## Current Security Grade

| Aspect | Demo Grade | Production Required |
|--------|------------|---------------------|
| Account Validation | A | A |
| Signer Checks | A | A |
| CPI Safety | A | A |
| Merkle Tree | F | A |
| VK Management | F | A |
| Arithmetic Safety | B | A |
| Race Conditions | C | A |

**Overall: Demo B- → Production A required**

---

## Notes

- Current code is suitable for devnet/testnet demos only
- DO NOT deploy with real BTC until all CRITICAL items resolved
- ZK circuits must be audited alongside on-chain code
- Consider formal verification for Merkle tree implementation
