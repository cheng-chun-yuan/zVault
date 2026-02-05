# @zvault/sdk

TypeScript SDK for interacting with the zVault protocol - a privacy-preserving Bitcoin-to-Solana bridge using Zero-Knowledge Proofs.

## Installation

```bash
bun add @zvault/sdk
# or
npm install @zvault/sdk
```

## Quick Start

```typescript
import {
  deriveKeysFromWallet,
  createStealthDeposit,
  scanAnnouncements,
  lookupZkeyName,
} from '@zvault/sdk';

// 1. Derive keys from wallet
const keys = await deriveKeysFromWallet(walletAdapter);

// 2. Look up recipient by .zkey name
const recipient = await lookupZkeyName(connection, 'alice');

// 3. Create stealth deposit
const deposit = await createStealthDeposit(recipient, 100000n);

// 4. Scan for incoming deposits
const notes = await scanAnnouncements(keys, announcements);
```

## Core Features

### Key Derivation

Derive spending and viewing keys from a Solana wallet signature (RAILGUN-style):

```typescript
import { deriveKeysFromWallet, type ZVaultKeys } from '@zvault/sdk';

const keys: ZVaultKeys = await deriveKeysFromWallet(walletAdapter);
// keys.spendingPubKey - for receiving funds
// keys.viewingPubKey  - for scanning deposits
// keys.spendingPrivKey - for claiming (keep secret!)
// keys.viewingPrivKey  - for scanning (can delegate)
```

### Stealth Addresses (EIP-5564/DKSAP Pattern)

Create private deposits that only the recipient can detect and claim:

```typescript
import {
  createStealthDeposit,
  scanAnnouncements,
  prepareClaimInputs,
} from '@zvault/sdk';

// Sender: Create stealth deposit
const deposit = await createStealthDeposit(recipientMeta, amountSats);
// deposit.ephemeralPub - publish on-chain
// deposit.commitment   - add to Merkle tree
// deposit.amountSats   - verified BTC amount

// Recipient: Scan for deposits
const notes = await scanAnnouncements(keys, onChainAnnouncements);

// Recipient: Prepare claim inputs for ZK proof
const claimInputs = await prepareClaimInputs(keys, note, merkleProof);
```

### .zkey Name Registry

Human-readable stealth addresses (like ENS for privacy):

```typescript
import {
  lookupZkeyName,
  scanByZkeyName,
  isValidName,
  buildRegisterNameData,
} from '@zvault/sdk';

// Look up a .zkey name
const address = await lookupZkeyName(connection, 'alice');
// address.spendingPubKey
// address.viewingPubKey
// address.stealthMetaAddress

// Scan deposits for a .zkey name (with ownership verification)
const notes = await scanByZkeyName(
  keys,           // Your full ZVaultKeys
  'alice',        // Name to verify you own
  connection,     // Solana connection
  announcements   // On-chain announcements
);

// Validate name format
if (isValidName('alice')) {
  const data = buildRegisterNameData('alice', spendingPub, viewingPub);
}
```

### Demo Instructions (Testing/Development)

Add mock deposits without real BTC for testing:

```typescript
import {
  buildAddDemoNoteData,
  buildAddDemoStealthData,
  getPoolStatePDASeeds,
  getCommitmentTreePDASeeds,
  DEMO_INSTRUCTION,
} from '@zvault/sdk';

// Build demo note instruction data
const noteData = buildAddDemoNoteData(secret); // 32-byte secret

// Build demo stealth instruction data
const stealthData = buildAddDemoStealthData(
  ephemeralPub,  // 33 bytes
  commitment,    // 32 bytes
  amountSats     // bigint
);

// Get PDA seeds for instruction construction
const { seeds: poolSeeds } = getPoolStatePDASeeds();
const { seeds: treeSeeds } = getCommitmentTreePDASeeds();
```

### Note Generation

Create and manage shielded notes:

```typescript
import {
  generateNote,
  deriveNote,
  createClaimLink,
  parseClaimLink,
} from '@zvault/sdk';

// Generate random note
const note = generateNote(100000n);

// Derive deterministic note from seed
const note = deriveNote('my-secret-phrase', 0, 100000n);

// Create shareable claim link
const link = createClaimLink(note);

// Parse claim link
const parsed = parseClaimLink(link);
```

### Taproot Address Derivation

Generate BTC deposit addresses:

```typescript
import { deriveTaprootAddress, verifyTaprootAddress } from '@zvault/sdk';

// Derive taproot address from commitment
const address = deriveTaprootAddress(commitment, 'testnet');

// Verify address matches commitment
const isValid = verifyTaprootAddress(address, commitment, 'testnet');
```

### Merkle Proofs

Work with the on-chain commitment tree:

```typescript
import {
  createMerkleProof,
  proofToNoirFormat,
  TREE_DEPTH,
} from '@zvault/sdk';

const proof = createMerkleProof(leaves, leafIndex);
const noirProof = proofToNoirFormat(proof);
```

## API Reference

### Stealth Module

| Function | Description |
|----------|-------------|
| `createStealthDeposit(recipient, amount)` | Create stealth deposit for recipient |
| `scanAnnouncements(keys, announcements)` | Scan for deposits using viewing key |
| `scanByZkeyName(keys, name, conn, announcements)` | Scan with .zkey name verification |
| `prepareClaimInputs(keys, note, proof)` | Prepare inputs for ZK claim proof |
| `parseStealthAnnouncement(data)` | Parse on-chain announcement data |
| `resolveZkeyName(conn, name)` | Look up .zkey name (send-only) |

### Name Registry Module

| Function | Description |
|----------|-------------|
| `lookupZkeyName(conn, name)` | Look up .zkey name to stealth address |
| `lookupZkeyNameWithPDA(getAccountInfo, name)` | Look up with pre-computed PDA |
| `isValidName(name)` | Check if name is valid format |
| `normalizeName(name)` | Normalize name (lowercase, trim) |
| `hashName(name)` | SHA256 hash of name |
| `buildRegisterNameData(name, spending, viewing)` | Build register instruction |
| `buildUpdateNameData(name, spending, viewing)` | Build update instruction |
| `buildTransferNameData(name)` | Build transfer instruction |

### Demo Module

| Function | Description |
|----------|-------------|
| `buildAddDemoNoteData(secret)` | Build demo note instruction data |
| `buildAddDemoStealthData(ephemeral, commit, amount)` | Build demo stealth data |
| `getPoolStatePDASeeds()` | Get pool state PDA seeds |
| `getCommitmentTreePDASeeds()` | Get commitment tree PDA seeds |
| `getStealthAnnouncementPDASeeds(ephemeral)` | Get stealth PDA seeds |
| `getDemoNoteAccountMetas()` | Get account metas for demo note |
| `getDemoStealthAccountMetas()` | Get account metas for demo stealth |

### Key Derivation Module

| Function | Description |
|----------|-------------|
| `deriveKeysFromWallet(wallet)` | Derive keys from wallet signature |
| `deriveKeysFromSignature(sig)` | Derive keys from raw signature |
| `deriveKeysFromSeed(seed)` | Derive keys from seed bytes |
| `createStealthMetaAddress(keys)` | Create stealth meta-address |
| `createDelegatedViewKey(keys, perms, expiry)` | Create delegated view key |

### Constants

```typescript
// Program IDs
ZVAULT_PROGRAM_ID        // Main zVault program (devnet)
CHADBUFFER_PROGRAM_ID    // ChadBuffer for SPV proofs

// Merkle Tree
TREE_DEPTH              // 20
MAX_LEAVES              // 2^20
ZERO_VALUE              // Empty leaf value

// Account Sizes
STEALTH_ANNOUNCEMENT_SIZE         // 98 bytes
NAME_REGISTRY_SIZE                // 180 bytes

// Demo Instructions
DEMO_INSTRUCTION.ADD_DEMO_NOTE    // 21
DEMO_INSTRUCTION.ADD_DEMO_STEALTH // 22
```

## Types

### ZVaultKeys

```typescript
interface ZVaultKeys {
  spendingPubKey: GrumpkinPoint;
  spendingPrivKey: bigint;
  viewingPubKey: GrumpkinPoint;
  viewingPrivKey: bigint;
}
```

### StealthDeposit

```typescript
interface StealthDeposit {
  ephemeralPub: Uint8Array;  // 33 bytes compressed
  amountSats: bigint;
  commitment: Uint8Array;    // 32 bytes
  createdAt: number;
}
```

### ScannedNote

```typescript
interface ScannedNote {
  amount: bigint;
  ephemeralPub: GrumpkinPoint;
  stealthPub: GrumpkinPoint;
  leafIndex: number;
  commitment: Uint8Array;
}
```

### ZkeyStealthAddress

```typescript
interface ZkeyStealthAddress {
  name: string;
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
  stealthMetaAddress: Uint8Array;
  stealthMetaAddressHex: string;
}
```

### ConnectionAdapter

```typescript
interface ConnectionAdapter {
  getAccountInfo: (
    pubkey: { toBytes(): Uint8Array }
  ) => Promise<{ data: Uint8Array } | null>;
}
```

## Groth16 Proof Generation (Sunspot)

Generate compact ~388-byte Groth16 proofs client-side via Sunspot CLI:

```typescript
import {
  generateClaimProofGroth16,
  generateSplitProofGroth16,
  generatePartialPublicProofGroth16,
  configureSunspot,
} from '@zvault/sdk';

// Configure Sunspot prover (circuits directory)
await configureSunspot({ circuitsDir: './circuits' });

// Generate claim proof (~1s)
const claimResult = await generateClaimProofGroth16({
  privKey, pubKeyX, amount: 5_000n,
  leafIndex: BigInt(proof.leafIndex),
  merkleRoot: proof.root,
  merkleProof: { siblings: proof.siblings, indices: proof.indices },
  recipient: recipientAddress,
});
// claimResult.proof is ~388 bytes - fits inline in a single Solana TX

// Generate split proof (~1s)
const splitResult = await generateSplitProofGroth16({
  privKey, pubKeyX, amount: 10_000n,
  leafIndex, merkleRoot, merkleProof,
  output1PubKeyX, output1Amount: 5_000n,
  output2PubKeyX, output2Amount: 5_000n,
});

// Generate partial public spend proof (~1s)
const partialResult = await generatePartialPublicProofGroth16({
  privKey, pubKeyX, amount: 5_000n,
  leafIndex, merkleRoot, merkleProof,
  publicAmount: 3_000n,
  changePubKeyX, changeAmount: 2_000n,
  recipient: recipientAddress,
});
```

### Per-Circuit Sunspot Verifiers

Each circuit has its own deployed verifier program on Solana (different `NR_INPUTS`):

| Circuit | NR_INPUTS | Verifier Program (Devnet) |
|---------|-----------|---------------------------|
| `claim` | 4 | `GfF1RnXivZ9ibg1K2QbwAuJ7ayoc1X9aqVU8P97DY1Qr` |
| `spend_split` | 8 | `EnpfJTd734e99otMN4pvhDvsT6BBgrYhqWtRLLqGbbdc` |
| `spend_partial_public` | 7 | `3K9sDVgLW2rvVvRyg2QT7yF8caaSbVHgJQfUuXiXbHdd` |

## End-to-End Integration Test

Run the full privacy flow on devnet (deposit → split → claim → spend partial public):

```bash
cd sdk
NETWORK=devnet bun run scripts/e2e-integration.ts
```

This generates real Groth16 proofs and submits them on-chain. Expected output:
```
[1/4] Demo Stealth Deposit (10,000 sats) — TX confirmed
[2/4] Split (10,000 → 5,000 + 5,000)   — Groth16 proof ~388 bytes, TX confirmed
[3/4] Claim (5,000 sats → public zkBTC)  — Groth16 proof ~388 bytes, TX confirmed
[4/4] Spend Partial Public (3,000 + 2,000 change) — Groth16 proof ~388 bytes, TX confirmed
```

## Security Considerations

1. **Never expose spending private key** - Only needed for claiming
2. **Viewing key can be delegated** - For balance monitoring without spend capability
3. **Nullifiers prevent double-spending** - Derived from spending key + leaf index
4. **Commitments hide amounts** - Poseidon2 hash of stealth pubkey + amount

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test
```

## License

MIT
