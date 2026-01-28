# zVault - Privacy-Preserving Bitcoin Bridge to Solana

## 4-Minute Pitch Script (Tech + Demo Combined)

---

### Opening (0:00 - 0:30) - The Problem

> "Bitcoin is digital gold, but unlike cash, every transaction is public. When you send BTC, everyone sees your balance, your history, and can trace your money.
>
> - Businesses don't want competitors seeing their treasury
> - Individuals don't want hackers knowing their wealth
> - Privacy is a right, not a crime
>
> **What if you could use Bitcoin with the privacy of cash?**"

---

### Solution + Live Demo (0:30 - 3:30)

> "Let me show you **zVault** - and explain the tech as we go."

**[Open zvault.xyz]**

---

#### Part 1: Connect & Generate Keys (0:30 - 1:00)

**[Demo: Connect wallet, click "Generate Privacy Keys"]**

> "First, I connect my wallet and generate privacy keys.
>
> **Tech: Stealth Address System (EIP-5564)**
> - zVault creates two Grumpkin curve keypairs from your signature
> - **Spending key** - to spend your funds
> - **Viewing key** - to detect incoming payments
>
> This separation means: a watch-only wallet can see your balance but can't steal your funds."

**[Show keys generated]**

---

#### Part 2: Send Private Payment (1:00 - 2:00)

**[Demo: Go to Pay tab, select a note]**

> "Now I'll send a private payment. I select a note - this is like a private UTXO.
>
> **Tech: Notes & Commitments**
> - Each note is a `commitment = Poseidon(stealth_pubkey, amount)`
> - Stored in a Merkle tree on-chain
> - Nobody knows the amount or owner - just a hash"

**[Enter recipient address, toggle Private mode]**

> "I enter the recipient's stealth address and enable Private mode.
>
> **Tech: Encrypted Amounts**
> - The amount is XOR-encrypted with a shared secret
> - `encrypted = amount XOR SHA256(ECDH_secret)`
> - Only the recipient can decrypt it"

**[Click Send, show transaction]**

> "Transaction sent! Notice:
> - On-chain: just encrypted bytes, no readable amount
> - Recipient address: a one-time stealth address, unlinkable to their identity
>
> **Tech: Zero-Knowledge Proof**
> - I just proved I own a valid note WITHOUT revealing which one
> - Proved amounts balance WITHOUT showing the amounts
> - ~3 seconds to generate, verified on Solana in 95k compute units"

---

#### Part 3: Receive & Claim (2:00 - 2:45)

**[Switch to recipient wallet/browser]**

> "Now I'm the recipient. Let me scan for payments..."

**[Show inbox scanning, payment appears]**

> "Found it! Only I can see this because I have the viewing key.
>
> **Tech: Stealth Detection**
> - My wallet scans all announcements
> - Tries `ECDH(my_viewing_key, ephemeral_pubkey)`
> - If the derived address matches, it's mine!"

**[Click Claim]**

> "I claim by generating another ZK proof - proving I can derive the spending key for this note."

**[Show success]**

> "Done. The note is now mine to spend or withdraw as BTC."

---

#### Part 4: On-Chain Proof (2:45 - 3:00)

**[Open Solana Explorer, show transaction]**

> "Let's look at the blockchain. You can see:
> - ✅ A transfer happened
> - ❌ Can't see the amount (encrypted)
> - ❌ Can't see who received it (stealth address)
> - ❌ Can't link to previous transactions
>
> **This is true cryptographic privacy, not mixing.**"

---

### Why zVault (3:00 - 3:30)

> "Quick recap - why zVault:
>
> ✅ **Real Privacy** - ZK proofs, not obfuscation
> ✅ **Self-Custody** - Your keys, your coins
> ✅ **1:1 BTC Backed** - Every zBTC backed by real Bitcoin
> ✅ **OFAC Compliant** - Built-in compliance screening
> ✅ **Solana Speed** - 400ms finality, $0.001 fees
>
> We're the first to bring **Zcash-level privacy to Bitcoin on Solana**."

---

### Closing (3:30 - 4:00)

> "zVault is live on devnet. Coming soon:
>
> - **Yield Pools** - Earn on private Bitcoin
> - **Name Registry** - Send to `alice.zkey` instead of long addresses
> - **Mobile App** - iOS & Android
>
> **Try it: zvault.xyz**
>
> Questions?"

---

## Demo Checklist

### Pre-Demo Setup
- [ ] Devnet wallet with SOL + zBTC notes
- [ ] Second wallet for receiving (or incognito window)
- [ ] Solana Explorer tab ready
- [ ] Privacy keys already generated (or show generation)

### Timing Guide
| Section | Time | What's Happening |
|---------|------|------------------|
| Problem | 0:00-0:30 | Slides only |
| Connect + Keys | 0:30-1:00 | Demo + explain stealth system |
| Send Payment | 1:00-2:00 | Demo + explain ZK proofs & encryption |
| Receive | 2:00-2:45 | Demo + explain detection |
| Explorer | 2:45-3:00 | Show on-chain privacy |
| Why zVault | 3:00-3:30 | Recap features |
| Close | 3:30-4:00 | Future + CTA |

### Key Tech Points to Hit
1. **Stealth addresses** - one-time addresses, unlinkable
2. **Encrypted amounts** - XOR with shared secret
3. **ZK proofs** - prove without revealing
4. **Merkle tree** - commitments stored as hashes

### If Demo Fails
- Have video backup ready
- Show Explorer transactions from earlier tests
- "Let me show you what this looks like on-chain..."

---

## One-Liner

> "zVault = Zcash for Bitcoin on Solana. Private transactions with ZK proofs, 1:1 BTC backed."
