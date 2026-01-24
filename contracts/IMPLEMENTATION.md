# zVault Implementation Summary

## Simplified Architecture

The protocol has been simplified to 6 main user-facing functions:

| Function | SDK Module | Noir Circuit | Program Instruction |
|----------|------------|--------------|---------------------|
| **deposit** | note, taproot, claim-link | helpers | VERIFY_DEPOSIT (8) |
| **withdraw** | note, merkle, proof | `partial_withdraw` | REQUEST_REDEMPTION (5) |
| **privateClaim** | claim-link, merkle, proof | `claim` | CLAIM (9) |
| **privateSplit** | note, merkle, proof | `split` | SPLIT_COMMITMENT (4) |
| **sendLink** | claim-link | — | None (off-chain) |
| **sendStealth** | stealth | helpers | ANNOUNCE_STEALTH (12) |

---

## What Was Implemented

### 1. Noir ZK Circuits (`noir-circuits/`)

Migrated from Circom to Noir UltraHonk proofs:

- **`claim/`**: Proves knowledge of (nullifier, secret) + Merkle inclusion
- **`split/`**: 1-in-2-out with amount conservation
- **`partial_withdraw/`**: Withdraw with change commitment
- **`helpers/`**: Poseidon2 hash computation utilities

All circuits use:
- Poseidon2 hashing (native to Noir)
- 10-level Merkle tree (1024 leaves)
- BN254 curve

### 2. TypeScript SDK (`sdk/`)

Simplified API with 6 main functions:

| Module | Description |
|--------|-------------|
| `api.ts` | 6 main functions (deposit, withdraw, etc.) |
| `zVault.ts` | High-level SDK client |
| `note.ts` | Note generation with nullifier/secret |
| `merkle.ts` | Client-side Merkle tree |
| `taproot.ts` | BIP-341 address derivation |
| `claim-link.ts` | URL encoding/decoding |
| `proof.ts` | Noir UltraHonk proof generation |
| `stealth.ts` | X25519 ECDH stealth addresses |
| `chadbuffer.ts` | SPV transaction upload |

### 3. Pinocchio Program (`programs/zVault-pinocchio/`)

Low-level optimized Solana program with ~84% CU savings.

**Core Instructions:**
- `VERIFY_DEPOSIT (8)` - SPV verify BTC deposit, add commitment to tree
- `CLAIM (9)` - ZK claim sbBTC to wallet
- `SPLIT_COMMITMENT (4)` - Split commitment 1→2
- `REQUEST_REDEMPTION (5)` - Burn sbBTC, queue BTC withdrawal
- `COMPLETE_REDEMPTION (6)` - Mark redemption complete
- `ANNOUNCE_STEALTH (12)` - Create stealth address announcement

**State Accounts:**
- `PoolState` - Main pool configuration
- `CommitmentTree` - Sparse Merkle tree
- `BitcoinLightClient` - Chain state tracking
- `BlockHeader` - Stored Bitcoin headers
- `DepositRecord` - Individual deposits
- `NullifierRecord` - Double-spend prevention
- `StealthAnnouncement` - ECDH stealth transfers

---

## Flow Diagrams

### Deposit Flow
```
1. User calls SDK deposit(amount)
   → Generate random nullifier + secret
   → Derive taproot address from commitment
   → Create claim link

2. User sends BTC to taproot address (external)

3. Call VERIFY_DEPOSIT instruction
   → Upload BTC tx to ChadBuffer
   → SPV verify merkle proof + block header
   → Add commitment to on-chain tree
```

### Claim Flow
```
1. Parse claim link or use Note directly
2. Get Merkle proof for commitment
3. Generate claim ZK proof (Noir)
4. Call CLAIM instruction
   → Verify ZK proof
   → Mark nullifier as spent
   → Mint sbBTC to user
```

### Split Flow
```
1. Generate two output notes
2. Generate split ZK proof (Noir)
3. Call SPLIT_COMMITMENT instruction
   → Verify ZK proof
   → Nullify input commitment
   → Add two output commitments to tree
4. Distribute outputs:
   → sendLink(output1) - shareable URL
   → sendStealth(output2, pubkey) - ECDH recipient
```

---

## Build Instructions

### Noir Circuits
```bash
cd noir-circuits
bun install
nargo compile
```

### SDK
```bash
cd contracts/sdk
bun install
bun run build
```

### Contracts
```bash
cd contracts
anchor build
# Or: cargo build-sbf --package zVault-pinocchio
```

### Tests
```bash
cd contracts
bun run test
```

---

## File Structure

```
contracts/
├── programs/
│   └── zVault-pinocchio/  # Main program
│       └── src/
│           ├── lib.rs            # Entry point
│           ├── instructions/     # Handlers
│           │   ├── verify_deposit.rs
│           │   ├── claim.rs
│           │   ├── split_commitment.rs
│           │   ├── request_redemption.rs
│           │   └── announce_stealth.rs
│           └── state/            # Accounts
├── sdk/                          # TypeScript SDK
│   └── src/
│       ├── api.ts               # 6 main functions
│       ├── zVault.ts     # Client class
│       └── index.ts             # Exports
└── noir-circuits/               # ZK circuits
    ├── claim/
    ├── split/
    └── partial_withdraw/
```

---

## Usage Example

```typescript
import { createClient } from '@zVault/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');
const client = createClient(connection, 'devnet');
client.setPayer(myKeypair);

// 1. DEPOSIT: Generate credentials
const deposit = await client.deposit(100_000n);
console.log('Send BTC to:', deposit.taprootAddress);
console.log('Claim link:', deposit.claimLink);

// 2. CLAIM: After BTC verified on-chain
const result = await client.privateClaim(deposit.claimLink);

// 3. SPLIT: Divide into two outputs
const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);

// 4. SEND: Choose distribution method per output
const link = client.sendLink(output1);           // Anyone can claim
await client.sendStealth(output2, alicePubKey);  // Only Alice can claim

// 5. WITHDRAW: Burn sbBTC for BTC
await client.withdraw(myNote, 'bc1q...');
```

---

## Security Notes

**WARNING: Proof-of-concept for hackathon demonstration.**

Known limitations:
- Noir UltraHonk proofs not audited
- Simplified SPV verification
- Stack size constraints in some instructions

Production requirements:
- Full security audit
- Formal verification of ZK circuits
- Multi-party custody (FROST) for BTC reserves
