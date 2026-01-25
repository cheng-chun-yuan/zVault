# zVault Product Requirements Document

Product Requirements Document for zVault: a privacy-preserving Bitcoin-to-Solana bridge.

---

## Table of Contents

1. [Vision](#vision)
2. [Problem Statement](#problem-statement)
3. [Target Users](#target-users)
4. [Core Features](#core-features)
5. [User Stories](#user-stories)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Privacy Guarantees](#privacy-guarantees)
8. [Security Requirements](#security-requirements)
9. [Success Metrics](#success-metrics)
10. [Roadmap](#roadmap)

---

## Vision

**Mission**: Enable Bitcoin holders to access Solana DeFi with full privacy preservation.

**Ultimate Goal**: Create a shielded pool where BTC deposits become private tokens (zBTC) that can be transferred, split, and withdrawn without linking on-chain activity to user identity.

### Value Proposition

| For | We Provide |
|-----|-----------|
| Privacy-conscious BTC holders | Unlinkable deposits and withdrawals |
| DeFi users | Private value transfer on Solana |
| Institutions | Compliant privacy (Proof of Innocence) |
| Developers | SDK for privacy-preserving applications |

---

## Problem Statement

### Current State

1. **On-chain Transparency**: All BTC and Solana transactions are publicly visible
2. **Address Reuse**: Creates transaction graphs linking user activity
3. **Exchange Surveillance**: KYC/AML links real identity to addresses
4. **Privacy Mixers**: Often blocked by exchanges, regulatory concerns

### zVault Solution

1. **Shielded Pool**: Amounts hidden in cryptographic commitments
2. **ZK Proofs**: Prove ownership without revealing which deposit
3. **Stealth Addresses**: One-time addresses per transaction
4. **Proof of Innocence**: Voluntary compliance without full de-anonymization

---

## Target Users

### Primary Personas

#### 1. Privacy-Conscious BTC Holder

- **Profile**: Individual holding BTC for savings/investment
- **Needs**: Spend BTC without revealing full transaction history
- **Pain Points**: Address reuse, exchange tracking, surveillance
- **Usage**: Deposit BTC, claim privately, withdraw when needed

#### 2. DeFi Power User

- **Profile**: Active DeFi participant across chains
- **Needs**: Bridge BTC to Solana for yield/trading
- **Pain Points**: Public transaction visibility, MEV exposure
- **Usage**: Deposit, split for partial positions, stealth send to DeFi

#### 3. Merchant/Business

- **Profile**: Business accepting BTC payments
- **Needs**: Receive payments without revealing customer data
- **Pain Points**: Customer privacy, competitive intelligence
- **Usage**: Generate stealth addresses per customer, aggregate privately

#### 4. Institutional User

- **Profile**: Fund, treasury, or compliant entity
- **Needs**: Privacy with regulatory compliance capability
- **Pain Points**: Regulatory scrutiny, audit requirements
- **Usage**: Full privacy with Proof of Innocence for audits

### Secondary Personas

- **Developer**: Building privacy-preserving applications
- **Exchange**: Integrating private BTC on/off ramps
- **Wallet Provider**: Adding privacy features to existing wallets

---

## Core Features

### 1. Private BTC Deposits

**Description**: Users deposit BTC to Taproot addresses derived from cryptographic commitments. The deposit is verified via SPV proof on Solana.

**Requirements**:
- [ ] Generate deposit credentials (nullifier, secret, commitment)
- [ ] Derive Taproot address from commitment
- [ ] Verify BTC deposit via SPV proof
- [ ] Record commitment in on-chain Merkle tree
- [ ] Support testnet and mainnet Bitcoin

**Privacy**: Deposit amount visible on Bitcoin; commitment unlinkable.

### 2. Shielded Claims

**Description**: Users claim zBTC by proving knowledge of commitment secrets via ZK proof, without revealing which deposit they're claiming.

**Requirements**:
- [ ] Generate ZK proof client-side (browser/mobile)
- [ ] Verify proof on Solana (~95k CU)
- [ ] Record nullifier hash to prevent double-spend
- [ ] Mint zBTC to new commitment in tree

**Privacy**: Claim unlinkable to deposit; nullifier hash only revealed.

### 3. Private Splits

**Description**: Split one commitment into two outputs while preserving total amount, all done privately with ZK proof.

**Requirements**:
- [ ] Split any amount ratio (e.g., 60/40, 99/1)
- [ ] Both outputs are new commitments
- [ ] Verify amount conservation in ZK
- [ ] Prevent nullifier reuse

**Privacy**: Split amounts hidden; only input nullifier revealed.

### 4. Stealth Sends

**Description**: Send to a recipient without revealing their identity on-chain, using ECDH-derived one-time addresses.

**Requirements**:
- [ ] Derive stealth meta-address from wallet
- [ ] Generate per-send ephemeral keys
- [ ] Compute shared secret via Grumpkin ECDH
- [ ] Announce on-chain with ephemeral pubkey
- [ ] Recipient scans announcements to detect funds

**Privacy**: Only recipient can derive actual commitment.

### 5. Claim Links (Bearer Instruments)

**Description**: Create shareable links that anyone with the link can claim. Functions as a bearer instrument.

**Requirements**:
- [ ] Encode nullifier + secret in URL
- [ ] Support QR code generation
- [ ] Enable one-time claim per link
- [ ] Optional password protection

**Privacy**: Link holder is anonymous; only need the link to claim.

### 6. Private Withdrawals

**Description**: Withdraw BTC by burning zBTC commitment and receiving BTC to specified address.

**Requirements**:
- [ ] Prove commitment ownership via ZK
- [ ] Support partial withdrawals (change output)
- [ ] Backend signs and broadcasts BTC transaction
- [ ] Track withdrawal status

**Privacy**: Withdrawal amount visible; unlinkable to original deposit.

### 7. Name Registry (.zkey)

**Description**: Human-readable names for stealth addresses, similar to ENS.

**Requirements**:
- [ ] Register names (1-32 chars, alphanumeric + underscore)
- [ ] Link name to stealth meta-address
- [ ] Support name transfers
- [ ] Lookup by name in SDK/app

**Example**: Send to `alice.zkey` instead of long hex address.

### 8. Proof of Innocence

**Description**: Voluntary compliance feature to prove funds originated from verified BTC deposit.

**Requirements**:
- [ ] Separate "innocence tree" for verified deposits only
- [ ] ZK proof that commitment is in innocence tree
- [ ] Without revealing which specific deposit
- [ ] Optional disclosure for regulatory compliance

**Use Case**: Exchange integration, institutional requirements.

---

## User Stories

### Deposit Flow

```
AS A Bitcoin holder
I WANT TO deposit BTC to zVault
SO THAT I can access Solana DeFi privately

ACCEPTANCE CRITERIA:
- Generate deposit credentials with one click
- Display QR code for Taproot address
- Track deposit confirmation status
- Claim link saved for later use
```

### Claim Flow

```
AS A user with a claim link
I WANT TO claim my zBTC
SO THAT I can use it privately on Solana

ACCEPTANCE CRITERIA:
- Paste or scan claim link
- Generate ZK proof in browser/app
- Transaction submitted automatically
- Balance visible in shielded wallet
```

### Split Flow

```
AS A zBTC holder
I WANT TO split my balance into two parts
SO THAT I can send partial amounts

ACCEPTANCE CRITERIA:
- Enter split amounts (sum must equal input)
- Generate ZK proof for split
- Receive two new claim links/commitments
- Original commitment invalidated
```

### Stealth Send Flow

```
AS A zBTC holder
I WANT TO send to another user
SO THAT only they can access the funds

ACCEPTANCE CRITERIA:
- Enter recipient's .zkey name or stealth address
- Generate one-time stealth commitment
- Announcement recorded on-chain
- Recipient can scan and claim
```

### Withdrawal Flow

```
AS A zBTC holder
I WANT TO withdraw back to BTC
SO THAT I can use my Bitcoin elsewhere

ACCEPTANCE CRITERIA:
- Enter BTC address and amount
- Generate ZK proof (with optional change)
- Track withdrawal status
- Receive BTC within 1-2 blocks
```

---

## Non-Functional Requirements

### Performance

| Metric | Requirement |
|--------|-------------|
| Proof generation (browser) | < 10 seconds |
| Proof generation (mobile) | < 5 seconds |
| On-chain verification | < 100,000 CU |
| API response time | < 500ms |
| Deposit confirmation | 2 BTC blocks |

### Scalability

| Metric | Requirement |
|--------|-------------|
| Merkle tree capacity | 1M+ commitments |
| Concurrent users | 10,000+ |
| TPS (shielded ops) | 100+ |
| Root history | 30 recent roots |

### Availability

| Metric | Requirement |
|--------|-------------|
| API uptime | 99.9% |
| Frontend uptime | 99.9% |
| RPC availability | Multiple providers |

### Compatibility

| Platform | Requirement |
|----------|-------------|
| Browsers | Chrome, Firefox, Safari (last 2 versions) |
| Mobile | iOS 14+, Android 8.0+ |
| Wallets | Phantom, Solflare, mobile wallets |

---

## Privacy Guarantees

### What's Private

| Data | Privacy Level |
|------|--------------|
| Deposit → Claim link | Full (unlinkable) |
| Shielded amounts | Hidden in commitments |
| Transaction graph | Broken by nullifiers |
| Recipient identity | Stealth addresses |
| Spending pattern | Uniform claim format |

### What's Visible

| Data | Visibility |
|------|------------|
| BTC deposit amount | Bitcoin blockchain |
| BTC withdrawal amount | Bitcoin blockchain |
| Merkle root updates | Solana blockchain |
| Nullifier hashes | Solana blockchain (no link to deposit) |
| Stealth announcements | Solana blockchain (encrypted) |

### Privacy Model

```
Deposit on Bitcoin:    Amount visible, commitment created
                              ↓
Claim on Solana:       ZK proof, only nullifier_hash revealed
                              ↓
Shielded Operations:   All amounts hidden, unlinkable
                              ↓
Withdraw on Bitcoin:   Amount visible, no link to deposit
```

---

## Security Requirements

### Cryptographic Security

| Component | Requirement |
|-----------|-------------|
| Proof system | Groth16 (128-bit security) |
| Hash function | Poseidon2 (ZK-optimized) |
| Curve | BN254 (Solana native) |
| Key derivation | RAILGUN-style from wallet signature |

### Smart Contract Security

| Requirement | Implementation |
|-------------|----------------|
| Nullifier uniqueness | On-chain PDA per nullifier |
| Double-spend prevention | Nullifier check before mint |
| Amount conservation | ZK constraint verification |
| Access control | Authority checks on admin ops |

### Operational Security

| Requirement | Implementation |
|-------------|----------------|
| Key storage | Encrypted in Keychain/Keystore |
| Biometric auth | Required for signing |
| Seed backup | User-managed, not stored |
| Session timeout | Auto-lock after 5 min |

### Audit Status

> **Current**: Proof-of-concept, no formal audit
> **Planned**: Full security audit before mainnet

---

## Success Metrics

### Adoption Metrics

| Metric | Target (6 months) |
|--------|------------------|
| Total deposits | 100 BTC |
| Unique users | 5,000 |
| Daily active users | 500 |
| Mobile app downloads | 10,000 |

### Engagement Metrics

| Metric | Target |
|--------|--------|
| Avg deposits per user | 2.5 |
| Stealth sends per week | 1,000 |
| .zkey registrations | 2,000 |
| Claim link shares | 5,000 |

### Technical Metrics

| Metric | Target |
|--------|--------|
| Proof generation success | 99.5% |
| Transaction success rate | 99.9% |
| API uptime | 99.9% |
| Mobile app crash rate | < 0.5% |

### Privacy Metrics

| Metric | Target |
|--------|--------|
| Anonymity set size | 10,000+ commitments |
| Avg time in pool | > 7 days |
| PoI usage rate | < 5% (voluntary) |

---

## Roadmap

### Phase 1: MVP (Current)

- [x] Core circuits (claim, split, transfer, withdraw)
- [x] Solana program (Pinocchio)
- [x] TypeScript SDK
- [x] Web frontend
- [x] Mobile app (Expo)
- [x] Backend API (redemption, stealth)

### Phase 2: Hardening

- [ ] Security audit
- [ ] Mainnet deployment
- [ ] Multi-wallet support
- [ ] Performance optimization
- [ ] Error handling improvements

### Phase 3: Features

- [ ] Multi-chain support (Ethereum bridge)
- [ ] DeFi integrations (AMMs, lending)
- [ ] Batch operations
- [ ] Hardware wallet support
- [ ] Advanced compliance tools

### Phase 4: Ecosystem

- [ ] Developer SDK documentation
- [ ] Partner integrations
- [ ] Governance token
- [ ] DAO structure
- [ ] Community grants

---

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| Commitment | Poseidon2(Poseidon2(nullifier, secret), amount) |
| Nullifier | Random 254-bit secret, revealed as hash to prevent double-spend |
| Stealth Address | One-time address derived via ECDH |
| ZK Proof | Groth16 proof of statement validity |
| Merkle Root | Root hash of commitment tree |
| Shielded Pool | On-chain set of all valid commitments |

### Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [CONTRACTS.md](./CONTRACTS.md) - Solana program details
- [SDK.md](./SDK.md) - Developer SDK reference
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
