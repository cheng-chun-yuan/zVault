# Devnet Completeness: Replace Demo Code with Real Implementations

**Date:** 2026-02-02
**Goal:** Make demo flows work with real on-chain data on devnet
**Approach:** Hybrid - Real ZK proofs, simulated BTC deposits

---

## Current State

| Component | Status |
|-----------|--------|
| Solana Programs (zVault, BTC Light Client, UltraHonk Verifier) | Deployed on devnet |
| Noir Circuits | Compiled |
| Verification Keys | Not registered on-chain |
| Header Relayer | Code exists, not running |
| FROST Server | Code exists, not running |
| Frontend | Using demo mode with fake data |

## Approach

Keep BTC deposit simulation (via `addDemoStealth` instruction) but make everything else real:
- Real ZK proof generation/verification
- Real on-chain state queries
- Cryptographically valid stealth data

This avoids external service dependencies while validating the ZK proof system end-to-end.

---

## Section 1: Infrastructure Setup (VK Registration)

**Blocker:** Verification keys aren't on-chain. Without these, the UltraHonk verifier can't validate proofs.

### Tasks

1. **Extract VK hashes from compiled circuits**
   - Location: `noir-circuits/target/*.json`
   - Circuits: `claim`, `spend_split`, `spend_partial_public`, `pool_deposit`, `pool_withdraw`, `pool_claim_yield`

2. **Register VKs on devnet**
   - Call UltraHonk verifier program's registration instruction
   - Create script in `contracts/scripts/` if missing

3. **Update SDK config with real VK hashes**
   - File: `sdk/src/config/presets.ts`
   - Replace `EMPTY_VK_HASHES` with actual values for devnet config

### Files Affected
- `sdk/src/config/presets.ts`
- `contracts/scripts/register-vks.ts` (new or existing)

---

## Section 2: Replace Demo Claim Flow with Real Proofs

**Current state:** `claim-flow.tsx` uses hardcoded amounts and fake signatures.

### Tasks

1. **Query real on-chain state for claimable deposits**
   - Fetch user's commitments from Merkle tree
   - Get actual deposit amounts from stealth announcements
   - Remove: `const demoAmountSats = 100000; // Placeholder`

2. **Generate real UltraHonk proofs client-side**
   - Use SDK's `generateClaimProof()` with actual note data
   - bb.js WASM proves in browser (~2s)

3. **Submit real claim transaction**
   - Build instruction with proof bytes (via ChadBuffer if >900 bytes)
   - Remove: `const demoSignature = 'claim_${Date.now().toString(16)}'`

4. **Handle proof verification errors**
   - Invalid proofs, already-claimed nullifiers, insufficient balance

### Files Affected
- `zvault-app/src/components/btc-widget/claim-flow.tsx`
- `zvault-app/src/lib/spv/verify.ts` (remove demo return at lines 295-303)

### Dependencies
- Section 1 (VKs must be registered)

---

## Section 3: Replace Demo Deposit Flow with Real Stealth Data

**Current state:** `deposit-flow.tsx` has `demoMode = true` by default.

### Approach
Keep demo toggle for flexibility, but default to OFF. Add real mode path alongside demo.

### Tasks

1. **Change demo mode default to OFF**
   - Change `useState(true)` → `useState(false)`
   - Demo mode remains available for quick testing

2. **Add real stealth deposit path when demo mode is OFF**
   - Generate real ephemeral keypair for ECDH
   - Compute actual Poseidon commitment (not XOR placeholder)
   - Proper ECDH-encrypted amounts

3. **Both paths use same on-chain instruction**
   - `addDemoStealth` instruction simulates BTC deposit in both cases
   - Demo mode: arbitrary test values
   - Real mode: cryptographically valid stealth data

4. **Clear UI indication of mode**
   - Demo ON: show "(Demo)" label
   - Demo OFF: show real flow status

### Files Affected
- `zvault-app/src/components/btc-widget/deposit-flow.tsx`
- `zvault-app/src/app/api/demo/route.ts`
- `sdk/src/watcher/base.ts` (fix placeholder commitment)

---

## Section 4: Replace Demo Stealth Send Flow

**Current state:** `stealth-send-flow.tsx` has real SDK call commented out with TODO.

### Tasks

1. **Implement real transfer call**
   - Lines 178-180 have commented `transferStealth()` call
   - Wire up SDK function with proper parameters

2. **Generate real `spend_split` proof**
   - Input: user's existing note
   - Output: two new notes (recipient + change)
   - Proves amount conservation without revealing values

3. **Post real stealth announcement on-chain**
   - Ephemeral pubkey for recipient detection
   - Encrypted amount (ChaCha20-Poly1305)
   - New commitment added to Merkle tree

4. **Query real note balance before sending**
   - Scan stealth announcements for user's spendable notes
   - Replace any hardcoded balances

### Files Affected
- `zvault-app/src/components/stealth-send-flow.tsx`
- Verify `sdk/src/api.ts` transfer functions

### Dependencies
- Sections 1 + 3 (needs VKs registered + real note to spend)

---

## Section 5: Yield Pool (DEFERRED)

**Status:** Pool not deployed on devnet. Defer until pool is ready.

### When Ready
- Replace demo stats fallback in `use-yield-pool.tsx`
- Implement real `pool_deposit` and `pool_withdraw` proofs
- Remove "(Demo mode)" messages from `earn/page.tsx`

---

## Section 6: Fix SDK Placeholder Implementations

### Tasks

1. **Fix placeholder commitment derivation**
   - File: `sdk/src/watcher/base.ts:173-176`
   - Currently: `(nullifier ^ note.secret) % (2n ** 256n)` (XOR placeholder)
   - Replace with: actual Poseidon hash computation
   - Options: JS Poseidon library, helper circuit, or backend call

2. **Document fake signature in key derivation**
   - File: `sdk/src/keys.ts:252-261`
   - `deriveKeysFromSeed()` creates fake signature from SHA256
   - Add deprecation warning: for testing only, real keys from wallet signatures

3. **Complete stealth claim proof generation**
   - File: `sdk/src/api.ts:1089-1103`
   - Currently throws "not yet implemented"
   - Implement `stealth_claim` circuit integration

### Files Affected
- `sdk/src/watcher/base.ts`
- `sdk/src/keys.ts`
- `sdk/src/api.ts`

---

## Implementation Order

```
Section 1 (VK Registration)
    │
    ├──► Section 2 (Claim Flow)
    │
    └──► Section 3 (Deposit Flow) ──► Section 4 (Stealth Send)

Section 6 (SDK Fixes) - can be done in parallel
```

**Recommended sequence:**
1. Section 1 - Infrastructure (unlocks everything)
2. Section 6 - SDK fixes (parallel, no dependencies)
3. Section 3 - Deposit flow (creates notes to test with)
4. Section 2 - Claim flow (uses deposited notes)
5. Section 4 - Stealth send (end-to-end private transfer)

---

## Out of Scope

- Mainnet configuration (placeholder addresses remain)
- Mobile prover implementation (stub remains)
- FROST server deployment
- Header relayer continuous operation
- Yield pool flows (deferred)

---

## Success Criteria

After implementation:
- [ ] VKs registered on devnet for all active circuits
- [ ] User can create stealth deposit with real cryptographic data (demo mode OFF)
- [ ] User can claim with real ZK proof verified on-chain
- [ ] User can send stealth transfer with real `spend_split` proof
- [ ] No fake signatures or hardcoded amounts in real mode
- [ ] Demo toggle preserved for quick testing
