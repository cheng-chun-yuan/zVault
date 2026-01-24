# czBTC 3-Minute Demo Script

## Overview
Demonstrate the permissionless Bitcoin-to-Solana bridge with SPV verification.

---

## Part 1: Header Relayer (30 sec)

**Show:** Railway dashboard with live logs

```bash
# Check relayer status
railway logs --tail 20
```

**Key Points:**
- Relayer runs 24/7, syncing Bitcoin testnet headers to Solana
- Currently synced to block ~4,835,100+
- Permissionless: anyone can run a relayer
- Program: `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG`

---

## Part 2: Verify Deposit Flow (1.5 min)

**Show:** Frontend or CLI verification

### Test Data Available:
- **Txid:** `bec8672b7dab057d6ccbcb52f664f9964652e6706646f849aef507b7f554d2ab`
- **Amount:** 100,000 sats (0.001 BTC)
- **Taproot Address:** `tb1pafqqaayy9actlajpqnyks50n4yvy4xmhgcn0ahhe4gnjjwwz6j4s3ll6pt`

### What happens:
1. User sends BTC to taproot address (commitment embedded in address)
2. Anyone calls `verify_deposit` with:
   - Raw transaction (in ChadBuffer)
   - SPV merkle proof
   - Block height
3. Contract verifies:
   - `hash(raw_tx) == txid`
   - Merkle proof against block's merkle root
   - Block has 6+ confirmations
4. Commitment extracted from OP_RETURN and stored in merkle tree

---

## Part 3: Architecture Diagram (30 sec)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Bitcoin        │     │  Header Relayer  │     │  Solana         │
│  Testnet        │────▶│  (Railway)       │────▶│  btc-light-     │
│                 │     │                  │     │  client         │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User           │────▶│  verify_deposit  │────▶│  stealthbridge  │
│  (SPV proof)    │     │  (permissionless)│     │  (mint czBTC)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Key Innovation:**
- **No trusted oracle** - anyone can verify deposits
- **Privacy preserved** - commitment ≠ claim (ZK proofs)
- **Two-path taproot** - admin sweep + user refund

---

## Part 4: Live Demo Commands (30 sec)

```bash
# 1. Check on-chain light client tip
solana account 6tYGgT8vD3H9oJPTDpJT8j8xH5aWaEHeCBVhEVUba1h7 --url devnet

# 2. Check a block header (e.g., height 4835090)
# PDA: seeds = ["block", height.to_le_bytes()]

# 3. Show frontend deposit page
open http://localhost:3000/deposit
```

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Header sync latency | ~30 sec |
| Required confirmations | 6 blocks |
| Header submission cost | ~0.002 SOL |
| Light client program | `8GCjjP...zUfG` |
| Stealthbridge program | `4qCkVg...rn4F` |

---

## Demo Talking Points

1. **Permissionless** - No trusted relayer needed, anyone can submit headers
2. **SPV Security** - Same security as Bitcoin SPV wallets
3. **Privacy** - ZK proofs break deposit-claim linkability
4. **Self-custody** - Two-path taproot allows user refunds
5. **Cost efficient** - Only ~0.002 SOL per header

