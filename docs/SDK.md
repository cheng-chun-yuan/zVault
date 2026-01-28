# zVault SDK Reference

Complete TypeScript SDK for interacting with the zVault protocol. Privacy-preserving BTC to Solana bridge using ZK proofs.

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Function Categories](#function-categories)
4. [Contract Instructions](#contract-instructions)
5. [Deposit Functions](#deposit-functions)
6. [Transfer Functions](#transfer-functions)
7. [Withdraw Functions](#withdraw-functions)
8. [Yield Pool Functions](#yield-pool-functions)
9. [Identity Functions](#identity-functions)
10. [Setup Functions](#setup-functions)
11. [Utility Functions](#utility-functions)
12. [Types Reference](#types-reference)

---

## Installation

```bash
bun add @zvault/sdk
```

**Peer Dependencies:**
```json
{
  "@solana/web3.js": "^1.95.0",
  "@noble/hashes": "^1.6.1"
}
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
const depositResult = await deposit(100_000n); // 0.001 BTC
console.log('Send BTC to:', depositResult.taprootAddress);
console.log('Save this link:', depositResult.claimLink);

// 2. After BTC confirmed, claim zkBTC
const claimed = await claimNote(config, depositResult.claimLink);

// 3. Split into two notes
const { output1, output2 } = await splitNote(config, depositResult.note, 60_000n);

// 4. Send via link or stealth
const link = createClaimLinkFromNote(output1);        // Shareable URL
await sendPrivate(config, output2, recipientMeta);    // Private transfer

// 5. Withdraw back to BTC
await withdraw(config, myNote, 'tb1q...');
```

---

## Function Categories

```
┌────────────────────────────────────────────────────────────────┐
│                        zVault SDK                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  DEPOSIT (BTC → zkBTC)                                        │
│  ├── deposit()          Generate taproot address              │
│  ├── claimNote()        Claim after BTC confirmed             │
│  └── sendStealth()      Direct deposit to recipient           │
│                                                                │
│  TRANSFER (zkBTC → Someone)                                   │
│  ├── splitNote()        Split 1 note → 2 notes               │
│  ├── createClaimLinkFromNote()  Create shareable URL          │
│  └── sendPrivate()      Send via stealth address              │
│                                                                │
│  WITHDRAW (zkBTC → BTC)                                       │
│  └── withdraw()         Burn and get BTC back                 │
│                                                                │
│  YIELD POOL (Earn)                                            │
│  ├── depositToPool()    Stake for yield                       │
│  ├── claimPoolYield()   Claim yield only                      │
│  ├── compoundYield()    Reinvest yield                        │
│  └── withdrawFromPool() Exit with principal + yield           │
│                                                                │
│  IDENTITY (.zkey)                                             │
│  ├── registerName()     Register "alice.zkey"                 │
│  └── lookupZkeyName()   Resolve to stealth address            │
│                                                                │
│  SETUP                                                        │
│  ├── deriveKeysFromWallet()   Get spending/viewing keys       │
│  └── createStealthMetaAddress()  Shareable address            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Contract Instructions

| Discriminator | Instruction | Purpose |
|---------------|-------------|---------|
| **0** | `INITIALIZE` | Initialize pool state and commitment tree |
| **1** | `ADD_COMMITMENT` | Add commitment to merkle tree (admin) |
| **4** | `SPLIT_COMMITMENT` | Split 1 note → 2 notes with ZK proof |
| **5** | `REQUEST_REDEMPTION` | Burn zkBTC, request BTC withdrawal |
| **8** | `VERIFY_DEPOSIT` | Record BTC deposit with SPV proof |
| **9** | `CLAIM` | Mint zkBTC with ZK proof |
| **10** | `TRANSFER` | Transfer zkBTC with ZK proof |
| **11** | `WITHDRAW` | Withdraw to BTC address with ZK proof |
| **12** | `ANNOUNCE_STEALTH` | Announce stealth transfer |
| **13** | `VERIFY_STEALTH_DEPOSIT` | Verify stealth BTC deposit |
| **20** | `REGISTER_NAME` | Register .zkey name |
| **21** | `UPDATE_NAME` | Update .zkey registration |
| **22** | `TRANSFER_NAME` | Transfer .zkey ownership |
| **30** | `CREATE_YIELD_POOL` | Create yield pool (admin) |
| **31** | `DEPOSIT_TO_POOL` | Deposit zkBTC into yield pool |
| **32** | `WITHDRAW_FROM_POOL` | Exit pool with principal + yield |
| **33** | `CLAIM_POOL_YIELD` | Claim yield, keep principal staked |
| **34** | `COMPOUND_YIELD` | Reinvest yield into principal |
| **35** | `UPDATE_YIELD_RATE` | Update pool rate (governance) |
| **36** | `HARVEST_YIELD` | Harvest from DeFi vault |

---

## Deposit Functions

### `deposit(amountSats, network?, baseUrl?)`

Generate deposit credentials (taproot address + claim link).

| | |
|---|---|
| **On-chain** | No |
| **ZK Proof** | No |
| **Purpose** | Generate BTC deposit address |

```typescript
const result = await deposit(100_000n, 'testnet');

// Returns:
{
  note: Note,              // Secret note data (SAVE THIS!)
  taprootAddress: string,  // BTC deposit address
  claimLink: string,       // Shareable claim URL
  displayAmount: string,   // "0.001 BTC"
}
```

**Next step:** Send BTC to the taproot address externally.

---

### `claimNote(config, claimLinkOrNote, merkleProof?)`

Claim zkBTC tokens with ZK proof after BTC deposit confirms.

| | |
|---|---|
| **On-chain** | Yes |
| **ZK Proof** | Yes (claim circuit) |
| **Purpose** | Mint zkBTC after BTC confirmed |

```typescript
// From claim link
const result = await claimNote(config, 'zvault://claim?n=abc...');

// Or from note directly
const result = await claimNote(config, note);

// Returns:
{
  signature: string,  // Solana transaction signature
  amount: bigint,     // Claimed amount in sats
  recipient: PublicKey,
}
```

---

### `sendStealth(config, recipientMeta, amountSats, leafIndex?)`

Send to specific recipient via stealth address (for new deposits).

| | |
|---|---|
| **On-chain** | Yes |
| **ZK Proof** | No |
| **Purpose** | Create stealth announcement for recipient |

```typescript
const result = await sendStealth(config, recipientMeta, 100_000n);

// Returns:
{
  signature: string,
  ephemeralPubKey: Uint8Array,  // For recipient scanning
  leafIndex: number,
}

// Recipient scans with viewing key to discover
const found = scanAnnouncements(recipientKeys, announcements);
```

---

## Transfer Functions

### `splitNote(config, inputNote, amount1, merkleProof?)`

Split one note into two outputs.

| | |
|---|---|
| **On-chain** | Yes |
| **ZK Proof** | Yes (split circuit) |
| **Purpose** | Divide balance into smaller pieces |

```typescript
// Split 100k sats into 60k + 40k
const { output1, output2 } = await splitNote(config, myNote, 60_000n);

// output1 = 60,000 sats (Note)
// output2 = 40,000 sats (Note)
// Original note is nullified (spent)
```

**Use cases:**
- Send partial amount to someone
- Keep some, share some via claim link

---

### `createClaimLinkFromNote(note, baseUrl?)`

Create a shareable claim link (off-chain).

| | |
|---|---|
| **On-chain** | No |
| **ZK Proof** | No |
| **Purpose** | Encode note secrets into URL |

```typescript
const link = createClaimLinkFromNote(note);
// => "zvault://claim?n=<nullifier>&s=<secret>&a=<amount>"

// Share via messaging, email, QR code
// Anyone with link can claim (first-come-first-served)
```

**Warning:** This is a bearer instrument. Anyone with the link can claim!

---

### `sendPrivate(config, inputNote, recipientMeta, merkleProof?)`

Send existing zkBTC to recipient's stealth address (private transfer).

| | |
|---|---|
| **On-chain** | Yes |
| **ZK Proof** | Yes (transfer circuit) |
| **Purpose** | Private send to known recipient |

```typescript
const result = await sendPrivate(config, myNote, aliceMetaAddress, merkleProof);

// Returns:
{
  signature: string,
  ephemeralPubKey: Uint8Array,
  outputCommitment: Uint8Array,
  inputNullifierHash: Uint8Array,
  amount: bigint,
}

// Alice scans and claims
const found = scanAnnouncements(aliceKeys, announcements);
```

---

## Withdraw Functions

### `withdraw(config, note, btcAddress, withdrawAmount?, merkleProof?)`

Request BTC withdrawal (burn zkBTC).

| | |
|---|---|
| **On-chain** | Yes |
| **ZK Proof** | Yes (withdraw circuit) |
| **Purpose** | Convert zkBTC back to BTC |

```typescript
// Full withdrawal
const result = await withdraw(config, myNote, 'tb1q...');

// Partial withdrawal (50%)
const result = await withdraw(config, myNote, 'tb1q...', 50_000n);

// Returns:
{
  signature: string,
  withdrawAmount: bigint,
  changeNote?: Note,       // If partial withdrawal
  changeClaimLink?: string,
}
```

**Next step:** Backend signs and broadcasts BTC transaction.

---

## Yield Pool Functions

The yield pool uses **stealth addresses** for privacy. Positions are discovered via viewing key scanning.

### `createStealthPoolDeposit(recipientMeta, principal, depositEpoch, poolId)`

Create a stealth pool deposit for a recipient.

| | |
|---|---|
| **On-chain** | No (preparation only) |
| **Purpose** | Prepare pool position data |

```typescript
import { createStealthPoolDeposit } from '@zvault/sdk';

const position = createStealthPoolDeposit(
  recipientMeta,    // Stealth meta address
  1_000_000n,       // 0.01 BTC principal
  currentEpoch,
  poolId
);
```

---

### `scanPoolAnnouncements(keys, announcements)`

Find your pool positions using viewing key.

| | |
|---|---|
| **On-chain** | No (read-only scan) |
| **Purpose** | Discover positions you can claim |

```typescript
import { scanPoolAnnouncements } from '@zvault/sdk';

const myPositions = scanPoolAnnouncements(keys, announcements);
// Returns positions where ECDH succeeds with your viewing key
```

---

### `calculateYield(position, currentEpoch, yieldRateBps)`

Calculate earned yield off-chain.

```typescript
import { calculateYield } from '@zvault/sdk';

const earned = calculateYield(position, currentEpoch, 500); // 5% rate
// Returns yield amount in sats
```

---

### `prepareStealthPoolClaimInputs(keys, position, merkleProof)`

Prepare inputs for pool claim/withdraw (requires spending key).

```typescript
import { prepareStealthPoolClaimInputs } from '@zvault/sdk';

const inputs = prepareStealthPoolClaimInputs(keys, position, merkleProof);
// Use inputs to generate ZK proof for claim
```

---

### Yield Pool Flow

```
zkBTC Note → depositToPool() → StealthPoolPosition
                                      ↓
              ┌───────────────────────┼───────────────────┐
              ↓                       ↓                   ↓
      claimPoolYield()        withdrawFromPool()   compoundYield()
      (yield → zkBTC)         (all → zkBTC)        (yield → principal)
```

---

## Identity Functions

### `lookupZkeyName(connection, name)`

Resolve .zkey name to stealth address.

```typescript
import { lookupZkeyName } from '@zvault/sdk';

const entry = await lookupZkeyName(connection, 'alice');
// Returns: { owner, stealthAddress, ... }

// Now you can send to alice.zkey
await sendPrivate(config, myNote, entry.stealthAddress);
```

---

### `isValidName(name)`

Validate .zkey name format.

```typescript
import { isValidName } from '@zvault/sdk';

isValidName('alice_123');  // true
isValidName('Alice');      // false (uppercase not allowed)
isValidName('ab');         // false (too short, min 3 chars)
```

---

## Setup Functions

### `deriveKeysFromWallet(walletAdapter)`

Derive spending/viewing keys from Solana wallet signature.

```typescript
import { deriveKeysFromWallet } from '@zvault/sdk';

const keys = await deriveKeysFromWallet(walletAdapter);

// Returns:
{
  spendingKey: bigint,      // Private - for spending
  viewingKey: bigint,       // Private - for scanning
  spendingPubKey: GrumpkinPoint,
  viewingPubKey: GrumpkinPoint,
}
```

---

### `createStealthMetaAddress(keys)`

Create shareable stealth meta-address from keys.

```typescript
import { createStealthMetaAddress, encodeStealthMetaAddress } from '@zvault/sdk';

const meta = createStealthMetaAddress(keys);
const encoded = encodeStealthMetaAddress(meta);
// => "zk1:ABC123..." (share this with senders)
```

---

### `scanAnnouncements(keys, announcements)`

Scan stealth announcements with viewing key.

```typescript
import { scanAnnouncements } from '@zvault/sdk';

const myNotes = scanAnnouncements(keys, announcements);
// Returns notes where ECDH derivation matches
```

---

## Utility Functions

### Note Management

```typescript
import {
  generateNote,       // Create note with random secrets
  createNote,         // Create from specific secrets
  serializeNote,      // Note → JSON
  deserializeNote,    // JSON → Note
  computeCommitment,  // Note → commitment hash
} from '@zvault/sdk';

const note = generateNote(100_000n);
const json = serializeNote(note);
const restored = deserializeNote(json);
```

### Cryptography

```typescript
import {
  poseidon2Hash,          // Poseidon2 hash (Noir compatible)
  sha256Hash,             // SHA-256
  doubleSha256,           // Bitcoin-style double SHA
  randomFieldElement,     // Random BN254 field element
  bigintToBytes,          // bigint → Uint8Array
  bytesToBigint,          // Uint8Array → bigint
} from '@zvault/sdk';
```

### Grumpkin Curve

```typescript
import {
  generateGrumpkinKeyPair,
  grumpkinEcdhSharedSecret,
  pointMul,
  pointAdd,
  isOnCurve,
} from '@zvault/sdk';

const { privateKey, publicKey } = generateGrumpkinKeyPair();
const shared = grumpkinEcdhSharedSecret(myPriv, theirPub);
```

### Taproot Addresses

```typescript
import {
  deriveTaprootAddress,
  verifyTaprootAddress,
  isValidBitcoinAddress,
} from '@zvault/sdk';

const { address } = await deriveTaprootAddress(commitment, 'testnet');
```

### Merkle Tree

```typescript
import {
  createMerkleProof,
  proofToNoirFormat,
  TREE_DEPTH,        // 20 levels
  MAX_LEAVES,        // ~1M leaves
} from '@zvault/sdk';
```

---

## Types Reference

### Core Types

```typescript
// Note (shielded commitment)
interface Note {
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  commitment?: bigint;
  nullifierHash?: bigint;
  commitmentBytes?: Uint8Array;
}

// Stealth meta-address (public, shareable)
interface StealthMetaAddress {
  spendingPubKey: GrumpkinPoint;
  viewingPubKey: GrumpkinPoint;
}

// ZVault keys (private, never share)
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

### Result Types

```typescript
interface DepositResult {
  note: Note;
  taprootAddress: string;
  claimLink: string;
  displayAmount: string;
}

interface ClaimNoteResult {
  signature: string;
  amount: bigint;
  recipient: PublicKey;
}

interface SplitNoteResult {
  signature: string;
  output1: Note;
  output2: Note;
  inputNullifierHash: Uint8Array;
}

interface WithdrawResult {
  signature: string;
  withdrawAmount: bigint;
  changeNote?: Note;
  changeClaimLink?: string;
}

interface SendPrivateResult {
  signature: string;
  ephemeralPubKey: Uint8Array;
  outputCommitment: Uint8Array;
  inputNullifierHash: Uint8Array;
  amount: bigint;
}
```

### Pool Types

```typescript
interface StealthPoolPosition {
  poolId: Uint8Array;
  ephemeralPub: Uint8Array;
  principal: bigint;
  depositEpoch: bigint;
  stealthPub: GrumpkinPoint;
  commitment: bigint;
  leafIndex: number;
  commitmentBytes: Uint8Array;
}

interface ScannedPoolPosition extends StealthPoolPosition {
  sharedSecret: bigint;
  stealthPriv: bigint;
}
```

---

## Constants

```typescript
// BN254 field prime
BN254_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Grumpkin curve order
GRUMPKIN_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Merkle tree config
TREE_DEPTH = 20;
MAX_LEAVES = 2 ** 20;  // ~1 million
ROOT_HISTORY_SIZE = 30;

// Program ID
ZVAULT_PROGRAM_ID = '5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK';
```

---

## Flow Diagrams

### Complete User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER ACTIONS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   BTC World                        Solana World                 │
│   ─────────                        ────────────                 │
│                                                                 │
│   ┌─────────┐    deposit()     ┌──────────────┐                │
│   │ Bitcoin │ ───────────────► │ Taproot Addr │                │
│   │ Wallet  │                  └──────┬───────┘                │
│   └─────────┘                         │                         │
│                                       │ SPV Verify              │
│                                       ▼                         │
│                               ┌───────────────┐                 │
│                               │  claimNote()  │                 │
│                               └───────┬───────┘                 │
│                                       │                         │
│                                       ▼                         │
│                               ┌───────────────┐                 │
│                               │   zkBTC Note  │                 │
│                               └───────┬───────┘                 │
│                                       │                         │
│         ┌─────────────────────────────┼─────────────────────┐   │
│         │                             │                     │   │
│         ▼                             ▼                     ▼   │
│  ┌─────────────┐            ┌─────────────────┐    ┌───────────┐│
│  │ splitNote   │            │  sendPrivate    │    │ withdraw  ││
│  │ (1 → 2)     │            │ (private send)  │    │ (→ BTC)   ││
│  └──────┬──────┘            └────────┬────────┘    └───────────┘│
│         │                            │                          │
│         ▼                            ▼                          │
│  ┌──────────────────┐       ┌─────────────────┐                │
│  │createClaimLink   │       │ Stealth Announce│                │
│  │FromNote(shareURL)│       │ (ECDH scan)     │                │
│  └──────────────────┘       └─────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Yield Pool Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      YIELD POOL (Stealth-based)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   zkBTC Note ──► depositToPool() ──► StealthPoolAnnouncement   │
│                                              │                  │
│                       ┌──────────────────────┼──────────┐       │
│                       ▼                      ▼          ▼       │
│               claimPoolYield()      withdrawFromPool()  │       │
│               (yield → zkBTC)       (all → zkBTC)       │       │
│                                                         │       │
│                                              compoundYield()    │
│                                              (yield → principal)│
│                                                                 │
│   Scanning: Use viewing key to discover your positions         │
│   Claiming: Use spending key to generate ZK proof              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [CONTRACTS.md](./CONTRACTS.md) - Solana program details
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
- [API.md](./API.md) - Backend API reference
