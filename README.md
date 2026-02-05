# zVault - Privacy-Preserving BTC on Solana

**Private Bitcoin on Solana using Zero-Knowledge Proofs**

zVault is a trustless bridge that enables Bitcoin holders to access Solana DeFi with full transaction privacy. Deposit BTC, receive shielded zkBTC, and transact without revealing amounts or linking identities.

```
BTC Deposit → Taproot Address → SPV Verify → Shielded Pool → ZK Transfers → Withdraw BTC
                                                   │
                              ┌────────────────────┴─────────────────────┐
                              │                                          │
                    Amounts hidden in commitments          Unlinkable stealth addresses
                    Nullifier-based double-spend prevention   .zkey.sol human-readable names
```

---

## The Problem

Bitcoin's transparent blockchain makes privacy challenging:
- Every transaction is publicly visible and linkable
- Cross-chain bridges expose user activity on both chains
- DeFi participation requires revealing transaction history

**zVault solves this** by creating a privacy layer between Bitcoin and Solana using zero-knowledge proofs.

---

## Tech Stack

| Layer | Technology | Innovation |
|-------|------------|------------|
| **ZK Circuits** | Noir + Groth16 (Sunspot) | 6 specialized privacy circuits |
| **On-Chain Verifier** | BN254 alt_bn128 precompiles | ~200k CU inline verification |
| **Smart Contracts** | Pinocchio (Solana) | Zero-copy, embedded VK verification |
| **Bitcoin Integration** | Taproot + SPV | Permissionless light client |
| **Name Service** | .zkey.sol (SNS-style) | Human-readable stealth addresses |
| **Stealth Addresses** | EIP-5564/DKSAP + Grumpkin | ~2k constraint ECDH (vs 300k X25519) |
| **RPC Infrastructure** | Helius | Priority fee estimation |
| **Client SDK** | @zvault/sdk (custom) | Full privacy toolkit |
| **Frontend** | Next.js 14 | Server components, React hooks |
| **Mobile** | Expo + React Native | Cross-platform wallet |
| **Backend** | Rust (Axum) | FROST threshold signing |

---

## Key Innovations

### 1. Noir ZK Circuits (6 Specialized Circuits)

Built on Aztec's Noir language compiled to Groth16 via Sunspot for compact proofs (~388 bytes):

| Circuit | Purpose | Key Constraints |
|---------|---------|-----------------|
| `claim` | Mint zkBTC from BTC deposit | Merkle proof, nullifier, amount match |
| `spend_split` | Split 1 note → 2 notes | Amount conservation, unique recipients |
| `spend_partial_public` | Partial withdrawal | Public + change outputs |
| `pool_deposit` | Enter yield pool | Unified → Pool commitment |
| `pool_withdraw` | Exit with yield | Yield calculation in-circuit |
| `pool_claim_yield` | Compound yields | Re-stake with epoch reset |

**Unified Commitment Model:**
```
Commitment = Poseidon2(pub_key_x, amount)
Nullifier  = Poseidon2(priv_key, leaf_index)
```

### 2. Stealth Address Protocol (EIP-5564/DKSAP)

Unlinkable one-time addresses using Grumpkin curve ECDH:

```
Sender:                              Recipient:
┌────────────────────┐               ┌────────────────────┐
│ 1. ephemeral_priv  │               │ 1. viewing_priv    │
│ 2. ECDH(eph, view) │───shared───►  │ 2. ECDH(view, eph) │
│ 3. derive stealth  │   secret      │ 3. derive stealth  │
│ 4. encrypt amount  │               │ 4. decrypt amount  │
│ 5. publish announce│               │ 5. spend with priv │
└────────────────────┘               └────────────────────┘
```

- **Viewing Key**: Detect and decrypt incoming transfers (cannot spend)
- **Spending Key**: Generate nullifier and claim funds
- **Grumpkin Curve**: ~2,000 constraints (vs ~300,000 for X25519)

### 3. Inline Groth16 Proofs (No Buffer Needed)

Groth16 proofs via Sunspot are ~388 bytes and fit inline in Solana transactions:

```typescript
// Proof is included directly in instruction data
// No buffer upload needed (unlike UltraHonk which required ChadBuffer)
const proof = await generateClaimProofGroth16(inputs);
// proof.proof is ~388 bytes - fits in single TX
```

- **Proof Size**: ~388 bytes (vs ~2-4 KB for UltraHonk)
- **Single Transaction**: No multi-TX buffer uploads
- **Verification**: ~200k CU via BN254 alt_bn128 precompiles

### 4. .zkey Name Registry (SNS-Style)

Human-readable stealth addresses following Solana Name Service patterns:

```typescript
// Send to alice.zkey.sol
const entry = await lookupZkeyName(connection, 'alice');
await sendPrivate(config, myNote, entry.stealthMetaAddress);

// Reverse lookup
const name = await reverseLookupZkeyName(connection, spendingPubKey);
// => "alice"
```

- **Format**: `name.zkey.sol` (1-32 lowercase alphanumeric + underscore)
- **Storage**: Maps name → (spendingPubKey, viewingPubKey)
- **Reverse Lookup**: spendingPubKey → name

### 5. Helius RPC Integration

Enhanced Solana RPC with priority fee estimation:

```typescript
import { getPriorityFeeInstructions, HELIUS_RPC_DEVNET } from '@zvault/sdk';

// Get optimal priority fee for your transaction
const feeIxs = await getPriorityFeeInstructions([programId, userPubkey]);
transaction.add(...feeIxs);
```

### 6. @zvault/sdk - Custom TypeScript SDK

Complete privacy toolkit with React hooks:

```typescript
import { createClient, deposit, claimNote, splitNote, sendPrivate } from '@zvault/sdk';

// 1. Generate deposit credentials
const { taprootAddress, claimLink } = await deposit(100_000n);

// 2. After BTC confirmed, claim zkBTC
const claimed = await claimNote(config, claimLink);

// 3. Split into two notes
const { output1, output2 } = await splitNote(config, note, 60_000n);

// 4. Send via stealth address
await sendPrivate(config, output1, recipientMeta);
```

---

## Quick Demo

```typescript
import { deposit, createClaimLinkFromNote } from '@zvault/sdk';

// Generate a private Bitcoin deposit address
const result = await deposit(50_000n); // 0.0005 BTC

console.log('Send BTC to:', result.taprootAddress);
console.log('Share this link:', result.claimLink);

// Anyone with the link can claim (bearer instrument)
// The claim is unlinkable to the deposit
```

---

## SDK Package

[![npm version](https://img.shields.io/npm/v/@zvault/sdk.svg)](https://www.npmjs.com/package/@zvault/sdk)

```bash
bun add @zvault/sdk
```

**npm**: https://www.npmjs.com/package/@zvault/sdk

---

## Project Structure

```
zVault/
├── contracts/                  # Solana programs
│   ├── programs/zvault/        # Main zVault program (Pinocchio)
│   └── programs/btc-light-client/  # Bitcoin header tracking
├── noir-circuits/              # Zero-knowledge circuits
│   ├── claim/                  # Claim zkBTC from deposit
│   ├── spend_split/            # Split 1 → 2 notes
│   ├── spend_partial_public/   # Partial withdrawal
│   ├── pool_deposit/           # Enter yield pool
│   ├── pool_withdraw/          # Exit pool with yield
│   ├── pool_claim_yield/       # Compound yields
│   ├── proof_of_innocence/     # Compliance proof
│   └── utils/                  # Shared crypto (Grumpkin, Poseidon2)
├── sdk/                        # @zvault/sdk TypeScript client
├── zvault-app/                 # Next.js web interface
├── mobile-app/                 # Expo React Native app
├── backend/                    # Rust API + redemption service
│   └── header-relayer/         # Bitcoin header sync
├── frost_server/               # FROST threshold signing (BTC redemption)
└── docs/                       # Technical documentation
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Technical Deep Dive](./docs/TECHNICAL.md) | Architecture, cryptography, circuits, stealth addresses |
| [SDK Reference](./docs/SDK.md) | TypeScript SDK quick reference |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Bun package manager
- Rust (for backend/contracts)
- Solana CLI

### Frontend

```bash
cd zvault-app
bun install
bun run dev          # Start dev server (port 3000)
```

### SDK

```bash
cd sdk
bun install
bun run build        # Compile TypeScript
bun test             # Run tests
```

### Contracts (Pinocchio)

```bash
cd contracts
cargo build-sbf                      # Build programs
cargo build-sbf --features devnet    # Build with demo instructions
solana program deploy target/deploy/zvault.so  # Deploy to devnet
```

### Noir Circuits

```bash
cd noir-circuits
bun run compile:all  # Compile all circuits
bun run test         # Run circuit tests
```

---

## Live on Devnet

The full privacy flow is verified end-to-end on Solana devnet with real Groth16 proof verification.

### Example Transactions

View these on [Helius XRAY Explorer](https://xray.helius.dev/?network=devnet):

| Step | Operation | Transaction |
|------|-----------|-------------|
| 1 | **Demo Deposit** (10,000 sats) | [`5QzSqKy...`](https://xray.helius.dev/tx/5QzSqKyXEMJFPTjP9qzYQGALVr4avT9KZXgThRJPEekMzYx4UvzqhznKZ7dP1qGpFz4yoGTRLbuD2dePaJuz8tJU?network=devnet) |
| 2 | **Split** (10,000 → 5,000 + 5,000) | [`24xAMPH...`](https://xray.helius.dev/tx/24xAMPHY1Ebfmj1KmUj4hN9JpmAn62xwB3SacnbfH5Tc3Puo79NC36w6AhhdjG26PJaWYbaRzTp5Nus9jXXXDwo9?network=devnet) |
| 3 | **Claim** (5,000 sats → public zkBTC) | [`5wpzusB...`](https://xray.helius.dev/tx/5wpzusBS9H5uvxEt7je3Ex48EjaAr6xr8y1YY79ngSUSH4G1Kg7XiBsAkcbgEeUj4hAkpkamTXdBaKoYaEUpZYPT?network=devnet) |
| 4 | **Spend Partial Public** (3,000 public + 2,000 change) | [`5PrdM6s...`](https://xray.helius.dev/tx/5PrdM6s4ub1jNQG92jk3UJZbjFwtrLfSoqLinHwTzHGSV5UkFRRCXcBG5F9eKarM1wfiomzGCY2ZXNDQTun1UdMK?network=devnet) |

**Results**: 10,000 sats deposited → 8,000 sats withdrawn (5,000 claim + 3,000 partial) → 2,000 sats remain as private change in the commitment tree.

### Privacy Flow

```
Demo Deposit (10,000 sats)
    └→ Commitment A added to on-chain Merkle tree
    └→ 10,000 sats minted to pool vault
         │
    Split (Groth16 proof, ~500k CU, ~1s proving)
    └→ Nullifies A, creates B1 (5,000) + B2 (5,000) in tree
         │
         ├─ Claim B1 (Groth16 proof → 5,000 sats to public ATA)
         │  └→ Transfers zkBTC from vault → user wallet
         │
         └─ Spend Partial Public B2 (Groth16 proof → 3,000 public + 2,000 change)
            └→ 3,000 sats to ATA, 2,000 change commitment C stays in tree
```

### Run It Yourself

```bash
cd sdk
NETWORK=devnet bun run scripts/e2e-integration.ts
```

---

## Program IDs (Devnet)

| Program | Address |
|---------|---------|
| **zVault** | [`3B98dVdvQCLGVavcSz35igiby3ZqVv1SNUBCvDkVGMbq`](https://xray.helius.dev/account/3B98dVdvQCLGVavcSz35igiby3ZqVv1SNUBCvDkVGMbq?network=devnet) |
| **BTC Light Client** | [`S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn`](https://xray.helius.dev/account/S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn?network=devnet) |

### Sunspot Groth16 Verifiers (Per-Circuit)

Each Noir circuit has its own deployed verifier program (compiled with circuit-specific public input count):

| Circuit | NR_INPUTS | Verifier Program |
|---------|-----------|------------------|
| **Claim** | 4 | [`GfF1RnXivZ9ibg1K2QbwAuJ7ayoc1X9aqVU8P97DY1Qr`](https://xray.helius.dev/account/GfF1RnXivZ9ibg1K2QbwAuJ7ayoc1X9aqVU8P97DY1Qr?network=devnet) |
| **Split** | 8 | [`EnpfJTd734e99otMN4pvhDvsT6BBgrYhqWtRLLqGbbdc`](https://xray.helius.dev/account/EnpfJTd734e99otMN4pvhDvsT6BBgrYhqWtRLLqGbbdc?network=devnet) |
| **Spend Partial Public** | 7 | [`3K9sDVgLW2rvVvRyg2QT7yF8caaSbVHgJQfUuXiXbHdd`](https://xray.helius.dev/account/3K9sDVgLW2rvVvRyg2QT7yF8caaSbVHgJQfUuXiXbHdd?network=devnet) |

### Deployed Accounts (Devnet)

| Account | Address | Purpose |
|---------|---------|---------|
| Pool State | `HoSZ1ywBeAEWSNSSzxLNmAs6CodCM4b1Y3rzLGNarffm` | Shielded pool state PDA |
| Commitment Tree | `Exd9HHYjm5MsMpxxCFSKwCUuWBM77BJMA1pnkwHUXBZo` | Merkle tree storage (depth 20) |
| zkBTC Mint | `FPXFZ2eMuLJXnBq1JkppggWvaMCPtENiqT7foodeabgy` | Token-2022 mint |
| Pool Vault | `7GJruCrMQs97M6exQ8KyPcwqRyndQjSq8tk8HsQY1aoP` | Token vault (pool ATA) |
| VK Registry (Claim) | `5yNcv1LFK11VguSkEdRCsCCLB4fMNwAuHden6guknjuA` | Verification key registry |

---

## Privacy Guarantees

| Operation | Amount Visible | Linkable |
|-----------|---------------|----------|
| Deposit BTC | On Bitcoin chain | No (to claim) |
| Claim zkBTC | No | No |
| Split | No | No |
| Stealth Send | No | Recipient only |
| Withdraw BTC | On Bitcoin chain | No (to deposit) |

---

## Cryptography

| Component | Technology |
|-----------|------------|
| Proof System | Groth16 (BN254) via Sunspot |
| Hash Function | Poseidon2 (ZK-friendly) |
| Commitment | `Poseidon2(pub_key_x, amount)` |
| Nullifier | `Poseidon2(priv_key, leaf_index)` |
| Stealth | Grumpkin ECDH (EIP-5564) |
| BTC Deposits | Taproot (BIP-341) |
| Merkle Tree | Depth 20 (~1M leaves) |
| On-Chain Verification | BN254 alt_bn128 precompiles |

---

## Security Notice

> **This is hackathon software.** Not audited for production use.

**Current Status:**
- Testnet/Devnet networks only
- Simplified key management for demo
- No production security audits

**Before Production:**
- Full security audit required
- Proper key management implementation
- Persistent database integration

---

## License

MIT
