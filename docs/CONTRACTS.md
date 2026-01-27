# zVault Solana Program Documentation

This document provides comprehensive documentation for the zVault Solana program, including all instructions, account structures, and usage patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Program IDs](#program-ids)
3. [Instructions Summary](#instructions-summary)
4. [Core Instructions](#core-instructions)
5. [Name Registry Instructions](#name-registry-instructions)
6. [Demo/Testing Instructions](#demotesting-instructions)
7. [Account Structures](#account-structures)
8. [PDA Derivation](#pda-derivation)
9. [Error Codes](#error-codes)
10. [Compute Units](#compute-units)

---

## Overview

The zVault program implements a shielded pool for private BTC-to-Solana bridging. Built with Pinocchio for optimal performance, it provides:

- **SPV Verification**: Verify Bitcoin deposits with Merkle proofs
- **Commitment Tree**: Poseidon2-based Merkle tree (depth 20)
- **ZK Verification**: Groth16 proofs via `alt_bn128` syscalls
- **Stealth Addresses**: ECDH-based private transfers
- **Name Registry**: Human-readable `.zkey` addresses

### Shielded-Only Architecture

```
| Operation     | Amount Visible? |
|---------------|-----------------|
| Deposit       | No (in commitment) |
| Split         | No |
| Stealth Send  | No |
| Withdraw      | Yes (unavoidable) |
```

---

## Program IDs

| Program | Network | Address |
|---------|---------|---------|
| zVault | Devnet | `5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK` |
| BTC Light Client | Devnet | `95vWurTc9BhjBvEbBdUKoTZHMPPyB1iQZEuXEaR7wPpd` |

---

## Instructions Summary

| Discriminator | Name | Purpose | CU Cost |
|---------------|------|---------|---------|
| 0 | INITIALIZE | Initialize pool state | ~5,000 |
| 4 | SPLIT_COMMITMENT | Split 1 commitment into 2 | ~100,000 |
| 5 | REQUEST_REDEMPTION | Request BTC withdrawal | ~15,000 |
| 6 | COMPLETE_REDEMPTION | Complete BTC withdrawal | ~10,000 |
| 7 | SET_PAUSED | Pause/unpause pool | ~5,000 |
| 8 | VERIFY_DEPOSIT | Record BTC deposit with SPV | ~50,000 |
| 16 | ANNOUNCE_STEALTH | Announce stealth transfer | ~20,000 |
| 17 | REGISTER_NAME | Register .zkey name | ~15,000 |
| 18 | UPDATE_NAME | Update name metadata | ~10,000 |
| 19 | TRANSFER_NAME | Transfer name ownership | ~10,000 |
| 21 | ADD_DEMO_NOTE | Add test commitment (admin) | ~10,000 |
| 22 | ADD_DEMO_STEALTH | Add test stealth (admin) | ~10,000 |
| 23 | VERIFY_STEALTH_DEPOSIT_V2 | Backend-managed stealth deposit | ~60,000 |

---

## Core Instructions

### INITIALIZE (0)

Initializes the pool state, commitment tree, and token mint.

**Accounts:**
```
[0] pool_state       (writable, PDA)     - Pool configuration
[1] commitment_tree  (writable, PDA)     - Merkle tree state
[2] zkbtc_mint       (writable, PDA)     - Token-2022 mint
[3] authority        (signer)            - Pool authority
[4] system_program   (readonly)          - System program
[5] token_program    (readonly)          - Token-2022 program
```

**Data:**
```rust
// No additional data required
```

---

### VERIFY_DEPOSIT (8)

Records a BTC deposit after verifying SPV proof.

**Accounts:**
```
[0] pool_state       (writable, PDA)     - Pool state
[1] commitment_tree  (writable, PDA)     - Merkle tree
[2] deposit_record   (writable, PDA)     - Deposit record (new)
[3] light_client     (readonly, PDA)     - BTC light client
[4] block_header     (readonly, PDA)     - Block containing tx
[5] chad_buffer      (readonly)          - Raw transaction data
[6] payer            (signer, writable)  - Transaction payer
[7] system_program   (readonly)          - System program
```

**Data:**
```rust
struct VerifyDepositData {
    commitment: [u8; 32],      // Poseidon2 commitment
    amount_sats: u64,          // Amount in satoshis
    block_height: u64,         // Bitcoin block height
    merkle_proof: Vec<[u8; 32]>, // Bitcoin tx Merkle proof
    tx_index: u32,             // Transaction index in block
}
```

**Flow:**
1. Verify transaction exists in Bitcoin block (SPV)
2. Parse transaction outputs for commitment-derived Taproot address
3. Verify amount matches
4. Insert commitment into Merkle tree
5. Create deposit record PDA

---

### SPLIT_COMMITMENT (4)

Splits one commitment into two outputs using ZK proof.

**Accounts:**
```
[0] pool_state        (readonly, PDA)    - Pool state
[1] commitment_tree   (writable, PDA)    - Merkle tree
[2] nullifier_record  (writable, PDA)    - Nullifier (new)
[3] payer             (signer, writable) - Transaction payer
[4] system_program    (readonly)         - System program
```

**Data:**
```rust
struct SplitCommitmentData {
    proof: [u8; 256],              // Groth16 proof (A, B, C)
    merkle_root: [u8; 32],         // Current tree root
    input_nullifier_hash: [u8; 32], // Hash(input_nullifier)
    output_commitment_1: [u8; 32],  // First output
    output_commitment_2: [u8; 32],  // Second output
}
```

**ZK Circuit Verification:**
- Input commitment exists in tree
- Nullifier hash matches commitment
- Amount conservation: input = output1 + output2
- Output commitments correctly formed

---

### REQUEST_REDEMPTION (5)

Burns shielded balance and requests BTC withdrawal.

**Accounts:**
```
[0] pool_state         (readonly, PDA)    - Pool state
[1] commitment_tree    (writable, PDA)    - Merkle tree
[2] redemption_request (writable, PDA)    - Redemption record
[3] nullifier_record   (writable, PDA)    - Nullifier (new)
[4] user               (signer, writable) - Requesting user
[5] system_program     (readonly)         - System program
```

**Data:**
```rust
struct RequestRedemptionData {
    proof: [u8; 256],           // Groth16 proof
    merkle_root: [u8; 32],      // Current tree root
    nullifier_hash: [u8; 32],   // Input nullifier hash
    withdraw_amount: u64,       // Amount to withdraw (sats)
    change_commitment: [u8; 32], // Change output (if partial)
    btc_address: [u8; 34],      // Destination BTC address
}
```

---

### COMPLETE_REDEMPTION (6)

Marks redemption as complete after BTC transaction.

**Accounts:**
```
[0] pool_state         (readonly, PDA)    - Pool state
[1] redemption_request (writable, PDA)    - Redemption record
[2] authority          (signer)           - Pool authority
```

**Data:**
```rust
struct CompleteRedemptionData {
    btc_txid: [u8; 32],  // Bitcoin transaction ID
}
```

---

### SET_PAUSED (7)

Pauses or unpauses the pool (admin only).

**Accounts:**
```
[0] pool_state  (writable, PDA)  - Pool state
[1] authority   (signer)         - Pool authority
```

**Data:**
```rust
struct SetPausedData {
    paused: bool,  // true = paused, false = active
}
```

---

### ANNOUNCE_STEALTH (16)

Announces a stealth transfer for recipient to scan.

**Accounts:**
```
[0] pool_state           (readonly, PDA)    - Pool state
[1] commitment_tree      (writable, PDA)    - Merkle tree
[2] stealth_announcement (writable, PDA)    - Announcement record
[3] sender               (signer, writable) - Sender
[4] system_program       (readonly)         - System program
```

**Data:**
```rust
struct AnnounceStealthData {
    commitment: [u8; 32],        // Output commitment
    ephemeral_pubkey: [u8; 32],  // Sender's ephemeral public key
    encrypted_data: [u8; 64],    // Encrypted note data (optional)
}
```

**Recipient Scanning:**
1. Recipient fetches all announcements
2. For each: tries ECDH with ephemeral key
3. Derives expected commitment
4. If match → can claim with derived secrets

---

## Name Registry Instructions

### REGISTER_NAME (17)

Registers a new `.zkey` human-readable name.

**Accounts:**
```
[0] name_registry  (writable, PDA)    - Name record
[1] owner          (signer, writable) - Name owner
[2] system_program (readonly)         - System program
```

**Data:**
```rust
struct RegisterNameData {
    name: String,                    // e.g., "alice" (max 32 chars)
    stealth_meta_address: [u8; 64],  // Spending + viewing pubkeys
}
```

**Validation:**
- Name: 1-32 lowercase alphanumeric + underscore
- No duplicates (PDA collision)
- Owner pays rent

---

### UPDATE_NAME (18)

Updates the stealth address for a name.

**Accounts:**
```
[0] name_registry (writable, PDA) - Name record
[1] owner         (signer)        - Current owner
```

**Data:**
```rust
struct UpdateNameData {
    stealth_meta_address: [u8; 64],  // New stealth address
}
```

---

### TRANSFER_NAME (19)

Transfers name ownership to new owner.

**Accounts:**
```
[0] name_registry (writable, PDA) - Name record
[1] owner         (signer)        - Current owner
[2] new_owner     (readonly)      - New owner pubkey
```

---

## Demo/Testing Instructions

### ADD_DEMO_NOTE (21)

Adds a test commitment to the tree (admin only, devnet).

**Accounts:**
```
[0] pool_state       (readonly, PDA)    - Pool state
[1] commitment_tree  (writable, PDA)    - Merkle tree
[2] authority        (signer)           - Pool authority
[3] system_program   (readonly)         - System program
```

**Data:**
```rust
struct AddDemoNoteData {
    commitment: [u8; 32],  // Commitment to add
    amount_sats: u64,      // Associated amount
}
```

---

### ADD_DEMO_STEALTH (22)

Adds a test stealth announcement (admin only, devnet).

**Accounts:**
```
[0] pool_state           (readonly, PDA)    - Pool state
[1] commitment_tree      (writable, PDA)    - Merkle tree
[2] stealth_announcement (writable, PDA)    - Announcement
[3] authority            (signer)           - Pool authority
[4] system_program       (readonly)         - System program
```

---

## Backend-Managed Instructions

### VERIFY_STEALTH_DEPOSIT_V2 (23)

Backend-managed stealth deposit flow combining SPV verification, stealth announcement creation, and zBTC minting in a single atomic transaction.

**Use Case:** 2-phase BTC deposit flow for demo/quick testing:
1. Backend generates ephemeral keypair, derives BTC deposit address
2. User deposits BTC to that address
3. Backend detects deposit, sweeps to vault, calls this instruction

**Accounts:**
```
[0]  pool_state           (writable, PDA)    - Pool state
[1]  light_client         (readonly, PDA)    - BTC light client
[2]  block_header         (readonly, PDA)    - Block containing sweep tx
[3]  commitment_tree      (writable, PDA)    - Merkle tree
[4]  deposit_record       (writable, PDA)    - Deposit record (new)
[5]  stealth_announcement (writable, PDA)    - Stealth announcement (new)
[6]  tx_buffer            (readonly)         - ChadBuffer with raw sweep tx
[7]  authority            (signer, writable) - Pool authority (pays rent)
[8]  system_program       (readonly)         - System program
[9]  zbtc_mint            (writable)         - zBTC Token-2022 mint
[10] pool_vault           (writable)         - Pool vault token account
[11] token_program        (readonly)         - Token-2022 program
```

**Data (117 bytes + merkle proof):**
```rust
struct VerifyStealthDepositV2Data {
    txid: [u8; 32],           // Sweep tx ID (reversed)
    block_height: u64,        // Block containing tx
    amount_sats: u64,         // Amount in satoshis
    tx_size: u32,             // Raw tx size in ChadBuffer
    ephemeral_pub: [u8; 33],  // Grumpkin compressed pubkey
    commitment: [u8; 32],     // Backend-computed Poseidon2 commitment
    // followed by merkle_proof (variable length)
}
```

**Flow:**
1. Verify authority is pool authority
2. Read raw tx from ChadBuffer, verify hash matches txid
3. Verify SPV merkle proof against light client
4. Verify 1+ confirmations (demo mode)
5. Create DepositRecord PDA (prevents double-spend)
6. Insert commitment into tree → get leaf_index
7. Create StealthAnnouncement PDA
8. Mint zBTC to pool vault
9. Update pool statistics

**Key Differences from VERIFY_DEPOSIT:**
- Authority-gated (only pool authority can call)
- Commitment pre-computed by backend (not from OP_RETURN)
- Ephemeral pubkey provided directly
- Creates stealth announcement atomically
- Mints zBTC in same transaction

---

## Account Structures

### PoolState

```rust
#[repr(C)]
pub struct PoolState {
    pub discriminator: u8,        // 0x01
    pub authority: [u8; 32],      // Admin pubkey
    pub zkbtc_mint: [u8; 32],     // Token mint
    pub merkle_root: [u8; 32],    // Current tree root
    pub deposit_count: u64,       // Total deposits
    pub total_deposited: u64,     // Total BTC deposited
    pub total_minted: u64,        // Total zkBTC minted
    pub flags: u8,                // Bitflags (paused, etc.)
    pub bump: u8,                 // PDA bump
    pub last_update: i64,         // Unix timestamp
}
// Size: ~130 bytes
```

### CommitmentTree

```rust
#[repr(C)]
pub struct CommitmentTree {
    pub discriminator: u8,                    // 0x02
    pub next_index: u64,                      // Next leaf index
    pub current_root_index: u8,               // Ring buffer index
    pub roots: [[u8; 32]; 30],                // Root history
    pub filled_subtrees: [[u8; 32]; 20],      // For incremental insert
}
// Size: ~1,640 bytes
```

### NullifierRecord

```rust
#[repr(C)]
pub struct NullifierRecord {
    pub discriminator: u8,        // 0x03
    pub nullifier_hash: [u8; 32], // Poseidon2(nullifier)
    pub spent_at: i64,            // Unix timestamp
}
// Size: ~42 bytes
```

### StealthAnnouncement

```rust
#[repr(C)]
pub struct StealthAnnouncement {
    pub discriminator: u8,         // 0x04
    pub commitment: [u8; 32],      // Output commitment
    pub ephemeral_pubkey: [u8; 32], // Grumpkin point
    pub encrypted_data: [u8; 64],  // Optional encrypted note
    pub leaf_index: u64,           // Tree position
    pub timestamp: i64,            // Creation time
}
// Size: ~146 bytes
```

### NameRegistry

```rust
#[repr(C)]
pub struct NameRegistry {
    pub discriminator: u8,              // 0x05
    pub owner: [u8; 32],                // Owner pubkey
    pub name_hash: [u8; 32],            // SHA256(name)
    pub stealth_spending_key: [u8; 32], // Grumpkin point
    pub stealth_viewing_key: [u8; 32],  // Grumpkin point
    pub created_at: i64,                // Creation timestamp
    pub updated_at: i64,                // Last update
}
// Size: ~170 bytes
```

---

## PDA Derivation

```typescript
// Pool State
["pool_state"] → pool_state_pda

// Commitment Tree
["commitment_tree"] → commitment_tree_pda

// Deposit Record
["deposit", txid: [u8; 32]] → deposit_record_pda

// Nullifier Record
["nullifier", nullifier_hash: [u8; 32]] → nullifier_pda

// Stealth Announcement
["stealth", commitment: [u8; 32]] → stealth_pda

// Name Registry
["name", name_hash: [u8; 32]] → name_pda

// Block Header (Light Client)
["block_header", height: u64] → header_pda
```

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0x1770 | PoolPaused | Pool is paused |
| 0x1771 | Unauthorized | Caller not authorized |
| 0x1772 | InvalidProof | ZK proof verification failed |
| 0x1773 | NullifierAlreadyUsed | Double-spend attempt |
| 0x1774 | InvalidMerkleRoot | Root not in history |
| 0x1775 | InvalidAmount | Amount mismatch |
| 0x1776 | SPVVerificationFailed | Bitcoin proof invalid |
| 0x1777 | DepositNotFound | No deposit record |
| 0x1778 | RedemptionNotFound | No redemption record |
| 0x1779 | NameTaken | Name already registered |
| 0x177A | InvalidName | Name format invalid |
| 0x177B | NotNameOwner | Caller doesn't own name |

---

## Compute Units

### Measured CU Costs (Devnet)

| Instruction | Typical CU | Peak CU |
|-------------|------------|---------|
| INITIALIZE | 5,000 | 8,000 |
| VERIFY_DEPOSIT | 45,000 | 55,000 |
| SPLIT_COMMITMENT | 95,000 | 105,000 |
| REQUEST_REDEMPTION | 90,000 | 100,000 |
| COMPLETE_REDEMPTION | 8,000 | 12,000 |
| ANNOUNCE_STEALTH | 18,000 | 25,000 |
| REGISTER_NAME | 12,000 | 18,000 |

### Optimization Notes

- ZK verification uses ~90,000 CU (dominated by `alt_bn128` syscalls)
- Pinocchio provides ~80% savings vs Anchor for non-ZK operations
- Consider request units: 200,000 for ZK instructions

---

## Usage Examples

### TypeScript (SDK)

```typescript
import { createClient } from '@zvault/sdk';
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com');
const client = createClient(connection);

// 1. Deposit
const deposit = await client.deposit(100_000n); // 0.001 BTC
console.log('Send BTC to:', deposit.taprootAddress);

// 2. Claim (after BTC confirmed)
const claim = await client.privateClaim(deposit.claimLink);

// 3. Split
const { output1, output2 } = await client.privateSplit(deposit.note, 50_000n);

// 4. Withdraw
const withdraw = await client.withdraw(output1.note, 'tb1qxyz...');
```

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [SDK.md](./SDK.md) - TypeScript SDK reference
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
