# zVault SDK Reference

Complete TypeScript SDK for interacting with the zVault protocol. Privacy-preserving BTC to Solana bridge using ZK proofs.

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [6 Main Functions](#6-main-functions)
4. [Client API](#client-api)
5. [Note Operations](#note-operations)
6. [Cryptographic Utilities](#cryptographic-utilities)
7. [Stealth Addresses](#stealth-addresses)
8. [Auto Stealth Deposits](#auto-stealth-deposits)
9. [Name Registry](#name-registry)
10. [Deposit Watcher](#deposit-watcher)
11. [React Hooks](#react-hooks)
12. [Types Reference](#types-reference)

---

## Installation

```bash
bun add @zvault/sdk
# or
npm install @zvault/sdk
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
import { createClient } from '@zvault/sdk';
import { Connection, Keypair } from '@solana/web3.js';

// 1. Create client
const connection = new Connection('https://api.devnet.solana.com');
const client = createClient(connection);
client.setPayer(myKeypair);

// 2. Generate deposit credentials
const deposit = await client.deposit(100_000n); // 0.001 BTC in sats
console.log('Send BTC to:', deposit.taprootAddress);
console.log('Save claim link:', deposit.claimLink);

// 3. After BTC is confirmed, claim zBTC
const result = await client.privateClaim(deposit.claimLink);

// 4. Split into two outputs
const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);

// 5. Send via link or stealth
const link = client.sendLink(output1.note);
await client.sendStealth(recipientMeta, output2.note.amount, leafIndex);
```

---

## 6 Main Functions

The SDK provides 6 core operations:

### 1. `deposit(amountSats, network?, baseUrl?)`

Generate deposit credentials (taproot address + claim link).

```typescript
const deposit = await client.deposit(100_000n, 'testnet');

// Returns:
{
  note: Note,              // Secret note data
  taprootAddress: string,  // BTC deposit address
  claimLink: string,       // Shareable claim URL
  displayAmount: string,   // Human-readable amount
}
```

### 2. `privateClaim(claimLinkOrNote)`

Claim zBTC with ZK proof after BTC deposit confirms.

```typescript
// From claim link
const result = await client.privateClaim('zvault://claim?n=abc...&s=xyz...');

// Or from note directly
const result = await client.privateClaim(note);

// Returns:
{
  signature: string,    // Solana transaction signature
  amount: bigint,       // Claimed amount in sats
  commitment: string,   // New commitment in tree
}
```

### 3. `privateSplit(inputNote, amount1)`

Split one commitment into two outputs.

```typescript
const { output1, output2 } = await client.privateSplit(inputNote, 60_000n);

// input: 100,000 sats
// output1: 60,000 sats
// output2: 40,000 sats (remainder)

// Each output contains:
{
  note: Note,
  claimLink: string,
}
```

### 4. `withdraw(note, btcAddress, withdrawAmount?)`

Request BTC withdrawal (burn zBTC).

```typescript
const result = await client.withdraw(note, 'tb1qxyz...', 50_000n);

// If withdrawAmount < note.amount, creates change commitment

// Returns:
{
  signature: string,        // Solana tx
  requestId: string,        // Backend tracking ID
  changeNote?: Note,        // If partial withdrawal
}
```

### 5. `sendLink(note, baseUrl?)`

Create global claim link (bearer instrument).

```typescript
const link = client.sendLink(note);
// Returns: "zvault://claim?n=<nullifier>&s=<secret>&a=<amount>"

// Anyone with link can claim!
```

### 6. `sendStealth(recipientMeta, amountSats, leafIndex?)`

Send to specific recipient via dual-key ECDH.

```typescript
const result = await client.sendStealth(
  recipientStealthMeta,  // Recipient's public stealth address
  50_000n,               // Amount in sats
  0                      // Leaf index for input note
);

// Returns:
{
  signature: string,
  ephemeralPubkey: Uint8Array,
  commitment: bigint,
}
```

---

## Client API

### `createClient(connection)`

Create a new zVault client.

```typescript
import { createClient } from '@zvault/sdk';

const client = createClient(connection);
```

### `ZVaultClient`

```typescript
class ZVaultClient {
  // Set transaction payer
  setPayer(payer: Keypair): void;

  // 6 main functions (see above)
  deposit(amountSats: bigint, network?: string, baseUrl?: string): Promise<DepositResult>;
  privateClaim(claimLinkOrNote: string | Note): Promise<ClaimResult>;
  privateSplit(inputNote: Note, amount1: bigint): Promise<SplitResult>;
  withdraw(note: Note, btcAddress: string, withdrawAmount?: bigint): Promise<WithdrawResult>;
  sendLink(note: Note, baseUrl?: string): string;
  sendStealth(recipientMeta: StealthMetaAddress, amountSats: bigint, leafIndex?: number): Promise<StealthResult>;

  // PDA derivation helpers
  derivePoolStatePDA(): [PublicKey, number];
  deriveLightClientPDA(): [PublicKey, number];
  deriveCommitmentTreePDA(): [PublicKey, number];
  deriveBlockHeaderPDA(height: number): [PublicKey, number];
  deriveDepositRecordPDA(txid: Uint8Array): [PublicKey, number];
  deriveNullifierRecordPDA(nullifierHash: Uint8Array): [PublicKey, number];
  deriveStealthAnnouncementPDA(commitment: bigint): [PublicKey, number];

  // Utilities
  restoreFromClaimLink(link: string): Promise<DepositCredentials | null>;
  validateBtcAddress(address: string): boolean;
  validateClaimLink(link: string): boolean;

  // Merkle state (local testing)
  insertCommitment(commitment: Uint8Array): number;
  getMerkleRoot(): Uint8Array;
  getLeafCount(): number;
}
```

---

## Note Operations

### Generate Note

```typescript
import { generateNote, createNote, deriveNote } from '@zvault/sdk';

// Random note
const note = generateNote(100_000n);

// From secrets (deterministic)
const note = createNote(nullifier, secret, amount);

// HD-style derivation
const masterKey = deriveMasterKey(seed);
const note = deriveNote(masterKey, 0, 100_000n); // index 0
```

### Note Structure

```typescript
interface Note {
  nullifier: bigint;        // Random 254-bit field element
  secret: bigint;           // Random 254-bit field element
  amount: bigint;           // Amount in satoshis

  // Computed (lazy)
  commitment?: bigint;      // Poseidon2(nullifier, secret, amount)
  nullifierHash?: bigint;   // Poseidon2(nullifier)
  commitmentBytes?: Uint8Array;
}
```

### Serialization

```typescript
import { serializeNote, deserializeNote } from '@zvault/sdk';

const serialized = serializeNote(note);
// { nullifier: "0x...", secret: "0x...", amount: "100000" }

const note = deserializeNote(serialized);
```

### Claim Links

```typescript
import {
  createClaimLink,
  parseClaimLink,
  isValidClaimLinkFormat,
  encodeClaimLink,
  decodeClaimLink,
} from '@zvault/sdk';

// Create link
const link = createClaimLink(note);
// "zvault://claim?n=abc...&s=xyz...&a=100000"

// Parse link back to note
const note = parseClaimLink(link);

// URL-safe encoding
const encoded = encodeClaimLink(note);
const decoded = decodeClaimLink(encoded);
```

---

## Cryptographic Utilities

### Poseidon2 Hashing

```typescript
import {
  poseidon2Hash,
  computeCommitment,
  computeNullifier,
  hashNullifier,
} from '@zvault/sdk';

// Generic hash
const hash = poseidon2Hash([field1, field2]);

// Commitment: Poseidon2(Poseidon2(nullifier, secret), amount)
const commitment = computeCommitment(nullifier, secret, amount);

// Nullifier hash: Poseidon2(nullifier)
const nullifierHash = hashNullifier(nullifier);
```

### Grumpkin Curve (In-circuit ECDH)

```typescript
import {
  generateGrumpkinKeyPair,
  deriveGrumpkinKeyPairFromSeed,
  grumpkinEcdh,
  grumpkinEcdhSharedSecret,
  pointMul,
  pointAdd,
  isOnCurve,
} from '@zvault/sdk';

// Generate keypair
const { privateKey, publicKey } = generateGrumpkinKeyPair();

// Derive from seed
const { privateKey, publicKey } = deriveGrumpkinKeyPairFromSeed(seed);

// ECDH shared secret
const sharedSecret = grumpkinEcdhSharedSecret(myPrivateKey, theirPublicKey);
```

### Taproot Addresses

```typescript
import {
  deriveTaprootAddress,
  verifyTaprootAddress,
  isValidBitcoinAddress,
} from '@zvault/sdk';

// Derive from commitment
const { address, tweakedPubkey } = await deriveTaprootAddress(
  commitment,
  'testnet'
);

// Verify address derivation
const isValid = await verifyTaprootAddress(address, commitment, 'testnet');

// General validation
const { valid, network } = isValidBitcoinAddress('tb1qxyz...');
```

### General Crypto

```typescript
import {
  randomFieldElement,
  sha256Hash,
  doubleSha256,
  taggedHash,
  bigintToBytes,
  bytesToBigint,
  hexToBytes,
  bytesToHex,
} from '@zvault/sdk';

const random = randomFieldElement(); // BN254 field element
const hash = sha256Hash(data);
const btcHash = doubleSha256(data);
const tagged = taggedHash('TapLeaf', data);
```

---

## Stealth Addresses

### Key Derivation (RAILGUN-style)

```typescript
import {
  deriveKeysFromWallet,
  deriveKeysFromSignature,
  createStealthMetaAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
} from '@zvault/sdk';

// Derive from Solana wallet
const keys = await deriveKeysFromWallet(walletAdapter);

// Returns:
{
  spendingKey: bigint,     // Private spending key
  viewingKey: bigint,      // Private viewing key
  spendingPubKey: GrumpkinPoint,
  viewingPubKey: GrumpkinPoint,
}

// Create stealth meta-address (public info)
const meta = createStealthMetaAddress(keys);
const serialized = serializeStealthMetaAddress(meta);
// Share this with senders
```

### Sending via Stealth

```typescript
import { createStealthDeposit, prepareClaimInputs } from '@zvault/sdk';

// Sender creates stealth deposit
const stealthDeposit = createStealthDeposit(
  recipientMeta,     // Recipient's stealth meta-address
  amount,
  ephemeralPrivateKey  // Generated per-send
);

// Returns:
{
  commitment: bigint,
  ephemeralPubkey: GrumpkinPoint,
  encryptedData: Uint8Array,
}
```

### Scanning & Claiming

```typescript
import { scanAnnouncements, prepareClaimInputs } from '@zvault/sdk';

// Recipient scans announcements
const myNotes = scanAnnouncements(
  announcements,  // From chain
  viewingKey,
  spendingPubKey
);

// Prepare claim inputs for found notes
const claimInputs = prepareClaimInputs(scannedNote, keys);
```

### Delegated View Keys

```typescript
import {
  createDelegatedViewKey,
  isDelegatedKeyValid,
  hasPermission,
  ViewPermissions,
} from '@zvault/sdk';

// Create view-only key for third party
const delegated = createDelegatedViewKey(
  viewingKey,
  ViewPermissions.VIEW_BALANCE | ViewPermissions.VIEW_HISTORY,
  expiry
);

// Check permissions
if (hasPermission(delegated, ViewPermissions.VIEW_BALANCE)) {
  // Can see balance
}
```

---

## Auto Stealth Deposits

Backend-managed 2-phase BTC deposit flow for quick demos. The backend handles ephemeral key generation, deposit detection, sweeping, and on-chain verification.

### Flow Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Deposit Detection                                  │
├─────────────────────────────────────────────────────────────┤
│  User                    Backend                  Bitcoin   │
│    │                        │                        │      │
│    │── POST /api/v2/prepare ─►│  Generate ephemeral   │      │
│    │   { viewingPub,        │  Derive BTC address   │      │
│    │     spendingPub }      │                        │      │
│    │                        │                        │      │
│    │◄── { depositId,       │                        │      │
│    │      btcAddress,       │                        │      │
│    │      ephemeralPub }    │                        │      │
│    │                        │                        │      │
│    │────── Send testnet BTC ─────────────────────────►│      │
│    │                        │                        │      │
│    │                        │◄─ Poll Esplora ────────│      │
│    │◄─ WS: "detected" ──────│                        │      │
│    │◄─ WS: "confirmed" ─────│  (1 confirmation)     │      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Phase 2: On-Chain Verification                              │
├─────────────────────────────────────────────────────────────┤
│  Backend                                        Solana      │
│    │                                               │        │
│    │── Sweep to vault ───────────────────────────►│        │
│    │── Upload raw tx to ChadBuffer ──────────────►│        │
│    │── verify_stealth_deposit_v2 ────────────────►│        │
│    │     • SPV proof                               │        │
│    │     • Insert commitment                       │        │
│    │     • Create StealthAnnouncement             │        │
│    │     • Mint zBTC to pool                       │        │
│    │                                               │        │
│  User◄─ WS: "ready" ───────────────────────────────│        │
│         User can now scan inbox and claim!         │        │
└─────────────────────────────────────────────────────────────┘
```

### API Endpoints

#### `POST /api/stealth/prepare`

Prepare a stealth deposit address.

```typescript
// Request
interface PrepareStealthDepositRequest {
  viewing_pub: string;   // 66 hex chars (33 bytes Grumpkin)
  spending_pub: string;  // 66 hex chars (33 bytes Grumpkin)
}

// Response
interface PrepareStealthDepositResponse {
  success: boolean;
  deposit_id: string;
  btc_address: string;      // tb1p... testnet Taproot
  ephemeral_pub: string;    // For recipient scanning
  expires_at: number;       // Unix timestamp
}
```

#### `GET /api/stealth/:id`

Get stealth deposit status.

```typescript
interface StealthDepositStatusResponse {
  id: string;
  status: StealthDepositStatus;
  btc_address: string;
  ephemeral_pub: string;
  actual_amount_sats?: number;
  confirmations: number;
  sweep_confirmations: number;
  deposit_txid?: string;
  sweep_txid?: string;
  solana_tx?: string;
  leaf_index?: number;
  error?: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

type StealthDepositStatus =
  | 'pending'        // Waiting for BTC
  | 'detected'       // BTC in mempool
  | 'confirming'     // Waiting for confirmations
  | 'confirmed'      // Ready to sweep
  | 'sweeping'       // Sweeping to vault
  | 'sweep_confirming' // Waiting for sweep confirmations
  | 'verifying'      // Submitting on-chain
  | 'ready'          // User can claim!
  | 'failed';        // Error occurred
```

#### `WS /ws/stealth/:id`

Subscribe to real-time status updates.

```typescript
interface StealthDepositStatusUpdate {
  deposit_id: string;
  status: StealthDepositStatus;
  actual_amount_sats?: number;
  confirmations: number;
  sweep_confirmations: number;
  is_ready: boolean;
  error?: string;
}
```

### React Hook

```typescript
import { useStealthDeposit } from '@/hooks/use-stealth-deposit';

function AutoStealthDeposit() {
  const {
    prepareDeposit,
    depositId,
    btcAddress,
    ephemeralPub,
    status,
    actualAmount,
    confirmations,
    sweepConfirmations,
    isReady,
    error,
    reset,
  } = useStealthDeposit();

  const { keys } = useZVaultKeys();

  const handlePrepare = async () => {
    if (!keys) return;
    await prepareDeposit(keys.viewingPubKey, keys.spendingPubKey);
  };

  return (
    <div>
      {!btcAddress ? (
        <button onClick={handlePrepare}>Generate Address</button>
      ) : (
        <>
          <QRCode value={btcAddress} />
          <p>Send BTC to: {btcAddress}</p>
          <p>Status: {status}</p>
          {isReady && <p>Check your Stealth Inbox!</p>}
        </>
      )}
    </div>
  );
}
```

### Demo Mode Configuration

For 3-minute demo, use reduced confirmations:

```rust
// Demo mode settings
required_confirmations: 1,        // vs 6 in production
required_sweep_confirmations: 1,  // vs 2 in production
poll_interval_secs: 5,            // vs 10 in production
```

---

## Name Registry

### Lookup

```typescript
import {
  lookupZkeyName,
  lookupZkeyNameWithPDA,
  isValidName,
  normalizeName,
  formatZkeyName,
} from '@zvault/sdk';

// Lookup by name
const entry = await lookupZkeyName(connection, 'alice');
// Returns: { owner, stealthAddress, ... }

// Validate name
isValidName('alice_123');  // true
isValidName('Alice');      // false (uppercase)
isValidName('ab');         // false (too short)

// Format
formatZkeyName('alice');   // "alice.zkey"
```

### Registration (via program)

```typescript
import { buildRegisterNameData } from '@zvault/sdk';

const data = buildRegisterNameData('alice', stealthMetaAddress);
// Use with REGISTER_NAME instruction
```

---

## Deposit Watcher

Real-time BTC deposit tracking.

### Web Watcher

```typescript
import { createWebWatcher, WebDepositWatcher } from '@zvault/sdk';

const watcher = createWebWatcher({
  pollingInterval: 30000,  // 30 seconds
  confirmations: 2,
});

watcher.on('confirmed', (deposit) => {
  console.log('Deposit confirmed!', deposit.txid);
});

watcher.on('error', (error) => {
  console.error('Watcher error:', error);
});

// Add deposit to watch
watcher.addDeposit({
  taprootAddress: 'tb1p...',
  commitment: '0x...',
  amount: 100_000n,
});

// Start watching
watcher.start();
```

### Native Watcher (React Native)

```typescript
import { createNativeWatcher, setAsyncStorage } from '@zvault/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Set storage adapter
setAsyncStorage(AsyncStorage);

const watcher = createNativeWatcher();
```

---

## React Hooks

### `useDepositWatcher`

```typescript
import { useDepositWatcher } from '@zvault/sdk';

function DepositStatus() {
  const {
    deposits,
    isWatching,
    addDeposit,
    removeDeposit,
    startWatching,
    stopWatching,
  } = useDepositWatcher();

  return (
    <div>
      {deposits.map(d => (
        <div key={d.id}>
          {d.status}: {d.confirmations} confirmations
        </div>
      ))}
    </div>
  );
}
```

### `useSingleDeposit`

```typescript
import { useSingleDeposit } from '@zvault/sdk';

function SingleDepositStatus({ depositId }) {
  const {
    deposit,
    status,
    confirmations,
    isConfirmed,
  } = useSingleDeposit(depositId);

  if (isConfirmed) {
    return <ClaimButton note={deposit.note} />;
  }

  return <div>Waiting for {2 - confirmations} confirmations...</div>;
}
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

// Deposit credentials
interface DepositCredentials {
  note: Note;
  taprootAddress: string;
  claimLink: string;
  displayAmount: string;
}

// Stealth meta-address (public)
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

### Result Types

```typescript
interface DepositResult {
  note: Note;
  taprootAddress: string;
  claimLink: string;
  displayAmount: string;
}

interface ClaimResult {
  signature: string;
  amount: bigint;
  commitment: string;
}

interface SplitResult {
  signature: string;
  output1: { note: Note; claimLink: string };
  output2: { note: Note; claimLink: string };
}

interface WithdrawResult {
  signature: string;
  requestId: string;
  changeNote?: Note;
}

interface StealthResult {
  signature: string;
  ephemeralPubkey: Uint8Array;
  commitment: bigint;
}
```

### Watcher Types

```typescript
type DepositStatus = 'pending' | 'detected' | 'confirming' | 'confirmed' | 'failed';

interface PendingDeposit {
  id: string;
  taprootAddress: string;
  commitment: string;
  amount: bigint;
  status: DepositStatus;
  confirmations: number;
  txid?: string;
  createdAt: number;
}

interface WatcherConfig {
  pollingInterval: number;
  confirmations: number;
  network: 'mainnet' | 'testnet';
}

interface WatcherCallbacks {
  onStatusChange?: (deposit: PendingDeposit) => void;
  onConfirmed?: (deposit: PendingDeposit) => void;
  onError?: (error: Error) => void;
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

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [CONTRACTS.md](./CONTRACTS.md) - Solana program details
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
- [API.md](./API.md) - Backend API reference
