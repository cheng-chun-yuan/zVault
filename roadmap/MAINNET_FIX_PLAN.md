# Mainnet Security Fix Plan

Pre-mainnet security fixes identified from Trail of Bits vulnerability scan.

---

## Priority 1: CRITICAL (Block Mainnet)

### Fix 1.1: Add Writability Validation

**Issue:** Instructions modifying accounts don't validate `is_writable`

**Risk:** Silent state corruption, double-spending

**Files Fixed:** ✅ COMPLETE
- [x] `split_commitment.rs`
- [x] `transfer_stealth.rs`
- [x] `verify_stealth_deposit_v2.rs`
- [x] `request_redemption.rs`
- [x] `deposit_to_pool.rs`
- [x] `withdraw_from_pool.rs`
- [x] `claim_pool_yield.rs`
- [x] `harvest_yield.rs`
- [x] `compound_yield.rs`

**Implementation:**

```rust
// Add to utils/validation.rs
pub fn validate_account_writable(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}
```

**Apply in each instruction:**
```rust
// Before any try_borrow_mut_data()
validate_account_writable(commitment_tree)?;
validate_account_writable(pool_state)?;
```

---

### Fix 1.2: Strengthen Demo Mode Protection

**Issue:** Demo instructions enabled via feature flag only

**Risk:** Accidental mainnet deployment with demo enabled

**Files to Fix:**
- [ ] `lib.rs` - Add runtime network check
- [ ] `add_demo_note.rs` - Add explicit guard
- [ ] `add_demo_stealth.rs` - Add explicit guard

**Implementation:**

```rust
// Option A: Compile-time only (current)
#[cfg(feature = "devnet")]
pub const ADD_DEMO_NOTE: u8 = 21;

// Option B: Add runtime check (recommended)
#[cfg(feature = "devnet")]
fn ensure_not_mainnet(program_id: &Pubkey) -> ProgramResult {
    // Mainnet program ID check
    const MAINNET_PROGRAM_ID: Pubkey = [...];
    if program_id == &MAINNET_PROGRAM_ID {
        return Err(ProgramError::Custom(9999));
    }
    Ok(())
}
```

---

## Priority 2: HIGH (Fix Before Launch)

### Fix 2.1: Token Account Validation ✅ COMPLETE

**Issue:** No verification that token account mint matches expected mint

**Risk:** Token account spoofing

**Files Fixed:**
- [x] `utils/validation.rs` - Added `validate_token_mint()` function

**Implementation:**

```rust
pub fn validate_token_account(
    account: &AccountInfo,
    expected_mint: &Pubkey,
) -> Result<(), ProgramError> {
    let data = account.try_borrow_data()?;
    // Token account layout: mint at offset 0-32
    let mint_bytes: [u8; 32] = data[0..32].try_into()
        .map_err(|_| ProgramError::InvalidAccountData)?;

    if &mint_bytes != expected_mint.as_ref() {
        return Err(ZVaultError::InvalidMint.into());
    }
    Ok(())
}
```

---

### Fix 2.2: Rent-Exempt Account Creation

**Issue:** Accounts created with minimum rent, not rent-exempt

**Risk:** Data loss from garbage collection

**Files to Fix:**
- [ ] `verify_deposit.rs`
- [ ] `request_redemption.rs`
- [ ] `announce_stealth.rs`
- [ ] `verify_stealth_deposit_v2.rs`

**Implementation:**

```rust
// Change from:
let lamports = Rent::get()?.minimum_balance(SIZE);

// To:
let rent = Rent::get()?;
let lamports = rent.minimum_balance(SIZE);
// Verify rent-exempt
if !rent.is_exempt(lamports, SIZE) {
    return Err(ProgramError::AccountNotRentExempt);
}
```

---

### Fix 2.3: Remove Demo Mode Bypass in Redemption ✅ COMPLETE

**Issue:** VK hash == 0 skips root validation

**Risk:** Double-spending in demo mode

**File Fixed:** `request_redemption.rs`

**Implementation:**

```rust
// Remove this check:
let is_demo_mode = ix_data.vk_hash == [0u8; 32];
if !is_demo_mode {
    // validation
}

// Replace with: Always validate
let tree_data = accounts.commitment_tree.try_borrow_data()?;
let tree = CommitmentTree::from_bytes(&tree_data)?;
if !tree.is_valid_root(&ix_data.merkle_root) {
    return Err(ZVaultError::InvalidRoot.into());
}
```

---

## Priority 3: MEDIUM (Pre-Audit)

### Fix 3.1: Safe Zero-Copy Deserialization ✅ COMPLETE

**Issue:** Unsafe pointer casts without alignment checks

**Risk:** Undefined behavior, potential crashes

**Status:** Already implemented correctly using Pinocchio best practices:
- [x] All state structs use `#[repr(C)]`
- [x] Multi-byte fields stored as byte arrays (not packed)
- [x] Accessor methods use `from_le_bytes()` / `to_le_bytes()`
- [x] No unaligned pointer access

**Implementation:**

```rust
// Add to all state structs
#[repr(C, packed)]
pub struct PoolState {
    // fields
}

// Update from_bytes
pub fn from_bytes(data: &[u8]) -> Result<&Self, ProgramError> {
    if data.len() < Self::SIZE {
        return Err(ProgramError::InvalidAccountData);
    }
    // Alignment check
    if (data.as_ptr() as usize) % std::mem::align_of::<Self>() != 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(unsafe { &*(data.as_ptr() as *const Self) })
}
```

---

### Fix 3.2: Add Error Enum for New Checks ✅ COMPLETE

**File Fixed:** `error.rs`

```rust
pub enum ZVaultError {
    // Existing...

    // New errors
    #[error("Account not writable")]
    AccountNotWritable = 20,

    #[error("Invalid token mint")]
    InvalidMint = 21,

    #[error("Demo mode disabled on mainnet")]
    DemoDisabledOnMainnet = 22,
}
```

---

## Implementation Checklist

### Week 1: Critical Fixes
- [ ] Create `validate_account_writable()` utility
- [ ] Add writability checks to all 9 instructions
- [ ] Add mainnet guard to demo instructions
- [ ] Unit tests for writability validation

### Week 2: High Priority Fixes
- [ ] Implement token account validation
- [ ] Update account creation to rent-exempt
- [ ] Remove demo mode bypass in redemption
- [ ] Integration tests

### Week 3: Medium Priority + Testing
- [ ] Add `#[repr(C, packed)]` to state structs
- [ ] Add alignment checks to from_bytes
- [ ] Full test suite run
- [ ] Fuzz testing setup

### Week 4: Audit Prep
- [ ] Code freeze
- [ ] Documentation update
- [ ] Security checklist review
- [ ] Prepare audit package

---

## Testing Requirements

### Unit Tests

```rust
#[test]
#[should_panic]
fn test_rejects_non_writable_account() {
    // Call instruction with read-only account
    // Should fail with InvalidArgument
}

#[test]
#[should_panic]
fn test_rejects_wrong_mint() {
    // Call with wrong token mint
    // Should fail with InvalidMint
}

#[test]
fn test_rent_exempt_accounts() {
    // Verify all created accounts are rent-exempt
}
```

### Integration Tests

```typescript
describe('security', () => {
  it('rejects non-writable commitment tree', async () => {
    // Submit split with read-only tree account
    // Expect failure
  });

  it('rejects demo on mainnet program ID', async () => {
    // Call add_demo_note with mainnet ID
    // Expect failure
  });
});
```

---

## Verification Checklist (Pre-Mainnet)

Before mainnet deployment, verify:

- [ ] All writability checks implemented
- [ ] Demo instructions fail on mainnet program ID
- [ ] Token mint validation active
- [ ] All accounts created rent-exempt
- [ ] Demo mode bypass removed from redemption
- [ ] State structs use `#[repr(C, packed)]`
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Fuzz testing completed (no crashes)
- [ ] External security audit scheduled

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `utils/validation.rs` | Add `validate_account_writable()` |
| `utils/token.rs` | Add `validate_token_account()` |
| `error.rs` | Add new error variants |
| `lib.rs` | Add mainnet guard for demo |
| `split_commitment.rs` | Writability checks |
| `transfer_stealth.rs` | Writability checks |
| `verify_stealth_deposit_v2.rs` | Writability + rent-exempt |
| `request_redemption.rs` | Remove demo bypass, writability |
| `deposit_to_pool.rs` | Writability checks |
| `withdraw_from_pool.rs` | Writability checks |
| `claim_pool_yield.rs` | Writability checks |
| `harvest_yield.rs` | Writability checks |
| `compound_yield.rs` | Writability checks |
| `verify_deposit.rs` | Rent-exempt creation |
| `announce_stealth.rs` | Rent-exempt creation |
| `state/*.rs` | Add `#[repr(C, packed)]` |

---

## Risk Assessment After Fixes

| Issue | Before | After |
|-------|--------|-------|
| Silent state corruption | CRITICAL | Mitigated |
| Demo mode exploit | CRITICAL | Mitigated |
| Token spoofing | HIGH | Mitigated |
| Data loss (rent) | HIGH | Mitigated |
| Demo bypass | MEDIUM | Removed |
| Alignment issues | MEDIUM | Mitigated |

**Post-Fix Security Grade: A- (Audit Ready)**
