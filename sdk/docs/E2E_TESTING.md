# E2E Testing Guide

## Network Requirements

### Poseidon Hash Support

The zVault protocol uses **Poseidon hash** for Merkle tree operations, which is compatible with:
- Noir ZK circuits (`std::hash::poseidon::bn254`)
- Solana's `sol_poseidon` syscall (available on devnet/mainnet)

### Localnet Limitation

**Important:** The Solana test validator (`solana-test-validator`) does NOT support the Poseidon syscall. When the on-chain program is built with the `localnet` feature, it falls back to SHA256 for Merkle tree hashing.

This creates a **hash mismatch** between:
- On-chain tree: SHA256 (localnet) vs Poseidon (devnet/mainnet)
- Noir circuit: Always uses Poseidon

**Result:** Real ZK proof tests cannot work on localnet because the circuit expects Poseidon-based Merkle proofs but the on-chain tree uses SHA256.

## Recommended Test Environments

### For Full E2E Testing (with real ZK proofs)

Use **devnet** which supports the Poseidon precompile:

```bash
# Run E2E tests on devnet
NETWORK=devnet bun run e2e:devnet
```

Requirements:
- Programs deployed to devnet
- Funded devnet wallet
- Compiled circuits (`cd noir-circuits && bun run compile:all && bun run copy-to-sdk`)

### For Unit/Integration Testing (no real proofs)

Use **localnet** for faster iteration:

```bash
# Start validator
solana-test-validator --reset

# Deploy programs (in contracts directory)
cd contracts && bun run deploy:localnet

# Run tests
cd sdk && bun test test/e2e/*.test.ts
```

The SDK automatically enables localnet mode (SHA256 for tree hashing) to match on-chain behavior.

## Test Categories

| Test Type | Localnet | Devnet | Description |
|-----------|----------|--------|-------------|
| Unit tests | ✅ | ✅ | No on-chain calls |
| Instruction building | ✅ | ✅ | Builds instructions, no submission |
| Mock proof tests | ✅ | ✅ | Uses mock proofs, validates structure |
| Tree root matching | ✅ | ✅ | SDK tree matches on-chain root |
| Real ZK proof generation | ⚠️ | ✅ | Requires Poseidon-compatible tree |
| Full claim flow | ❌ | ✅ | Requires Poseidon on-chain |

⚠️ = Works for simple proofs (all-zero siblings), fails with real on-chain tree
❌ = Cannot work due to hash mismatch

## SDK Localnet Mode

The SDK automatically detects localnet and switches Merkle tree hashing:

```typescript
import { useLocalnetMode, isLocalnetMode } from "@zvault/sdk";

// Manually enable/disable (usually automatic)
useLocalnetMode(true);  // SHA256 for Merkle hashing
useLocalnetMode(false); // Poseidon for Merkle hashing

// Check current mode
if (isLocalnetMode()) {
  console.log("Using SHA256 for Merkle hashing (localnet)");
}
```

## Running Devnet E2E Tests

### Prerequisites

1. **Deploy programs to devnet:**
   ```bash
   cd contracts
   solana config set --url devnet
   bun run deploy:devnet
   ```

2. **Fund your wallet:**
   ```bash
   solana airdrop 2 --url devnet
   ```

3. **Compile circuits:**
   ```bash
   cd noir-circuits
   bun run compile:all
   bun run copy-to-sdk
   ```

### Run Tests

```bash
cd sdk
NETWORK=devnet bun run e2e:devnet
```

Or run specific test file:
```bash
NETWORK=devnet bun test test/e2e/claim.test.ts
```

## Troubleshooting

### Error: InvalidRoot (6021)

**Cause:** SDK-computed Merkle root doesn't match on-chain root history.

**Solutions:**
1. Ensure localnet mode is enabled for localnet testing
2. Check that both SDK and on-chain use same hash function
3. Verify commitment tree is properly initialized

### Error: Value exceeds field modulus

**Cause:** SHA256 values (localnet) passed to Noir circuit which expects field elements.

**Solution:** Use devnet for real proof tests. SHA256 can produce values > BN254 field modulus.

### Error: Poseidon not initialized

**Cause:** `initPoseidon()` not called before using hash functions.

**Solution:** Call `initPoseidon()` at test setup:
```typescript
import { initPoseidon } from "@zvault/sdk";

beforeAll(async () => {
  await initPoseidon();
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Test Flow                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│  │  Create  │───▶│  Build   │───▶│ Generate │               │
│  │  Note    │    │  Tree    │    │  Proof   │               │
│  └──────────┘    └──────────┘    └──────────┘               │
│       │               │               │                      │
│       │               │               │                      │
│       ▼               ▼               ▼                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    On-Chain                           │   │
│  │  ┌─────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │ Stealth │  │ Commitment  │  │    Verifier     │   │   │
│  │  │ Deposit │  │    Tree     │  │  (UltraHonk)    │   │   │
│  │  └─────────┘  └─────────────┘  └─────────────────┘   │   │
│  │                     │                   │             │   │
│  │                     │  Hash Function    │             │   │
│  │                     │                   │             │   │
│  │            ┌────────┴────────┐          │             │   │
│  │            │                 │          │             │   │
│  │      ┌─────▼─────┐    ┌─────▼─────┐    │             │   │
│  │      │  SHA256   │    │  Poseidon │    │             │   │
│  │      │ (localnet)│    │  (devnet) │◀───┘             │   │
│  │      └───────────┘    └───────────┘                  │   │
│  │                                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Poseidon-Enabled Localnet

You can run a localnet with devnet-like features (including Poseidon syscall) using the `--clone-feature-set` flag:

### Setup

1. **Start Poseidon-enabled validator:**
   ```bash
   cd contracts
   bun run start:localnet-poseidon
   # Or with reset: bun run start:localnet-poseidon:reset
   ```

   This starts `solana-test-validator` with `--clone-feature-set --url devnet` which clones all devnet feature flags including the Poseidon syscall.

2. **Deploy programs (built WITHOUT localnet feature):**
   ```bash
   cd contracts
   bun run build:devnet  # Build with Poseidon (not SHA256)
   bun run deploy:localnet-poseidon
   ```

3. **Run tests with Poseidon enabled:**
   ```bash
   cd sdk
   bun run test:e2e:localnet-poseidon
   # Or for instruction building:
   bun run e2e:localnet-poseidon
   ```

### How It Works

- The validator clones devnet's feature flags, enabling `sol_poseidon` syscall
- Programs are built with `--features devnet` (uses Poseidon for Merkle tree)
- SDK detects `POSEIDON_ENABLED=true` and uses Poseidon for Merkle hashing
- Full ZK proof flow works locally without needing actual devnet

### Test Categories (Updated)

| Test Type | Localnet (SHA256) | Localnet-Poseidon | Devnet | Description |
|-----------|-------------------|-------------------|--------|-------------|
| Unit tests | ✅ | ✅ | ✅ | No on-chain calls |
| Instruction building | ✅ | ✅ | ✅ | Builds instructions, no submission |
| Mock proof tests | ✅ | ✅ | ✅ | Uses mock proofs, validates structure |
| Tree root matching | ✅ | ✅ | ✅ | SDK tree matches on-chain root |
| Real ZK proof generation | ⚠️ | ✅ | ✅ | Requires Poseidon-compatible tree |
| Full claim flow | ❌ | ✅ | ✅ | Requires Poseidon on-chain |

⚠️ = Works for simple proofs (all-zero siblings), fails with real on-chain tree
❌ = Cannot work due to hash mismatch

### Notes

- First start may take time to clone features from devnet
- Requires network connectivity to devnet for initial feature clone
- Ledger is stored in `.localnet-ledger` (use `--reset` to clear)
- This approach avoids devnet rate limits and is faster for development
