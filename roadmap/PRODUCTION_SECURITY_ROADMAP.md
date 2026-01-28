# Production Security Roadmap

**Status:** Demo/Hackathon code - NOT production ready for real funds

This document outlines critical security improvements required before deploying with real BTC/funds.

---

## CRITICAL: Must Fix Before Any Real Funds

### 1. Merkle Tree Implementation (CRITICAL)

**Current Issue:** XOR-based root computation in `commitment_tree.rs:144-147`

```rust
// INSECURE - Demo only
for i in 0..32 {
    new_root[i] = self.current_root[i] ^ commitment[i];
}
```

**Risk:** XOR is reversible and lacks collision resistance. Attackers can forge commitments.

**Fix Required:**
- Implement proper incremental Merkle tree with Poseidon2 hashing
- Store sibling hashes for path verification
- Use on-chain Poseidon2 syscall or precompile

**Reference Implementation:** Tornado Cash / Semaphore Merkle tree

---

### 2. Verification Key Management (CRITICAL)

**Current Issue:** Hardcoded test VK in `groth16.rs:445`

```rust
pinocchio::msg!("WARNING: Using placeholder VK - proofs will fail in production!");
```

**Risk:** Test VK accepts any proof or rejects all proofs.

**Fix Required:**
- Deploy VK to on-chain account
- Load VK from verified on-chain source
- Implement VK upgrade mechanism with timelock
- Version VKs for circuit upgrades

---

### 3. Split Commitment Root Update (HIGH)

**Current Issue:** `split_commitment.rs:193` only updates root with first output

```rust
tree.update_root(ix_data.output_commitment_1);  // Missing output_commitment_2!
tree.set_next_index(next + 2);
```

**Risk:** Second output commitment not reflected in tree root.

**Fix Required:**
- Insert both commitments properly
- Recompute Merkle path for both

---

## HIGH PRIORITY: Fix Before Beta

### 4. Nullifier Race Condition Prevention

**Current Pattern:**
```rust
// Check nullifier doesn't exist
if account.data[0] == DISCRIMINATOR { return Err(...) }
// ... other operations ...
// Create account later
```

**Risk:** Two transactions could pass check simultaneously.

**Fix Required:**
- Use atomic account creation with discriminator check
- Consider using account existence as the check (if account exists, already spent)

---

### 5. Root History DOS Prevention

**Current Issue:** Only 32 historical roots stored

**Risk:** Attacker can force 32 updates to invalidate pending proofs.

**Fix Required:**
- Increase `ROOT_HISTORY_SIZE` to 100-500
- Or implement timestamp-based root validity (e.g., roots valid for 24 hours)

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
