# zVault Zero-Knowledge Proofs

Comprehensive documentation of the Noir circuits used in zVault for privacy-preserving operations. All circuits use Groth16 proofs on BN254, verified on Solana via `alt_bn128` syscalls.

---

## Table of Contents

1. [Overview](#overview)
2. [Circuit Summary](#circuit-summary)
3. [Cryptographic Primitives](#cryptographic-primitives)
4. [Claim Circuit](#claim-circuit)
5. [Split Circuit](#split-circuit)
6. [Transfer Circuit](#transfer-circuit)
7. [Partial Withdraw Circuit](#partial-withdraw-circuit)
8. [Proof of Innocence Circuit](#proof-of-innocence-circuit)
9. [Proof Generation](#proof-generation)
10. [On-Chain Verification](#on-chain-verification)
11. [Merkle Tree Configuration](#merkle-tree-configuration)

---

## Overview

zVault uses Zero-Knowledge Proofs to enable privacy-preserving operations:

| Operation | Privacy | What's Proven |
|-----------|---------|---------------|
| Claim | Unlinkable to deposit | Know commitment secrets, commitment in tree |
| Split | Hidden amounts | 1 input = 2 outputs, amounts conserved |
| Transfer | Refreshed commitment | 1 input = 1 output, same amount |
| Partial Withdraw | Partial amount | Withdraw + change, amounts conserved |
| Proof of Innocence | Selective disclosure | Funds from verified BTC deposit |

### Technology Stack

- **Circuit Language**: Noir
- **Proof System**: Groth16 (constant-size proofs)
- **Curve**: BN254 (alt_bn128)
- **Hash Function**: Poseidon2
- **Embedded Curve**: Grumpkin (for ECDH)
- **Verification**: Solana syscalls (`sol_alt_bn128`)

---

## Circuit Summary

| Circuit | Purpose | Private Inputs | Public Inputs |
|---------|---------|----------------|---------------|
| `claim` | Claim zBTC | nullifier, secret, amount, merkle_path | root, nullifier_hash, amount |
| `split` | Split 1→2 | input note, outputs, merkle_path | root, input_nullifier_hash, output_commitments |
| `transfer` | Refresh 1→1 | input note, output note, merkle_path | root, nullifier_hash, output_commitment |
| `partial_withdraw` | Withdraw + change | input note, change note, merkle_path | root, nullifier_hash, withdraw_amount, change_commitment |
| `proof_of_innocence` | Compliance proof | spending_key, note data, innocence_path | innocence_root, nullifier_hash |

### Merkle Tree Depth

All circuits use **depth 20** (~1M leaves capacity).

---

## Cryptographic Primitives

### Poseidon2 Hashing

ZK-friendly hash function over BN254 scalar field:

```noir
use dep::poseidon::poseidon2::Poseidon2;

// Hash two field elements
let hash = Poseidon2::hash([a, b], 2);
```

### Commitment Structure

```
noteHash = Poseidon2(nullifier, secret)
commitment = Poseidon2(noteHash, amount)
nullifierHash = Poseidon2(nullifier)
```

**Why this structure?**
- `noteHash` binds nullifier and secret
- Adding amount creates final commitment
- Nullifier hash prevents double-spend without revealing nullifier

### Grumpkin Curve

Embedded curve for efficient in-circuit ECDH:

```noir
use dep::zvault_utils::grumpkin;

// ECDH shared secret
let (shared_x, shared_y) = grumpkin::ecdh(my_scalar, their_point);

// Derive note public key
let note_pub_key = grumpkin::derive_note_pubkey(shared_x, shared_y);

// Compute stealth commitment
let commitment = grumpkin::compute_stealth_commitment(note_pub_key, amount, random);
```

---

## Claim Circuit

**File**: `noir-circuits/claim/src/main.nr`

Proves knowledge of a commitment's secrets and its existence in the Merkle tree.

### Purpose

- Claim zBTC after BTC deposit is verified
- Proves: "I know the secrets for a commitment in the tree"
- Outputs nullifier hash to prevent double-spend

### Inputs

**Private:**
```noir
nullifier: Field,          // Random 254-bit secret
secret: Field,             // Random 254-bit secret
amount: Field,             // Amount in satoshis
merkle_path: [Field; 20],  // Sibling hashes
path_indices: [u1; 20],    // Left/right flags
```

**Public:**
```noir
merkle_root: pub Field,    // Current tree root
nullifier_hash: pub Field, // Poseidon2(nullifier)
amount_pub: pub Field,     // Claimed amount
```

### Constraints

```noir
// 1. Compute commitment
let commitment = compute_commitment_from_secrets(nullifier, secret, amount);

// 2. Verify commitment in Merkle tree
assert(verify_merkle_proof_20(commitment, merkle_root, merkle_path, path_indices));

// 3. Verify nullifier hash
assert(nullifier_hash == compute_nullifier_hash(nullifier));

// 4. Verify amount matches
assert(amount == amount_pub);
```

### Usage

```typescript
import { generateClaimProof } from '@zvault/sdk';

const { proof, publicInputs } = await generateClaimProof({
  nullifier: note.nullifier,
  secret: note.secret,
  amount: note.amount,
  merklePath: merkleProof.pathElements,
  pathIndices: merkleProof.pathIndices,
  merkleRoot: currentRoot,
});
```

---

## Split Circuit

**File**: `noir-circuits/split/src/main.nr`

Splits one commitment into two outputs with amount conservation.

### Purpose

- Divide balance into two parts
- Enables partial spends
- Both outputs are new commitments

### Inputs

**Private:**
```noir
// Input note
input_nullifier: Field,
input_secret: Field,
input_amount: u64,
merkle_path: [Field; 20],
path_indices: [u1; 20],

// Output 1
output1_nullifier: Field,
output1_secret: Field,
output1_amount: u64,

// Output 2
output2_nullifier: Field,
output2_secret: Field,
output2_amount: u64,
```

**Public:**
```noir
merkle_root: pub Field,
input_nullifier_hash: pub Field,
output_commitment1: pub Field,
output_commitment2: pub Field,
```

### Constraints

```noir
// 1. Amount conservation
assert(input_amount == output1_amount + output2_amount);

// 2. Input exists in tree
let input_commitment = compute_commitment(input_nullifier, input_secret, input_amount);
assert(verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices));

// 3. Nullifier hash correct
assert(input_nullifier_hash == compute_nullifier_hash(input_nullifier));

// 4. Output commitments match
assert(output_commitment1 == compute_commitment(output1_nullifier, output1_secret, output1_amount));
assert(output_commitment2 == compute_commitment(output2_nullifier, output2_secret, output2_amount));

// 5. Nullifier uniqueness (security)
assert(output1_nullifier != output2_nullifier);
assert(output1_nullifier != input_nullifier);
assert(output2_nullifier != input_nullifier);
```

### Security Properties

- **Amount Conservation**: No inflation possible
- **Nullifier Uniqueness**: Prevents replay attacks
- **Input Validation**: Must exist in tree

---

## Transfer Circuit

**File**: `noir-circuits/transfer/src/main.nr`

Refreshes a commitment (1→1) with new secrets.

### Purpose

- Change commitment secrets without changing amount
- Privacy refresh (break transaction graph)
- Same amount, new nullifier/secret

### Inputs

**Private:**
```noir
nullifier: Field,
secret: Field,
amount: Field,
merkle_path: [Field; 20],
path_indices: [u1; 20],
output_nullifier: Field,
output_secret: Field,
```

**Public:**
```noir
merkle_root: pub Field,
nullifier_hash: pub Field,
output_commitment: pub Field,
```

### Constraints

```noir
// 1. Input in tree
let input_commitment = compute_commitment(nullifier, secret, amount);
assert(verify_merkle_proof_20(input_commitment, merkle_root, merkle_path, path_indices));

// 2. Nullifier hash correct
assert(nullifier_hash == compute_nullifier_hash(nullifier));

// 3. Output commitment (same amount)
assert(output_commitment == compute_commitment(output_nullifier, output_secret, amount));

// 4. New nullifier required
assert(output_nullifier != nullifier);
```

---

## Partial Withdraw Circuit

**File**: `noir-circuits/partial_withdraw/src/main.nr`

Withdraws a portion and creates change output.

### Purpose

- Withdraw any amount ≤ balance
- Creates change commitment for remainder
- Full withdraw if change_amount = 0

### Inputs

**Private:**
```noir
nullifier: Field,
secret: Field,
amount: u64,
merkle_path: [Field; 20],
path_indices: [u1; 20],
change_nullifier: Field,
change_secret: Field,
change_amount: u64,
```

**Public:**
```noir
merkle_root: pub Field,
nullifier_hash: pub Field,
withdraw_amount: pub u64,
change_commitment: pub Field,
recipient: pub Field,       // BTC address hash (binding)
```

### Constraints

```noir
// 1. Input in tree
let commitment = compute_commitment(nullifier, secret, amount);
assert(verify_merkle_proof_20(commitment, merkle_root, merkle_path, path_indices));

// 2. Nullifier hash
assert(nullifier_hash == compute_nullifier_hash(nullifier));

// 3. Amount conservation
assert(withdraw_amount <= amount);
assert(amount == withdraw_amount + change_amount);

// 4. Change commitment
assert(change_commitment == compute_commitment(change_nullifier, change_secret, change_amount));

// 5. Change nullifier uniqueness (if change > 0)
if change_amount > 0 {
    assert(change_nullifier != nullifier);
}
```

---

## Proof of Innocence Circuit

**File**: `noir-circuits/proof_of_innocence/src/main.nr`

Proves funds originated from verified BTC deposit (compliance feature).

### Purpose

- Voluntary compliance disclosure
- Prove funds are "clean" (from BTC deposits)
- Without revealing which specific deposit

### Architecture

```
BTC Deposit → SPV Verify → Add to InnocenceTree
                                      ↓
User proves: "My note came from verified BTC deposit"
             WITHOUT revealing which deposit
```

### Inputs

**Private:**
```noir
// Spending key (Grumpkin)
spending_priv: Field,

// Ephemeral public key (from sender)
ephemeral_spend_pub_x: Field,
ephemeral_spend_pub_y: Field,

// Note data
amount: Field,
random: Field,
leaf_index: Field,

// Innocence tree Merkle proof
innocence_merkle_path: [Field; 20],
innocence_path_indices: [u1; 20],
```

**Public:**
```noir
innocence_tree_root: pub Field,  // Root of verified deposits tree
nullifier_hash: pub Field,       // Links to actual spending
```

### Constraints

```noir
// 1. Derive commitment via Grumpkin ECDH
let spending_scalar = grumpkin::scalar_from_field(spending_priv);
let ephemeral_pub = grumpkin::point_from_coords(ephemeral_spend_pub_x, ephemeral_spend_pub_y);
let (shared_x, shared_y) = grumpkin::ecdh(spending_scalar, ephemeral_pub);
let note_pub_key = grumpkin::derive_note_pubkey(shared_x, shared_y);
let commitment = grumpkin::compute_stealth_commitment(note_pub_key, amount, random);

// 2. Verify in innocence tree (only verified BTC deposits)
assert(innocence_tree_root == compute_merkle_root(commitment, leaf_index, innocence_merkle_path, innocence_path_indices));

// 3. Verify nullifier links to spending
let nullifier = grumpkin::compute_stealth_nullifier(spending_priv, leaf_index);
assert(nullifier_hash == grumpkin::hash_nullifier(nullifier));
```

### Use Cases

- Exchange integration (prove clean source)
- Regulatory compliance (voluntary disclosure)
- Institutional requirements

---

## Proof Generation

### Browser/Node.js (WASM)

```typescript
import { initProver, generateClaimProof } from '@zvault/sdk';

// Initialize prover
await initProver();

// Generate proof
const { proof, publicInputs } = await generateClaimProof({
  nullifier: note.nullifier,
  secret: note.secret,
  amount: note.amount,
  merklePath: merkleProof.pathElements,
  pathIndices: merkleProof.pathIndices,
  merkleRoot: currentRoot,
});
```

### React Native (Native)

```typescript
import { generateProof } from 'noir-react-native';

const circuit = require('./circuits/claim.json');

const { proof, publicInputs } = await generateProof(circuit, {
  nullifier: note.nullifier,
  secret: note.secret,
  // ... other inputs
});
```

### CLI (Development)

```bash
cd noir-circuits/claim

# Compile
nargo compile

# Execute (generates witness)
nargo execute

# Prove
bb prove -b ./target/claim.json -w ./target/claim.gz -o ./proof

# Verify locally
bb verify -k ./target/vk -p ./proof
```

---

## On-Chain Verification

### Solana `alt_bn128` Syscalls

The Solana runtime provides native BN254 operations:

```rust
// Groth16 verification equation:
// e(A, B) = e(α, β) × e(vk_x, γ) × e(C, δ)

pub fn verify_groth16(
    vk: &VerificationKey,
    proof: &Groth16Proof,
    public_inputs: &[[u8; 32]],
) -> Result<bool, ProgramError> {
    // 1. Compute vk_x = vk.ic[0] + Σ(input[i] × vk.ic[i+1])
    let mut vk_x = vk.ic[0];
    for (i, input) in public_inputs.iter().enumerate() {
        let mul_result = alt_bn128_multiplication(&vk.ic[i + 1], input)?;
        vk_x = alt_bn128_addition(&vk_x, &mul_result)?;
    }

    // 2. Pairing check
    let neg_a = negate_g1(&proof.a)?;
    let pairing_input = [
        neg_a, proof.b,
        vk.alpha, vk.beta,
        vk_x, vk.gamma,
        proof.c, vk.delta,
    ];

    let result = alt_bn128_pairing(&pairing_input)?;
    Ok(result[31] == 1 && result[..31].iter().all(|&b| b == 0))
}
```

### Verification Cost

| Operation | CU Cost |
|-----------|---------|
| G1 scalar mul | ~12,000 |
| G1 addition | ~500 |
| Pairing (4 pairs) | ~75,000 |
| **Total (claim)** | **~95,000** |

---

## Merkle Tree Configuration

### Parameters

```
TREE_DEPTH = 20
MAX_LEAVES = 2^20 = 1,048,576
ROOT_HISTORY_SIZE = 30
ZERO_VALUE = Poseidon2(0)
```

### Structure

```
                    Root
                   /    \
                 /        \
               H₁          H₂
              /  \        /  \
            H₃   H₄     H₅   H₆
           / \   / \   / \   / \
          ... ... ... ... ... ... (20 levels)

Leaves: [C₀, C₁, C₂, ..., Cₙ]
```

### Incremental Insertion

```noir
fn insert_leaf(commitment: Field) -> (u64, Field) {
    let index = next_index;
    next_index += 1;

    let mut current = commitment;
    let mut current_index = index;

    for level in 0..TREE_DEPTH {
        if current_index % 2 == 0 {
            // Left child: update subtree
            filled_subtrees[level] = current;
            current = Poseidon2::hash([current, zeros[level]], 2);
        } else {
            // Right child: hash with left sibling
            current = Poseidon2::hash([filled_subtrees[level], current], 2);
        }
        current_index /= 2;
    }

    let new_root = current;
    roots[root_index] = new_root;
    root_index = (root_index + 1) % ROOT_HISTORY_SIZE;

    (index, new_root)
}
```

### Root History

- Keeps last 30 roots
- Allows proofs against recent roots
- Handles concurrent transactions

---

## Compiling Circuits

```bash
cd noir-circuits

# Compile all circuits
bun run compile:all

# Compile individual circuit
bun run compile:claim
bun run compile:split
bun run compile:transfer
bun run compile:partial_withdraw
bun run compile:proof_of_innocence

# Run tests
bun run test
```

### Output Files

```
noir-circuits/
├── claim/
│   └── target/
│       ├── claim.json         # Circuit artifact
│       ├── vk                  # Verification key
│       └── Prover.toml        # Prover inputs template
├── split/
│   └── target/
│       └── ...
└── ...
```

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [CONTRACTS.md](./CONTRACTS.md) - On-chain verification details
- [SDK.md](./SDK.md) - Proof generation APIs
