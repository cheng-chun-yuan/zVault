# zVault Production Technical Plan PRD

**Version:** 1.0
**Date:** 2026-02-02
**Status:** DRAFT - For Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Production Readiness Analysis](#3-production-readiness-analysis)
4. [Security Requirements](#4-security-requirements)
5. [Infrastructure Architecture](#5-infrastructure-architecture)
6. [Testing & Quality Assurance](#6-testing--quality-assurance)
7. [Deployment Strategy](#7-deployment-strategy)
8. [Monitoring & Operations](#8-monitoring--operations)
9. [Risk Assessment & Mitigations](#9-risk-assessment--mitigations)
10. [Timeline & Milestones](#10-timeline--milestones)
11. [Success Criteria](#11-success-criteria)
12. [Appendices](#12-appendices)

---

## 1. Executive Summary

### 1.1 Project Overview

zVault is a privacy-preserving Bitcoin-to-Solana bridge using Zero-Knowledge Proofs. It enables Bitcoin holders to access Solana DeFi with full transaction privacy through shielded zkBTC tokens, stealth addresses, and client-side proof generation.

### 1.2 Key Value Propositions

| Feature | Description | User Benefit |
|---------|-------------|--------------|
| **Trustless Bridge** | Full SPV verification on Solana | No centralized custody |
| **Transaction Privacy** | ZK proofs hide amounts & linkage | Financial confidentiality |
| **Client-Side Proving** | UltraHonk proofs in browser/mobile | No trusted backend for proofs |
| **Stealth Addresses** | EIP-5564/DKSAP protocol | Unlinkable recipients |
| **No Trusted Setup** | UltraHonk vs Groth16 | Transparent security model |

### 1.3 Production Goals

1. **Mainnet Deployment** - Solana mainnet + Bitcoin mainnet integration
2. **Security Hardening** - Complete security audit & formal verification
3. **Operational Excellence** - 99.9% uptime with comprehensive monitoring
4. **Regulatory Compliance** - Proof of Innocence circuit for optional compliance
5. **Scalability** - Support 10,000+ concurrent users

---

## 2. Current State Assessment

### 2.1 Component Maturity Matrix

| Component | Status | Devnet | Tests | Docs | Production Ready |
|-----------|--------|--------|-------|------|------------------|
| **SDK (@zvault/sdk)** | v2.0.2 | ✅ | ✅ | ✅ | 🟡 Needs audit |
| **Smart Contracts** | Deployed | ✅ | ✅ | ✅ | 🟡 Needs audit |
| **Noir Circuits (6)** | Complete | ✅ | ✅ | ✅ | 🟡 Needs audit |
| **UltraHonk Verifier** | In Progress | 🔄 | ❌ | ✅ | ❌ Blocking |
| **Web Frontend** | Production | ✅ | ✅ | ✅ | 🟡 Security review |
| **Mobile App** | Development | ✅ | 🟡 | ✅ | 🟡 App store prep |
| **Backend API** | Functional | ✅ | ✅ | ✅ | 🟡 Hardening needed |
| **FROST Server** | Implemented | ✅ | ✅ | ✅ | 🟡 Key ceremony |
| **BTC Light Client** | Deployed | ✅ | ✅ | ✅ | 🟡 Needs audit |
| **Header Relayer** | Functional | ✅ | 🟡 | ✅ | 🟡 Redundancy needed |

**Legend:** ✅ Complete | 🟡 Needs Work | 🔄 In Progress | ❌ Not Started

### 2.2 Critical Blockers

#### 2.2.1 UltraHonk Verifier (HIGH PRIORITY)

**Current State:** Design complete, implementation in progress
**Blocker:** Demo mode flag currently bypasses proof verification
**Impact:** Cannot go mainnet without cryptographic verification

**Required Work:**
- [ ] Port transcript generation (~2 days)
- [ ] Port sumcheck verification (~2 days)
- [ ] Port shplemini verification (~3 days)
- [ ] VK account management (~1 day)
- [ ] Integration & testing (~4 days)

**Estimated CU Budget:** ~850,000 CU (within 1.4M limit)

#### 2.2.2 Security Audit (HIGH PRIORITY)

**Scope Required:**
1. Solana Smart Contracts (zVault, BTC Light Client, UltraHonk Verifier)
2. Noir ZK Circuits (6 circuits + utils)
3. SDK Cryptographic Implementation
4. Backend API Security

**Estimated Duration:** 4-6 weeks

#### 2.2.3 FROST Key Ceremony (MEDIUM PRIORITY)

**Current State:** 2-of-3 threshold signing implemented
**Required:** Production key ceremony with independent custodians
**Dependencies:** Legal agreements, HSM infrastructure

### 2.3 Technical Debt

| Category | Items | Priority |
|----------|-------|----------|
| **CI/CD** | No GitHub Actions workflows | High |
| **Testing** | E2E coverage gaps on mobile | Medium |
| **Documentation** | API OpenAPI spec incomplete | Medium |
| **Code Quality** | Inconsistent error handling | Low |
| **Dependencies** | Some nightly Noir versions | Medium |

---

## 3. Production Readiness Analysis

### 3.1 Cryptographic Security

#### 3.1.1 Proof System (UltraHonk)

| Aspect | Status | Notes |
|--------|--------|-------|
| No Trusted Setup | ✅ | Transparent, universal setup |
| Proof Soundness | ✅ | Based on bb.js (Aztec) |
| Client-Side Proving | ✅ | 2-4 seconds in browser |
| Verifier Implementation | 🔄 | In progress for Solana |

#### 3.1.2 Commitment Scheme

```
commitment = Poseidon2(stealth_pubkey_x, amount)  ✅ ZK-friendly
nullifier = Poseidon2(spending_privkey, leaf_index)  ✅ Double-spend protection
```

#### 3.1.3 Stealth Protocol (EIP-5564/DKSAP)

| Component | Implementation | Constraints |
|-----------|----------------|-------------|
| Grumpkin ECDH | ✅ Native Noir | ~2,000 |
| Key Derivation | ✅ Poseidon2 | ~160 |
| Viewing/Spending Separation | ✅ | Proper isolation |

### 3.2 Smart Contract Security

#### 3.2.1 zVault Program (Pinocchio)

**Critical Functions:**
- `claim()` - Mints zkBTC with ZK proof verification
- `spend_split()` - Splits notes with conservation check
- `request_redemption()` - Burns zkBTC for BTC withdrawal
- `verify_stealth_deposit()` - Validates stealth announcements

**Security Considerations:**
- [ ] Reentrancy protection
- [ ] Integer overflow checks
- [ ] PDA validation
- [ ] Signer verification
- [ ] CPI guard rails

#### 3.2.2 BTC Light Client

**Critical Functions:**
- `submit_headers()` - Bitcoin header chain maintenance
- `verify_transaction()` - SPV proof verification

**Security Considerations:**
- [ ] Difficulty adjustment validation
- [ ] Chain reorg handling (6+ confirmations)
- [ ] Header timestamp validation
- [ ] Merkle proof validation

### 3.3 Infrastructure Security

| Component | Requirement | Status |
|-----------|-------------|--------|
| API Rate Limiting | Per-IP limits | ✅ Implemented |
| Input Validation | Strict validation | ✅ Implemented |
| CORS Configuration | Allowlist only | ✅ Implemented |
| TLS/HTTPS | Mandatory | ✅ Configured |
| Secrets Management | Env vars/Vault | 🟡 Needs Vault |
| DDoS Protection | CDN/WAF | ❌ Needed |

---

## 4. Security Requirements

### 4.1 Audit Scope

#### 4.1.1 Smart Contract Audit

**Scope:**
```
contracts/programs/
├── zvault/             # Main program (~3,000 lines)
├── btc-light-client/   # Bitcoin SPV (~1,500 lines)
└── ultrahonk-verifier/ # Proof verification (~2,000 lines)
```

**Audit Firms (Recommended):**
1. OtterSec (Solana specialist)
2. Neodyme (Solana + crypto)
3. Trail of Bits (ZK specialist)

**Duration:** 4 weeks
**Budget Estimate:** $80,000 - $150,000

#### 4.1.2 ZK Circuit Audit

**Scope:**
```
noir-circuits/
├── claim/              # Deposit claiming
├── spend_split/        # Note splitting
├── spend_partial_public/  # Partial withdrawal
├── pool_deposit/       # Yield pool entry
├── pool_withdraw/      # Yield pool exit
└── pool_claim_yield/   # Yield claiming
```

**Audit Focus:**
- Soundness (can't create invalid proofs)
- Completeness (valid inputs produce valid proofs)
- Zero-knowledge (proofs don't leak private inputs)
- Constraint satisfaction

**Duration:** 3 weeks
**Budget Estimate:** $50,000 - $80,000

#### 4.1.3 SDK & Backend Audit

**Scope:**
- Cryptographic implementations
- Key derivation logic
- Proof generation pipeline
- API endpoint security

**Duration:** 2 weeks
**Budget Estimate:** $30,000 - $50,000

### 4.2 Formal Verification

**Recommended Verifications:**
1. **Commitment scheme** - Prove binding & hiding properties
2. **Nullifier uniqueness** - Prove no collisions
3. **Amount conservation** - Prove split outputs = input
4. **SPV security** - Prove verification completeness

### 4.3 Bug Bounty Program

**Recommended Structure:**

| Severity | Reward | Examples |
|----------|--------|----------|
| Critical | $50,000 - $100,000 | Fund theft, proof forgery |
| High | $10,000 - $50,000 | Privacy leak, DoS |
| Medium | $2,000 - $10,000 | Logic errors, data exposure |
| Low | $500 - $2,000 | Minor issues |

**Platforms:** Immunefi (DeFi focus)

---

## 5. Infrastructure Architecture

### 5.1 Production Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 USERS                                            │
│   Web Browser    │    Mobile App    │    SDK Integrations                       │
└────────┬─────────────────┬─────────────────────┬────────────────────────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CDN / WAF (Cloudflare)                                │
│   DDoS Protection │ SSL Termination │ Caching │ Rate Limiting                  │
└────────┬─────────────────┬─────────────────────┬────────────────────────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          LOAD BALANCER (AWS ALB)                                │
│   Health Checks │ SSL Certificates │ Request Routing                           │
└────────┬─────────────────┬─────────────────────┬────────────────────────────────┘
         │                 │                     │
    ┌────┴────┐       ┌────┴────┐          ┌────┴────┐
    │ Region  │       │ Region  │          │ Region  │
    │ US-East │       │ EU-West │          │  APAC   │
    └────┬────┘       └────┬────┘          └────┬────┘
         │                 │                     │
┌────────▼─────────────────▼─────────────────────▼────────────────────────────────┐
│                         APPLICATION TIER                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Web Frontend    │  │ API Backend     │  │ Header Relayer  │                  │
│  │ (Vercel Edge)   │  │ (ECS Fargate)   │  │ (ECS Fargate)   │                  │
│  │ - Static assets │  │ - Rust/Axum     │  │ - Node.js       │                  │
│  │ - SSR rendering │  │ - REST + WS     │  │ - Redundant x3  │                  │
│  └─────────────────┘  └────────┬────────┘  └────────┬────────┘                  │
│                                │                     │                          │
└────────────────────────────────┼─────────────────────┼──────────────────────────┘
                                 │                     │
┌────────────────────────────────▼─────────────────────▼──────────────────────────┐
│                         DATA TIER                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ PostgreSQL      │  │ Redis Cluster   │  │ S3 (Backups)    │                  │
│  │ (RDS Multi-AZ)  │  │ (ElastiCache)   │  │                 │                  │
│  │ - Deposits      │  │ - Sessions      │  │ - Circuit data  │                  │
│  │ - Redemptions   │  │ - Rate limits   │  │ - Audit logs    │                  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────────┐
│                       BLOCKCHAIN TIER                                            │
│  ┌─────────────────────────┐          ┌─────────────────────────┐               │
│  │ Solana RPC Cluster      │          │ Bitcoin Full Nodes      │               │
│  │ - Helius (Primary)      │          │ - Esplora API (Primary) │               │
│  │ - QuickNode (Failover)  │          │ - Self-hosted (Backup)  │               │
│  │ - Triton (Backup)       │          │                         │               │
│  └─────────────────────────┘          └─────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────────┐
│                       FROST SIGNING TIER (Isolated)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                              │
│  │ Signer 1    │  │ Signer 2    │  │ Signer 3    │                              │
│  │ (AWS HSM)   │  │ (GCP HSM)   │  │ (Azure HSM) │                              │
│  │ Custodian A │  │ Custodian B │  │ Custodian C │                              │
│  └─────────────┘  └─────────────┘  └─────────────┘                              │
│            \              │              /                                       │
│             \      2-of-3 Threshold     /                                        │
│              └───────────┬─────────────┘                                         │
│                          ▼                                                       │
│               Aggregated BTC Signatures                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component Specifications

#### 5.2.1 Web Frontend (Vercel)

| Specification | Value |
|---------------|-------|
| Framework | Next.js 16 |
| Deployment | Vercel Edge Network |
| CDN | Vercel Edge + Cloudflare |
| SSL | Automatic HTTPS |
| Regions | Global (30+ PoPs) |

#### 5.2.2 API Backend (AWS ECS Fargate)

| Specification | Value |
|---------------|-------|
| Runtime | Rust (tokio) |
| Framework | Axum |
| Instances | 3 minimum (Multi-AZ) |
| vCPU | 2 vCPU per instance |
| Memory | 4 GB per instance |
| Auto-scaling | CPU > 70% trigger |
| Health Checks | /health endpoint |

#### 5.2.3 Header Relayer (Redundant)

| Specification | Value |
|---------------|-------|
| Runtime | Node.js (bun) |
| Instances | 3 (geographically distributed) |
| Sync Interval | 10 minutes |
| Failover | Automatic leader election |

#### 5.2.4 FROST Signers (HSM-Backed)

| Specification | Value |
|---------------|-------|
| Key Storage | HSM (CloudHSM/Azure HSM) |
| Threshold | 2-of-3 |
| Custodians | 3 independent entities |
| Network Isolation | Private VPC, no internet |
| Signing Latency | < 5 seconds |

### 5.3 Database Schema (Production)

```sql
-- Core Tables

CREATE TABLE deposits (
    id UUID PRIMARY KEY,
    commitment BYTEA NOT NULL UNIQUE,
    amount_sats BIGINT NOT NULL,
    taproot_address VARCHAR(64) NOT NULL,
    btc_txid VARCHAR(64),
    btc_vout INTEGER,
    spv_verified BOOLEAN DEFAULT FALSE,
    leaf_index INTEGER,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    claimed_at TIMESTAMP
);

CREATE TABLE nullifiers (
    nullifier BYTEA PRIMARY KEY,
    commitment BYTEA NOT NULL,
    spent_at TIMESTAMP DEFAULT NOW(),
    tx_signature VARCHAR(128) NOT NULL
);

CREATE TABLE redemptions (
    id UUID PRIMARY KEY,
    burn_tx_signature VARCHAR(128) NOT NULL,
    btc_recipient_address VARCHAR(64) NOT NULL,
    amount_sats BIGINT NOT NULL,
    btc_txid VARCHAR(64),
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE TABLE stealth_announcements (
    id SERIAL PRIMARY KEY,
    ephemeral_pubkey_x BYTEA NOT NULL,
    ephemeral_pubkey_y BYTEA NOT NULL,
    encrypted_data BYTEA NOT NULL,
    commitment_prefix BYTEA NOT NULL,
    leaf_index INTEGER NOT NULL,
    announced_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE zkey_names (
    name VARCHAR(32) PRIMARY KEY,
    spending_pubkey BYTEA NOT NULL,
    viewing_pubkey BYTEA NOT NULL,
    registered_at TIMESTAMP DEFAULT NOW(),
    owner_authority BYTEA NOT NULL
);

-- Indexes

CREATE INDEX idx_deposits_status ON deposits(status);
CREATE INDEX idx_deposits_taproot ON deposits(taproot_address);
CREATE INDEX idx_redemptions_status ON redemptions(status);
CREATE INDEX idx_stealth_commitment ON stealth_announcements(commitment_prefix);
```

### 5.4 RPC Provider Strategy

#### 5.4.1 Solana RPC

| Provider | Role | Rate Limits | Cost |
|----------|------|-------------|------|
| Helius | Primary | 100 RPS | $500/mo |
| QuickNode | Failover | 50 RPS | $300/mo |
| Triton | Backup | 25 RPS | $100/mo |

**Failover Logic:**
1. Primary: Helius (latency < 100ms)
2. If latency > 200ms or error rate > 1%: QuickNode
3. If both fail: Triton (with alerts)

#### 5.4.2 Bitcoin API

| Provider | Role | Capabilities |
|----------|------|--------------|
| Esplora (Blockstream) | Primary | Address watching, tx broadcast |
| Mempool.space | Backup | Fee estimation, tx monitoring |
| Self-hosted | Disaster Recovery | Full node, archival |

---

## 6. Testing & Quality Assurance

### 6.1 Testing Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TESTING PYRAMID                                        │
│                                                                                 │
│                              ┌─────────┐                                        │
│                              │  E2E    │  Mainnet Fork Tests                    │
│                             ─┴─────────┴─                                       │
│                            ┌─────────────┐                                      │
│                            │ Integration │  Cross-component tests               │
│                           ─┴─────────────┴─                                     │
│                          ┌─────────────────┐                                    │
│                          │      Unit       │  Component isolation               │
│                         ─┴─────────────────┴─                                   │
│                        ┌─────────────────────┐                                  │
│                        │    Static Analysis  │  Type checking, linting          │
│                       ─┴─────────────────────┴─                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Test Coverage Requirements

| Component | Current | Target | Tools |
|-----------|---------|--------|-------|
| SDK | 75% | 90% | Vitest |
| Contracts | 60% | 85% | Anchor tests |
| Noir Circuits | 80% | 95% | nargo test |
| Frontend | 50% | 75% | Vitest + Playwright |
| Backend | 65% | 85% | cargo test |
| Mobile | 30% | 70% | Jest + Detox |

### 6.3 CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml (Required)

name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  # Stage 1: Static Analysis
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint SDK
        run: cd sdk && bun run lint
      - name: Lint Contracts
        run: cd contracts && cargo clippy -- -D warnings
      - name: Lint Frontend
        run: cd zvault_app && bun run lint

  # Stage 2: Unit Tests
  test-sdk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: SDK Unit Tests
        run: cd sdk && bun test

  test-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Contract Tests
        run: cd contracts && anchor test

  test-circuits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Noir Circuit Tests
        run: cd noir-circuits && bun run test

  # Stage 3: Integration Tests
  integration:
    needs: [test-sdk, test-contracts, test-circuits]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start Localnet
        run: solana-test-validator &
      - name: E2E Tests
        run: cd sdk && bun run e2e

  # Stage 4: Security Scan
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Cargo Audit
        run: cargo audit
      - name: NPM Audit
        run: bun audit
      - name: Semgrep
        uses: returntocorp/semgrep-action@v1

  # Stage 5: Build
  build:
    needs: [integration]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build SDK
        run: cd sdk && bun run build
      - name: Build Contracts
        run: cd contracts && anchor build
      - name: Build Frontend
        run: cd zvault_app && bun run build
```

### 6.4 E2E Test Scenarios

#### 6.4.1 Happy Path Tests

| Scenario | Description | Expected |
|----------|-------------|----------|
| Full Deposit Flow | BTC → Taproot → SPV → Claim → zkBTC | Success, balance increase |
| Split Transaction | 1 note → 2 notes | Conservation holds |
| Stealth Send | Alice → Bob stealth | Bob can scan & claim |
| Redemption Flow | zkBTC → Burn → BTC | BTC received |
| Name Registration | Register alice.zkey | Lookup works |

#### 6.4.2 Security Tests

| Scenario | Description | Expected |
|----------|-------------|----------|
| Double Spend | Reuse nullifier | Transaction rejected |
| Fake Proof | Invalid ZK proof | Verification fails |
| SPV Attack | Invalid Merkle proof | Deposit rejected |
| Amount Mismatch | Split with wrong amounts | Conservation check fails |
| Replay Attack | Resubmit old transaction | Nonce/signature fails |

#### 6.4.3 Stress Tests

| Scenario | Load | Expected |
|----------|------|----------|
| Concurrent Claims | 100 simultaneous | All succeed, < 5s latency |
| Header Relay Storm | 1000 headers/min | No drops, correct chain |
| WebSocket Flood | 10k connections | Graceful degradation |
| Large Proof | Max circuit size | Verify under 1.4M CU |

### 6.5 Testnet Graduation Criteria

Before mainnet deployment, all must pass:

- [ ] **100% E2E test pass rate** on devnet
- [ ] **Security audit complete** with no critical findings
- [ ] **Performance benchmarks met** (proof gen < 5s, verify < 1.4M CU)
- [ ] **Chaos testing passed** (random failure injection)
- [ ] **Mainnet fork tests passed** (full flow on fork)
- [ ] **Manual QA signoff** from 3+ team members

---

## 7. Deployment Strategy

### 7.1 Environment Progression

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Localnet│────▶│ Devnet  │────▶│ Testnet │────▶│ Mainnet │
│         │     │(Current)│     │ (Beta)  │     │         │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
    CI/CD        Internal        Closed Beta      Public
   Testing        Testing        (~100 users)     Launch
```

### 7.2 Deployment Checklist

#### 7.2.1 Pre-Deployment

- [ ] All tests passing on CI
- [ ] Security audit findings resolved
- [ ] Code freeze announced (48h prior)
- [ ] Runbook updated
- [ ] Rollback plan documented
- [ ] On-call schedule confirmed

#### 7.2.2 Deployment Steps

```bash
# 1. Contract Deployment
anchor deploy --program-id <MAINNET_ID> --provider.cluster mainnet

# 2. Initialize State
bun run scripts/initialize-mainnet.ts

# 3. Upload VK Accounts
bun run scripts/upload-verification-keys.ts --network mainnet

# 4. Deploy Backend
aws ecs update-service --cluster zvault-prod --service api --force-new-deployment

# 5. Deploy Frontend
vercel deploy --prod

# 6. Verify Health
curl https://api.zvault.io/health
```

#### 7.2.3 Post-Deployment

- [ ] Smoke tests passing
- [ ] Monitoring dashboards green
- [ ] First transaction successful
- [ ] Team notification sent

### 7.3 Rollback Procedure

**Trigger Conditions:**
- Error rate > 5%
- Latency > 10s for critical paths
- Any fund-at-risk scenario

**Rollback Steps:**
1. Pause contract (if upgrade authority exists)
2. Revert ECS to previous task definition
3. Revert Vercel deployment
4. Notify users via status page
5. Post-mortem within 24h

### 7.4 Feature Flags

| Flag | Description | Default |
|------|-------------|---------|
| `ENABLE_MAINNET_BTC` | Real BTC integration | OFF |
| `ENABLE_FROST_SIGNING` | Production threshold signing | OFF |
| `ENABLE_YIELD_POOLS` | Yield pool functionality | OFF |
| `ENABLE_MOBILE_CLAIMING` | Mobile proof generation | OFF |
| `MAINTENANCE_MODE` | Disable new operations | OFF |

---

## 8. Monitoring & Operations

### 8.1 Observability Stack

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           OBSERVABILITY STACK                                    │
│                                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │    METRICS      │  │     LOGS        │  │    TRACES       │                  │
│  │   (Prometheus)  │  │  (Loki/ELK)     │  │   (Jaeger)      │                  │
│  │                 │  │                 │  │                 │                  │
│  │ - Request rate  │  │ - API logs      │  │ - Tx tracing    │                  │
│  │ - Error rate    │  │ - Solana txs    │  │ - Proof gen     │                  │
│  │ - Latency p99   │  │ - BTC events    │  │ - Cross-service │                  │
│  │ - CU usage      │  │ - Errors        │  │                 │                  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                    │                          │
│           └────────────────────┼────────────────────┘                          │
│                                ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         GRAFANA DASHBOARDS                               │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │   │   Overview   │  │   Deposits   │  │  Redemptions │  │   Alerts   │  │   │
│  │   └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                │                                                │
│                                ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         ALERTING (PagerDuty)                             │   │
│  │   Critical: Immediate page  │  High: 15min  │  Medium: Daily digest     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Key Metrics

#### 8.2.1 Service Level Indicators (SLIs)

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Availability | 99.9% | < 99.5% |
| Deposit Confirmation Time | < 1h | > 2h |
| Claim Success Rate | > 99% | < 98% |
| Proof Generation Time | < 5s | > 10s |
| On-chain Verification | < 1.2M CU | > 1.3M CU |

#### 8.2.2 Business Metrics

| Metric | Description |
|--------|-------------|
| TVL (Total Value Locked) | Sum of all zkBTC in circulation |
| Daily Active Users | Unique wallets per day |
| Deposit Volume | BTC deposited per day |
| Redemption Volume | BTC withdrawn per day |
| Stealth Transfers | Private sends per day |

### 8.3 Alerting Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| API Down | No 200 response 5min | Critical | Page on-call |
| High Error Rate | > 5% errors/min | High | Page + investigate |
| Deposit Stuck | Pending > 2h | High | Check BTC/Solana |
| Low Pool Balance | BTC < 10% reserves | Medium | Notify treasury |
| Header Relay Lag | > 6 blocks behind | Medium | Check relayers |
| Circuit Timeout | Proof > 30s | Low | Investigate load |

### 8.4 Runbook Template

```markdown
## Runbook: [Alert Name]

### Symptoms
- What the alert means
- Expected user impact

### Diagnosis
1. Check [dashboard URL]
2. Query logs: `{service="api"} |= "error"`
3. Verify dependent services

### Resolution Steps
1. Step one...
2. Step two...
3. Escalation path if unresolved

### Prevention
- What can prevent recurrence
```

### 8.5 Incident Response

**Severity Levels:**

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| SEV1 | Funds at risk | 5 min | Exploit, double spend |
| SEV2 | Service down | 15 min | API outage |
| SEV3 | Degraded | 1 hour | Slow deposits |
| SEV4 | Minor | 24 hours | UI bugs |

---

## 9. Risk Assessment & Mitigations

### 9.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ZK Proof Vulnerability | Low | Critical | Multiple audits, formal verification |
| Smart Contract Bug | Medium | Critical | Audit, upgrade authority, insurance |
| Bitcoin Reorg (>6 blocks) | Very Low | High | 6+ confirmation requirement |
| Solana Congestion | Medium | Medium | Priority fees, retry logic |
| FROST Signer Compromise | Low | Critical | HSM, 2-of-3 threshold, key rotation |
| Dependency Vulnerability | Medium | Medium | Regular audits, pinned versions |

### 9.2 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| RPC Provider Outage | Medium | High | Multi-provider failover |
| Key Ceremony Failure | Low | High | Documented process, backup custodians |
| Team Bus Factor | Medium | Medium | Documentation, cross-training |
| Infrastructure Cost Overrun | Medium | Low | Budget alerts, auto-scaling limits |

### 9.3 Regulatory Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Privacy Regulations | Medium | High | Proof of Innocence circuit |
| Exchange Delisting | Medium | Medium | Compliance partnerships |
| Jurisdiction Issues | Medium | Medium | Geo-blocking if required |

### 9.4 Economic Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Liquidity Crisis | Low | High | Reserve requirements, insurance |
| BTC Price Volatility | High | Medium | Real-time oracle pricing |
| Bridge Run | Low | Critical | Proof of reserves, transparency |

---

## 10. Timeline & Milestones

### 10.1 Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2026                                                                            │
│                                                                                 │
│ Feb         Mar         Apr         May         Jun         Jul                │
│  │           │           │           │           │           │                  │
│  ▼           ▼           ▼           ▼           ▼           ▼                  │
│ ┌───────────────────────────────────────────────────────────────────────────┐  │
│ │ Phase 1: Foundation   │ Phase 2: Security  │ Phase 3: Launch             │  │
│ │ (6 weeks)             │ (6 weeks)          │ (4 weeks)                   │  │
│ │                       │                    │                             │  │
│ │ - UltraHonk verifier  │ - Security audit   │ - Testnet beta              │  │
│ │ - CI/CD pipeline      │ - Bug bounty       │ - Mainnet deploy            │  │
│ │ - Test coverage       │ - FROST ceremony   │ - Public launch             │  │
│ │ - Infrastructure      │ - Penetration test │ - Marketing                 │  │
│ └───────────────────────┴────────────────────┴─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Detailed Milestones

#### Phase 1: Foundation (Weeks 1-6)

| Week | Milestone | Deliverable | Owner |
|------|-----------|-------------|-------|
| 1-2 | UltraHonk Core | Transcript + sumcheck verification | Core |
| 2-3 | UltraHonk Complete | Shplemini + pairing verification | Core |
| 3-4 | CI/CD Pipeline | GitHub Actions workflows | DevOps |
| 4-5 | Test Coverage | 85%+ coverage on all components | QA |
| 5-6 | Infrastructure | Production AWS/Vercel setup | DevOps |

**Phase 1 Exit Criteria:**
- [ ] UltraHonk verifier deployed to devnet
- [ ] All proofs verify < 1.2M CU
- [ ] CI/CD pipeline running
- [ ] 85% test coverage achieved

#### Phase 2: Security (Weeks 7-12)

| Week | Milestone | Deliverable | Owner |
|------|-----------|-------------|-------|
| 7-10 | Security Audit | Audit report + fixes | Security |
| 8-9 | FROST Ceremony | Production keys generated | Ops |
| 10-11 | Bug Bounty | Program live on Immunefi | Security |
| 11-12 | Pen Testing | External penetration test | Security |

**Phase 2 Exit Criteria:**
- [ ] Security audit passed (no critical findings)
- [ ] FROST keys in HSMs
- [ ] Bug bounty live
- [ ] Pen test report clean

#### Phase 3: Launch (Weeks 13-16)

| Week | Milestone | Deliverable | Owner |
|------|-----------|-------------|-------|
| 13 | Testnet Beta | 100 beta users | Product |
| 14 | Beta Feedback | Bugs fixed, UX improved | Product |
| 15 | Mainnet Deploy | Programs + infra live | Core |
| 16 | Public Launch | Marketing, PR | Marketing |

**Phase 3 Exit Criteria:**
- [ ] Beta feedback incorporated
- [ ] Mainnet programs deployed
- [ ] Monitoring dashboards live
- [ ] Public announcement made

### 10.3 Resource Requirements

| Role | FTE | Phase 1 | Phase 2 | Phase 3 |
|------|-----|---------|---------|---------|
| Core Engineer | 3 | High | Medium | Low |
| Security Engineer | 1 | Low | High | Medium |
| DevOps | 1 | High | Medium | High |
| QA | 1 | High | High | Medium |
| Product | 1 | Low | Low | High |
| **Total** | **7** | | | |

---

## 11. Success Criteria

### 11.1 Technical Success

| Metric | Target | Measurement |
|--------|--------|-------------|
| API Uptime | 99.9% | Monitoring |
| Proof Verification | < 1.2M CU | On-chain logs |
| Deposit Time | < 1 hour | User reports |
| Mobile Proof Gen | < 10 seconds | Performance tests |
| Zero Critical Bugs | 0 | Bug tracker |

### 11.2 Business Success (90 Days Post-Launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Total Value Locked | $10M+ | On-chain |
| Daily Active Users | 1,000+ | Analytics |
| Daily Volume | $500K+ | On-chain |
| User Retention (30d) | 40%+ | Analytics |
| Mobile Downloads | 10,000+ | App stores |

### 11.3 Security Success

| Metric | Target | Measurement |
|--------|--------|-------------|
| Security Incidents | 0 critical | Incident log |
| Audit Findings Resolved | 100% | Audit tracker |
| Mean Time to Patch | < 24 hours | Incident log |
| Bug Bounty Payouts | < $50K | Immunefi |

---

## 12. Appendices

### 12.1 Appendix A: Program IDs

| Program | Devnet | Mainnet (TBD) |
|---------|--------|---------------|
| zVault | `zKeyrLmpT8W9o8iRvhizuSihLAFLhfAGBvfM638Pbw8` | TBD |
| BTC Light Client | `S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn` | TBD |
| ChadBuffer | `C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF` | TBD |
| UltraHonk Verifier | TBD | TBD |

### 12.2 Appendix B: Circuit Specifications

| Circuit | Public Inputs | Private Inputs | Constraints |
|---------|---------------|----------------|-------------|
| claim | merkle_root, nullifier, commitment | secret, leaf_index, amount | ~15,000 |
| spend_split | nullifier_in, commitment_out_1, commitment_out_2 | secret, amounts | ~25,000 |
| spend_partial_public | nullifier, commitment_out, public_amount | secret, amounts | ~20,000 |
| pool_deposit | commitment_in_null, pool_commitment_out | secret, principal | ~20,000 |
| pool_withdraw | pool_commitment_null, commitment_out | secret, principal, yield | ~22,000 |
| pool_claim_yield | pool_commitment_null, yield_commitment_out | secret, yield_amount | ~28,000 |

### 12.3 Appendix C: API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/deposit/register` | POST | Register new deposit |
| `/api/v1/deposit/:id/status` | GET | Check deposit status |
| `/api/v1/redemption/request` | POST | Request BTC withdrawal |
| `/api/v1/stealth/prepare` | POST | Prepare stealth deposit |
| `/api/v1/names/:name` | GET | Lookup .zkey name |
| `/ws/deposits` | WS | Real-time deposit updates |

### 12.4 Appendix D: Glossary

| Term | Definition |
|------|------------|
| **zkBTC** | Shielded Bitcoin representation on Solana |
| **Commitment** | Poseidon2 hash binding pubkey to amount |
| **Nullifier** | Hash used to prevent double-spending |
| **Stealth Address** | One-time unlinkable recipient address |
| **SPV** | Simplified Payment Verification (light client) |
| **FROST** | Flexible Round-Optimized Schnorr Threshold signatures |
| **UltraHonk** | ZK proof system without trusted setup |
| **Grumpkin** | BN254's embedded curve for efficient ECDH |
| **ChadBuffer** | On-chain large data storage solution |

### 12.5 Appendix E: Contact & Escalation

| Role | Contact | Escalation Path |
|------|---------|-----------------|
| Engineering Lead | TBD | Primary on-call |
| Security Lead | TBD | Security incidents |
| Operations | TBD | Infrastructure |
| Product | TBD | User-facing issues |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | Claude | Initial draft |

---

**Next Steps:**

1. Review this document with stakeholders
2. Prioritize items in Phase 1
3. Assign owners to each milestone
4. Begin UltraHonk verifier implementation
5. Initiate security audit vendor selection
