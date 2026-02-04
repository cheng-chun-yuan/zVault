# zVault Senior-Level Architecture

This document defines the target architecture for the zVault codebase, organized by functionality for maintainability and minimal redundancy.

---

## 1. Contracts Architecture (`/contracts`)

### Structure

```
contracts/programs/zvault/src/
├── lib.rs                              # Entry point only (~30 LoC)
├── program_id.rs                       # Program ID constant
│
├── domains/                            # Vertical slices by functionality
│   ├── mod.rs
│   │
│   ├── pool/                           # Core pool lifecycle
│   │   ├── mod.rs
│   │   ├── state.rs                    # PoolState account
│   │   ├── instructions/
│   │   │   ├── initialize.rs
│   │   │   └── set_paused.rs
│   │   └── validation.rs
│   │
│   ├── deposit/                        # BTC deposits & stealth announcements
│   │   ├── mod.rs
│   │   ├── state/
│   │   │   ├── deposit_record.rs
│   │   │   └── stealth_announcement.rs
│   │   ├── instructions/
│   │   │   ├── verify_stealth_deposit.rs
│   │   │   └── add_demo_stealth.rs
│   │   └── spv/
│   │
│   ├── shielded/                       # ZK transfers: claim, split, partial
│   │   ├── mod.rs
│   │   ├── state/
│   │   │   ├── commitment_tree.rs
│   │   │   └── nullifier.rs
│   │   ├── instructions/
│   │   │   ├── claim.rs
│   │   │   ├── spend_split.rs
│   │   │   └── spend_partial_public.rs
│   │   └── proof/
│   │       ├── proof_source.rs         # Consolidated ProofSource enum
│   │       ├── public_inputs.rs
│   │       └── verification.rs
│   │
│   ├── redemption/                     # BTC withdrawals
│   │   ├── mod.rs
│   │   ├── state/redemption_request.rs
│   │   └── instructions/
│   │       ├── request_redemption.rs
│   │       └── complete_redemption.rs
│   │
│   ├── yield_pool/                     # zkEarn yield operations
│   │   ├── mod.rs
│   │   ├── state/
│   │   │   ├── pool_config.rs
│   │   │   ├── pool_commitment_tree.rs
│   │   │   ├── pool_nullifier.rs
│   │   │   └── stealth_pool_announcement.rs
│   │   ├── instructions/
│   │   │   ├── create_pool.rs
│   │   │   ├── deposit.rs
│   │   │   ├── withdraw.rs
│   │   │   ├── claim_yield.rs
│   │   │   ├── compound.rs
│   │   │   ├── update_rate.rs
│   │   │   └── harvest.rs
│   │   └── proof/
│   │
│   ├── name_registry/                  # .zkey names
│   │   ├── mod.rs
│   │   ├── state/
│   │   │   ├── name_registry.rs
│   │   │   └── reverse_registry.rs
│   │   └── instructions/
│   │       ├── register_name.rs
│   │       ├── update_name.rs
│   │       └── transfer_name.rs
│   │
│   └── vk_registry/                    # Verification keys
│       ├── mod.rs
│       ├── state/vk_registry.rs
│       └── instructions/
│
├── shared/                             # Cross-domain infrastructure
│   ├── mod.rs
│   ├── accounts/
│   │   ├── validation.rs
│   │   ├── pda.rs
│   │   └── serialization.rs
│   ├── crypto/
│   │   ├── poseidon.rs
│   │   ├── merkle.rs
│   │   └── sha256.rs
│   ├── cpi/
│   │   ├── token_2022.rs
│   │   ├── ultrahonk.rs
│   │   ├── chadbuffer.rs
│   │   └── btc_light_client.rs
│   ├── bitcoin/
│   │   ├── tx_hash.rs
│   │   ├── merkle_proof.rs
│   │   └── address.rs
│   ├── introspection/
│   │   └── prior_verification.rs
│   ├── error.rs
│   └── constants.rs
│
└── router/                             # Instruction dispatch
    ├── discriminators.rs
    └── dispatch.rs
```

### Design Principles
- **Vertical slices**: Each domain owns its state, instructions, and validation
- **Shared infrastructure**: Common code in explicit `shared/` module
- **Clear dependencies**: Lower layers don't depend on higher layers
- **Router pattern**: Dispatch logic separate from business logic

### Build Commands
```bash
cargo build-sbf                                    # Build all programs
solana program deploy target/deploy/zvault.so     # Deploy to devnet
```

---

## 2. SDK Architecture (`/sdk`)

### Structure

```
sdk/src/
├── index.ts                            # Main entry point
├── sdk.ts                              # ZVaultSDK class (primary API)
├── version.ts
│
├── types/                              # All TypeScript types
│   ├── index.ts
│   ├── config.ts
│   ├── note.ts
│   ├── stealth.ts
│   ├── pool.ts
│   ├── bitcoin.ts
│   ├── solana.ts
│   ├── prover.ts
│   └── merkle.ts
│
├── config/                             # SDK configuration
│   ├── index.ts
│   ├── presets.ts
│   ├── resolver.ts
│   └── constants.ts
│
├── crypto/                             # Cryptographic primitives
│   ├── index.ts
│   ├── field.ts
│   ├── bytes.ts
│   ├── hash.ts
│   ├── grumpkin.ts
│   ├── ecdh.ts
│   ├── poseidon.ts
│   └── random.ts
│
├── keys/                               # Key management
│   ├── index.ts
│   ├── derivation.ts
│   ├── stealth-meta.ts
│   ├── delegated.ts
│   └── security.ts
│
├── note/                               # Note operations
│   ├── index.ts
│   ├── generate.ts
│   ├── serialize.ts
│   ├── derive.ts
│   ├── commitment.ts
│   └── stealth-note.ts
│
├── merkle/                             # Merkle tree operations
│   ├── index.ts
│   ├── proof.ts
│   ├── format.ts
│   └── constants.ts
│
├── stealth/                            # Stealth addresses
│   ├── index.ts
│   ├── deposit.ts
│   ├── output.ts
│   ├── scan.ts
│   ├── claim.ts
│   ├── encryption.ts
│   ├── parse.ts
│   ├── pda.ts
│   └── btc-deposit.ts
│
├── pool/                               # Yield pool (zkEarn)
│   ├── index.ts
│   ├── deposit.ts
│   ├── withdraw.ts
│   ├── claim-yield.ts
│   ├── position.ts
│   ├── scan.ts
│   ├── yield.ts
│   ├── parse.ts
│   ├── pda.ts
│   └── constants.ts
│
├── prover/                             # ZK proof generation
│   ├── index.ts
│   ├── web.ts
│   ├── mobile.ts
│   ├── init.ts
│   ├── circuits.ts
│   └── inputs/
│       ├── claim.ts
│       ├── split.ts
│       ├── partial-public.ts
│       ├── pool-deposit.ts
│       ├── pool-withdraw.ts
│       └── pool-claim-yield.ts
│
├── instructions/                       # Solana instructions
│   ├── index.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── data/
│   │   ├── claim.ts
│   │   ├── split.ts
│   │   ├── spend-partial-public.ts
│   │   ├── pool-deposit.ts
│   │   ├── pool-withdraw.ts
│   │   ├── pool-claim-yield.ts
│   │   ├── redemption.ts
│   │   └── verifier.ts
│   └── builders.ts
│
├── pda/                                # PDA derivation
│   ├── index.ts
│   ├── zvault.ts
│   ├── light-client.ts
│   ├── pool.ts
│   ├── registry.ts
│   └── seeds.ts
│
├── bitcoin/                            # Bitcoin integration
│   ├── index.ts
│   ├── taproot.ts
│   ├── claim-link.ts
│   ├── esplora.ts
│   ├── mempool.ts
│   └── spv.ts
│
├── solana/                             # Solana utilities
│   ├── index.ts
│   ├── connection.ts
│   ├── priority-fee.ts
│   ├── chadbuffer.ts
│   └── transaction.ts
│
├── registry/                           # Name registry
│   ├── index.ts
│   ├── lookup.ts
│   ├── reverse.ts
│   ├── validation.ts
│   └── instructions.ts
│
├── watcher/                            # Deposit watching
│   ├── index.ts
│   ├── base.ts
│   ├── web.ts
│   ├── native.ts
│   ├── types.ts
│   └── storage.ts
│
├── react/                              # React hooks
│   ├── index.ts
│   ├── useDepositWatcher.ts
│   └── useZVault.ts
│
├── commitment-tree/                    # On-chain tree operations
│   ├── index.ts
│   ├── parse.ts
│   ├── fetch.ts
│   ├── proof.ts
│   └── indexer.ts
│
└── utils/                              # Shared utilities
    ├── index.ts
    ├── format.ts
    ├── validation.ts
    └── base58.ts
```

### Design Principles
- **Domain modules**: Each functional area is a directory
- **Types centralized**: All interfaces in `types/`
- **Subpath exports**: Tree-shakeable imports (`@zvault/sdk/stealth`)
- **No monolithic files**: Maximum ~300 LoC per file

---

## 3. Backend Services Architecture

### Structure

```
zVault/
├── crates/                             # Shared Rust libraries
│   ├── Cargo.toml                      # Workspace manifest
│   │
│   ├── zvault-core/                    # Shared types & crypto
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── crypto/
│   │       │   ├── commitment.rs
│   │       │   ├── stealth.rs
│   │       │   └── taproot.rs
│   │       ├── types/
│   │       │   ├── deposit.rs
│   │       │   ├── redemption.rs
│   │       │   ├── stealth.rs
│   │       │   ├── frost.rs
│   │       │   └── units.rs
│   │       ├── config/
│   │       │   ├── network.rs
│   │       │   └── env.rs
│   │       └── error.rs
│   │
│   ├── zvault-bitcoin/                 # Bitcoin infrastructure
│   │   └── src/
│   │       ├── esplora/
│   │       ├── spv/
│   │       ├── taproot/
│   │       └── signing/
│   │
│   ├── zvault-solana/                  # Solana infrastructure
│   │   └── src/
│   │       ├── client.rs
│   │       ├── transactions.rs
│   │       └── accounts.rs
│   │
│   ├── zvault-storage/                 # Persistence
│   │   └── src/
│   │       ├── traits.rs
│   │       ├── sqlite.rs
│   │       └── memory.rs
│   │
│   └── zvault-frost/                   # FROST signing library
│       └── src/
│           ├── dkg.rs
│           ├── signing.rs
│           └── keystore.rs
│
├── services/                           # Runnable binaries
│   │
│   ├── api-gateway/                    # Unified REST + WebSocket
│   │   └── src/
│   │       ├── main.rs
│   │       ├── routes/
│   │       ├── middleware/
│   │       └── websocket/
│   │
│   ├── deposit-tracker/                # BTC deposit processor
│   │   └── src/
│   │       ├── main.rs
│   │       ├── watcher.rs
│   │       ├── sweeper.rs
│   │       ├── verifier.rs
│   │       └── service.rs
│   │
│   ├── redemption-processor/           # BTC withdrawal processor
│   │   └── src/
│   │       ├── main.rs
│   │       ├── watcher.rs
│   │       ├── queue.rs
│   │       ├── builder.rs
│   │       └── service.rs
│   │
│   ├── frost-signer/                   # FROST signer node
│   │   └── src/
│   │       ├── main.rs
│   │       ├── server.rs
│   │       └── bin/
│   │
│   └── header-relayer/                 # Bitcoin header relay
│       └── src/
│
└── circuits/                           # Noir circuits
    ├── Nargo.toml                      # Workspace manifest
    ├── lib/                            # Shared libraries
    ├── claim/
    ├── spend_split/
    ├── spend_partial_public/
    ├── pool_deposit/
    ├── pool_withdraw/
    ├── pool_claim_yield/
    ├── target/                         # Unified build artifacts
    └── scripts/
```

### Design Principles
- **Crates for libraries**: Shared code in reusable crates
- **Services for binaries**: Each service has single responsibility
- **Unified dependencies**: Single Cargo workspace
- **Type sharing**: Common types in `zvault-core`

---

## 4. Files to Remove

| File | Reason |
|------|--------|
| `sdk/src/stealth.ts` | Split into `sdk/src/stealth/` |
| `sdk/src/yield-pool.ts` | Split into `sdk/src/pool/` |
| `sdk/src/api.ts` | Deprecated, use `sdk.ts` |
| `backend/src/btc_client.rs` | Legacy, use `zvault-bitcoin` |
| `backend/src/sol_client.rs` | Legacy, use `zvault-solana` |
| `backend/src/taproot.rs` | Legacy, moved to crate |
| `contracts/.../state/btc_light_client.rs` | Duplicate |

---

## 5. Migration Strategy

1. Create new directory structures (no code changes)
2. Move files to new locations with re-exports
3. Update imports throughout codebase
4. Remove legacy re-exports
5. Run full test suite
