# zVault - Private BTC on Solana

Privacy-preserving Bitcoin deposits and withdrawals on Solana using Zero-Knowledge Proofs.

```
BTC → Taproot Deposit → SPV Verify → Shielded Pool → ZK Transfers → Withdraw BTC
                                          │
                         Amounts hidden in commitments
                         Unlinkable deposits/claims
                         Stealth address transfers
```

---

## Overview

zVault enables Bitcoin holders to access Solana with full transaction privacy. Deposits create cryptographic commitments that can be claimed, split, and transferred privately using ZK proofs.

### Key Features

- **Private Deposits**: BTC deposits unlinkable to claims via ZK proofs
- **Shielded Transfers**: Split and transfer without revealing amounts
- **Stealth Addresses**: One-time addresses via ECDH (Grumpkin curve)
- **Claim Links**: Bearer instrument links for easy sharing
- **Name Registry**: Human-readable `.zkey` addresses
- **Proof of Innocence**: Optional compliance without de-anonymization

### Privacy Guarantees

| Operation | Amount Visible | Linkable |
|-----------|---------------|----------|
| Deposit BTC | On Bitcoin chain | No (to claim) |
| Claim zBTC | No | No |
| Split | No | No |
| Stealth Send | No | Recipient only |
| Withdraw BTC | On Bitcoin chain | No (to deposit) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BITCOIN LAYER                                   │
│     Taproot Deposits  →  SPV Verification  →  Commitment Recording          │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SOLANA LAYER                                    │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    zVault Program (Pinocchio)                          │ │
│  │  Commitment Tree │ Nullifier Registry │ Stealth Announcements │ Names │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│        Frontend (Next.js)  │  Mobile (Expo)  │  SDK  │  Backend (Rust)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Directory | Technology | Purpose |
|-----------|-----------|------------|---------|
| Contracts | `contracts/programs/zvault` | Rust (Pinocchio) | Main Solana program |
| BTC Light Client | `contracts/programs/btc-light-client` | Rust | Bitcoin header tracking |
| SDK | `sdk` | TypeScript | Client library (@zvault/sdk) |
| Frontend | `frontend` | Next.js | Web interface |
| Mobile | `mobile-app` | Expo/React Native | Mobile wallet |
| Backend | `backend` | Rust (Axum) | Redemption & stealth API |
| Header Relayer | `backend/header-relayer` | Node.js | Bitcoin header sync |
| ZK Circuits | `noir-circuits` | Noir | Privacy proofs |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Bun package manager
- Rust (for backend)
- Solana CLI (for contracts)

### Frontend (Next.js)

```bash
cd frontend
bun install
bun run dev          # Start dev server (port 3000)
```

### Backend (Rust)

```bash
cd backend
cargo run --bin zkbtc-api      # Start API server (port 8080)
```

### Contracts (Solana)

```bash
cd contracts
anchor build         # Build programs
anchor deploy        # Deploy to devnet
```

### SDK

```bash
cd sdk
bun install
bun run build        # Compile TypeScript
```

### Mobile App (Expo)

```bash
cd mobile-app
bun install
bun run start        # Start Expo dev server
bun run ios          # Run on iOS simulator
```

### Noir Circuits

```bash
cd noir-circuits
bun run compile:all  # Compile all circuits
bun run test         # Run circuit tests
```

---

## SDK Usage

```typescript
import { createClient } from '@zvault/sdk';
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');
const client = createClient(connection);
client.setPayer(myKeypair);

// 1. DEPOSIT: Generate credentials
const deposit = await client.deposit(100_000n); // 0.001 BTC
console.log('Send BTC to:', deposit.taprootAddress);
console.log('Save claim link:', deposit.claimLink);

// 2. CLAIM: After BTC confirmed
const result = await client.privateClaim(deposit.claimLink);

// 3. SPLIT: Divide into two outputs
const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);

// 4. SEND: Via link or stealth
const link = client.sendLink(output1.note);
await client.sendStealth(recipientMeta, output2.note.amount, leafIndex);

// 5. WITHDRAW: Back to BTC
const withdraw = await client.withdraw(output1.note, 'tb1qxyz...');
```

---

## Program IDs

| Program | Network | Address |
|---------|---------|---------|
| zVault | Devnet | `CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR` |
| BTC Light Client | Devnet | `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG` |

---

## Cryptography

| Component | Technology |
|-----------|------------|
| Proof System | Groth16 on BN254 |
| Hash Function | Poseidon2 (ZK-friendly) |
| Commitment | `Poseidon2(Poseidon2(nullifier, secret), amount)` |
| Stealth | Grumpkin ECDH |
| BTC Deposits | Taproot (BIP-341) |
| Merkle Tree | Depth 20 (~1M leaves) |

---

## Documentation

Comprehensive documentation is available in the [`docs/`](./docs/) folder:

| Document | Description |
|----------|-------------|
| [Architecture](./docs/ARCHITECTURE.md) | System design and data flows |
| [Contracts](./docs/CONTRACTS.md) | Solana program reference |
| [SDK](./docs/SDK.md) | TypeScript SDK guide |
| [API](./docs/API.md) | Backend REST API |
| [Mobile](./docs/MOBILE.md) | Mobile app documentation |
| [ZK Proofs](./docs/ZK_PROOFS.md) | Circuit documentation |
| [PRD](./docs/PRD.md) | Product requirements |

---

## API Endpoints

### Redemption API

```
POST /api/redeem            - Submit BTC withdrawal request
GET  /api/withdrawal/:id    - Check withdrawal status
GET  /api/health            - Health check
```

### Stealth API

```
POST /api/stealth/prepare   - Prepare stealth deposit
GET  /api/stealth/status/:id - Get stealth deposit status
POST /api/stealth/announce  - Manual announcement
```

---

## Configuration

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

## Development

### Running Tests

```bash
# SDK tests
cd sdk && bun test

# Contract tests
cd contracts && bun run test

# Frontend tests
cd frontend && bun run test

# Circuit tests
cd noir-circuits && bun run test

# Backend tests
cd backend && cargo test
```

### Build for Production

```bash
# Frontend
cd frontend && bun run build

# SDK
cd sdk && bun run build

# Backend
cd backend && cargo build --release
```

---

## Security

> **WARNING**: This is a proof-of-concept for hackathon demonstration.

**Current Limitations**:
- Uses testnet/devnet networks only
- No production security audits performed
- Simplified key management for demo
- In-memory storage (data lost on restart)

**Before Production**:
- Full security audit required
- Proper key management implementation
- Persistent database integration
- Rate limiting and DDoS protection

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

See documentation for coding standards and architecture guidelines.

---

## License

MIT
