# zVault System Architecture

This document provides a comprehensive overview of the zVault system architecture, a privacy-preserving Bitcoin-to-Solana bridge using Zero-Knowledge Proofs.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Component Diagram](#component-diagram)
4. [Privacy Model](#privacy-model)
5. [Cryptography Stack](#cryptography-stack)
6. [Data Flow](#data-flow)
7. [Network Configuration](#network-configuration)
8. [Security Model](#security-model)

---

## Overview

zVault enables privacy-preserving Bitcoin deposits into a Solana-based shielded pool. Users deposit BTC and receive shielded commitments that can be transferred privately using ZK proofs, then withdrawn back to BTC.

### Key Properties

| Property | Description |
|----------|-------------|
| **Privacy** | Amounts hidden in commitments; unlinkable deposits/claims |
| **Security** | Groth16 ZK proofs verified on-chain via alt_bn128 syscalls |
| **Scalability** | Merkle tree with 2^20 (~1M) leaves capacity |
| **Interoperability** | BTC Taproot deposits, Solana Token-2022 |

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BITCOIN LAYER                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────────┐  │
│  │   Taproot   │    │   Block     │    │        SPV Proofs               │  │
│  │   Deposits  │───►│   Headers   │───►│  (Merkle proofs for deposits)   │  │
│  └─────────────┘    └─────────────┘    └─────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────-┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SOLANA LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         zVault Program (Pinocchio)                   │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │ BTC Light   │  │ Commitment  │  │  Nullifier  │  │  Name      │  │    │
│  │  │ Client      │  │ Tree        │  │  Registry   │  │  Registry  │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │    │
│  │  │ Pool State  │  │ Stealth     │  │ Redemption  │  │  Groth16   │  │    │
│  │  │             │  │ Announce    │  │ Requests    │  │  Verifier  │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌────────────┐    │
│  │  Frontend   │    │   Mobile    │    │    SDK      │    │  Backend   │    │
│  │  (Next.js)  │    │   (Expo)    │    │(TypeScript) │    │  (Rust)    │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    └────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Diagram

### Directory Structure

| Directory | Purpose | Technology |
|-----------|---------|------------|
| `contracts/programs/zvault` | Main Solana program | Rust (Pinocchio) |
| `contracts/programs/btc-light-client` | Bitcoin header tracking | Rust |
| `sdk` | TypeScript SDK (@zvault/sdk) | TypeScript |
| `backend` | API server + redemption service | Rust (Axum) |
| `backend/header-relayer` | Bitcoin header sync | Node.js |
| `frontend` | Web interface | Next.js + React |
| `mobile-app` | Mobile app | Expo + React Native |
| `noir-circuits` | ZK circuits | Noir (Groth16) |

### Component Responsibilities

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            SDK (@zvault/sdk)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   deposit()  │  │privateClaim()│  │privateSplit()│  │  withdraw()  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  sendLink()  │  │sendStealth() │  │ Key Deriv.   │  │  Proof Gen.  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │  Frontend   │  │  Mobile App │  │   Backend   │
            │  (Next.js)  │  │   (Expo)    │  │   (Rust)    │
            └─────────────┘  └─────────────┘  └─────────────┘
                    │                │                │
                    └────────────────┼────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │      Solana (zVault Program)    │
                    └─────────────────────────────────┘
```

---

## Privacy Model

### Shielded Pool Architecture

zVault implements a UTXO-based shielded pool where all balances exist as cryptographic commitments:

```
commitment = Poseidon2(nullifier, secret, amount)
```

| Operation | Amount Visible? | Linkable? |
|-----------|-----------------|-----------|
| Deposit BTC | On-chain (Bitcoin) | To commitment: No |
| Claim (mint to commitment) | No | No |
| Split (1→2 outputs) | No | No |
| Transfer (1→1 output) | No | No |
| Stealth Send | No | Recipient only |
| Withdraw to BTC | Yes (unavoidable) | From commitment: No |

### Unlinkability

- **Deposits**: BTC deposit creates commitment; claim uses ZK proof
- **Nullifier Hash**: Prevents double-spend without revealing nullifier
- **Stealth Addresses**: ECDH-based one-time addresses for recipients

---

## Cryptography Stack

### Hash Functions

| Function | Use Case | Field |
|----------|----------|-------|
| Poseidon2 | Commitments, nullifiers, Merkle tree | BN254 scalar field |
| SHA256 | Bitcoin SPV proofs | 256-bit |
| Tagged Hash | Taproot key derivation | 256-bit |

### Curves

| Curve | Use Case |
|-------|----------|
| BN254 | Groth16 pairing-based proofs |
| Grumpkin | In-circuit ECDH (embedded curve) |
| secp256k1 | Bitcoin Taproot signatures |

### Zero-Knowledge Proofs

- **Proof System**: Groth16 (constant-size proofs, fast verification)
- **Circuit Language**: Noir
- **Backend**: UltraHonk (proof generation), alt_bn128 (on-chain verification)
- **Verification Cost**: ~95,000 CU per proof on Solana

### Merkle Tree

- **Depth**: 20 levels (~1M leaves)
- **Hash**: Poseidon2 (BN254 field)
- **Zero Value**: Poseidon2(0)

---

## Data Flow

### 1. Deposit Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  User    │    │  Bitcoin │    │  Header  │    │  Solana  │
│  Wallet  │    │  Network │    │  Relayer │    │  Program │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     │ 1. Generate   │               │               │
     │ nullifier,    │               │               │
     │ secret        │               │               │
     │               │               │               │
     │ 2. Compute    │               │               │
     │ commitment    │               │               │
     │               │               │               │
     │ 3. Derive     │               │               │
     │ taproot addr  │               │               │
     │               │               │               │
     │ 4. Send BTC ─────────────────►│               │
     │               │               │               │
     │               │ 5. Block      │               │
     │               │ confirmed ────►│               │
     │               │               │               │
     │               │               │ 6. Submit     │
     │               │               │ headers ──────►│
     │               │               │               │
     │ 7. Submit SPV proof + commitment ─────────────►│
     │               │               │               │
     │               │               │ 8. Verify SPV │
     │               │               │ + add to tree │
     └───────────────┴───────────────┴───────────────┘
```

### 2. Claim Flow (ZK Proof)

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│  User    │    │  WASM    │    │  Solana  │
│  Client  │    │  Prover  │    │  Program │
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     │ 1. Load note  │               │
     │ (nullifier,   │               │
     │  secret, amt) │               │
     │               │               │
     │ 2. Get Merkle │               │
     │ proof from    │               │
     │ program       │               │
     │               │               │
     │ 3. Generate ──►│               │
     │ ZK proof      │               │
     │               │               │
     │◄──4. Proof ───│               │
     │               │               │
     │ 5. Submit claim tx ───────────►│
     │               │               │
     │               │ 6. Verify proof│
     │               │ (alt_bn128)    │
     │               │               │
     │               │ 7. Check       │
     │               │ nullifier      │
     │               │               │
     │               │ 8. Mint to     │
     │               │ new commitment │
     └───────────────┴───────────────┘
```

### 3. Split Flow

```
Input Commitment (100 sats)
        │
        ▼
   ┌─────────────┐
   │  ZK Proof   │
   │  (Split)    │
   └─────────────┘
        │
   ┌────┴────┐
   ▼         ▼
Output 1   Output 2
(60 sats)  (40 sats)
```

### 4. Stealth Send Flow

```
Sender                           Recipient
  │                                  │
  │ 1. Get recipient's              │
  │    stealth meta-address ◄───────│
  │                                  │
  │ 2. Generate ephemeral key        │
  │                                  │
  │ 3. ECDH shared secret            │
  │                                  │
  │ 4. Derive one-time address       │
  │                                  │
  │ 5. Submit stealth announcement ──►
  │    (commitment, ephemeral pub)   │
  │                                  │
  │                           6. Scan announcements
  │                                  │
  │                           7. Derive secrets
  │                                  │
  │                           8. Claim commitment
```

---

## Network Configuration

### Current Deployment

| Component | Network | Address/URL |
|-----------|---------|-------------|
| zVault Program | Solana Devnet | `CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR` |
| BTC Light Client | Solana Devnet | `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG` |
| Bitcoin | Testnet3 | Standard testnet |
| Backend API | Local/Cloud | `http://localhost:8080` |

### Environment Variables

```env
# Solana
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
ZVAULT_PROGRAM_ID=CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR

# Bitcoin
BITCOIN_NETWORK=testnet
ESPLORA_URL=https://blockstream.info/testnet/api

# Backend
ZKBTC_API_URL=http://localhost:8080
```

---

## Security Model

### Trust Assumptions

| Component | Trust Level | Notes |
|-----------|-------------|-------|
| Solana Runtime | High | Executes ZK verification |
| ZK Proofs | Trustless | Math guarantees |
| Header Relayer | Low | Only submits public data |
| Backend (Redemption) | Medium | Holds BTC for withdrawals |
| User Client | Local | Holds secrets locally |

### Threat Model

1. **Double-Spend Prevention**: Nullifier hash recorded on-chain
2. **Fake Deposits**: SPV proof verification required
3. **Amount Manipulation**: ZK proof enforces conservation
4. **Timing Analysis**: All claims look identical
5. **Key Compromise**: User secrets never leave client

### Audit Status

> **WARNING**: This is a proof-of-concept for hackathon demonstration.
> No production security audits have been performed.

---

## Related Documentation

- [CONTRACTS.md](./CONTRACTS.md) - Solana program details
- [SDK.md](./SDK.md) - TypeScript SDK reference
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
- [API.md](./API.md) - Backend API reference
