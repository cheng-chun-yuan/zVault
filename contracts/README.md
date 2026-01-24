# zVault Contracts

Solana smart contracts for the privacy-preserving BTC to Solana bridge, built with Pinocchio for maximum efficiency.

## 6 Main Functions

The protocol provides 6 user-facing operations:

| Function | Description | On-Chain |
|----------|-------------|----------|
| **deposit** | Generate deposit credentials (taproot address + claim link) | No (SDK only) |
| **withdraw** | Request BTC withdrawal (burn sbBTC) | Yes |
| **privateClaim** | Claim sbBTC tokens with ZK proof | Yes |
| **privateSplit** | Split one commitment into two outputs | Yes |
| **sendLink** | Create global claim link (anyone can claim) | No (SDK only) |
| **sendStealth** | Send to specific recipient via ECDH | Yes |

## Quick Start

### Prerequisites

- Rust 1.70+ (stable)
- Solana CLI installed
- Bun (for SDK and tests)

### Build

```bash
cd contracts

# Build the program
cargo build-sbf --package zVault-pinocchio

# Or with Anchor
anchor build
```

### Test

```bash
# Rust unit tests
cargo +stable test

# TypeScript integration tests
bun run test
```

### Deploy

```bash
anchor deploy
```

## SDK Usage

```typescript
import { createClient } from '@zVault/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');
const client = createClient(connection, 'devnet');
client.setPayer(myKeypair);

// 1. DEPOSIT: Generate credentials
const deposit = await client.deposit(100_000n); // 0.001 BTC
console.log('Send BTC to:', deposit.taprootAddress);
console.log('Save this link:', deposit.claimLink);

// 2. CLAIM: After BTC is verified on-chain
const result = await client.privateClaim(deposit.claimLink);

// 3. SPLIT: Divide into two outputs
const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);

// 4. SEND: Via link or stealth
const link = client.sendLink(output1); // Anyone can claim
await client.sendStealth(output2, recipientPubKey); // Only recipient can claim
```

## Program Instructions

### Core Instructions (Simplified)

| Discriminator | Instruction | Description |
|---------------|-------------|-------------|
| 0 | INITIALIZE | Pool setup (admin only) |
| 4 | SPLIT_COMMITMENT | Split 1 commitment into 2 (private_split) |
| 5 | REQUEST_REDEMPTION | Burn sbBTC, request BTC (withdraw) |
| 6 | COMPLETE_REDEMPTION | Relayer marks withdrawal complete |
| 7 | SET_PAUSED | Pause/unpause pool |
| 8 | VERIFY_DEPOSIT | SPV verify BTC deposit (deposit) |
| 9 | CLAIM | Claim sbBTC with ZK proof (private_claim) |
| 10 | INIT_COMMITMENT_TREE | Initialize Merkle tree |
| 11 | ADD_DEMO_COMMITMENT | Add demo commitment (testing) |
| 12 | ANNOUNCE_STEALTH | Create stealth announcement (send_stealth) |

## Account Structures

### PoolState
Main pool configuration and statistics.

### CommitmentTree
Merkle tree for commitment storage (10 levels, 1024 leaves).

### DepositRecord
Individual deposit record: `(commitment, amount, leaf_index)`.

### NullifierRecord
Spent nullifier tracking for double-spend prevention.

### RedemptionRequest
Pending BTC withdrawal request.

### StealthAnnouncement
On-chain stealth address announcement for ECDH-based transfers.

## Project Structure

```
contracts/
├── Anchor.toml
├── programs/
│   ├── zVault-pinocchio/     # Main optimized program
│   │   └── src/
│   │       ├── lib.rs               # Program entry point
│   │       ├── constants.rs         # Constants
│   │       ├── error.rs             # Error types
│   │       ├── state/               # Account structures
│   │       │   ├── pool.rs
│   │       │   ├── commitment_tree.rs
│   │       │   ├── nullifier.rs
│   │       │   ├── redemption.rs
│   │       │   └── stealth_announcement.rs
│   │       ├── instructions/        # Instruction handlers
│   │       │   ├── initialize.rs
│   │       │   ├── verify_deposit.rs
│   │       │   ├── claim.rs
│   │       │   ├── split_commitment.rs
│   │       │   ├── request_redemption.rs
│   │       │   ├── complete_redemption.rs
│   │       │   └── announce_stealth.rs
│   │       └── utils/
│   └── btc-light-client/            # Bitcoin SPV client
├── sdk/                             # TypeScript SDK
│   └── src/
│       ├── api.ts                   # 6 main functions
│       ├── zVault.ts         # SDK client
│       ├── note.ts                  # Note utilities
│       ├── proof.ts                 # ZK proof generation
│       ├── stealth.ts               # Stealth address utilities
│       └── index.ts                 # Exports
└── noir-circuits/                   # Noir ZK circuits
    ├── claim/
    ├── split/
    ├── partial_withdraw/
    └── helpers/
```

## Privacy Model

- **commitment**: `Poseidon2(Poseidon2(nullifier, secret), amount)`
- **nullifier_hash**: `Poseidon2(nullifier)` - revealed at spend time
- Without knowing `secret`, you cannot link deposit → claim
- Stealth addresses use X25519 ECDH for recipient privacy

## Security

**WARNING: This is a proof-of-concept for hackathon demonstration.**

- Uses Noir UltraHonk proofs (not audited)
- Simplified SPV verification
- No production security audits

For production:
- Full security audit required
- Formal verification of ZK circuits
- Multi-party custody for BTC reserves
