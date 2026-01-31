# zVault SDK Reference

TypeScript SDK for privacy-preserving BTC to Solana bridge.

---

## Installation

```bash
bun add @zvault/sdk
```

---

## Quick Start

```typescript
import {
  deposit,
  claimNote,
  splitNote,
  createClaimLinkFromNote,
  sendPrivate,
  withdraw
} from '@zvault/sdk';

// 1. Generate deposit credentials
const result = await deposit(100_000n); // 0.001 BTC
console.log('Send BTC to:', result.taprootAddress);
console.log('Save this link:', result.claimLink);

// 2. After BTC confirmed, claim zkBTC
const claimed = await claimNote(config, result.claimLink);

// 3. Split into two notes
const { output1, output2 } = await splitNote(config, result.note, 60_000n);

// 4. Send via link or stealth
const link = createClaimLinkFromNote(output1);        // Shareable URL
await sendPrivate(config, output2, recipientMeta);    // Private transfer

// 5. Withdraw back to BTC
await withdraw(config, myNote, 'tb1q...');
```

---

## Function Categories

| Category | Functions | Purpose |
|----------|-----------|---------|
| **Deposit** | `deposit`, `claimNote`, `sendStealth` | BTC → zkBTC |
| **Transfer** | `splitNote`, `createClaimLinkFromNote`, `sendPrivate` | zkBTC → Someone |
| **Withdraw** | `withdraw` | zkBTC → BTC |
| **Yield** | `depositToPool`, `withdrawFromPool`, `claimPoolYield` | Earn yield |
| **Identity** | `registerName`, `lookupZkeyName` | .zkey names |
| **Setup** | `deriveKeysFromWallet`, `createStealthMetaAddress` | Key management |

---

## Core Functions

### Deposit Functions

| Function | On-Chain | ZK Proof | Description |
|----------|----------|----------|-------------|
| `deposit(amount)` | No | No | Generate BTC deposit address |
| `claimNote(config, claimLink)` | Yes | Yes | Mint zkBTC after BTC confirmed |
| `sendStealth(config, meta, amount)` | Yes | No | Create stealth announcement |

### Transfer Functions

| Function | On-Chain | ZK Proof | Description |
|----------|----------|----------|-------------|
| `splitNote(config, note, amount1)` | Yes | Yes | Split 1 note → 2 notes |
| `createClaimLinkFromNote(note)` | No | No | Create shareable URL |
| `sendPrivate(config, note, recipientMeta)` | Yes | Yes | Private stealth transfer |

### Withdraw Functions

| Function | On-Chain | ZK Proof | Description |
|----------|----------|----------|-------------|
| `withdraw(config, note, btcAddress)` | Yes | Yes | Burn zkBTC, request BTC |

---

## Key Management

```typescript
import { deriveKeysFromWallet, createStealthMetaAddress } from '@zvault/sdk';

// Derive keys from wallet signature
const keys = await deriveKeysFromWallet(walletAdapter);
// Returns: { spendingKey, viewingKey, spendingPubKey, viewingPubKey }

// Create shareable stealth address
const meta = createStealthMetaAddress(keys);
// Share this with senders
```

---

## Stealth Address Operations

```typescript
import { scanAnnouncements, lookupZkeyName } from '@zvault/sdk';

// Scan for incoming transfers
const myNotes = scanAnnouncements(keys, announcements);

// Send to .zkey name
const entry = await lookupZkeyName(connection, 'alice');
await sendPrivate(config, myNote, entry.stealthMetaAddress);
```

---

## ChadBuffer (Large Data Upload)

```typescript
import {
  uploadTransactionToBuffer,
  uploadProofToBuffer,
  closeBuffer,
  needsBuffer
} from '@zvault/sdk';

// Upload Bitcoin transaction
const bufferAddress = await uploadTransactionToBuffer(rpc, rpcSubs, payer, rawTx);

// Upload ZK proof if needed
if (needsBuffer(proofBytes)) {
  const result = await uploadProofToBuffer(rpc, rpcSubs, payer, proofBytes);
}

// Reclaim rent after verification
await closeBuffer(rpc, rpcSubs, payer, bufferAddress);
```

---

## Contract Instructions

| Disc | Instruction | Purpose |
|------|-------------|---------|
| 0 | `INITIALIZE` | Initialize pool state |
| 4 | `SPLIT_COMMITMENT` | Split 1 → 2 notes |
| 5 | `REQUEST_REDEMPTION` | Burn, request BTC |
| 8 | `VERIFY_DEPOSIT` | Record BTC deposit (SPV) |
| 9 | `CLAIM` | Mint zkBTC with proof |
| 12 | `ANNOUNCE_STEALTH` | Stealth transfer |
| 17 | `REGISTER_NAME` | Register .zkey name |

---

## Types

```typescript
// Note (shielded commitment)
interface Note {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  commitment?: bigint;
}

// Stealth meta-address (shareable)
interface StealthMetaAddress {
  spendingPubKey: GrumpkinPoint;
  viewingPubKey: GrumpkinPoint;
}

// ZVault keys (private)
interface ZVaultKeys {
  spendingKey: bigint;
  viewingKey: bigint;
  spendingPubKey: GrumpkinPoint;
  viewingPubKey: GrumpkinPoint;
}

// Grumpkin curve point
interface GrumpkinPoint {
  x: bigint;
  y: bigint;
}

// Merkle proof
interface MerkleProof {
  pathElements: Uint8Array[];
  pathIndices: number[];
  leafIndex: number;
  root: Uint8Array;
}
```

---

## Constants

```typescript
// Program IDs
ZVAULT_PROGRAM_ID = '5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK';
CHADBUFFER_PROGRAM_ID = 'C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF';

// Merkle tree
TREE_DEPTH = 20;
MAX_LEAVES = 2 ** 20;  // ~1 million

// ChadBuffer
AUTHORITY_SIZE = 32;
MAX_DATA_PER_WRITE = 1082;  // bytes per chunk
```

---

## Error Handling

```typescript
try {
  await claimNote(config, claimLink);
} catch (error) {
  if (error.message.includes('Nullifier already exists')) {
    console.log('Note already claimed');
  } else if (error.message.includes('Commitment not found')) {
    console.log('Wait for deposit confirmation');
  } else if (error.message.includes('Invalid proof')) {
    console.log('Proof verification failed');
  }
}
```

---

## Best Practices

1. **Backup notes** before transactions
2. **Wait for confirmation** after claims
3. **Close buffers** to reclaim rent
4. **Never expose** spending/viewing keys

---

## Related Documentation

- [Technical Deep Dive](./TECHNICAL.md) - Architecture and cryptography
- [Main README](../README.md) - Project overview
