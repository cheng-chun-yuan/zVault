# ZK Proof System

Groth16 proofs on BN254, verified on Solana via `alt_bn128` syscalls.

## Circuits

| Circuit | Constraints | Purpose |
|---------|-------------|---------|
| `deposit` | ~250 | Prove commitment = Poseidon(Poseidon(nullifier, secret), amount) |
| `partial_withdraw` | ~6,200 | Withdraw any amount with change |

## Withdraw Circuit

**Privacy**: All withdrawals look identical. Change >= 0.

### Public Inputs
- `root` - Merkle tree root
- `nullifierHash` - Poseidon(nullifier), prevents double-spend
- `withdrawAmount` - Amount to withdraw (sats)
- `changeCommitment` - Commitment for remaining balance
- `recipient` - BTC address hash

### Private Inputs
- `nullifier, secret, amount` - Input note
- `changeNullifier, changeSecret` - Change note secrets
- `pathElements[20], pathIndices[20]` - Merkle proof

### What It Proves

```
1. Input note exists in tree: MerkleProof(commitment, path) == root
2. Nullifier hash correct: nullifierHash == Poseidon(nullifier)
3. Valid amounts: withdrawAmount <= amount
4. Change commitment correct: changeCommitment == Poseidon(Poseidon(changeNullifier, changeSecret), changeAmount)
```

## Usage

```typescript
import { generatePartialWithdrawProof, prepareWithdrawal } from "@/lib/zVault";

const { changeNote } = prepareWithdrawal(inputNote, withdrawAmount);
const { proof, publicSignals } = await generatePartialWithdrawProof({
  root,
  merkleProof,
  inputNote,
  withdrawAmount,
  recipient: hashBtcAddress(btcAddress),
  changeNote,
});
```

## Files

```
frontend/public/circuits/
├── deposit.wasm              # Circuit WASM
├── deposit_final.zkey        # Proving key
├── deposit_vk.json           # Verification key
├── partial_withdraw.wasm
├── partial_withdraw_final.zkey
└── partial_withdraw_vk.json
```

## Commitment Structure

```
noteHash = Poseidon(nullifier, secret)
commitment = Poseidon(noteHash, amount)
nullifierHash = Poseidon(nullifier)
```

Poseidon is ZK-friendly (~250 constraints vs 25,000 for SHA-256).
