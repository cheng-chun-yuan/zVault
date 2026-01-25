# zVault Backend API Reference

REST API documentation for the zVault backend services. The backend provides redemption processing and stealth deposit coordination.

---

## Table of Contents

1. [Overview](#overview)
2. [Base URL](#base-url)
3. [Health Check](#health-check)
4. [Redemption API](#redemption-api)
5. [Stealth API](#stealth-api)
6. [WebSocket API](#websocket-api)
7. [Status Lifecycles](#status-lifecycles)
8. [Error Handling](#error-handling)
9. [Configuration](#configuration)

---

## Overview

The zVault backend consists of two main services:

| Service | Port | Purpose |
|---------|------|---------|
| Redemption API | 8080 | BTC withdrawal processing |
| Combined API | 8080 | Redemption + Stealth deposits |

### Architecture Note

Most operations (deposit, claim, split, transfer) are handled **client-side** via the SDK. The backend is only needed for:

- **Redemption**: Signing and broadcasting BTC withdrawal transactions
- **Stealth**: Coordinating stealth deposit preparation (optional relay mode)

---

## Base URL

```
# Local development
http://localhost:8080

# Production (configure via env)
${SBBTC_API_URL}
```

---

## Health Check

### GET `/api/health`

Check service health and version.

**Request:**
```bash
curl http://localhost:8080/api/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "sbbtc-api",
  "version": "0.1.0"
}
```

**Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Service healthy |
| 503 | Service unavailable |

---

## Redemption API

### POST `/api/redeem`

Submit a BTC withdrawal request. Burns zBTC and queues BTC transaction.

**Request:**
```bash
curl -X POST http://localhost:8080/api/redeem \
  -H "Content-Type: application/json" \
  -d '{
    "amount_sats": 50000,
    "btc_address": "tb1qxyz...",
    "solana_address": "ABC123..."
  }'
```

**Request Body:**
```json
{
  "amount_sats": 50000,
  "btc_address": "tb1qxyz...",
  "solana_address": "ABC123..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount_sats` | integer | Yes | Amount in satoshis |
| `btc_address` | string | Yes | Destination BTC address (Bech32) |
| `solana_address` | string | Yes | User's Solana address (for verification) |

**Response (Success):**
```json
{
  "success": true,
  "request_id": "api_request_1706200000000",
  "message": "Withdrawal request submitted"
}
```

**Response (Error):**
```json
{
  "success": false,
  "request_id": null,
  "message": "Invalid BTC address format"
}
```

**Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Request submitted successfully |
| 400 | Invalid request (bad address, amount, etc.) |
| 500 | Internal server error |

---

### GET `/api/withdrawal/status/:id`

Check withdrawal request status.

**Request:**
```bash
curl http://localhost:8080/api/withdrawal/status/api_request_1706200000000
```

**Response (Found):**
```json
{
  "request_id": "api_request_1706200000000",
  "status": "completed",
  "amount_sats": 50000,
  "btc_address": "tb1qxyz...",
  "btc_txid": "abc123def456...",
  "created_at": 1706200000,
  "updated_at": 1706200100
}
```

**Response (Not Found):**
```json
{
  "error": "Not found",
  "details": "Withdrawal request api_request_xxx not found"
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| `pending` | Request received, queued |
| `processing` | Building/signing transaction |
| `broadcasting` | Broadcasting to Bitcoin network |
| `completed` | Transaction confirmed |
| `failed` | Transaction failed |

**Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Request found |
| 404 | Request not found |

---

## Stealth API

### POST `/api/stealth/prepare`

Prepare a stealth deposit (relay or self-custody mode).

**Request:**
```bash
curl -X POST http://localhost:8080/api/stealth/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "recipient_stealth_address": "0x...",
    "amount_sats": 100000,
    "mode": "relay"
  }'
```

**Request Body:**
```json
{
  "recipient_stealth_address": "0x...",
  "amount_sats": 100000,
  "mode": "relay"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipient_stealth_address` | string | Yes | Recipient's stealth meta-address (hex) |
| `amount_sats` | integer | Yes | Amount in satoshis |
| `mode` | string | Yes | `"relay"` or `"self_custody"` |

**Response (Relay Mode):**
```json
{
  "success": true,
  "deposit_id": "stealth_abc123",
  "taproot_address": "tb1p...",
  "amount_sats": 100000,
  "expires_at": 1706300000,
  "message": null
}
```

**Response (Self-Custody Mode):**
```json
{
  "success": true,
  "taproot_address": "tb1p...",
  "amount_sats": 100000,
  "stealth_data": "base64-encoded-data...",
  "message": null
}
```

**Response (Error):**
```json
{
  "success": false,
  "deposit_id": null,
  "taproot_address": null,
  "amount_sats": 100000,
  "expires_at": null,
  "message": "Invalid stealth address"
}
```

**Modes:**
| Mode | Description |
|------|-------------|
| `relay` | Backend monitors deposit and announces on-chain |
| `self_custody` | User handles announcement (returns stealth_data) |

---

### GET `/api/stealth/status/:id`

Get stealth deposit status (relay mode only).

**Request:**
```bash
curl http://localhost:8080/api/stealth/status/stealth_abc123
```

**Response:**
```json
{
  "deposit_id": "stealth_abc123",
  "status": "confirmed",
  "taproot_address": "tb1p...",
  "amount_sats": 100000,
  "btc_txid": "abc123...",
  "solana_tx": "xyz789...",
  "leaf_index": 42,
  "created_at": 1706200000,
  "updated_at": 1706200500
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| `pending` | Waiting for BTC deposit |
| `detected` | BTC transaction seen |
| `confirming` | Waiting for confirmations |
| `confirmed` | BTC confirmed, announcing |
| `announced` | Stealth announcement complete |
| `expired` | Deposit window expired |
| `failed` | Processing failed |

---

### POST `/api/stealth/announce`

Manually trigger stealth announcement (self-custody mode).

**Request:**
```bash
curl -X POST http://localhost:8080/api/stealth/announce \
  -H "Content-Type: application/json" \
  -d '{
    "stealth_data": "base64-encoded-data..."
  }'
```

**Request Body:**
```json
{
  "stealth_data": "base64-encoded-data..."
}
```

**Response:**
```json
{
  "success": true,
  "solana_tx": "xyz789...",
  "leaf_index": 42,
  "message": "Announcement simulated for commitment abc..."
}
```

---

## WebSocket API

### Deposit Tracker WebSocket

Real-time deposit status updates.

**Connect:**
```javascript
const ws = new WebSocket('ws://localhost:8080/api/deposits/ws');
```

**Subscribe:**
```json
{
  "action": "subscribe",
  "addresses": ["tb1p..."]
}
```

**Unsubscribe:**
```json
{
  "action": "unsubscribe",
  "addresses": ["tb1p..."]
}
```

**Server Messages:**

```json
{
  "type": "deposit_detected",
  "address": "tb1p...",
  "txid": "abc123...",
  "amount_sats": 100000,
  "confirmations": 0
}
```

```json
{
  "type": "deposit_confirmed",
  "address": "tb1p...",
  "txid": "abc123...",
  "amount_sats": 100000,
  "confirmations": 2,
  "block_height": 2500000
}
```

---

## Status Lifecycles

### Withdrawal Lifecycle

```
pending → processing → broadcasting → completed
    ↓         ↓            ↓
  failed    failed       failed
```

```
┌─────────┐     ┌────────────┐     ┌──────────────┐     ┌───────────┐
│ pending │────►│ processing │────►│ broadcasting │────►│ completed │
└─────────┘     └────────────┘     └──────────────┘     └───────────┘
     │               │                    │
     └───────────────┴────────────────────┴──────────────► failed
```

| State | Duration | Description |
|-------|----------|-------------|
| pending | < 1 min | Queued for processing |
| processing | 1-5 min | Building & signing tx |
| broadcasting | 10-60 min | Waiting for confirmations |
| completed | - | Transaction confirmed |
| failed | - | Error occurred |

### Stealth Deposit Lifecycle

```
┌─────────┐     ┌──────────┐     ┌────────────┐     ┌───────────┐     ┌───────────┐
│ pending │────►│ detected │────►│ confirming │────►│ confirmed │────►│ announced │
└─────────┘     └──────────┘     └────────────┘     └───────────┘     └───────────┘
     │               │                  │                  │
     │               └──────────────────┴──────────────────┴──────────► failed
     │
     └─────────────────────────────────────────────────────────────────► expired
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "Error category",
  "details": "Detailed error message"
}
```

### Common Errors

| HTTP Code | Error | Description |
|-----------|-------|-------------|
| 400 | Invalid address | BTC address format invalid |
| 400 | Invalid amount | Amount <= 0 or exceeds limit |
| 400 | Invalid stealth data | Stealth data decode failed |
| 404 | Not found | Resource doesn't exist |
| 429 | Rate limited | Too many requests |
| 500 | Internal error | Server-side failure |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /api/redeem | 10/minute |
| GET /api/withdrawal/status | 60/minute |
| POST /api/stealth/prepare | 20/minute |
| WebSocket | 100 messages/minute |

---

## Configuration

### Environment Variables

```env
# Server
PORT=8080
HOST=0.0.0.0
RUST_LOG=info

# Bitcoin
BITCOIN_NETWORK=testnet
ESPLORA_URL=https://blockstream.info/testnet/api
BTC_WALLET_PRIVATE_KEY=<hex>

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
ZVAULT_PROGRAM_ID=CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR

# Limits
MIN_WITHDRAWAL_SATS=10000
MAX_WITHDRAWAL_SATS=100000000
STEALTH_EXPIRY_SECONDS=3600
```

### Running the Backend

```bash
# Development
cd backend
cargo run --bin sbbtc-api

# With logging
RUST_LOG=debug cargo run --bin sbbtc-api

# Production
cargo build --release
./target/release/sbbtc-api

# Combined API (redemption + stealth)
cargo run --bin sbbtc-combined
```

---

## Data Storage

> **Note**: The current backend uses **in-memory storage only**.
> All data is lost on service restart.
> Production deployments should integrate a persistent database.

### In-Memory Storage

```rust
// Current implementation
pub struct RedemptionService {
    requests: Arc<RwLock<HashMap<String, WithdrawalRequest>>>,
}

pub struct StealthDepositService {
    deposits: Arc<RwLock<HashMap<String, StealthDepositRecord>>>,
}
```

### Future Database Schema

For production, consider PostgreSQL:

```sql
-- Withdrawal requests
CREATE TABLE withdrawal_requests (
    id VARCHAR(64) PRIMARY KEY,
    solana_address VARCHAR(44) NOT NULL,
    btc_address VARCHAR(62) NOT NULL,
    amount_sats BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    btc_txid VARCHAR(64),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- Stealth deposits
CREATE TABLE stealth_deposits (
    id VARCHAR(64) PRIMARY KEY,
    recipient_stealth_address BYTEA NOT NULL,
    taproot_address VARCHAR(62) NOT NULL,
    amount_sats BIGINT NOT NULL,
    mode VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    btc_txid VARCHAR(64),
    solana_tx VARCHAR(88),
    leaf_index INTEGER,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [SDK.md](./SDK.md) - TypeScript SDK reference
- [CONTRACTS.md](./CONTRACTS.md) - Solana program details
