# Merkle Tree Security Testing Design

**Date**: 2026-02-03
**Goal**: Security assurance for on-chain merkle tree integrity
**Scope**: Comprehensive - unit, adversarial, cross-implementation consistency, ZK circuit integration

## Overview

zVault has 3 merkle tree implementations that must produce identical results:

| Location | Language | Purpose |
|----------|----------|---------|
| `contracts/.../crypto/merkle.rs` | Rust | On-chain verification (Pinocchio) |
| `sdk/src/merkle.ts` | TypeScript | Proof structure/formatting |
| `sdk/src/commitment-tree.ts` | TypeScript | Incremental tree (Tornado/Semaphore pattern) |

A mismatch between SDK and on-chain would cause valid proofs to fail or invalid proofs to pass.

## Test Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Security Test Suite Architecture                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 1: Unit Tests (per implementation)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Rust merkle.rs  │  │ SDK merkle.ts   │  │ SDK commitment- │     │
│  │ (cargo test)    │  │ (bun test)      │  │ tree.ts         │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│  Layer 2: Cross-Implementation Consistency                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Shared test vectors (JSON) - same inputs produce same outputs │  │
│  │ • Poseidon hash vectors   • Merkle root vectors              │  │
│  │ • Zero hash constants     • Proof path vectors               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Layer 3: Adversarial Tests                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ • Invalid proofs (tampered siblings, wrong indices)          │  │
│  │ • Out-of-bounds leaf indices    • Forged roots               │  │
│  │ • Replay attacks (reused nullifiers)                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Layer 4: ZK Circuit Integration                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ SDK generates proof → Circuit verifies → On-chain accepts    │  │
│  │ • claim circuit    • spend_split    • spend_partial_public   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Layer 1: Rust Unit Tests (merkle.rs)

Extend existing `#[cfg(test)]` module in `contracts/programs/zvault/src/shared/crypto/merkle.rs`:

### Property Tests
- `test_different_leaves_different_roots` - Different leaves at same position → different roots
- `test_same_leaf_different_positions` - Same leaf at different positions → different roots
- `test_deterministic_root_computation` - Same inputs always produce same output

### Boundary Tests
- `test_max_depth_proof` - Maximum tree depth (20 levels)
- `test_max_leaf_index` - Leaf index at tree capacity boundary (2^20 - 1)
- `test_empty_siblings` - Empty siblings array handling

### Adversarial Tests
- `test_tampered_sibling_fails` - Tampered sibling should fail verification
- `test_wrong_index_fails` - Wrong leaf index should fail verification
- `test_truncated_proof_fails` - Truncated proof (missing siblings) should fail
- `test_swapped_siblings_fails` - Swapped siblings order should fail

### Cross-Implementation Vectors
- `test_known_vector_1` - Test against shared vectors
- `test_known_vector_2` - Test against shared vectors

## Layer 2: SDK Consistency Tests

**File**: `sdk/test/security/merkle-consistency.test.ts`

### Zero Hash Constants
- `commitment-tree.ts ZERO_HASHES match on-chain constants`
- `merkle.ts ZERO_VALUE matches commitment-tree.ts ZERO_HASHES[0]`

### Poseidon Hash Consistency
- `SDK poseidonHashSync matches known test vectors`
- `hash(0, 0) produces expected ZERO_HASHES[1]`
- `hash(a, b) ≠ hash(b, a) for a ≠ b (non-commutative)`

### Tree Root Consistency
- `empty tree root matches ZERO_HASHES[20]`
- `single leaf tree root matches test vector`
- `multi-leaf tree root matches test vector`
- `1000 sequential inserts produce expected root`

### Proof Generation Consistency
- `generated proof verifies against computed root`
- `pathIndicesToLeafIndex inverts leafIndexToPathIndices`
- `proof siblings have correct length (TREE_DEPTH)`

## Layer 3: Adversarial Tests

**File**: `sdk/test/security/adversarial.test.ts`

### Invalid Proof Detection
- `rejects proof with tampered sibling`
- `rejects proof with wrong leaf index`
- `rejects proof with flipped path index`
- `rejects proof with truncated siblings`
- `rejects proof with extra siblings`
- `rejects proof against wrong root`

### Boundary Attacks
- `rejects negative leaf index`
- `rejects leaf index >= MAX_LEAVES`
- `handles leaf index 0 correctly`
- `handles leaf index MAX_LEAVES-1 correctly`

### Forged Root Attacks
- `cannot find collision for different commitment`
- `valid proof for commitment A fails for commitment B`
- `historical root still validates old proofs`

### Nullifier Security
- `same note produces same nullifier (deterministic)`
- `different notes produce different nullifiers`
- `nullifier cannot be predicted without secret`

## Layer 4: ZK Circuit Integration

**File**: `sdk/test/security/zk-integration.test.ts`

### Claim Circuit
- `valid commitment + valid proof → proof accepted`
- `valid commitment + invalid merkle proof → circuit rejects`
- `valid commitment + wrong root → circuit rejects`
- `tampered nullifier → circuit rejects`
- `mismatched secret/nullifier pair → circuit rejects`

### Spend Split Circuit
- `valid input note + valid proof → outputs valid`
- `sum(outputs) must equal input amount`
- `reused nullifier detected (double-spend)`
- `invalid input merkle proof → circuit rejects`

### Spend Partial Public Circuit
- `public amount + change note sum equals input`
- `invalid merkle proof for input → circuit rejects`
- `change note commitment correctly formed`

### Proof-to-Chain Flow
- `SDK-generated proof passes UltraHonk verifier`
- `manually corrupted proof fails verifier`
- `proof with wrong public inputs fails verifier`
- `proof size matches expected (16KB for UltraHonk)`

### Nullifier Guard Integration
- `first spend with nullifier succeeds`
- `second spend with same nullifier fails on-chain`
- `nullifier registered in guard after successful spend`

## Shared Test Vectors

**File**: `test-vectors/merkle-vectors.json`

```json
{
  "version": "1.0",
  "description": "Cross-implementation test vectors for merkle tree security",

  "poseidon_hash": [
    {
      "name": "hash_zeros",
      "inputs": ["0x0", "0x0"],
      "expected": "0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"
    }
  ],

  "zero_hashes": [
    { "level": 0, "value": "0x0" },
    { "level": 1, "value": "0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864" },
    { "level": 20, "value": "0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e" }
  ],

  "merkle_proofs": [...],
  "adversarial": [...]
}
```

## Files Summary

### Create
| File | Type | Tests |
|------|------|-------|
| `test-vectors/merkle-vectors.json` | Data | Shared test vectors |
| `sdk/test/security/merkle-consistency.test.ts` | TypeScript | ~12 tests |
| `sdk/test/security/adversarial.test.ts` | TypeScript | ~15 tests |
| `sdk/test/security/zk-integration.test.ts` | TypeScript | ~18 tests |

### Modify
| File | Changes |
|------|---------|
| `contracts/programs/zvault/src/shared/crypto/merkle.rs` | Add ~15 tests to `#[cfg(test)]` |

## Test Commands

```bash
# Rust tests
cd contracts && cargo test merkle

# SDK security tests
cd sdk && bun test test/security/

# All SDK tests
cd sdk && bun test
```

## Security Properties Covered

| Property | Layer |
|----------|-------|
| Cross-implementation hash consistency | 2 |
| Merkle proof validity enforcement | 1, 3 |
| Tamper detection (any bit flip fails) | 1, 3 |
| Boundary safety (indices, depths) | 1, 3 |
| Nullifier uniqueness and binding | 3, 4 |
| Double-spend prevention | 4 |
| ZK circuit constraint satisfaction | 4 |
| UltraHonk verifier correctness | 4 |

## Expected Test Count

| Layer | Tests |
|-------|-------|
| Rust unit tests | ~18 (3 existing + 15 new) |
| SDK consistency | ~12 |
| SDK adversarial | ~15 |
| SDK ZK integration | ~18 |
| **Total new** | **~60** |
