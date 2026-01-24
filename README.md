# zVault - Private BTC on Solana

Private BTC deposits and withdrawals on Solana using Zero-Knowledge Proofs.

## Quick Start

```bash
# Frontend
cd frontend && bun install && bun dev

# Backend
cd backend && cargo run --bin sbbtc-api

# Contracts
cd contracts && anchor build
```

## Simplified Flow

```
1. User generates: nullifier + secret (random 32 bytes each)
2. User computes: commitment = Hash(nullifier, secret)
3. Backend returns: taproot address for commitment
4. User sends BTC to taproot address
5. Relayer detects BTC, records (commitment, amount) on-chain
6. User claims with: nullifier + secret → sbBTC minted
```

## Privacy Guarantee

- `commitment = Hash(nullifier, secret)` - no amount included
- `nullifier_hash = Hash(nullifier)` - revealed at claim time
- **Without knowing 'secret', you cannot link deposit → claim**
- Amount is public at deposit time, but claim is unlinkable

```
DEPOSIT                           CLAIM
┌──────────┐                     ┌──────────┐
│ nullifier│ ──► commitment ──►  │ Taproot  │ ──► BTC
│ + secret │                     │ address  │
└──────────┘                     └──────────┘
      │                                │
      │                                ▼
      │                         ┌──────────┐
      │                         │ Relayer  │ ── Records
      │                         │ records  │   (commitment,
      │                         │ deposit  │    amount)
      │                         └──────────┘
      │                                │
      ▼                                ▼
┌──────────┐                    ┌──────────┐
│ User     │ nullifier + ──────►│ sbBTC    │ ── Amount looked
│ claims   │ secret             │ minted   │    up from chain
└──────────┘                    └──────────┘
```

## Structure

```
sbbtc/
├── frontend/                 # Next.js app
│   └── src/components/       # Deposit/Claim widgets
├── contracts/                # Solana Anchor programs
│   └── programs/zVault/
├── backend/                  # Rust API server
│   └── src/api/             # REST endpoints
└── docs/                     # Documentation
```

## API Endpoints

### Deposit Flow
```
POST /api/deposit/prepare   { commitment } → { taproot_address }
POST /api/deposit/record    { commitment, amount } (relayer only)
GET  /api/deposit/status/:commitment
```

### Claim Flow
```
POST /api/claim             { nullifier, secret, solana_address }
POST /api/claim/verify      { nullifier, secret }
```

### Redemption Flow (sbBTC → BTC)
```
POST /api/redeem            { amount, btc_address, solana_address }
GET  /api/withdrawal/status/:id
```

## Claim Link Format

Users can share claim links:
```
?n=<nullifier_hex>&s=<secret_hex>
```

The recipient opens the link and clicks "Claim" - amount is looked up from the on-chain record.

## Crypto

- **Hash**: SHA256 for commitments (`Hash(nullifier, secret)`)
- **Nullifier Hash**: SHA256 (`Hash(nullifier)`) - prevents double-spend
- **Merkle Tree**: 20 levels (1M+ deposits)
- **Taproot**: BIP-341 deposit addresses
- **Groth16**: ZK proof verification on Solana

## Config

```env
NEXT_PUBLIC_sbBTC_API_URL=http://localhost:8080
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
```

## Security

**WARNING: This is a proof-of-concept for hackathon demonstration.**

Current limitations:
- Uses deterministic keys (POC only)
- Simplified integrations
- No production security audits

## License

MIT
