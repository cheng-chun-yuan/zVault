# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

zVault is a privacy-preserving Bitcoin-to-Solana bridge using Zero-Knowledge Proofs. Users deposit BTC to receive private zkBTC tokens that can be transferred using stealth addresses and ZK proofs (Groth16 via Sunspot).

**Key Technologies**: Pinocchio (Solana), Noir circuits (Groth16 proofs via Sunspot), Taproot (BTC deposits), Grumpkin ECDH (stealth addresses), FROST (threshold signing)

## Commands

### Frontend (Next.js) - `/zvault-app`
```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Production build (builds SDK first)
bun run lint         # ESLint
bun run test         # Vitest tests
```

### SDK - `/sdk`
```bash
bun run build        # Compile TypeScript
bun test             # Run tests
bun run e2e          # End-to-end tests (localnet)
bun run e2e:devnet   # E2E tests on devnet
```

### Contracts (Pinocchio) - `/contracts`
```bash
cargo build-sbf      # Build programs
solana program deploy target/deploy/zvault.so  # Deploy to devnet
bun run test         # TypeScript tests
```

### FROST Server - `/frost_server`
```bash
cargo run --bin frost-server       # Start FROST signing server
cargo run --bin generate_deposit_address  # Generate Taproot address
cargo run --bin spend_utxo         # Spend UTXO with threshold sig
cargo test                         # Run tests
```

### Backend (Rust) - `/backend`
```bash
cargo run                # Start API server
cargo test               # Run tests
```

### Mobile App (Expo) - `/mobile-app`
```bash
bun run start        # Start Expo dev server
bun run ios          # Run on iOS simulator
bun run android      # Run on Android emulator
```

### Noir Circuits - `/noir-circuits`
```bash
bun run compile:all       # Compile all 6 circuits
bun run compile:claim     # Single circuit
bun run test              # Noir + JS tests
bun run prove             # Generate proof
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
Claim: Provide nullifier+secret → Generate Groth16 ZK Proof (Sunspot) → Verify → Mint zkBTC
                                                                              ↓
Redeem: Burn zkBTC → FROST threshold signature → Return BTC to user
```

### Main Components

| Directory | Purpose | Language |
|-----------|---------|----------|
| `contracts/programs/zvault` | Main Solana program | Rust (Pinocchio) |
| `contracts/programs/btc-light-client` | Bitcoin header tracking | Rust |
| `contracts/programs/sunspot-verifier` | Groth16 proof verification (Sunspot) | Rust |
| `sdk` | TypeScript SDK (@zvault/sdk) | TypeScript |
| `frost_server` | FROST threshold signing for BTC | Rust |
| `backend` | API server + header relayer | Rust + Node.js |
| `zvault-app` | Web interface | Next.js + React |
| `mobile-app` | Mobile app | Expo + React Native |
| `noir-circuits` | ZK circuits (6 circuits) | Noir |

### Noir Circuits

| Circuit | Purpose |
|---------|---------|
| `claim` | Claim deposited BTC as zkBTC |
| `spend_split` | Split 1 note into 2 notes |
| `spend_partial_public` | Partial public spend |
| `pool_deposit` | Deposit into yield pool |
| `pool_withdraw` | Withdraw from yield pool |
| `pool_claim_yield` | Claim yield rewards |

### Key Privacy Features

| Feature | Description |
|---------|-------------|
| **Client-Side Proving** | ZK proofs generated via Sunspot CLI - no trusted backend required |
| **Groth16 via Sunspot** | Compact ~388 byte proofs fit inline in transactions |
| **BN254 Precompiles** | On-chain verification via Solana alt_bn128 syscalls (~200k CU) |
| **Viewing/Spending Key Separation** | Share viewing key for audits without compromising spend ability |
| **Stealth Addresses** | Unlinkable one-time addresses via DKSAP (EIP-5564) |
| **.zkey Names** | Human-readable stealth addresses (SNS-style registry) |

### Key Model

```
Spending Key (private) ─► Can spend funds, must keep secret
       │
       └─► Viewing Key (derived) ─► Can view balances/history, safe to share with auditors
```

- **Spending Key**: Full control - generate nullifiers, sign transactions
- **Viewing Key**: Read-only access - scan for incoming payments, view transaction history
- Use case: Share viewing key with accountants, regulators, or compliance without risk

### Cryptography

1. **Commitment**: Poseidon hash (in-circuit) bound to Taproot address
2. **ZK Proof**: Groth16 via Sunspot (Noir circuits compiled to gnark)
3. **Stealth**: Grumpkin ECDH (~2k constraints vs ~300k for X25519)
4. **Redemption**: FROST threshold signatures (secp256k1-tr)

### Why Groth16 via Sunspot

| Aspect | Groth16 (Sunspot) | UltraHonk |
|--------|-------------------|-----------|
| Proof Size | ~388 bytes (inline) | ~2-4 KB (needs buffer) |
| Verifier Cost | ~200k CU (BN254 precompiles) | Higher on-chain |
| TX Complexity | Single transaction | Multi-TX with ChadBuffer |
| Prover | Sunspot CLI (gnark) | bb.js WASM |

We chose Groth16 for compact proof sizes that fit inline in Solana transactions.

## Key Program IDs

- **zVault (devnet)**: `zKeyrLmpT8W9o8iRvhizuSihLAFLhfAGBvfM638Pbw8`
- **BTC Light Client**: `S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn`

## SDK Usage (@zvault/sdk)

```typescript
import { generateNote, generateClaimProofGroth16, createStealthDeposit } from '@zvault/sdk';

// Create note with nullifier/secret
const note = generateNote(amount);

// Generate Groth16 proof for claim (via Sunspot)
const proof = await generateClaimProofGroth16({
  privKey: note.privKey,
  pubKeyX: note.pubKeyX,
  amount: note.amount,
  leafIndex: note.leafIndex,
  merkleRoot,
  merkleProof,
  recipient,
});

// ECDH-based stealth sends
const stealth = createStealthDeposit(recipientPubkey, amount);
```

## Documentation

- `docs/TECHNICAL.md` - Full technical documentation
- `docs/SDK.md` - SDK API reference

## Development Notes

- **Package Manager**: Always use `bun` instead of `npm`
- **Network**: Solana devnet + Bitcoin testnet
- **Poseidon Hashing**: Done inside Noir circuits (Grumpkin curve)
- **Token**: zkBTC uses Token-2022 program
- **Solana SDK**: Uses `@solana/kit` (new framework-kit)

## Testing: Localnet vs Devnet

### Poseidon Syscall Limitation

**Important:** The Solana test validator (`solana-test-validator`) does NOT support the Poseidon syscall (`sol_poseidon`).

| Environment | Merkle Tree Hash | ZK Proof Compatibility |
|-------------|------------------|------------------------|
| **Localnet** | SHA256 (fallback) | ❌ Incompatible with Noir circuits |
| **Devnet/Mainnet** | Poseidon (syscall) | ✅ Compatible with Noir circuits |

### Impact on Testing

- **Localnet**: Unit tests, instruction building, and mock proofs work fine. Real ZK proof tests will **fail** because the Noir circuit uses Poseidon but on-chain tree uses SHA256.
- **Devnet**: Full E2E testing with real ZK proofs works correctly.

### Recommended Testing Strategy

```bash
# Fast iteration (no real proofs) - use localnet
solana-test-validator --reset
NETWORK=localnet bun test test/e2e/*.test.ts

# Full E2E with real proofs - use devnet
NETWORK=devnet bun run e2e:devnet
```

### SDK Localnet Mode

The SDK automatically switches to SHA256 for Merkle tree operations when on localnet to match on-chain behavior:

```typescript
import { useLocalnetMode, isLocalnetMode } from "@zvault/sdk";

// Check current mode
if (isLocalnetMode()) {
  console.log("Using SHA256 (localnet mode)");
}
```

See `sdk/docs/E2E_TESTING.md` for detailed testing guide.
