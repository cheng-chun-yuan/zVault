# zVault Production Action Plan

**Priority Execution Order**

---

## Phase 1: Critical Path (Weeks 1-4)

### Week 1-2: UltraHonk Verifier
| Task | Days | Owner | Status |
|------|------|-------|--------|
| Port transcript generation | 2 | | [ ] |
| Port sumcheck verification | 2 | | [ ] |
| Port shplemini verification | 3 | | [ ] |
| VK account management | 1 | | [ ] |

### Week 3-4: CI/CD & Testing
| Task | Days | Owner | Status |
|------|------|-------|--------|
| GitHub Actions setup | 2 | | [ ] |
| SDK test coverage → 90% | 3 | | [ ] |
| Contract test coverage → 85% | 3 | | [ ] |
| E2E tests on devnet | 2 | | [ ] |

---

## Phase 2: Security (Weeks 5-10)

### Week 5: Audit Prep
| Task | Days | Owner | Status |
|------|------|-------|--------|
| Select audit firm | 2 | | [ ] |
| Prepare audit documentation | 3 | | [ ] |
| Code freeze for audit | 1 | | [ ] |

### Weeks 6-9: Security Audit
| Task | Duration | Owner | Status |
|------|----------|-------|--------|
| Smart contract audit | 4 weeks | Auditor | [ ] |
| Circuit audit | 3 weeks | Auditor | [ ] |
| Fix critical findings | 1 week | Team | [ ] |

### Week 10: FROST & Bug Bounty
| Task | Days | Owner | Status |
|------|------|-------|--------|
| FROST key ceremony | 3 | | [ ] |
| Launch bug bounty (Immunefi) | 2 | | [ ] |

---

## Phase 3: Launch (Weeks 11-14)

### Week 11-12: Testnet Beta
| Task | Days | Owner | Status |
|------|------|-------|--------|
| Deploy to testnet | 1 | | [ ] |
| Onboard 100 beta users | 5 | | [ ] |
| Collect & address feedback | 4 | | [ ] |

### Week 13-14: Mainnet
| Task | Days | Owner | Status |
|------|------|-------|--------|
| Mainnet contract deployment | 1 | | [ ] |
| Production infrastructure | 2 | | [ ] |
| Monitoring setup | 1 | | [ ] |
| Public launch | 1 | | [ ] |

---

## Immediate Next Actions

**This Week:**
1. [ ] Start UltraHonk transcript generation port
2. [ ] Set up GitHub Actions CI skeleton
3. [ ] Contact 2-3 audit firms for quotes

**Blockers to Resolve:**
- UltraHonk verifier must complete before audit
- Audit must complete before mainnet
- FROST key ceremony needs 3 independent custodians

---

## Budget Summary

| Category | Estimate |
|----------|----------|
| Security Audit | $130K - $230K |
| Bug Bounty Pool | $50K - $100K |
| Infrastructure (monthly) | $2K - $5K |
| RPC Providers (monthly) | $1K |
| **Total Launch Cost** | **$180K - $335K** |

---

## Success Metrics

| Metric | Target | Deadline |
|--------|--------|----------|
| UltraHonk verifier live | < 1.2M CU | Week 4 |
| Security audit passed | 0 critical | Week 10 |
| Beta users onboarded | 100 | Week 12 |
| Mainnet TVL | $1M+ | Week 16 |

---

## Risk Watchlist

| Risk | Trigger | Action |
|------|---------|--------|
| Audit delays | > 1 week slip | Accelerate fixes, parallel work |
| CU budget exceeded | > 1.3M CU | Split transactions |
| FROST ceremony fails | Any signer unavailable | Backup custodian list |

---

*Last Updated: 2026-02-02*
