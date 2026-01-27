# zVault Visual Architecture

Interactive Mermaid diagrams for technical discussions. View in any Markdown viewer with Mermaid support (GitHub, VS Code, Notion, etc.).

---

## 1. High-Level System Overview

```mermaid
flowchart TB
    subgraph Bitcoin["Bitcoin Network"]
        BTC_TX[Bitcoin Transaction]
        TAPROOT[Taproot Address]
    end

    subgraph User["User/Client"]
        SDK["@zvault/sdk"]
        FRONTEND[Frontend/Mobile App]
        WALLET[Solana Wallet]
    end

    subgraph Solana["Solana Blockchain"]
        subgraph Program["zVault Program"]
            POOL[PoolState]
            TREE[CommitmentTree]
            NULL[NullifierRecord]
            DEPOSIT[DepositRecord]
            STEALTH[StealthAnnouncement]
            NAME[NameRegistry]
            REDEEM[RedemptionRequest]
        end
        LIGHT[BTC Light Client]
    end

    subgraph Backend["Backend Services"]
        API[REST API]
        REDEMPTION[Redemption Processor]
        RELAYER[Header Relayer]
    end

    subgraph ZK["ZK Proof Generation"]
        NOIR[Noir Circuits]
        GROTH16[Groth16 Prover]
    end

    WALLET --> SDK
    SDK --> FRONTEND
    FRONTEND --> SDK

    SDK -->|1. Generate Taproot Address| TAPROOT
    BTC_TX -->|2. BTC Deposit| TAPROOT
    RELAYER -->|3. Submit Headers| LIGHT
    SDK -->|4. verify_deposit| POOL
    POOL -->|5. Insert Commitment| TREE
    POOL -->|6. Create Record| DEPOSIT

    SDK --> NOIR
    NOIR --> GROTH16
    GROTH16 -->|Proof| SDK

    SDK -->|claim + proof| NULL
    SDK -->|split + proof| NULL
    SDK -->|announce_stealth| STEALTH

    SDK -->|request_redemption| REDEEM
    REDEMPTION -->|Poll requests| REDEEM
    REDEMPTION -->|Sign & broadcast| BTC_TX

    SDK -->|register/lookup| NAME
```

---

## 2. Component Architecture

```mermaid
flowchart LR
    subgraph Clients["Client Layer"]
        direction TB
        WEB["Web Frontend<br/>(Next.js)"]
        MOBILE["Mobile App<br/>(Expo)"]
        CLI["CLI Tools"]
    end

    subgraph SDK_Layer["SDK Layer (@zvault/sdk)"]
        direction TB
        NOTE["note.ts<br/>Note Generation"]
        KEYS["keys.ts<br/>Key Derivation"]
        CRYPTO["crypto.ts<br/>Field Math"]
        GRUMPKIN["grumpkin.ts<br/>ECDH"]
        STEALTH_SDK["stealth.ts<br/>Stealth Addresses"]
        MERKLE["merkle.ts<br/>Merkle Proofs"]
        PROVER["prover.ts<br/>WASM Prover"]
        TAPROOT_SDK["taproot.ts<br/>BTC Address"]
        WATCHER["watcher/<br/>Deposit Monitoring"]
    end

    subgraph Solana_Layer["Solana Program Layer"]
        direction TB
        ZVAULT["zVault-Pinocchio<br/>Main Program"]
        LIGHT_CLIENT["BTC Light Client<br/>SPV Verification"]
    end

    subgraph Backend_Layer["Backend Layer (Rust)"]
        direction TB
        API_SVC["REST API<br/>(Axum)"]
        REDEEM_SVC["Redemption<br/>Processor"]
        HEADER_SVC["Header Relayer<br/>(Node.js)"]
    end

    subgraph External["External"]
        direction TB
        BTC["Bitcoin<br/>Network"]
        ESPLORA["Esplora<br/>Block Explorer"]
    end

    Clients --> SDK_Layer
    SDK_Layer --> Solana_Layer
    SDK_Layer --> Backend_Layer
    Backend_Layer --> BTC
    HEADER_SVC --> ESPLORA
    HEADER_SVC --> LIGHT_CLIENT
```

---

## 3. Complete Data Flow: Deposit to Withdrawal

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant SDK as SDK
    participant BTC as Bitcoin
    participant HR as Header Relayer
    participant LC as Light Client
    participant ZV as zVault Program
    participant BE as Backend

    rect rgb(40, 60, 80)
    note right of U: Phase 1: Deposit Generation
    U->>SDK: deposit(amount)
    SDK->>SDK: Generate nullifier, secret
    SDK->>SDK: commitment = Poseidon2(Poseidon2(nullifier, secret), amount)
    SDK->>SDK: Derive Taproot address from commitment
    SDK-->>U: Return { taprootAddress, claimLink }
    end

    rect rgb(60, 40, 80)
    note right of U: Phase 2: Bitcoin Deposit
    U->>BTC: Send BTC to Taproot address
    BTC-->>BTC: Transaction confirmed
    HR->>BTC: Poll new block headers
    HR->>LC: Submit block headers
    end

    rect rgb(40, 80, 60)
    note right of U: Phase 3: Deposit Verification
    U->>SDK: verifyDeposit(txid)
    SDK->>SDK: Fetch SPV proof from Esplora
    SDK->>SDK: Upload raw tx to ChadBuffer
    SDK->>ZV: verify_deposit instruction
    ZV->>LC: Verify SPV proof
    ZV->>ZV: Insert commitment to Merkle tree
    ZV->>ZV: Create DepositRecord
    ZV->>ZV: Mint zBTC to pool vault
    ZV-->>SDK: Return leaf_index
    end

    rect rgb(80, 60, 40)
    note right of U: Phase 4: Private Claim (ZK)
    U->>SDK: claim(claimLink)
    SDK->>SDK: Parse nullifier, secret, amount
    SDK->>SDK: Generate Groth16 proof
    SDK->>ZV: claim instruction + proof
    ZV->>ZV: Verify Groth16 proof (alt_bn128)
    ZV->>ZV: Check nullifier not spent
    ZV->>ZV: Create NullifierRecord
    ZV-->>U: Claim successful
    end

    rect rgb(80, 40, 60)
    note right of U: Phase 5: Withdrawal
    U->>SDK: withdraw(note, btcAddress)
    SDK->>SDK: Generate withdrawal ZK proof
    SDK->>ZV: request_redemption + proof
    ZV->>ZV: Verify proof
    ZV->>ZV: Create RedemptionRequest
    ZV->>ZV: Burn zBTC from pool
    BE->>ZV: Poll pending requests
    BE->>BTC: Sign & broadcast BTC tx
    BE->>ZV: Update status = Completed
    BTC-->>U: Receive BTC
    end
```

---

## 4. Stealth Address Transfer Flow

```mermaid
sequenceDiagram
    autonumber
    participant S as Sender
    participant SDK as SDK
    participant ZV as zVault Program
    participant R as Recipient

    rect rgb(50, 70, 90)
    note right of R: Recipient Setup
    R->>SDK: Generate stealth meta address
    SDK->>SDK: Generate Grumpkin keypairs
    SDK-->>R: { spendingPub, viewingPub }
    R-->>S: Share meta address (QR/link)
    end

    rect rgb(70, 50, 90)
    note right of S: Sender Creates Stealth Deposit
    S->>SDK: sendStealth(recipientMeta, amount)
    SDK->>SDK: Generate ephemeral Grumpkin keypair
    SDK->>SDK: sharedSecret = ECDH(ephemeralPriv, viewingPub)
    SDK->>SDK: stealthPub = spendingPub + hash(sharedSecret) * G
    SDK->>SDK: commitment = Poseidon2(stealthPub.x, amount)
    SDK->>ZV: announce_stealth(ephemeralPub, commitment, amount)
    ZV->>ZV: Create StealthAnnouncement
    ZV->>ZV: Insert commitment to tree
    ZV-->>SDK: Return leaf_index
    SDK-->>S: { signature, ephemeralPub }
    end

    rect rgb(90, 70, 50)
    note right of R: Recipient Scans & Claims
    R->>ZV: Fetch all StealthAnnouncements
    loop For each announcement
        R->>SDK: Check if mine
        SDK->>SDK: sharedSecret = ECDH(viewingPriv, ephemeralPub)
        SDK->>SDK: stealthPub = spendingPub + hash(sharedSecret) * G
        SDK->>SDK: Verify commitment == Poseidon2(stealthPub.x, amount)
    end
    R->>SDK: Found matching announcement!
    SDK->>SDK: stealthPriv = spendingPriv + hash(sharedSecret)
    SDK->>SDK: Generate claim ZK proof with stealthPriv
    SDK->>ZV: claim instruction + proof
    ZV-->>R: Claim successful
    end
```

---

## 5. Split Operation Flow (1-in-2-out)

```mermaid
flowchart TB
    subgraph Input["Input Note"]
        IN_NULL[nullifier1]
        IN_SEC[secret1]
        IN_AMT[amount1]
        IN_COMMIT["commitment1 =<br/>Poseidon2(Poseidon2(n1,s1), a1)"]
    end

    subgraph ZK_Proof["ZK Proof Generation"]
        PROOF["Groth16 Proof proves:<br/>1. Input exists in Merkle tree<br/>2. amount1 = amount2 + amount3<br/>3. All nullifiers unique<br/>4. Output commitments valid"]
    end

    subgraph Output1["Output Note 1"]
        OUT1_NULL[nullifier2]
        OUT1_SEC[secret2]
        OUT1_AMT[amount2]
        OUT1_COMMIT["commitment2 =<br/>Poseidon2(Poseidon2(n2,s2), a2)"]
    end

    subgraph Output2["Output Note 2"]
        OUT2_NULL[nullifier3]
        OUT2_SEC[secret3]
        OUT2_AMT[amount3]
        OUT2_COMMIT["commitment3 =<br/>Poseidon2(Poseidon2(n3,s3), a3)"]
    end

    subgraph OnChain["On-Chain State Changes"]
        NULLIFIER["NullifierRecord<br/>(input spent)"]
        TREE_UPDATE["CommitmentTree<br/>(2 new leaves)"]
        POOL_UPDATE["PoolState<br/>(split_count++)"]
    end

    Input --> ZK_Proof
    ZK_Proof --> Output1
    ZK_Proof --> Output2
    ZK_Proof --> OnChain

    IN_AMT -.->|"="| SUM["amount2 + amount3"]
    OUT1_AMT --> SUM
    OUT2_AMT --> SUM
```

---

## 6. Account Structure (PDAs)

```mermaid
erDiagram
    PoolState {
        u8 discriminator "0x01"
        Pubkey authority
        Pubkey zbtc_mint
        Pubkey pool_vault
        u64 deposit_count
        u64 total_minted
        u64 total_burned
        u64 pending_redemptions
        u64 direct_claims
        u64 split_count
        u64 total_shielded
        u8 flags
    }

    CommitmentTree {
        u8 discriminator "0x05"
        u8 depth "20"
        bytes32 current_root
        u32 next_index
        bytes32_array root_history "32 entries"
    }

    DepositRecord {
        u8 discriminator "0x02"
        bytes32 btc_txid
        bytes32 commitment
        u32 leaf_index
        u64 amount_sats
    }

    NullifierRecord {
        u8 discriminator "0x03"
        bytes32 nullifier_hash
        u8 operation_type
        Pubkey spent_by
        i64 spent_at
        u64 spent_in_request
    }

    RedemptionRequest {
        u8 discriminator "0x04"
        u64 request_id
        Pubkey requester
        u64 amount_sats
        string btc_address
        u8 status
        bytes32 btc_txid
    }

    StealthAnnouncement {
        u8 discriminator "0x08"
        bytes33 ephemeral_pub
        u64 amount_sats
        bytes32 commitment
        u32 leaf_index
        i64 created_at
    }

    NameRegistry {
        u8 discriminator "0x09"
        bytes32 name_hash
        Pubkey owner
        bytes33 spending_pubkey
        bytes33 viewing_pubkey
        i64 created_at
        i64 updated_at
    }

    PoolState ||--o{ DepositRecord : tracks
    PoolState ||--o{ NullifierRecord : tracks
    PoolState ||--o{ RedemptionRequest : tracks
    CommitmentTree ||--o{ DepositRecord : contains
    CommitmentTree ||--o{ StealthAnnouncement : contains
```

---

## 7. Cryptographic Pipeline

```mermaid
flowchart LR
    subgraph Note_Gen["Note Generation"]
        NULL["nullifier<br/>(random 32 bytes)"]
        SEC["secret<br/>(random 32 bytes)"]
        AMT["amount<br/>(u64 satoshis)"]
    end

    subgraph Hash1["Inner Hash"]
        P1["Poseidon2(nullifier, secret)"]
    end

    subgraph Hash2["Commitment"]
        P2["Poseidon2(inner_hash, amount)"]
    end

    subgraph Taproot["BTC Address"]
        TAP["P2TR Address<br/>(commitment-derived)"]
    end

    subgraph Nullifier_Hash["Nullifier Hash"]
        NH["Poseidon2(nullifier)"]
    end

    subgraph ZK_Verify["ZK Verification"]
        VERIFY["Groth16 Verify<br/>(alt_bn128 syscalls)"]
    end

    NULL --> P1
    SEC --> P1
    P1 --> P2
    AMT --> P2
    P2 --> TAP
    P2 -->|"in Merkle tree"| VERIFY
    NULL --> NH
    NH -->|"public input"| VERIFY
```

---

## 8. Privacy Model

```mermaid
flowchart TB
    subgraph Public["Publicly Visible"]
        BTC_AMT["BTC Deposit Amount<br/>(on Bitcoin)"]
        WITHDRAW_AMT["Withdrawal Amount<br/>(revealed for BTC tx)"]
        TREE_ROOT["Merkle Tree Root"]
        NULL_HASH["Nullifier Hashes<br/>(prevents double-spend)"]
        EPHEMERAL["Ephemeral Public Keys<br/>(stealth announcements)"]
    end

    subgraph Hidden["Hidden (ZK Protected)"]
        COMMITMENT["Commitment Contents<br/>(nullifier, secret, amount)"]
        SENDER["Sender Identity<br/>(in transfers)"]
        RECEIVER["Receiver Identity<br/>(stealth addresses)"]
        SPLIT_AMT["Split Amounts<br/>(1-to-2 output)"]
        LINK["Transaction Graph<br/>(unlinked via ZK)"]
    end

    subgraph Key_Sep["Key Separation"]
        SPEND["Spending Key<br/>(can claim)"]
        VIEW["Viewing Key<br/>(can scan, cannot spend)"]
    end

    Public -.->|"Cannot derive"| Hidden
    VIEW -->|"Detects deposits"| EPHEMERAL
    SPEND -->|"Required for"| COMMITMENT
```

---

## 9. Instruction Flow Map

```mermaid
flowchart TB
    subgraph Init["Initialization"]
        I0["INITIALIZE (0)"]
    end

    subgraph Deposit_Phase["Deposit Phase"]
        I8["VERIFY_DEPOSIT (8)"]
    end

    subgraph Shielded_Ops["Shielded Operations"]
        I9["CLAIM (9)<br/>~95k CU"]
        I4["SPLIT_COMMITMENT (4)<br/>~100k CU"]
        I16["ANNOUNCE_STEALTH (16)<br/>~20k CU"]
    end

    subgraph Withdrawal_Phase["Withdrawal Phase"]
        I5["REQUEST_REDEMPTION (5)"]
        I6["COMPLETE_REDEMPTION (6)"]
    end

    subgraph Admin["Admin Operations"]
        I7["SET_PAUSED (7)"]
    end

    subgraph Name_Registry["Name Registry"]
        I17["REGISTER_NAME (17)"]
        I18["UPDATE_NAME (18)"]
        I19["TRANSFER_NAME (19)"]
    end

    I0 --> I8
    I8 -->|"or"| I16
    I8 --> I9
    I16 --> I9
    I9 --> I4
    I4 --> I4
    I9 --> I5
    I4 --> I5
    I5 --> I6

    I17 --> I18
    I18 --> I19
```

---

## 10. Technology Stack

```mermaid
mindmap
    root((zVault))
        Solana
            Pinocchio Framework
            Token-2022
            alt_bn128 Syscalls
        Bitcoin
            Taproot P2TR
            SPV Verification
            Header Relay
        Cryptography
            Groth16 ZK Proofs
            BN254 Curve
            Grumpkin ECDH
            Poseidon2 Hash
            SHA256
        SDK
            TypeScript
            WASM Prover
            React Hooks
        Backend
            Rust/Axum
            Node.js Relayer
        Frontend
            Next.js
            Expo Mobile
        Circuits
            Noir Language
            claim
            split
            transfer
            withdraw
```

---

## 11. Deployment Architecture

```mermaid
flowchart TB
    subgraph Client_Apps["Client Applications"]
        WEB["Web App<br/>(Vercel)"]
        MOBILE_IOS["iOS App<br/>(App Store)"]
        MOBILE_AND["Android App<br/>(Play Store)"]
    end

    subgraph Backend_Infra["Backend Infrastructure"]
        API_SERVER["API Server<br/>(Cloud VM)"]
        REDEMPTION_WORKER["Redemption Worker<br/>(Cloud VM)"]
        HEADER_RELAYER["Header Relayer<br/>(Cloud VM)"]
    end

    subgraph Blockchain["Blockchain Networks"]
        SOLANA_DEVNET["Solana Devnet"]
        SOLANA_MAIN["Solana Mainnet"]
        BTC_TEST["Bitcoin Testnet"]
        BTC_MAIN["Bitcoin Mainnet"]
    end

    subgraph External_Services["External Services"]
        ESPLORA_API["Esplora API<br/>(Block Explorer)"]
        RPC["Solana RPC<br/>(Helius/Triton)"]
    end

    Client_Apps --> RPC
    Client_Apps --> API_SERVER
    API_SERVER --> RPC
    REDEMPTION_WORKER --> RPC
    REDEMPTION_WORKER --> BTC_TEST
    HEADER_RELAYER --> ESPLORA_API
    HEADER_RELAYER --> RPC
```

---

## 12. User Journey Map

```mermaid
journey
    title zVault User Journey
    section Onboarding
      Connect Wallet: 5: User
      View Dashboard: 4: User
    section Deposit BTC
      Generate Deposit Address: 5: User
      Send BTC from External Wallet: 3: User
      Wait for Confirmation: 2: User
      Verify Deposit on Solana: 4: User
    section Private Operations
      Receive Claim Link: 5: User
      Claim with ZK Proof: 4: User
      Split Note: 4: User
      Send via Stealth Address: 5: User
    section Withdrawal
      Request Withdrawal: 4: User
      Provide BTC Address: 3: User
      Wait for Processing: 2: User
      Receive BTC: 5: User
```

---

## 13. State Machine: Redemption Request

```mermaid
stateDiagram-v2
    [*] --> Pending: User submits request_redemption
    Pending --> Processing: Backend picks up request
    Processing --> Broadcasting: BTC tx signed
    Broadcasting --> Completed: BTC tx confirmed
    Processing --> Failed: Signing error
    Broadcasting --> Failed: Broadcast error
    Failed --> [*]
    Completed --> [*]
```

---

## 14. C4 Context Diagram

```mermaid
C4Context
    title zVault System Context

    Person(user, "User", "Wants to bridge BTC to Solana privately")

    System(zvault, "zVault", "Privacy-preserving BTC bridge with ZK proofs")

    System_Ext(bitcoin, "Bitcoin Network", "Source chain for BTC deposits")
    System_Ext(solana, "Solana Network", "Destination chain for private tokens")
    System_Ext(wallet, "Wallet App", "Phantom, Backpack, etc.")

    Rel(user, zvault, "Uses")
    Rel(zvault, bitcoin, "Verifies deposits from")
    Rel(zvault, solana, "Runs program on")
    Rel(user, wallet, "Signs with")
    Rel(wallet, zvault, "Connects to")
```

---

## 15. Complete Flow Summary

```mermaid
flowchart TB
    subgraph Phase1["1. DEPOSIT"]
        A1["Generate Note<br/>(nullifier, secret)"]
        A2["Compute Commitment"]
        A3["Derive Taproot Address"]
        A4["Send BTC"]
        A5["Verify on Solana"]
        A1 --> A2 --> A3 --> A4 --> A5
    end

    subgraph Phase2["2. CLAIM"]
        B1["Parse Claim Link"]
        B2["Generate ZK Proof"]
        B3["Submit Claim"]
        B4["Create NullifierRecord"]
        B1 --> B2 --> B3 --> B4
    end

    subgraph Phase3["3. PRIVATE OPS"]
        C1["Split: 1-to-2"]
        C2["Transfer: 1-to-1"]
        C3["Stealth Send"]
        C1 --> C1
        C2 --> C2
        C1 --> C3
        C2 --> C3
    end

    subgraph Phase4["4. WITHDRAW"]
        D1["Request Redemption"]
        D2["Burn zBTC"]
        D3["Backend Signs BTC"]
        D4["Receive BTC"]
        D1 --> D2 --> D3 --> D4
    end

    Phase1 --> Phase2
    Phase2 --> Phase3
    Phase3 --> Phase4
    Phase2 --> Phase4
```

---

## Quick Reference

### Program IDs

| Component | Network | Address |
|-----------|---------|---------|
| zVault Program | Devnet | `CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR` |
| BTC Light Client | Devnet | `8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG` |

### PDA Seeds

| Account | Seeds |
|---------|-------|
| PoolState | `["pool_state"]` |
| CommitmentTree | `["commitment_tree"]` |
| DepositRecord | `["deposit", txid]` |
| NullifierRecord | `["nullifier", nullifier_hash]` |
| RedemptionRequest | `["redemption", request_id]` |
| StealthAnnouncement | `["stealth", ephemeral_pub]` |
| NameRegistry | `["zkey", name_hash]` |

### Instruction Discriminators

| Disc | Name | CU |
|------|------|----|
| 0 | INITIALIZE | - |
| 4 | SPLIT_COMMITMENT | ~100k |
| 5 | REQUEST_REDEMPTION | ~95k |
| 6 | COMPLETE_REDEMPTION | - |
| 7 | SET_PAUSED | - |
| 8 | VERIFY_DEPOSIT | ~200k |
| 9 | CLAIM | ~95k |
| 16 | ANNOUNCE_STEALTH | ~20k |
| 17-19 | NAME_REGISTRY_OPS | - |

---

## How to View

1. **GitHub**: Push to repo, view on GitHub (native Mermaid support)
2. **VS Code**: Install "Mermaid Preview" extension
3. **Notion**: Paste Mermaid code in code block with "mermaid" language
4. **Online**: Use [mermaid.live](https://mermaid.live) to edit/export
5. **Export**: Generate PNG/SVG from mermaid.live for presentations
