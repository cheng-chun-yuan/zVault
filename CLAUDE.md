# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

zVault is a privacy-preserving Bitcoin-to-Solana bridge using Zero-Knowledge Proofs. Users deposit BTC to receive private sbBTC tokens that can be transferred using stealth addresses and ZK proofs (Groth16 on BN254).

**Key Technologies**: Pinocchio (Solana), Noir circuits (ZK), Taproot (BTC deposits), X25519 ECDH (stealth addresses)

## Commands

### Frontend (Next.js) - `/frontend`
```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Production build
bun run lint         # ESLint
bun run test         # Vitest tests
```

### Backend (Rust) - `/backend`
```bash
cargo run --bin sbbtc-api      # Start API server (port 8080)
cargo run --bin redemption     # Start redemption service
cargo test                     # Run tests
```

### Contracts (Pinocchio + Anchor) - `/contracts`
```bash
anchor build         # Build programs
anchor deploy        # Deploy to devnet
npm run test         # TypeScript tests (ts-mocha, 120s timeout)
```

### SDK - `/contracts/sdk`
```bash
bun run build        # Compile TypeScript
bun test             # Run tests
```

### Noir Circuits - `/noir-circuits`
```bash
bun run compile:all            # Compile all circuits
bun run compile:claim          # Single circuit
bun run test                   # Noir + JS tests
```

### Header Relayer - `/backend/header-relayer`
```bash
bun run init         # Initialize light client (first time)
bun run start        # Start header relay service
```

## Architecture

```
BTC Deposit → Taproot Address (commitment-derived) → SPV Verification → On-chain Commitment
                                                                              ↓
Claim: Provide nullifier+secret → Generate Groth16 ZK Proof → Verify → Mint sbBTC
                                                                              ↓
Redeem: Burn sbBTC → Backend signs BTC transaction → Return BTC to user
```

### Main Components

| Directory | Purpose | Language |
|-----------|---------|----------|
| `contracts/programs/zVault-pinocchio` | Main Solana program | Rust (Pinocchio) |
| `contracts/programs/btc-light-client` | Bitcoin header tracking | Rust |
| `contracts/sdk` | TypeScript SDK (@zvault/sdk) | TypeScript |
| `backend` | API server + redemption service | Rust |
| `backend/header-relayer` | Bitcoin header sync | Node.js |
| `frontend` | Web interface | Next.js + React |
| `noir-circuits` | ZK circuits (claim, transfer, split, withdraw) | Noir |

### Program Instructions (Pinocchio)

| Discriminator | Name | Purpose |
|---|---|---|
| 8 | VERIFY_DEPOSIT | Record BTC deposit with SPV proof |
| 9 | CLAIM | Mint sbBTC with ZK proof (~95k CU) |
| 4 | SPLIT_COMMITMENT | Split 1 note into 2 notes (~100k CU) |
| 5 | REQUEST_REDEMPTION | Burn sbBTC, request BTC withdrawal |
| 12 | ANNOUNCE_STEALTH | Send via stealth address |

### Cryptography Flow

1. **Commitment**: `SHA256(nullifier || secret)` bound to Taproot address
2. **ZK Proof**: Groth16 via Noir circuits, verified on-chain via `alt_bn128` syscalls
3. **Stealth**: X25519 ECDH derives shared secret for recipient-specific notes

## Key Program IDs

- **zVault (devnet)**: `CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR`
- **BTC Light Client**: `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG`

## SDK Usage

The SDK (`contracts/sdk`) provides:
- `generateNote(amount)` - Create note with nullifier/secret
- `deriveTaprootAddress(commitment)` - Get BTC deposit address
- `createClaimLink(note)` - Shareable claim URL
- `createStealthDeposit()` - ECDH-based stealth sends
- Watcher system for real-time deposit tracking

## Development Notes

- **Package Manager**: Always use `bun` instead of `npm`
- **Network**: Solana devnet + Bitcoin testnet
- **Poseidon Hashing**: Done inside Noir circuits, not in SDK
- **Token**: sbBTC uses Token-2022 program
