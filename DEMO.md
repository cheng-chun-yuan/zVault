# CZBTC Demo - Full Setup Guide

## Project Components

| Component | Location | Port | Description |
|-----------|----------|------|-------------|
| **Contracts** | `/contracts` | - | Solana smart contracts (deployed to devnet) |
| **Backend API** | `/backend` | 8080 | Rust API server for deposits/claims |
| **Header Relayer** | `/backend/header-relayer` | - | Bitcoin header sync service |
| **Frontend** | `/frontend` | 3000 | Next.js web interface |

---

## Quick Start (4 Terminals)

### Terminal 1: Backend API
```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/backend
cargo run --bin czbtc-api
```

### Terminal 2: Header Relayer
```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/backend/header-relayer
bun run init    # First time only
bun run start
```

### Terminal 3: Frontend
```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/frontend
bun install     # First time only
bun run dev
```

### Terminal 4: Open Browser
```bash
open http://localhost:3000
```

---

## Detailed Setup

### 1. Contracts (Already Deployed)

The Solana contracts are deployed to **devnet**:
- Program ID: `4k6UTCS9QBBsJigJoikqEqfsePUpfYh51v9S4yFTYSB4`

To redeploy (optional):
```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/contracts
anchor build
anchor deploy --provider.cluster devnet
```

### 2. Backend API Server

```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/backend

# Build
cargo build --release

# Run
cargo run --bin czbtc-api
```

API endpoints available at `http://localhost:8080`:
- `GET /api/health` - Health check
- `POST /api/deposit/prepare` - Get taproot address
- `POST /api/claim` - Claim with nullifier + secret

### 3. Header Relayer

```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/backend/header-relayer

# Install dependencies
bun install

# Initialize light client (first time only)
bun run init

# Start relayer
bun run start
```

The relayer will:
- Poll Bitcoin testnet every 30 seconds
- Submit new block headers to Solana
- Log progress to console

### 4. Frontend

```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/frontend

# Install dependencies
bun install

# Start dev server
bun run dev
```

Open http://localhost:3000

---

## Environment Files

### Backend API (`/backend/.env`)
```env
PORT=8080
RUST_LOG=info
```

### Header Relayer (`/backend/header-relayer/.env`)
```env
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=4k6UTCS9QBBsJigJoikqEqfsePUpfYh51v9S4yFTYSB4
RELAYER_KEYPAIR=[250,155,254,...]
BITCOIN_NETWORK=testnet
START_BLOCK_HEIGHT=4835045
POLL_INTERVAL_MS=30000
```

---

## Demo Flow

1. **Generate Deposit Address**
   - Frontend generates nullifier + secret
   - Computes commitment = Hash(nullifier, secret)
   - Gets taproot address from backend

2. **Send BTC**
   - User sends BTC to taproot address (testnet)
   - Wait for confirmations

3. **Header Relayer Syncs**
   - Relayer submits Bitcoin block headers to Solana
   - On-chain light client tracks finality

4. **Verify & Record Deposit**
   - SPV proof verifies BTC transaction
   - Commitment recorded on-chain

5. **Claim czBTC**
   - User provides nullifier + secret
   - ZK proof verifies knowledge
   - czBTC minted to user's wallet

---

## Troubleshooting

### "Light client not initialized"
```bash
cd /Users/chengchunyuan/project/hackathon/czbtc/backend/header-relayer
bun run init
```

### "Insufficient balance"
```bash
solana airdrop 2 496Dhngvw1rYbKNYA4wnwLXxZz7eHiKVQEnLeWifdS6B --url devnet
```

### "BlockNotConnected"
The light client tip doesn't match. Reinitialize with current block height:
```bash
# Get current testnet height
curl https://mempool.space/testnet/api/blocks/tip/height

# Update START_BLOCK_HEIGHT in .env, then reinitialize
```

---

## Useful Commands

```bash
# Check Bitcoin testnet tip
curl https://mempool.space/testnet/api/blocks/tip/height

# Check relayer balance
solana balance 496Dhngvw1rYbKNYA4wnwLXxZz7eHiKVQEnLeWifdS6B --url devnet

# Airdrop SOL to relayer
solana airdrop 2 496Dhngvw1rYbKNYA4wnwLXxZz7eHiKVQEnLeWifdS6B --url devnet

# View Solana program logs
solana logs 4k6UTCS9QBBsJigJoikqEqfsePUpfYh51v9S4yFTYSB4 --url devnet
```
