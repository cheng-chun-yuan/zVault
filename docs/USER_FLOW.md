# zVault Complete User Flow

A comprehensive guide covering the entire user journey from BTC deposit to zkBTC operations.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Phase 1: Generate Credentials](#phase-1-generate-credentials)
4. [Phase 2: Deposit BTC](#phase-2-deposit-btc)
5. [Phase 3: Submit Block Headers](#phase-3-submit-block-headers)
6. [Phase 4: Verify Deposit](#phase-4-verify-deposit)
7. [Phase 5: Claim zkBTC](#phase-5-claim-zkbtc)
8. [Phase 6: Split Commitment](#phase-6-split-commitment)
9. [Phase 7: Transfer via Claim Link](#phase-7-transfer-via-claim-link)
10. [Phase 8: Refresh Commitment](#phase-8-refresh-commitment)
11. [Phase 9: Withdraw to BTC](#phase-9-withdraw-to-btc)
12. [State Diagrams](#state-diagrams)
13. [Data Structures](#data-structures)
14. [Security Model](#security-model)
15. [Error Reference](#error-reference)

---

## System Overview

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           ZVAULT SYSTEM                                 ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║    ┌─────────────────┐                         ┌─────────────────┐            ║
║    │                 │                         │                 │            ║
║    │    BITCOIN      │◄───────────────────────►│    SOLANA       │            ║
║    │    NETWORK      │                         │    NETWORK      │            ║
║    │                 │                         │                 │            ║
║    └────────┬────────┘                         └────────┬────────┘            ║
║             │                                           │                      ║
║             │                                           │                      ║
║    ┌────────▼────────┐                         ┌────────▼────────┐            ║
║    │                 │                         │                 │            ║
║    │  BTC Deposits   │────── SPV Proof ───────►│  zVault  │            ║
║    │  (Taproot)      │                         │  Contract       │            ║
║    │                 │                         │                 │            ║
║    └────────┬────────┘                         └────────┬────────┘            ║
║             │                                           │                      ║
║             │                                           │                      ║
║    ┌────────▼────────┐                         ┌────────▼────────┐            ║
║    │                 │                         │                 │            ║
║    │  FROST Custody  │◄──── Redemptions ──────│  zkBTC Token    │            ║
║    │  (Threshold)    │                         │  (SPL Token)    │            ║
║    │                 │                         │                 │            ║
║    └─────────────────┘                         └─────────────────┘            ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Architecture Diagram

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              ARCHITECTURE                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                              USER                                        │  ║
║  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  ║
║  │  │ Generate │  │  Send    │  │  Claim   │  │  Split   │  │ Withdraw │  │  ║
║  │  │ Secrets  │  │  BTC     │  │  zkBTC   │  │  Amount  │  │  to BTC  │  │  ║
║  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │  ║
║  └───────┼─────────────┼─────────────┼─────────────┼─────────────┼────────┘  ║
║          │             │             │             │             │            ║
║          ▼             ▼             ▼             ▼             ▼            ║
║  ┌─────────────────────────────────────────────────────────────────────────┐  ║
║  │                           FRONTEND / SDK                                 │  ║
║  │  ┌──────────────────────────────────────────────────────────────────┐   │  ║
║  │  │  • Poseidon Hash    • ZK Proof Generation    • Claim Links       │   │  ║
║  │  │  • Address Derive   • ChadBuffer Upload      • Transaction Build │   │  ║
║  │  └──────────────────────────────────────────────────────────────────┘   │  ║
║  └─────────────────────────────────────────────────────────────────────────┘  ║
║          │             │             │             │             │            ║
║          ▼             ▼             ▼             ▼             ▼            ║
║  ┌───────────────────────────┐    ┌────────────────────────────────────────┐  ║
║  │      BITCOIN NETWORK      │    │           SOLANA NETWORK               │  ║
║  │  ┌─────────────────────┐  │    │  ┌──────────────────────────────────┐  │  ║
║  │  │                     │  │    │  │      ZVAULT CONTRACT      │  │  ║
║  │  │  • Block Headers    │  │    │  │  ┌────────────────────────────┐  │  │  ║
║  │  │  • Transactions     │──┼────┼──│  │  Bitcoin Light Client      │  │  │  ║
║  │  │  • Merkle Proofs    │  │    │  │  │  • Block Headers           │  │  │  ║
║  │  │                     │  │    │  │  │  • Chainwork Tracking      │  │  │  ║
║  │  └─────────────────────┘  │    │  │  └────────────────────────────┘  │  │  ║
║  │                           │    │  │  ┌────────────────────────────┐  │  │  ║
║  │  ┌─────────────────────┐  │    │  │  │  Commitment Tree           │  │  │  ║
║  │  │                     │  │    │  │  │  • Merkle Tree (10 levels) │  │  │  ║
║  │  │  FROST Threshold    │◄─┼────┼──│  │  • Historical Roots        │  │  │  ║
║  │  │  Signature Scheme   │  │    │  │  └────────────────────────────┘  │  │  ║
║  │  │  • Pool Custody     │  │    │  │  ┌────────────────────────────┐  │  │  ║
║  │  │  • Redemptions      │  │    │  │  │  Nullifier Registry        │  │  │  ║
║  │  │                     │  │    │  │  │  • Double-spend Prevention │  │  │  ║
║  │  └─────────────────────┘  │    │  │  └────────────────────────────┘  │  │  ║
║  │                           │    │  │  ┌────────────────────────────┐  │  │  ║
║  │                           │    │  │  │  zkBTC Token (SPL)         │  │  │  ║
║  │                           │    │  │  │  • Mint / Burn             │  │  │  ║
║  │                           │    │  │  └────────────────────────────┘  │  │  ║
║  │                           │    │  └──────────────────────────────────┘  │  ║
║  └───────────────────────────┘    └────────────────────────────────────────┘  ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Complete User Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            COMPLETE USER FLOW                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   PHASE 1          PHASE 2          PHASE 3          PHASE 4                  ║
║   Generate         Deposit          Submit           Verify                    ║
║   Secrets          BTC              Headers          Deposit                   ║
║                                                                                ║
║   ┌───────┐       ┌───────┐        ┌───────┐        ┌───────┐                 ║
║   │       │       │       │        │       │        │       │                 ║
║   │ User  │──────►│Bitcoin│───────►│Relayer│───────►│Anyone │                 ║
║   │       │       │  TX   │        │       │        │       │                 ║
║   └───────┘       └───────┘        └───────┘        └───────┘                 ║
║       │               │                │                │                      ║
║       ▼               ▼                ▼                ▼                      ║
║   ┌───────┐       ┌───────┐        ┌───────┐        ┌───────┐                 ║
║   │nullfr │       │OP_RET │        │Headers│        │Comitmt│                 ║
║   │secret │       │commit │        │on-chn │        │in tree│                 ║
║   │commit │       │       │        │       │        │       │                 ║
║   └───────┘       └───────┘        └───────┘        └───────┘                 ║
║                                                                                ║
║ ──────────────────────────────────────────────────────────────────────────── ║
║                                                                                ║
║   PHASE 5          PHASE 6          PHASE 7          PHASE 8                  ║
║   Claim            Split            Transfer         Withdraw                  ║
║   zkBTC            1 → 2            (Link)           to BTC                    ║
║                                                                                ║
║   ┌───────┐       ┌───────┐        ┌───────┐        ┌───────┐                 ║
║   │       │       │       │        │       │        │       │                 ║
║   │ User  │──────►│ User  │───────►│Friend │───────►│ User  │                 ║
║   │       │       │       │        │       │        │       │                 ║
║   └───────┘       └───────┘        └───────┘        └───────┘                 ║
║       │               │                │                │                      ║
║       ▼               ▼                ▼                ▼                      ║
║   ┌───────┐       ┌───────┐        ┌───────┐        ┌───────┐                 ║
║   │ Mint  │       │2 new  │        │Friend │        │ Burn  │                 ║
║   │zkBTC  │       │commits│        │claims │        │zkBTC  │                 ║
║   │       │       │       │        │       │        │get BTC│                 ║
║   └───────┘       └───────┘        └───────┘        └───────┘                 ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Phase 1: Generate Credentials

User generates cryptographic credentials before depositing BTC.

### Credential Generation Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         CREDENTIAL GENERATION                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   ┌─────────────────┐                                                         ║
║   │  Random Source  │                                                         ║
║   │  (crypto.rand)  │                                                         ║
║   └────────┬────────┘                                                         ║
║            │                                                                   ║
║            ▼                                                                   ║
║   ┌────────────────────────────────────────────┐                              ║
║   │                                            │                              ║
║   │    nullifier = random(32 bytes)            │                              ║
║   │    secret = random(32 bytes)               │                              ║
║   │                                            │                              ║
║   └────────────────────┬───────────────────────┘                              ║
║                        │                                                       ║
║                        ▼                                                       ║
║   ┌────────────────────────────────────────────┐                              ║
║   │                                            │                              ║
║   │    commitment = Poseidon(nullifier,secret) │                              ║
║   │                                            │                              ║
║   │    ┌─────────┐   ┌─────────┐              │                              ║
║   │    │nullifier│ + │ secret  │ ──► Poseidon ──► commitment                 ║
║   │    └─────────┘   └─────────┘              │                              ║
║   │                                            │                              ║
║   └────────────────────┬───────────────────────┘                              ║
║                        │                                                       ║
║                        ▼                                                       ║
║   ┌────────────────────────────────────────────┐                              ║
║   │                                            │                              ║
║   │    nullifierHash = Poseidon(nullifier)     │  ◄── Used at claim time     ║
║   │                                            │                              ║
║   └────────────────────────────────────────────┘                              ║
║                                                                                ║
║   ┌────────────────────────────────────────────┐                              ║
║   │           USER MUST SAVE SECURELY          │                              ║
║   │  ┌──────────────────────────────────────┐  │                              ║
║   │  │  nullifier:  0xabc123... (32 bytes)  │  │                              ║
║   │  │  secret:     0xdef456... (32 bytes)  │  │                              ║
║   │  │  commitment: 0x789abc... (32 bytes)  │  │                              ║
║   │  └──────────────────────────────────────┘  │                              ║
║   └────────────────────────────────────────────┘                              ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
import { poseidonHash } from '@zVault/crypto';
import * as crypto from 'crypto';

// Step 1: Generate random secrets
const nullifier = crypto.randomBytes(32);
const secret = crypto.randomBytes(32);

// Step 2: Compute commitment
const commitment = poseidonHash([nullifier, secret]);

// Step 3: Compute nullifier hash (for claim)
const nullifierHash = poseidonHash([nullifier]);

// Step 4: Save credentials
const credentials = {
  nullifier: nullifier.toString('hex'),
  secret: secret.toString('hex'),
  commitment: commitment.toString('hex'),
  nullifierHash: nullifierHash.toString('hex'),
};

console.log('=== SAVE THESE CREDENTIALS SECURELY ===');
console.log(JSON.stringify(credentials, null, 2));
```

---

## Phase 2: Deposit BTC

### Deposit Address Derivation

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        DEPOSIT ADDRESS STRUCTURE                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║                        Taproot Address (bc1p...)                               ║
║                                 │                                              ║
║                    ┌────────────┴────────────┐                                ║
║                    │                         │                                 ║
║                    ▼                         ▼                                 ║
║           ┌───────────────┐         ┌───────────────┐                         ║
║           │   KEY PATH    │         │  SCRIPT PATH  │                         ║
║           │               │         │               │                         ║
║           │  pool_pubkey  │         │  Script Tree  │                         ║
║           │  (immediate   │         │               │                         ║
║           │   sweep)      │         │  ┌─────────┐  │                         ║
║           │               │         │  │ Refund  │  │                         ║
║           └───────────────┘         │  │ Script  │  │                         ║
║                                     │  │         │  │                         ║
║                                     │  │<24hr>   │  │                         ║
║                                     │  │OP_CSV   │  │                         ║
║                                     │  │<user_pk>│  │                         ║
║                                     │  │CHECKSIG │  │                         ║
║                                     │  └─────────┘  │                         ║
║                                     └───────────────┘                         ║
║                                                                                ║
║   Who can spend:                                                              ║
║   ├── Pool (immediately via key path) ──► Sweeps to custody                  ║
║   └── User (after 24hr via script path) ──► Refund if pool fails             ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Bitcoin Transaction Structure

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        BITCOIN DEPOSIT TRANSACTION                             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                         TRANSACTION                                      │ ║
║   ├─────────────────────────────────────────────────────────────────────────┤ ║
║   │                                                                          │ ║
║   │   INPUTS:                                                                │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │  Input 0: User's UTXO (e.g., 0.002 BTC)                           │ │ ║
║   │   │           Previous TX: abc123...                                   │ │ ║
║   │   │           Index: 0                                                 │ │ ║
║   │   │           Signature: <user_signature>                              │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │                                                                          │ ║
║   │   OUTPUTS:                                                               │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │  Output 0: DEPOSIT                                                 │ │ ║
║   │   │           Value: 100,000 sats (0.001 BTC)                         │ │ ║
║   │   │           Script: P2TR <deposit_address>                          │ │ ║
║   │   │                   bc1p...                                          │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │  Output 1: OP_RETURN (COMMITMENT)                                  │ │ ║
║   │   │           Value: 0 sats                                            │ │ ║
║   │   │           Script: OP_RETURN <32-byte commitment>                  │ │ ║
║   │   │                   6a20<commitment_hex>                             │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │  Output 2: CHANGE (optional)                                       │ │ ║
║   │   │           Value: 95,000 sats                                       │ │ ║
║   │   │           Script: P2WPKH <user_change_address>                    │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   After broadcast:                                                            ║
║   ├── txid: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ║
║   └── Wait for 6+ confirmations before verification                          ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
import * as bitcoin from 'bitcoinjs-lib';

function createDepositTransaction(
  userUtxo: UTXO,
  depositAddress: string,
  commitment: Buffer,
  amountSats: number,
  changeAddress: string,
  feeRate: number
): bitcoin.Transaction {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

  // Add input
  psbt.addInput({
    hash: userUtxo.txid,
    index: userUtxo.vout,
    witnessUtxo: {
      script: userUtxo.script,
      value: userUtxo.value,
    },
  });

  // Output 0: Deposit to taproot address
  psbt.addOutput({
    address: depositAddress,
    value: amountSats,
  });

  // Output 1: OP_RETURN with commitment
  const opReturnScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    commitment,  // 32 bytes
  ]);
  psbt.addOutput({
    script: opReturnScript,
    value: 0,
  });

  // Output 2: Change
  const fee = estimateFee(psbt, feeRate);
  const change = userUtxo.value - amountSats - fee;
  if (change > 546) {  // Dust threshold
    psbt.addOutput({
      address: changeAddress,
      value: change,
    });
  }

  return psbt;
}
```

---

## Phase 3: Submit Block Headers

Block headers are submitted to Solana by relayers (permissionless).

### Block Header Submission Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         BLOCK HEADER SUBMISSION                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   BITCOIN NETWORK                              SOLANA NETWORK                  ║
║                                                                                ║
║   ┌─────────────┐                             ┌─────────────────────────────┐ ║
║   │   Block N   │                             │   Bitcoin Light Client      │ ║
║   │  ┌───────┐  │                             │                             │ ║
║   │  │Header │  │ ────── submit_header ─────► │   tip_height: N-1           │ ║
║   │  │80bytes│  │                             │   tip_hash: 0xabc...        │ ║
║   │  └───────┘  │                             │                             │ ║
║   │  merkle_root│                             └─────────────────────────────┘ ║
║   │  prev_hash  │                                          │                  ║
║   │  timestamp  │                                          │                  ║
║   │  bits       │                                          ▼                  ║
║   │  nonce      │                             ┌─────────────────────────────┐ ║
║   └─────────────┘                             │   Verification:             │ ║
║                                               │   1. prev_hash == tip_hash  │ ║
║                                               │   2. PoW valid (hash<target)│ ║
║                                               │   3. timestamp reasonable   │ ║
║                                               └─────────────────────────────┘ ║
║                                                            │                  ║
║                                                            ▼                  ║
║                                               ┌─────────────────────────────┐ ║
║                                               │   Store BlockHeader PDA     │ ║
║                                               │   seeds: ["block_header", N]│ ║
║                                               │                             │ ║
║                                               │   • merkle_root             │ ║
║                                               │   • prev_hash               │ ║
║                                               │   • timestamp               │ ║
║                                               │   • height: N               │ ║
║                                               └─────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
// Relayer submits block headers
async function submitBlockHeader(
  program: Program,
  rawHeader: Buffer,  // 80 bytes
  height: number
) {
  const [blockHeaderPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("block_header"), new BN(height).toArrayLike(Buffer, 'le', 8)],
    program.programId
  );

  const tx = await program.methods
    .submitHeader(
      Array.from(rawHeader),
      new BN(height)
    )
    .accounts({
      lightClient,
      blockHeader: blockHeaderPDA,
      submitter: relayer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`Block ${height} header submitted:`, tx);
}
```

---

## Phase 4: Verify Deposit

### SPV Verification Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            VERIFY DEPOSIT FLOW                                 ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   STEP 1: Upload Raw TX to ChadBuffer                                         ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   Raw Bitcoin TX (variable size, e.g., 250 bytes)                       │ ║
║   │   ┌──────────────────────────────────────────────────────────────────┐  │ ║
║   │   │ version | inputs | outputs | locktime | witness (if segwit)      │  │ ║
║   │   └──────────────────────────────────────────────────────────────────┘  │ ║
║   │                              │                                           │ ║
║   │                              ▼                                           │ ║
║   │   ┌──────────────────────────────────────────────────────────────────┐  │ ║
║   │   │                    ChadBuffer Account                             │  │ ║
║   │   │  ┌────────────┬──────────────────────────────────────────────┐   │  │ ║
║   │   │  │ Authority  │              Raw TX Data                      │   │  │ ║
║   │   │  │ (32 bytes) │              (N bytes)                        │   │  │ ║
║   │   │  └────────────┴──────────────────────────────────────────────┘   │  │ ║
║   │   └──────────────────────────────────────────────────────────────────┘  │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   STEP 2: Call verify_deposit                                                 ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   ┌───────────────┐     ┌───────────────┐     ┌───────────────┐         │ ║
║   │   │  ChadBuffer   │     │ Block Header  │     │ Merkle Proof  │         │ ║
║   │   │  (raw tx)     │     │ (merkle_root) │     │ (siblings)    │         │ ║
║   │   └───────┬───────┘     └───────┬───────┘     └───────┬───────┘         │ ║
║   │           │                     │                     │                  │ ║
║   │           └─────────────────────┼─────────────────────┘                  │ ║
║   │                                 │                                        │ ║
║   │                                 ▼                                        │ ║
║   │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║   │   │                     VERIFICATION STEPS                           │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   1. hash(raw_tx) == txid ?                    ✓ or ✗            │   │ ║
║   │   │   2. merkle_proof(txid) == merkle_root ?       ✓ or ✗            │   │ ║
║   │   │   3. confirmations >= 6 ?                      ✓ or ✗            │   │ ║
║   │   │   4. parse tx → find OP_RETURN → commitment    ✓ or ✗            │   │ ║
║   │   │   5. amount within bounds ?                    ✓ or ✗            │   │ ║
║   │   │                                                                  │   │ ║
║   │   └─────────────────────────────────────────────────────────────────┘   │ ║
║   │                                 │                                        │ ║
║   │                                 ▼                                        │ ║
║   │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║   │   │                     IF ALL CHECKS PASS                           │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   • Insert commitment into CommitmentTree                        │   │ ║
║   │   │   • Create DepositRecord PDA (seeds: ["deposit", txid])         │   │ ║
║   │   │   • Emit DepositVerified event                                   │   │ ║
║   │   │                                                                  │   │ ║
║   │   └─────────────────────────────────────────────────────────────────┘   │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Merkle Proof Verification

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          MERKLE PROOF VERIFICATION                             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   Block's Merkle Tree:                                                        ║
║                                                                                ║
║                              ┌─────────────┐                                  ║
║                              │ merkle_root │ ◄── Stored in block header       ║
║                              └──────┬──────┘                                  ║
║                         ┌──────────┴──────────┐                               ║
║                         │                     │                                ║
║                    ┌────┴────┐           ┌────┴────┐                          ║
║                    │  H(0,1) │           │  H(2,3) │ ◄── Sibling              ║
║                    └────┬────┘           └─────────┘                          ║
║               ┌─────────┴─────────┐                                           ║
║               │                   │                                            ║
║          ┌────┴────┐         ┌────┴────┐                                      ║
║          │  H(tx0) │         │  H(tx1) │ ◄── Sibling                          ║
║          └─────────┘         └────┬────┘                                      ║
║                                   │                                            ║
║                              ┌────┴────┐                                      ║
║                              │  txid   │ ◄── Your transaction                 ║
║                              │ (tx1)   │                                      ║
║                              └─────────┘                                      ║
║                                                                                ║
║   Verification:                                                               ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   current = txid                                                         │ ║
║   │                                                                          │ ║
║   │   for each (sibling, direction) in proof:                               │ ║
║   │       if direction == LEFT:                                              │ ║
║   │           current = double_sha256(sibling || current)                   │ ║
║   │       else:                                                              │ ║
║   │           current = double_sha256(current || sibling)                   │ ║
║   │                                                                          │ ║
║   │   assert(current == merkle_root)                                        │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
import { prepareVerifyDeposit } from '@zVault/sdk';

async function verifyDeposit(
  connection: Connection,
  program: Program,
  payer: Keypair,
  txid: string,
  expectedAmount: number
) {
  // Step 1: Fetch raw tx and upload to ChadBuffer
  const {
    bufferPubkey,
    transactionSize,
    merkleProof,
    blockHeight,
    txIndex,
    txidBytes,
  } = await prepareVerifyDeposit(connection, payer, txid, "mainnet");

  // Step 2: Derive PDAs
  const [poolState] = derivePoolStatePDA(program.programId);
  const [lightClient] = deriveLightClientPDA(program.programId);
  const [blockHeader] = deriveBlockHeaderPDA(program.programId, blockHeight);
  const [commitmentTree] = deriveCommitmentTreePDA(program.programId);
  const [depositRecord] = deriveDepositRecordPDA(program.programId, txidBytes);

  // Step 3: Build merkle proof
  const merkleProofData = {
    txid: Array.from(txidBytes),
    siblings: merkleProof.map(p => Array.from(p)),
    path: computePath(txIndex, merkleProof.length),
    txIndex,
  };

  // Step 4: Call verify_deposit
  const tx = await program.methods
    .verifyDeposit(
      Array.from(txidBytes),
      merkleProofData,
      new BN(blockHeight),
      { value: new BN(expectedAmount), expectedPubkey: [], vout: 0 },
      transactionSize
    )
    .accounts({
      poolState,
      lightClient,
      blockHeader,
      commitmentTree,
      depositRecord,
      txBuffer: bufferPubkey,
      submitter: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("Deposit verified:", tx);
  return depositRecord;
}
```

---

## Phase 5: Claim zkBTC

### ZK Proof Generation & Claim Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              CLAIM zkBTC FLOW                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   STEP 1: Generate ZK Proof (Off-chain)                                       ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   PRIVATE INPUTS (witness):                PUBLIC INPUTS:                │ ║
║   │   ┌─────────────────────────┐              ┌─────────────────────────┐  │ ║
║   │   │ • nullifier             │              │ • merkle_root           │  │ ║
║   │   │ • secret                │              │ • nullifier_hash        │  │ ║
║   │   │ • merkle_path           │              │ • amount                │  │ ║
║   │   │ • path_indices          │              │ • recipient             │  │ ║
║   │   └───────────┬─────────────┘              └─────────────────────────┘  │ ║
║   │               │                                       │                  │ ║
║   │               └───────────────────┬───────────────────┘                  │ ║
║   │                                   │                                      │ ║
║   │                                   ▼                                      │ ║
║   │                    ┌──────────────────────────┐                          │ ║
║   │                    │    Groth16 Prover        │                          │ ║
║   │                    │                          │                          │ ║
║   │                    │  Circuit proves:         │                          │ ║
║   │                    │  1. commitment = H(n,s)  │                          │ ║
║   │                    │  2. commitment ∈ tree    │                          │ ║
║   │                    │  3. nullHash = H(n)      │                          │ ║
║   │                    │                          │                          │ ║
║   │                    └────────────┬─────────────┘                          │ ║
║   │                                 │                                        │ ║
║   │                                 ▼                                        │ ║
║   │                    ┌──────────────────────────┐                          │ ║
║   │                    │   Groth16 Proof          │                          │ ║
║   │                    │   (256 bytes: A, B, C)   │                          │ ║
║   │                    └──────────────────────────┘                          │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   STEP 2: Submit Claim Transaction                                            ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │                         claim_direct(                                    │ ║
║   │                           proof,                                         │ ║
║   │                           merkle_root,                                   │ ║
║   │                           nullifier_hash,                                │ ║
║   │                           amount                                         │ ║
║   │                         )                                                │ ║
║   │                              │                                           │ ║
║   │                              ▼                                           │ ║
║   │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║   │   │                   ON-CHAIN VERIFICATION                          │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   1. merkle_root is valid (current or historical)    ✓          │   │ ║
║   │   │   2. Groth16 proof verifies                          ✓          │   │ ║
║   │   │   3. nullifier_hash not used before                  ✓          │   │ ║
║   │   │   4. amount within bounds                            ✓          │   │ ║
║   │   │                                                                  │   │ ║
║   │   └─────────────────────────────────────────────────────────────────┘   │ ║
║   │                              │                                           │ ║
║   │                              ▼                                           │ ║
║   │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║   │   │                   IF VERIFICATION PASSES                         │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   • Create NullifierRecord PDA (prevents double-spend)          │   │ ║
║   │   │   • Mint zkBTC tokens to user's wallet                          │   │ ║
║   │   │   • Emit ClaimCompleted event                                    │   │ ║
║   │   │                                                                  │   │ ║
║   │   └─────────────────────────────────────────────────────────────────┘   │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
import { generateClaimProof } from '@zVault/circuits';

async function claimzkBTC(
  program: Program,
  credentials: Credentials,
  amount: number
) {
  // Step 1: Get current merkle root
  const commitmentTree = await program.account.commitmentTree.fetch(commitmentTreePDA);
  const merkleRoot = commitmentTree.root;

  // Step 2: Get merkle path for commitment
  const merklePathData = await getMerklePath(credentials.commitment);

  // Step 3: Generate ZK proof
  const proof = await generateClaimProof({
    nullifier: Buffer.from(credentials.nullifier, 'hex'),
    secret: Buffer.from(credentials.secret, 'hex'),
    amount,
    merkleRoot,
    merklePath: merklePathData.siblings,
    pathIndices: merklePathData.indices,
    recipient: userWallet.publicKey.toBytes(),
  });

  // Step 4: Compute nullifier hash
  const nullifierHash = poseidonHash([
    Buffer.from(credentials.nullifier, 'hex')
  ]);

  // Step 5: Submit claim
  const [nullifierRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), nullifierHash],
    program.programId
  );

  const tx = await program.methods
    .claimDirect(
      Array.from(proof.proofBytes),
      Array.from(merkleRoot),
      Array.from(nullifierHash),
      new BN(amount)
    )
    .accounts({
      poolState,
      commitmentTree: commitmentTreePDA,
      nullifierRecord,
      zkbtcMint,
      userTokenAccount,
      user: userWallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([userWallet])
    .rpc();

  console.log("Claimed", amount, "sats worth of zkBTC");
  console.log("Transaction:", tx);
}
```

---

## Phase 6: Split Commitment

### Split Flow (1 → 2)

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           SPLIT COMMITMENT FLOW                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   BEFORE:                                                                     ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   ┌───────────────────────────────────────────┐                         │ ║
║   │   │           Original Commitment              │                         │ ║
║   │   │                                           │                         │ ║
║   │   │   commitment = H(nullifier, secret)       │                         │ ║
║   │   │   amount = 100,000 sats                   │                         │ ║
║   │   │                                           │                         │ ║
║   │   └───────────────────────────────────────────┘                         │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   SPLIT OPERATION:                                                            ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │                    ┌───────────────────┐                                 │ ║
║   │                    │   split_commit    │                                 │ ║
║   │                    │                   │                                 │ ║
║   │                    │  ZK Proof proves: │                                 │ ║
║   │                    │  • Know old secret│                                 │ ║
║   │                    │  • Conservation:  │                                 │ ║
║   │                    │    in = out1+out2 │                                 │ ║
║   │                    │                   │                                 │ ║
║   │                    └─────────┬─────────┘                                 │ ║
║   │                              │                                           │ ║
║   │               ┌──────────────┴──────────────┐                            │ ║
║   │               │                             │                             │ ║
║   │               ▼                             ▼                             │ ║
║   │   ┌─────────────────────┐       ┌─────────────────────┐                 │ ║
║   │   │   Commitment 1      │       │   Commitment 2      │                 │ ║
║   │   │   (KEEP)            │       │   (SEND TO FRIEND)  │                 │ ║
║   │   │                     │       │                     │                 │ ║
║   │   │   H(null1, sec1)    │       │   H(null2, sec2)    │                 │ ║
║   │   │   60,000 sats       │       │   40,000 sats       │                 │ ║
║   │   │                     │       │                     │                 │ ║
║   │   └─────────────────────┘       └─────────────────────┘                 │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   AFTER:                                                                      ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   CommitmentTree:                                                        │ ║
║   │   ┌──────────────────────────────────────────────────────────────────┐  │ ║
║   │   │  ...                                                              │  │ ║
║   │   │  [leaf N]:   commitment_old  (SPENT - nullifier used)            │  │ ║
║   │   │  [leaf N+1]: commitment_1    (NEW - 60,000 sats)                 │  │ ║
║   │   │  [leaf N+2]: commitment_2    (NEW - 40,000 sats)                 │  │ ║
║   │   │  ...                                                              │  │ ║
║   │   └──────────────────────────────────────────────────────────────────┘  │ ║
║   │                                                                          │ ║
║   │   NullifierRegistry:                                                     │ ║
║   │   ┌──────────────────────────────────────────────────────────────────┐  │ ║
║   │   │  H(nullifier_old) → SPENT (cannot reuse original commitment)     │  │ ║
║   │   └──────────────────────────────────────────────────────────────────┘  │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
async function splitCommitment(
  program: Program,
  oldCredentials: Credentials,
  totalAmount: number,
  amount1: number
) {
  const amount2 = totalAmount - amount1;

  // Generate new credentials for both outputs
  const newCreds1 = generateCredentials();
  const newCreds2 = generateCredentials();

  // Generate split proof
  const proof = await generateSplitProof({
    // Old commitment (being spent)
    oldNullifier: Buffer.from(oldCredentials.nullifier, 'hex'),
    oldSecret: Buffer.from(oldCredentials.secret, 'hex'),
    totalAmount,
    merkleRoot,
    merklePath,
    pathIndices,

    // New commitments
    newCommitment1: Buffer.from(newCreds1.commitment, 'hex'),
    newCommitment2: Buffer.from(newCreds2.commitment, 'hex'),
    amount1,
    amount2,
  });

  const oldNullifierHash = poseidonHash([
    Buffer.from(oldCredentials.nullifier, 'hex')
  ]);

  // Submit split transaction
  const tx = await program.methods
    .splitCommitment(
      Array.from(proof.proofBytes),
      Array.from(merkleRoot),
      Array.from(oldNullifierHash),
      Array.from(Buffer.from(newCreds1.commitment, 'hex')),
      Array.from(Buffer.from(newCreds2.commitment, 'hex'))
    )
    .accounts({
      poolState,
      commitmentTree,
      nullifierRecord,
      user: userWallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([userWallet])
    .rpc();

  console.log("Split complete:", tx);

  return {
    commitment1: { ...newCreds1, amount: amount1 },  // Keep this
    commitment2: { ...newCreds2, amount: amount2 },  // Send to friend
  };
}
```

---

## Phase 7: Transfer via Claim Link

### Claim Link Generation & Transfer

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           CLAIM LINK TRANSFER                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   SENDER (Alice):                                                             ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   1. After split, Alice has commitment2 credentials:                    │ ║
║   │      ┌────────────────────────────────────────────┐                     │ ║
║   │      │  nullifier2: 0xabc123...                   │                     │ ║
║   │      │  secret2:    0xdef456...                   │                     │ ║
║   │      │  amount:     40,000 sats                   │                     │ ║
║   │      └────────────────────────────────────────────┘                     │ ║
║   │                                                                          │ ║
║   │   2. Alice creates claim link:                                          │ ║
║   │      ┌────────────────────────────────────────────────────────────┐     │ ║
║   │      │  https://zVault.app/claim?                           │     │ ║
║   │      │    data=base64(encrypt(nullifier2 + secret2 + amount))     │     │ ║
║   │      └────────────────────────────────────────────────────────────┘     │ ║
║   │                                                                          │ ║
║   │   3. Alice sends link to Bob via:                                       │ ║
║   │      • Encrypted message                                                 │ ║
║   │      • QR code                                                           │ ║
║   │      • Any secure channel                                                │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║                              ┌─────────────┐                                  ║
║                              │ Claim Link  │                                  ║
║                              │   ──────►   │                                  ║
║                              └─────────────┘                                  ║
║                                                                                ║
║   RECEIVER (Bob):                                                             ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   1. Bob opens claim link                                               │ ║
║   │                                                                          │ ║
║   │   2. Frontend decodes credentials:                                      │ ║
║   │      ┌────────────────────────────────────────────┐                     │ ║
║   │      │  nullifier2: 0xabc123...                   │                     │ ║
║   │      │  secret2:    0xdef456...                   │                     │ ║
║   │      │  amount:     40,000 sats                   │                     │ ║
║   │      └────────────────────────────────────────────┘                     │ ║
║   │                                                                          │ ║
║   │   3. Bob connects wallet                                                │ ║
║   │                                                                          │ ║
║   │   4. Frontend generates ZK proof with Bob as recipient                  │ ║
║   │                                                                          │ ║
║   │   5. Bob calls claim_direct → receives 40,000 sats of zkBTC            │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   PRIVACY:                                                                    ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   • Alice's identity not linked on-chain                                │ ║
║   │   • Bob's identity not linked to Alice                                  │ ║
║   │   • Only nullifier_hash visible (not linkable to commitment)           │ ║
║   │   • Amount is visible when claimed                                       │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
// Alice creates claim link
function createClaimLink(credentials: Credentials): string {
  const data = {
    n: credentials.nullifier,
    s: credentials.secret,
    a: credentials.amount,
  };

  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `https://zVault.app/claim?data=${encoded}`;
}

// Bob decodes and claims
async function claimFromLink(link: string, bobWallet: Keypair) {
  // Parse link
  const url = new URL(link);
  const encoded = url.searchParams.get('data');
  const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());

  const credentials = {
    nullifier: data.n,
    secret: data.s,
    amount: data.a,
  };

  // Generate proof with Bob as recipient
  const proof = await generateClaimProof({
    nullifier: Buffer.from(credentials.nullifier, 'hex'),
    secret: Buffer.from(credentials.secret, 'hex'),
    amount: credentials.amount,
    merkleRoot,
    merklePath,
    pathIndices,
    recipient: bobWallet.publicKey.toBytes(),  // Bob's wallet
  });

  // Submit claim
  await claimDirect(program, proof, credentials.amount, bobWallet);

  console.log("Bob claimed", credentials.amount, "sats!");
}
```

---

## Phase 8: Refresh Commitment

### Commitment Refresh (1 → 1)

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         REFRESH COMMITMENT FLOW                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   PURPOSE: Break transaction linkability by creating new commitment           ║
║                                                                                ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   OLD COMMITMENT                        NEW COMMITMENT                   │ ║
║   │   ┌───────────────────┐                ┌───────────────────┐            │ ║
║   │   │                   │                │                   │            │ ║
║   │   │  H(null_old,      │   ────────►    │  H(null_new,      │            │ ║
║   │   │    sec_old)       │  mint_to_      │    sec_new)       │            │ ║
║   │   │                   │  commitment    │                   │            │ ║
║   │   │  100,000 sats     │                │  100,000 sats     │            │ ║
║   │   │                   │                │                   │            │ ║
║   │   └───────────────────┘                └───────────────────┘            │ ║
║   │                                                                          │ ║
║   │   SAME AMOUNT, NEW SECRETS                                              │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   USE CASES:                                                                  ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   1. Security rotation (if secrets may be compromised)                  │ ║
║   │   2. Privacy improvement (new commitment not linkable to old)           │ ║
║   │   3. Before receiving funds (create fresh commitment)                   │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Phase 9: Withdraw to BTC

### Withdrawal Flow

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            WITHDRAW TO BTC FLOW                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   STEP 1: User Requests Redemption (Solana)                                   ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   User calls request_redemption(amount, btc_address)                    │ ║
║   │                                                                          │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │                                                                    │ │ ║
║   │   │   1. Verify user has sufficient zkBTC                             │ │ ║
║   │   │   2. Burn zkBTC from user's account                               │ │ ║
║   │   │   3. Create RedemptionRequest PDA:                                │ │ ║
║   │   │      • amount: 50,000 sats                                        │ │ ║
║   │   │      • btc_address: "bc1q..."                                     │ │ ║
║   │   │      • status: Pending                                             │ │ ║
║   │   │      • requested_at: 1705123456                                   │ │ ║
║   │   │                                                                    │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   STEP 2: FROST Relayer Processes (Automated)                                 ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║   │   │                     FROST SIGNING FLOW                           │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   1. Relayer monitors RedemptionRequest events                  │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   2. FROST threshold signing (t-of-n):                          │   │ ║
║   │   │      ┌─────────┐   ┌─────────┐   ┌─────────┐                   │   │ ║
║   │   │      │Signer 1 │   │Signer 2 │   │Signer 3 │   ...             │   │ ║
║   │   │      │  ✓      │   │  ✓      │   │  ✓      │                   │   │ ║
║   │   │      └────┬────┘   └────┬────┘   └────┬────┘                   │   │ ║
║   │   │           └─────────────┼─────────────┘                         │   │ ║
║   │   │                         ▼                                       │   │ ║
║   │   │              ┌──────────────────┐                               │   │ ║
║   │   │              │ Aggregate Sig    │                               │   │ ║
║   │   │              └──────────────────┘                               │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   3. Create Bitcoin transaction:                                │   │ ║
║   │   │      Input:  Pool's UTXO                                        │   │ ║
║   │   │      Output: 50,000 sats → user's btc_address                  │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   4. Broadcast to Bitcoin network                               │   │ ║
║   │   │                                                                  │   │ ║
║   │   │   5. Wait for confirmation                                      │   │ ║
║   │   │                                                                  │   │ ║
║   │   └─────────────────────────────────────────────────────────────────┘   │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   STEP 3: Complete Redemption (Solana)                                        ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   Relayer calls complete_redemption(btc_txid)                           │ ║
║   │                                                                          │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │                                                                    │ │ ║
║   │   │   1. Update RedemptionRequest status: Completed                   │ │ ║
║   │   │   2. Store btc_txid for record                                    │ │ ║
║   │   │   3. Emit RedemptionCompleted event                               │ │ ║
║   │   │                                                                    │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   STEP 4: User Receives BTC                                                   ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   Bitcoin Transaction:                                                   │ ║
║   │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║   │   │  Input:  Pool custody UTXO (FROST signed)                         │ │ ║
║   │   │  Output: 50,000 sats → bc1q... (user's address)                  │ │ ║
║   │   └───────────────────────────────────────────────────────────────────┘ │ ║
║   │                                                                          │ ║
║   │   User sees BTC in their wallet! ✓                                      │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Code Example

```typescript
async function requestWithdrawal(
  program: Program,
  userWallet: Keypair,
  amountSats: number,
  btcAddress: string
) {
  // Generate unique nonce for this request
  const requestNonce = Date.now();

  const [redemptionRequest] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("redemption"),
      userWallet.publicKey.toBuffer(),
      new BN(requestNonce).toArrayLike(Buffer, 'le', 8)
    ],
    program.programId
  );

  const tx = await program.methods
    .requestRedemption(
      new BN(amountSats),
      btcAddress,
      new BN(requestNonce)
    )
    .accounts({
      poolState,
      redemptionRequest,
      zkbtcMint,
      userTokenAccount,
      user: userWallet.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([userWallet])
    .rpc();

  console.log("Withdrawal requested:", tx);
  console.log("Amount:", amountSats, "sats");
  console.log("BTC Address:", btcAddress);
  console.log("Status: Pending FROST signature...");

  return redemptionRequest;
}
```

---

## State Diagrams

### Deposit State Machine

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           DEPOSIT STATE MACHINE                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║                          ┌─────────────────┐                                  ║
║                          │                 │                                  ║
║              ┌──────────►│   NOT_EXISTS    │                                  ║
║              │           │                 │                                  ║
║              │           └────────┬────────┘                                  ║
║              │                    │                                           ║
║              │                    │ send BTC with OP_RETURN                   ║
║              │                    ▼                                           ║
║              │           ┌─────────────────┐                                  ║
║              │           │                 │                                  ║
║              │           │   BTC_PENDING   │ (waiting for confirmations)      ║
║              │           │                 │                                  ║
║              │           └────────┬────────┘                                  ║
║              │                    │                                           ║
║              │                    │ 6+ confirmations                          ║
║              │                    ▼                                           ║
║              │           ┌─────────────────┐                                  ║
║              │           │                 │                                  ║
║              │           │  BTC_CONFIRMED  │ (ready for verification)         ║
║              │           │                 │                                  ║
║              │           └────────┬────────┘                                  ║
║              │                    │                                           ║
║              │                    │ verify_deposit()                          ║
║              │                    ▼                                           ║
║              │           ┌─────────────────┐                                  ║
║              │           │                 │                                  ║
║              │           │    VERIFIED     │ (commitment in tree)             ║
║              │           │                 │                                  ║
║              │           └────────┬────────┘                                  ║
║              │                    │                                           ║
║              │                    │ claim_direct()                            ║
║              │                    ▼                                           ║
║              │           ┌─────────────────┐                                  ║
║   (refund    │           │                 │                                  ║
║    path)     │           │    CLAIMED      │ (zkBTC minted)                   ║
║              │           │                 │                                  ║
║              └───────────└─────────────────┘                                  ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Commitment State Machine

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         COMMITMENT STATE MACHINE                               ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║                          ┌─────────────────┐                                  ║
║                          │                 │                                  ║
║                          │   IN_TREE       │ (valid, spendable)               ║
║                          │                 │                                  ║
║                          └────────┬────────┘                                  ║
║                                   │                                           ║
║             ┌─────────────────────┼─────────────────────┐                    ║
║             │                     │                     │                    ║
║             │ claim_direct()      │ split_commitment()  │ mint_to_commit()   ║
║             │                     │                     │                    ║
║             ▼                     ▼                     ▼                    ║
║   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐           ║
║   │                 │   │                 │   │                 │           ║
║   │ SPENT_CLAIMED   │   │  SPENT_SPLIT    │   │ SPENT_REFRESH   │           ║
║   │                 │   │                 │   │                 │           ║
║   │ (zkBTC minted)  │   │ (2 new commits) │   │ (1 new commit)  │           ║
║   │                 │   │                 │   │                 │           ║
║   └─────────────────┘   └─────────────────┘   └─────────────────┘           ║
║                                   │                     │                    ║
║                                   │                     │                    ║
║                                   ▼                     ▼                    ║
║                          ┌─────────────────────────────────┐                 ║
║                          │                                 │                 ║
║                          │   NEW COMMITMENTS IN_TREE       │                 ║
║                          │                                 │                 ║
║                          └─────────────────────────────────┘                 ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Data Structures

### On-Chain Accounts

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            ON-CHAIN ACCOUNTS                                   ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   PoolState (PDA: ["pool"])                                                   ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  authority:          Pubkey     // Admin                                 │ ║
║   │  zkbtc_mint:         Pubkey     // Token mint address                   │ ║
║   │  min_deposit:        u64        // 10,000 sats                          │ ║
║   │  max_deposit:        u64        // 100,000,000,000 sats                 │ ║
║   │  total_minted:       u64        // Total zkBTC minted                   │ ║
║   │  total_burned:       u64        // Total zkBTC burned                   │ ║
║   │  deposit_count:      u64        // Number of deposits                   │ ║
║   │  paused:             bool       // Emergency pause                       │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   BitcoinLightClient (PDA: ["btc_light_client"])                             ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  genesis_hash:       [u8; 32]   // Network genesis                      │ ║
║   │  tip_hash:           [u8; 32]   // Current chain tip                    │ ║
║   │  tip_height:         u64        // Current height                       │ ║
║   │  finalized_height:   u64        // tip - 6                              │ ║
║   │  network:            u8         // 0=main, 1=test, 2=reg                │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   BlockHeader (PDA: ["block_header", height])                                 ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  version:            i32        // Block version                        │ ║
║   │  prev_block_hash:    [u8; 32]   // Previous block                       │ ║
║   │  merkle_root:        [u8; 32]   // Transaction merkle root              │ ║
║   │  timestamp:          u32        // Block timestamp                      │ ║
║   │  bits:               u32        // Difficulty target                    │ ║
║   │  nonce:              u32        // PoW nonce                            │ ║
║   │  height:             u64        // Block height                         │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   CommitmentTree (PDA: ["commitment_tree"])                                   ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  depth:              u8         // 10 levels                            │ ║
║   │  next_index:         u64        // Next leaf position                   │ ║
║   │  root:               [u8; 32]   // Current merkle root                  │ ║
║   │  filled_subtrees:    [[u8;32];10] // For incremental insert            │ ║
║   │  root_history:       [[u8;32];30] // Last 30 roots (for proofs)        │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   DepositRecord (PDA: ["deposit", txid])                                      ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  commitment:         [u8; 32]   // User's commitment                    │ ║
║   │  amount_sats:        u64        // Deposit amount                       │ ║
║   │  btc_txid:           [u8; 32]   // Bitcoin transaction ID              │ ║
║   │  block_height:       u64        // Block containing tx                  │ ║
║   │  leaf_index:         u64        // Position in tree                     │ ║
║   │  timestamp:          i64        // Verification time                    │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   NullifierRecord (PDA: ["nullifier", nullifier_hash])                        ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │  nullifier_hash:     [u8; 32]   // H(nullifier)                        │ ║
║   │  spent_at:           i64        // When spent                           │ ║
║   │  spent_by:           Pubkey     // Who spent                            │ ║
║   │  operation_type:     enum       // Claim/Split/Transfer                 │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Security Model

### Privacy Guarantees

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            PRIVACY GUARANTEES                                  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   ┌─────────────┬───────────────────────┬───────────────────────────────────┐ ║
║   │   PHASE     │   PUBLIC ON-CHAIN     │   PRIVATE (OFF-CHAIN)             │ ║
║   ├─────────────┼───────────────────────┼───────────────────────────────────┤ ║
║   │             │                       │                                    │ ║
║   │  Deposit    │  • txid               │  • nullifier                      │ ║
║   │             │  • commitment         │  • secret                         │ ║
║   │             │  • amount             │  • user identity                  │ ║
║   │             │  • deposit address    │                                    │ ║
║   │             │                       │                                    │ ║
║   ├─────────────┼───────────────────────┼───────────────────────────────────┤ ║
║   │             │                       │                                    │ ║
║   │  Claim      │  • nullifier_hash     │  • nullifier                      │ ║
║   │             │  • amount             │  • secret                         │ ║
║   │             │  • recipient          │  • which deposit                  │ ║
║   │             │                       │                                    │ ║
║   ├─────────────┼───────────────────────┼───────────────────────────────────┤ ║
║   │             │                       │                                    │ ║
║   │  Split      │  • old nullifier_hash │  • amounts per output             │ ║
║   │             │  • 2 new commitments  │  • who owns which                 │ ║
║   │             │                       │                                    │ ║
║   ├─────────────┼───────────────────────┼───────────────────────────────────┤ ║
║   │             │                       │                                    │ ║
║   │  Withdraw   │  • btc_address        │  • source of funds                │ ║
║   │             │  • amount             │                                    │ ║
║   │             │                       │                                    │ ║
║   └─────────────┴───────────────────────┴───────────────────────────────────┘ ║
║                                                                                ║
║   KEY PRIVACY PROPERTY:                                                       ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   commitment = Poseidon(nullifier, secret)                              │ ║
║   │   nullifier_hash = Poseidon(nullifier)                                  │ ║
║   │                                                                          │ ║
║   │   ∴ commitment ≠ nullifier_hash (different hash inputs)                 │ ║
║   │   ∴ Cannot link deposit → claim without knowing 'secret'                │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Threat Model

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              THREAT MODEL                                      ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   PROTECTED AGAINST:                                                          ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   ✓ Double-spending        Nullifier registry prevents reuse            │ ║
║   │   ✓ Fake deposits          SPV proof required, 6+ confirmations         │ ║
║   │   ✓ Amount manipulation    Proven in ZK, verified on-chain              │ ║
║   │   ✓ Front-running claims   Recipient bound in proof                     │ ║
║   │   ✓ Transaction linkage    commitment ≠ nullifier_hash                  │ ║
║   │   ✓ Block reorgs           6 confirmation requirement                   │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
║   TRUST ASSUMPTIONS:                                                          ║
║   ┌─────────────────────────────────────────────────────────────────────────┐ ║
║   │                                                                          │ ║
║   │   • Bitcoin: 51% honest miners                                          │ ║
║   │   • Solana: Network liveness                                             │ ║
║   │   • FROST: t-of-n signers honest (for withdrawals)                      │ ║
║   │   • ZK Circuits: Correct implementation                                  │ ║
║   │   • User: Keeps secrets secure                                           │ ║
║   │                                                                          │ ║
║   └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Error Reference

| Error Code | Name | Description | Solution |
|------------|------|-------------|----------|
| 6000 | `PoolPaused` | Pool is paused | Wait for admin to unpause |
| 6001 | `AmountTooSmall` | Below minimum (10k sats) | Deposit more |
| 6002 | `AmountTooLarge` | Above maximum | Split deposit |
| 6003 | `InvalidMerkleProof` | SPV proof invalid | Check txid, block height |
| 6004 | `NullifierAlreadyUsed` | Double-spend attempt | Already claimed |
| 6005 | `CommitmentNotFound` | No OP_RETURN in tx | Add commitment to tx |
| 6006 | `InsufficientConfirmations` | < 6 confirmations | Wait longer |
| 6007 | `InvalidZkProof` | Proof verification failed | Regenerate proof |
| 6008 | `InvalidRoot` | Merkle root not found | Use recent root |
| 6009 | `BlockNotFound` | Header not submitted | Submit header first |

---

## Fee Summary

| Operation | Network | Typical Fee |
|-----------|---------|-------------|
| BTC Deposit | Bitcoin | 1,000-5,000 sats |
| Submit Header | Solana | ~0.000005 SOL |
| Verify Deposit | Solana | ~0.005 SOL |
| Claim zkBTC | Solana | ~0.01 SOL |
| Split | Solana | ~0.01 SOL |
| Request Withdrawal | Solana | ~0.005 SOL |
| BTC Withdrawal | Bitcoin | 1,000-5,000 sats (pool pays) |

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QUICK REFERENCE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  DEPOSIT:                                                                    │
│    1. Generate: nullifier, secret, commitment                               │
│    2. Send BTC with OP_RETURN commitment                                    │
│    3. Wait 6+ confirmations                                                 │
│    4. Call verify_deposit (anyone can do this)                              │
│                                                                              │
│  CLAIM:                                                                      │
│    1. Generate ZK proof with your secrets                                   │
│    2. Call claim_direct → receive zkBTC                                     │
│                                                                              │
│  SPLIT:                                                                      │
│    1. Generate 2 new credential sets                                        │
│    2. Generate split proof                                                  │
│    3. Call split_commitment → 2 new commitments                             │
│                                                                              │
│  TRANSFER:                                                                   │
│    1. Create claim link with credentials                                    │
│    2. Send link to recipient                                                │
│    3. Recipient claims with their wallet                                    │
│                                                                              │
│  WITHDRAW:                                                                   │
│    1. Call request_redemption(amount, btc_address)                          │
│    2. zkBTC burned, request queued                                          │
│    3. FROST signs and sends BTC                                             │
│    4. Receive BTC at your address                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```
