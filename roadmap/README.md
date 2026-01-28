# zVault Roadmap

## Vision

**Make Bitcoin private on every chain.**

zVault is the first privacy-preserving Bitcoin bridge. We start with Solana, then expand to become the universal private layer for Bitcoin in DeFi.

---

## Current State

| Component | Status |
|-----------|--------|
| Contracts | ✅ Built, testnet deployed |
| ZK Circuits | ✅ Working |
| SDK | ✅ Released |
| Frontend | ✅ Working |
| Backend | ✅ Working |
| Mobile | ✅ Prototype |

---

## Phase 1: Mainnet Beta (Month 1)

### Security Hardening
- [x] Remove testing bypasses from contracts
- [x] Gate demo instructions (devnet only)
- [x] Environment-based key management
- [x] Input validation & rate limiting
- [x] Structured logging
- [x] Remove unused/deprecated code (5 files)

### Pre-Mainnet Security Fixes

> See [MAINNET_FIX_PLAN.md](./MAINNET_FIX_PLAN.md) for detailed implementation

**Critical (Must Fix):**
- [x] Add writability validation to all instructions ✅
- [ ] Strengthen demo mode protection (compile-time gated)

**High Priority:**
- [x] Token account mint validation ✅
- [ ] Rent-exempt account creation
- [x] Remove demo mode bypass in redemption ✅

**Medium Priority:**
- [ ] Safe zero-copy deserialization (`#[repr(C, packed)]`)
- [ ] Alignment checks in state parsing

### Infrastructure
- [ ] PostgreSQL persistence layer
- [ ] State recovery on restart
- [ ] Health check endpoints

### Deploy
- [ ] Deploy contracts to Solana mainnet
- [ ] Configure mainnet Bitcoin integration
- [ ] Launch with $10K deposit limit

---

## Phase 2: Decentralize (Month 2)

### FROST Threshold Signing
- [ ] Implement 2-of-3 FROST DKG
- [ ] Distribute keys to independent operators
- [ ] Remove single point of failure

### Scale
- [ ] Raise limit to $50K
- [ ] Operator monitoring & alerting

---

## Phase 3: Audit (Month 3)

### Security Audit Scope
- [ ] Solana contracts (`/contracts`)
- [ ] ZK circuits (`/noir-circuits`)
- [ ] Backend signing (`/backend`)

### Post-Audit
- [ ] Fix all critical/high findings
- [ ] Publish audit report
- [ ] Raise limit to $250K

---

## Phase 4: Yield (Month 4+)

### zkEarn Launch
- [ ] Deploy yield pool contracts
- [ ] Integrate DeFi yield source
- [ ] Automated yield harvesting

### Scale
- [ ] Remove deposit limits
- [ ] Mobile app production release
- [ ] Governance launch

---

## Long-term Vision

```
Phase 1-4          Phase 5            Phase 6            Phase 7
─────────────────────────────────────────────────────────────────
SOLANA             MULTI-CHAIN        INSTITUTIONS       UNIVERSAL

Private BTC        Expand to          Compliance         Private BTC
on Solana          Ethereum, L2s      integration        everywhere
```

### Expansion Targets
1. **Ethereum** - Largest DeFi ecosystem
2. **L2s** - Arbitrum, Optimism, Base
3. **Cosmos** - IBC-connected chains
4. **Other L1s** - Sui, Aptos

### Ultimate Goal
Become the **default privacy layer** for Bitcoin in DeFi - wherever you want to use BTC privately, you use zVault.

---

## Milestones

| When | What | Success |
|------|------|---------|
| Month 1 | Beta live | 100 deposits |
| Month 2 | Decentralized | 3 operators |
| Month 3 | Audited | Clean report |
| Month 6 | Growing | $1M TVL |
| Year 1 | Multi-chain | 2+ chains |
| Year 2 | Standard | $100M TVL |
