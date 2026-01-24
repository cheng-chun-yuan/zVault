# czBTC - Privacy-Preserving Bitcoin Bridge to Solana

## Demo Presentation Script (5-7 minutes)

---

## 🎬 INTRO (1 min)

### The Problem
> "Today, bridging Bitcoin to other chains requires trusting centralized custodians.
> When you use WBTC, you're trusting BitGo. When you use other bridges, you're trusting their multisig.
> And the worst part? Every transaction is publicly traceable."

### Our Solution: czBTC
> "czBTC is a **trustless, privacy-preserving** Bitcoin bridge to Solana.
> - **Trustless**: SPV proofs verify deposits - no oracle needed
> - **Private**: ZK proofs break the link between deposits and claims
> - **Self-custody**: Two-path Taproot lets users refund if anything goes wrong"

---

## 🏗️ ARCHITECTURE (30 sec)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         czBTC ARCHITECTURE                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   BITCOIN                    SOLANA                                   │
│   ┌─────────┐               ┌─────────────────────────────────┐      │
│   │ User    │               │  btc-light-client               │      │
│   │ sends   │               │  (Block headers synced 24/7)    │      │
│   │ BTC     │               └─────────────┬───────────────────┘      │
│   └────┬────┘                             │                           │
│        │                                  ▼                           │
│        │                    ┌─────────────────────────────────┐      │
│        └───────────────────►│  stealthbridge                  │      │
│           SPV Proof         │  ├── verify_deposit (SPV)       │      │
│                             │  ├── claim_direct (ZK mint)     │      │
│                             │  ├── split_commitment (1→2)     │      │
│                             │  └── request_redemption (burn)  │      │
│                             └─────────────────────────────────┘      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Components:**
1. **btc-light-client** - Permissionless header relay (running on Railway 24/7)
2. **stealthbridge** - Main contract with ZK verification
3. **Commitment Tree** - Merkle tree storing shielded notes
4. **Nullifier Registry** - Prevents double-spending

---

## 📥 DEMO 1: DEPOSIT FLOW (1.5 min)

### Step 1: Generate Private Credentials
```typescript
// User generates secrets locally (never leaves their device)
const nullifier = randomBytes(32);  // Random 32 bytes
const secret = randomBytes(32);     // Random 32 bytes

// Compute commitment using Poseidon hash
const commitment = Poseidon(nullifier, secret);

// This commitment will be embedded in the Bitcoin transaction
console.log("Commitment:", commitment);
// → "1205444fd4eb0649c6d26a7fe15893f0ded3131fa060dcf6edf1b1f9ff586e9f"
```

### Step 2: Get Deposit Address (Two-Path Taproot)
```
Taproot Address: tb1pafqqaayy9actlajpqnyks50n4yvy4xmhgcn0ahhe4gnjjwwz6j4s3ll6pt

┌─────────────────────────────────────┐
│         TAPROOT ADDRESS             │
├─────────────────────────────────────┤
│                                     │
│   KEY PATH (Admin)                  │
│   └── Immediate sweep to custody    │
│                                     │
│   SCRIPT PATH (User)                │
│   └── Refund after 24hr timelock    │
│       (Self-custody guarantee!)     │
│                                     │
└─────────────────────────────────────┘
```

### Step 3: Send Bitcoin Transaction
```
Bitcoin TX Structure:
├── Output 0: 100,000 sats → Taproot address
└── Output 1: OP_RETURN → commitment (32 bytes)
                          ↑
                    Privacy magic here!
```

### Step 4: SPV Verification (Permissionless!)
```bash
# Anyone can verify - no trusted relayer needed!
verify_deposit(
  txid,           # Bitcoin transaction ID
  merkle_proof,   # Proof tx is in block
  block_height,   # Block containing tx
  raw_tx          # Full transaction data
)

# Contract verifies:
# ✓ hash(raw_tx) == txid
# ✓ merkle_proof valid against block header
# ✓ Block has 6+ confirmations
# ✓ Extracts commitment from OP_RETURN
```

---

## 🎫 DEMO 2: CLAIM FLOW - THE PRIVACY MAGIC (2 min)

> "This is where the magic happens. The user proves they own a deposit WITHOUT revealing WHICH deposit."

### The Privacy Problem & Solution
```
WITHOUT ZK PROOFS:
  Deposit: Alice deposits 1 BTC at commitment ABC
  Claim:   Alice claims 1 BTC revealing commitment ABC
  Result:  ❌ Everyone knows Alice deposited and claimed

WITH ZK PROOFS:
  Deposit: Someone deposits 1 BTC at commitment ABC
  Claim:   Someone proves they know secrets for SOME commitment
  Result:  ✓ No one can link deposit to claim!
```

### ZK Proof Public Inputs
```typescript
// What the world sees (public):
{
  merkle_root:    "0x7a3b...",  // Which tree state
  nullifier_hash: "0x9f2c...",  // Prevents double-spend
  amount:         100000,       // Sats to mint
}

// What remains hidden (private):
{
  nullifier:      "???",        // Only prover knows
  secret:         "???",        // Only prover knows
  commitment:     "???",        // CANNOT be linked!
  merkle_path:    "???",        // Which leaf - hidden!
}
```

### Claim Instruction
```typescript
// User generates ZK proof locally
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements: merkleProof.siblings,
    pathIndices: merkleProof.indices,
  },
  "claim_direct.wasm",
  "claim_direct.zkey"
);

// Submit to Solana
await program.methods.claimDirect(
  proof,           // 256 bytes Groth16 proof
  merkle_root,     // Current or historical root
  nullifier_hash,  // Poseidon(nullifier)
  amount           // Sats to mint
).rpc();

// Result: User receives czBTC tokens!
// But NO ONE knows which deposit they're claiming!
```

### Double-Spend Prevention
```
Nullifier Registry (PDA per nullifier_hash):
┌────────────────────────────────────┐
│  nullifier_hash  │     status     │
├──────────────────┼────────────────┤
│  0x9f2c...       │     SPENT      │  ← Cannot claim again!
│  0x3a7b...       │     SPENT      │
│  0x...           │     ...        │
└────────────────────────────────────┘
```

---

## ✂️ DEMO 3: SPLIT COMMITMENT - CLAIM LINKS (1.5 min)

> "Split lets you divide your balance and create shareable claim links - like Venmo but private!"

### Use Case: Send 0.0006 BTC to a Friend
```
You have: 0.001 BTC (100,000 sats) in a commitment

Split into:
├── 60,000 sats → New commitment for friend (claim link)
└── 40,000 sats → New commitment for yourself (change)

┌─────────────────────────────────────────────────────────────┐
│                    SPLIT OPERATION                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   INPUT                          OUTPUTS                     │
│   ┌──────────────┐              ┌──────────────┐            │
│   │ 100,000 sats │              │  60,000 sats │ → Friend   │
│   │ commitment_A │    ────►     │ commitment_B │            │
│   │              │              ├──────────────┤            │
│   │  (nullified) │              │  40,000 sats │ → You      │
│   └──────────────┘              │ commitment_C │            │
│                                 └──────────────┘            │
│                                                              │
│   ZK Proof verifies: 60,000 + 40,000 = 100,000 ✓            │
│   But individual amounts are PRIVATE!                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Creating a Claim Link
```typescript
// Generate new credentials for friend
const friendNote = {
  nullifier: randomBytes(32),
  secret: randomBytes(32),
  amount: 60000,
};
friendNote.commitment = Poseidon(friendNote.nullifier, friendNote.secret);

// Create claim link (base64 encoded secrets)
const claimLink = `https://czbtc.app/claim#${encodeNote(friendNote)}`;

// Send to friend via any channel (Signal, email, etc.)
console.log("Share this link:", claimLink);
// → https://czbtc.app/claim#eyJudWxsaWZpZXIiOiIweDEyMzQ...
```

### Split Instruction
```typescript
await program.methods.splitCommitment(
  proof,               // ZK proof (256 bytes)
  merkle_root,         // Tree root
  nullifier_hash,      // Input commitment's nullifier
  output_commitment_1, // Friend's new commitment
  output_commitment_2, // Your change commitment
).rpc();

// Results:
// ✓ Input nullifier marked as spent
// ✓ Two new commitments added to tree
// ✓ Friend can claim with their link
// ✓ You keep your change
```

### Friend Claims Their Link
```typescript
// Friend opens claim link
const note = decodeNote(linkFragment);

// Friend generates their own ZK proof
const proof = await generateClaimProof(note);

// Friend calls claim_direct
await program.methods.claimDirect(
  proof,
  merkle_root,
  Poseidon(note.nullifier),
  note.amount
).rpc();

// Friend receives 60,000 sats as czBTC!
```

---

## 🔴 LIVE DEMO (1 min)

### Show Railway Relayer Logs
```bash
railway logs --tail 10
```
```
[2026-01-21T09:01:22] On-chain tip height: 4835117
[2026-01-21T09:01:22] Bitcoin testnet tip: 4835117
[2026-01-21T09:01:22] Already synced to tip ✓
```

### Run Demo Script
```bash
cd contracts && bun run scripts/demo-verify.ts
```

### Show Test Data
```json
{
  "txid": "bec8672b7dab057d...",
  "amount": 100000,
  "commitment": "1205444fd4eb0649...",
  "taprootAddress": "tb1pafqqaayy9act..."
}
```

---

## 📊 KEY METRICS

| Feature | czBTC | WBTC | Other Bridges |
|---------|-------|------|---------------|
| Trustless Verification | ✅ SPV | ❌ Custodian | ❌ Multisig |
| Privacy | ✅ ZK Proofs | ❌ Traceable | ❌ Traceable |
| Self-Custody | ✅ 24hr Refund | ❌ None | ❌ None |
| Permissionless | ✅ Anyone | ❌ KYC | ⚠️ Varies |
| Header Cost | ~0.002 SOL | N/A | N/A |

---

## 🎯 SUMMARY

1. **Deposit**: Send BTC to Taproot address with commitment in OP_RETURN
2. **Verify**: Anyone can submit SPV proof (permissionless!)
3. **Claim**: ZK proof mints czBTC without revealing which deposit
4. **Split**: Divide balance into claim links for friends
5. **Redeem**: Burn czBTC → receive BTC (FROST threshold signing)

> "czBTC: The first truly private, trustless Bitcoin bridge."

---

## 🔗 Links

- **Relayer**: Running 24/7 on Railway
- **btc-light-client**: `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG`
- **stealthbridge**: `4qCkVgFUWQENxPXq86ccN7ZjBgyx7ehbkkfCXxCmrn4F`
- **Testnet**: Bitcoin Testnet + Solana Devnet

