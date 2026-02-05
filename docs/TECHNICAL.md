# zVault Technical Documentation

**Privacy-Preserving BTC on Solana with Zero-Knowledge Proofs**

---

## What We Built (30-Second Overview)

zVault is a trustless bridge enabling Bitcoin holders to access Solana with full transaction privacy.

```
BTC Deposit ─► Taproot Address ─► SPV Verify ─► Shielded Pool ─► ZK Transfers ─► Withdraw BTC
                                                      │
                   ┌──────────────────────────────────┴──────────────────────────────────┐
                   │                                                                      │
         Amounts hidden in commitments                            Unlinkable stealth addresses
         Nullifier-based double-spend prevention                  .zkey.sol human-readable names
```

### Key Innovations

| Innovation | What It Does | Why It Matters |
|------------|--------------|----------------|
| **6 Noir ZK Circuits** | Groth16 proofs via Sunspot | ~388 byte proofs fit inline |
| **BN254 Precompiles** | On-chain verification via alt_bn128 | ~200k CU efficient verification |
| **Grumpkin ECDH** | In-circuit elliptic curve operations | ~2k constraints vs ~300k for X25519 |
| **Full SPV Bridge** | Bitcoin light client on Solana | Trustless BTC verification |
| **Stealth Addresses** | EIP-5564/DKSAP protocol | Unlinkable one-time addresses |
| **.zkey Names** | SNS-style name registry | Human-readable stealth addresses |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BITCOIN LAYER                                         │
│   User Wallet ──► Taproot Address ──► Bitcoin Network ──► Block Confirmation    │
│        │              │                                         │               │
│        │         (commitment                              (6+ confirms)         │
│        │          in script)                                    │               │
│        │              │                                         ▼               │
│        │              └──────────────────────────► Header Relayer Service       │
└────────│────────────────────────────────────────────────────────│───────────────┘
         │                                                        │
         │ claim link                                     headers │
         │                                                        │
┌────────▼────────────────────────────────────────────────────────▼───────────────┐
│                            SOLANA LAYER                                          │
│   ┌────────────────────────────────────────────────────────────────────────┐    │
│   │                    BTC Light Client Program                             │    │
│   │         Header Chain │ Difficulty Adjustment │ Block Validation        │    │
│   └────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                        │
│                               SPV proof │                                       │
│                                        ▼                                        │
│   ┌────────────────────────────────────────────────────────────────────────┐    │
│   │                    zVault Program (Pinocchio)                          │    │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │    │
│   │   │ Commitment   │  │  Nullifier   │  │   Stealth    │  │   Name    │  │    │
│   │   │    Tree      │  │  Registry    │  │ Announcements│  │ Registry  │  │    │
│   │   │ (depth 20)   │  │(double-spend)│  │  (ECDH)      │  │ (.zkey)   │  │    │
│   │   └──────────────┘  └──────────────┘  └──────────────┘  └───────────┘  │    │
│   └────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────────-┘
                                         │
                               ZK proofs │
                                         │
┌────────────────────────────────────────▼────────────────────────────────────────┐
│                            CLIENT LAYER                                          │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                         @zvault/sdk                                       │  │
│   │   Note Management │ Proof Generation │ Stealth ECDH │ Taproot Derivation │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│              ┌─────────────────────────┼─────────────────────────┐              │
│        ┌─────▼─────┐            ┌──────▼──────┐           ┌──────▼──────┐       │
│        │  Frontend │            │   Mobile    │           │   Backend   │       │
│        │ (Next.js) │            │   (Expo)    │           │   (Rust)    │       │
│        └───────────┘            └─────────────┘           └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **BTC Light Client** | Maintains Bitcoin header chain, validates SPV proofs |
| **zVault Program** | Manages commitments, nullifiers, stealth announcements, names |
| **Header Relayer** | Syncs Bitcoin headers to Solana (permissionless) |
| **SDK** | Client-side proof generation, key derivation, transaction building |
| **Backend** | BTC redemption signing (FROST), stealth deposit preparation |

---

## Bitcoin Integration (Trustless Bridge)

### Full SPV Implementation

Bitcoin light client running on Solana for trustless deposit verification:

```
┌─────────────────────────────────────────────────────────┐
│                BTC Light Client Program                  │
├─────────────────────────────────────────────────────────┤
│   Header Chain State:                                    │
│   ┌─────────────────────────────────────────────────┐   │
│   │ latest_height: u32                               │   │
│   │ latest_hash: [u8; 32]                           │   │
│   │ chain_work: [u8; 32]                            │   │
│   │ retarget_epoch: u32                             │   │
│   └─────────────────────────────────────────────────┘   │
│                                                          │
│   Instructions:                                          │
│   - SUBMIT_HEADERS: Add new block headers               │
│   - VERIFY_TRANSACTION: SPV proof verification          │
└─────────────────────────────────────────────────────────┘
```

**SPV Verification Flow:**
1. Transaction in block at height H
2. Merkle proof: tx_hash → merkle_root
3. Block header with merkle_root at height H
4. Header chain connects to verified tip (6+ confirmations)

### Taproot Deposit Addresses (BIP-341)

Each deposit gets a unique Taproot address derived from the commitment:

```typescript
// Commitment bound to Taproot script
const commitment = computeCommitment(pubKeyX, amount);
const tweak = taggedHash('TapTweak', internalPubKey, commitment);
const outputPubKey = tweakPublicKey(internalPubKey, tweak);
const address = bech32m.encode('tb', [1, ...outputPubKey]);
```

**Security:** Deposit can only be claimed with correct commitment preimage. No address reuse.

### FROST Threshold Signing

For BTC withdrawals, 2-of-3 multi-party signing:
- Decentralized custody
- No single point of failure
- Backend coordinates signing rounds

---

## Noir ZK Circuits (Privacy Layer)

### Why This Matters

- **Groth16 via Sunspot** = Noir circuits compiled to gnark, then Groth16 proofs
- **Compact proofs** = ~388 bytes fit inline in Solana transactions
- **BN254 precompiles** = efficient on-chain verification (~200k CU)

### 6 ZK Circuits

| Circuit | Purpose | Key Constraints | ~Constraints |
|---------|---------|-----------------|--------------|
| `claim` | Mint zkBTC from deposit | Merkle proof, nullifier, amount match | ~15,000 |
| `spend_split` | Split 1 note → 2 notes | Amount conservation, unique recipients | ~25,000 |
| `spend_partial_public` | Partial withdrawal | Public + change outputs | ~20,000 |
| `pool_deposit` | Enter yield pool | Unified → Pool commitment | ~20,000 |
| `pool_withdraw` | Exit with yield | Yield calculation in-circuit | ~22,000 |
| `pool_claim_yield` | Compound yields | Re-stake with epoch reset | ~28,000 |

### Unified Commitment Model

All circuits use consistent commitment and nullifier formats:

```noir
// Commitment = Poseidon2(pub_key_x, amount)
pub fn compute_commitment(pub_key_x: Field, amount: Field) -> Field {
    Poseidon2::hash([pub_key_x, amount], 2)
}

// Nullifier = Poseidon2(priv_key, leaf_index)
pub fn compute_nullifier(priv_key: Field, leaf_index: Field) -> Field {
    Poseidon2::hash([priv_key, leaf_index], 2)
}

// Pool position includes epoch for yield tracking
pub fn compute_pool_commitment(pub_key_x: Field, principal: Field, deposit_epoch: Field) -> Field {
    Poseidon2::hash([pub_key_x, principal, deposit_epoch], 3)
}
```

### Proof Generation Pipeline

```
Noir Circuit ─► nargo compile ─► Sunspot CLI ─► Groth16 Proof (~388 bytes) ─► Solana
```

**Sunspot Flow:**
1. `nargo compile` - Compile Noir circuit to ACIR
2. `sunspot compile` - Convert ACIR to CCS (gnark constraint system)
3. `sunspot setup` - Generate proving/verification keys
4. `sunspot prove` - Generate Groth16 proof

### Inline Proofs (No Buffer Needed)

**Problem Solved:** Groth16 proofs are ~388 bytes, fitting easily within Solana's 1232 byte tx limit.

```
Proof Data ──► Include inline in instruction data ──► Verify via BN254 precompiles
```

**No ChadBuffer required for ZK proofs** (only for large BTC transactions).

### Why Grumpkin Curve?

Grumpkin is Noir's embedded curve, optimized for in-circuit operations:

| Curve | Constraints | Relative Cost |
|-------|-------------|---------------|
| **Grumpkin** | ~2,000 | 1x |
| X25519 | ~300,000 | 150x |
| secp256k1 | ~400,000 | 200x |

```noir
// Efficient ECDH in-circuit
let spending_scalar = grumpkin::scalar_from_field(spending_priv);
let (shared_x, shared_y) = grumpkin::ecdh(spending_scalar, ephemeral_pub);
```

---

## Stealth Addresses (Privacy Innovation)

### EIP-5564/DKSAP Protocol

Dual-Key Stealth Address Protocol adapted for Grumpkin curve:

```
User Keys:
├── spending_priv ──► spending_pub (can spend funds)
└── viewing_priv  ──► viewing_pub  (can detect incoming)

Stealth Meta-Address (public, shareable):
[spending_pub || viewing_pub] = 66 bytes
```

### Protocol Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│   SENDER                                            RECIPIENT               │
│                                                                              │
│   eph_priv ───┐                                     viewing_priv ───┐       │
│               │                                                     │       │
│               ▼                                                     │       │
│          eph_pub ─────────── On-Chain ──────────► eph_pub          │       │
│               │              Announcement              │            │       │
│               │                                        ▼            │       │
│               │              viewing_pub ◄──────── ECDH ◄───────────┘       │
│               │                   │                    │                    │
│               ▼                   ▼                    ▼                    │
│            ECDH ───────────► shared_secret ◄────── SAME!                   │
│               │                                        │                    │
│               ▼                                        ▼                    │
│          note_pub ─────────────────────────────► note_pub                  │
│               │                                        │                    │
│               ▼                                        ▼                    │
│         commitment ──────── Merkle Tree ────────► commitment               │
│                                                        │ + spending_priv    │
│                                                        ▼                    │
│                                                    ZK PROOF ──► CLAIM      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Properties

| Role | What They Know | What They Can Do |
|------|----------------|------------------|
| **Sender** | Shared secret, recipient pubkeys | Send unlinkable funds |
| **Recipient (Viewing)** | Incoming transfers, amounts | Detect, cannot spend |
| **Recipient (Spending)** | Everything above + nullifier | Claim funds |
| **Observer** | Encrypted data, unlinkable points | Nothing useful |

### On-Chain Announcement Format

```
91 bytes total:
├── eph_pub_x:   32 bytes (Grumpkin x-coordinate)
├── eph_pub_y:   32 bytes (Grumpkin y-coordinate)
├── encrypted:   24 bytes (ChaCha20-Poly1305 ciphertext)
└── commitment:  3 bytes  (truncated for indexing)
```

---

## ChadBuffer Integration

### The Problem

Solana transactions max 1,232 bytes. Large data exceeds this:
- Bitcoin SPV proofs: 500+ bytes
- UltraHonk proofs: 900+ bytes
- Combined verification data

### The Solution

```typescript
// Upload Bitcoin transaction for SPV verification
const bufferAddress = await uploadTransactionToBuffer(rpc, payer, rawBtcTx);

// Upload large UltraHonk proof (>900 bytes)
const { bufferAddress, usedBuffer } = await uploadProofToBuffer(rpc, payer, proofBytes);

// After verification, reclaim rent
await closeBuffer(rpc, payer, bufferAddress);
```

**Program ID:** `C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF`

---

## .zkey Name Registry (SNS-Style)

Human-readable stealth addresses:

```typescript
// Send to alice.zkey.sol
const entry = await lookupZkeyName(connection, 'alice');
await sendPrivate(config, myNote, entry.stealthMetaAddress);

// Reverse lookup
const name = await reverseLookupZkeyName(connection, spendingPubKey);
// => "alice"
```

**Format:** `name.zkey.sol` (1-32 lowercase alphanumeric + underscore)

**Storage:** Maps name → (spendingPubKey, viewingPubKey) + reverse lookup

---

## On-Chain Verification

### Groth16 via BN254 Precompiles

zVault uses the `groth16-solana` crate with Solana's native `alt_bn128` syscalls:

```rust
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};
```

### Embedded Verification Keys

VKs are compiled into the program for efficient verification:

```rust
// VKs embedded at compile time
pub static CLAIM_VK_BYTES: &[u8] = include_bytes!("../../../circuits_vk/claim.vk");

// Parse and verify
let vk = get_claim_vk()?;
verify_groth16_proof_with_vk(&proof_a, &proof_b, &proof_c, &public_inputs, &vk)?;
```

### Compute Unit Budget

| Operation | Compute Units |
|-----------|---------------|
| Groth16 Verification | ~200,000 CU |
| Merkle Update | ~5,000 CU |
| State Updates | ~5,000 CU |
| **Total (Claim)** | **~210,000 CU** |
| **Total (Split)** | **~215,000 CU** |

---

## Program Instructions Reference

| Disc | Name | Purpose | CU |
|------|------|---------|-----|
| 0 | `INITIALIZE` | Initialize pool state | 30k |
| 4 | `SPLIT_COMMITMENT` | Split 1 → 2 notes | ~100k |
| 5 | `REQUEST_REDEMPTION` | Burn zkBTC, request BTC | 50k |
| 8 | `VERIFY_DEPOSIT` | Record BTC deposit (SPV) | 150k |
| 9 | `CLAIM` | Mint zkBTC with ZK proof | ~95k |
| 12 | `ANNOUNCE_STEALTH` | Stealth transfer announce | 50k |
| 17 | `REGISTER_NAME` | Register .zkey name | 30k |

---

## Cryptography Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Proof System** | Groth16 (BN254) via Sunspot | ZK proof generation/verification |
| **Prover** | Sunspot CLI (gnark backend) | Generates ~388 byte proofs |
| **Verifier** | groth16-solana + alt_bn128 | On-chain verification (~200k CU) |
| **Hash Function** | Poseidon2 | ZK-friendly hashing (~160 constraints) |
| **Commitment** | `Poseidon2(pub_key_x, amount)` | Binding to amounts |
| **Nullifier** | `Poseidon2(priv_key, leaf_index)` | Double-spend prevention |
| **Stealth** | Grumpkin ECDH (EIP-5564) | Unlinkable addresses |
| **BTC Deposits** | Taproot (BIP-341) | Commitment-bound addresses |
| **Merkle Tree** | Depth 20 (~1M leaves) | Commitment storage |

---

## Security Model

### Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Double-spend | Nullifier registry (on-chain set) |
| Fake deposits | SPV proof with 6+ confirmations |
| Link deposit→claim | ZK proof hides preimage |
| Link sender→receiver | Stealth addresses (ECDH) |
| Front-running claims | Bearer instrument model |
| Malicious relayer | Permissionless header submission |

### Privacy Guarantees

| Operation | Amount Visible | Linkable |
|-----------|---------------|----------|
| Deposit BTC | On Bitcoin chain | No (to claim) |
| Claim zkBTC | No | No |
| Split | No | No |
| Stealth Send | No | Recipient only |
| Withdraw BTC | On Bitcoin chain | No (to deposit) |

### Trust Assumptions

| Component | Trust Level |
|-----------|-------------|
| BTC Network | 51% honest hashpower |
| Solana Network | 67% honest validators |
| ZK Circuits | Sound proof system |
| Grumpkin ECDH | ECDLP hardness |
| Poseidon2 | Collision resistance |

---

## Program IDs

| Program | Network | Address |
|---------|---------|---------|
| zVault | Devnet | `zKeyrLmpT8W9o8iRvhizuSihLAFLhfAGBvfM638Pbw8` |
| BTC Light Client | Devnet | `S6rgPjCeBhkYBejWyDR1zzU3sYCMob36LAf8tjwj8pn` |
| ChadBuffer | Devnet | `C5RpjtTMFXKVZCtXSzKXD4CDNTaWBg3dVeMfYvjZYHDF` |

**Note:** Groth16 verification is done inline using embedded VKs and BN254 precompiles - no separate verifier program needed.

---

## Performance

### Proof Generation (Sunspot CLI)

| Circuit | Constraints | Prove Time* | Proof Size |
|---------|-------------|-------------|------------|
| claim | ~15,000 | ~2s | ~388 bytes |
| spend_split | ~25,000 | ~3s | ~388 bytes |
| pool_deposit | ~20,000 | ~2.5s | ~388 bytes |
| pool_withdraw | ~22,000 | ~2.5s | ~388 bytes |
| pool_claim_yield | ~28,000 | ~3.5s | ~388 bytes |

*Approximate times with Sunspot CLI (gnark backend)

### On-Chain Verification

| Operation | Compute Units |
|-----------|---------------|
| Groth16 Proof Verification | ~200,000 CU |
| Merkle Tree Update | ~5,000 CU |
| State Updates | ~5,000 CU |

### Scalability

- **Merkle Tree**: 2^20 = ~1 million commitments
- **Nullifier Set**: Unbounded (PDA per nullifier)
- **Header Chain**: ~550 bytes per header
- **Inline Proofs**: ~388 bytes (no buffer needed)

---

## Related Documentation

- [SDK Reference](./SDK.md) - TypeScript SDK guide
- [Main README](../README.md) - Project overview
