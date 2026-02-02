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
| **ZK Circuits** | Noir + UltraHonk | 8 specialized privacy circuits |
| **On-Chain Verifier** | BN254 alt_bn128 syscalls | Client-side proof generation |
| **Smart Contracts** | Pinocchio (Solana) | Zero-copy, ~95k CU verification |
| **Bitcoin Integration** | Taproot + SPV | Permissionless light client |
| **Data Publishing** | ChadBuffer | Large tx & proof upload on-chain |
| **Name Service** | .zkey.sol (SNS-style) | Human-readable stealth addresses |
| **Stealth Addresses** | EIP-5564/DKSAP + Grumpkin | ~2k constraint ECDH (vs 300k X25519) |
| **RPC Infrastructure** | Helius | Priority fee estimation |
| **Client SDK** | @zvault/sdk (custom) | Full privacy toolkit |
| **Frontend** | Next.js 14 | Server components, React hooks |
| **Mobile** | Expo + React Native | Cross-platform wallet |
| **Backend** | Rust (Axum) | FROST threshold signing |

---

## Key Innovations

### 1. Noir ZK Circuits (8 Specialized Circuits)

Built on Aztec's Noir language with UltraHonk proofs for efficient client-side proving:

| Circuit | Purpose | Key Constraints |
|---------|---------|-----------------|
| `claim` | Mint zkBTC from BTC deposit | Merkle proof, nullifier, amount match |
| `spend_split` | Split 1 note → 2 notes | Amount conservation, unique recipients |
| `spend_partial_public` | Partial withdrawal | Public + change outputs |
| `pool_deposit` | Enter yield pool | Unified → Pool commitment |
| `pool_withdraw` | Exit with yield | Yield calculation in-circuit |
| `pool_claim_yield` | Compound yields | Re-stake with epoch reset |
| `proof_of_innocence` | Regulatory compliance | Dual Merkle tree verification |

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

### 3. ChadBuffer Integration

On-chain large data publishing for Bitcoin transactions and ZK proofs:

```typescript
// Upload Bitcoin transaction for SPV verification
const bufferAddress = await uploadTransactionToBuffer(rpc, payer, rawBtcTx);

// Upload large UltraHonk proof (>900 bytes)
const { bufferAddress, usedBuffer } = await uploadProofToBuffer(rpc, payer, proofBytes);
```

- **Program ID**: `C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF`
- **Chunked Uploads**: Handles data larger than Solana tx limits
- **Rent Reclaimable**: Close buffer to recover lamports

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

### Contracts

```bash
cd contracts
anchor build         # Build programs
anchor deploy        # Deploy to devnet
```

### Noir Circuits

```bash
cd noir-circuits
bun run compile:all  # Compile all circuits
bun run test         # Run circuit tests
```

---

## Program IDs

| Program | Network | Address |
|---------|---------|---------|
| zVault | Devnet | `zKeyrLmpT8W9o8iRvhizuSihLAFLhfAGBvfM638Pbw8` |
| BTC Light Client | Devnet | `S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn` |
| UltraHonk Verifier | Devnet | `5uAoTLSexeKKLU3ZXniWFE2CsCWGPzMiYPpKiywCGqsd` |
| ChadBuffer | Devnet | `C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF` |

### Deployed Accounts (Devnet)

| Account | Address | Purpose |
|---------|---------|---------|
| Pool State | `Bq8FTMnpyspkygAr3yN6tU8dzDhD5Ag19oVN3xXwy3gg` | Shielded pool state |
| Commitment Tree | `M4hjajsFJU98xdx6ZtLuzgVPUKP6TTKXjfFpBiNE272` | Merkle tree storage |
| zkBTC Mint | `AUuocP2KQVkUnt8pFtBx5CHpDargEPQNeq29hwtQoxFY` | Token-2022 mint |
| Pool Vault | `5VCCporx5wvF2y8W97o55r1FiEb4pxp6RLRJMm3wQ1Ck` | Token vault |

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
| Proof System | UltraHonk (BN254) |
| Hash Function | Poseidon2 (ZK-friendly) |
| Commitment | `Poseidon2(pub_key_x, amount)` |
| Nullifier | `Poseidon2(priv_key, leaf_index)` |
| Stealth | Grumpkin ECDH (EIP-5564) |
| BTC Deposits | Taproot (BIP-341) |
| Merkle Tree | Depth 20 (~1M leaves) |

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
