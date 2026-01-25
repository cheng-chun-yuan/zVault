# zVault Documentation

Welcome to the zVault documentation. This folder contains comprehensive documentation for the privacy-preserving Bitcoin-to-Solana bridge.

---

## Quick Navigation

| Document | Description | Audience |
|----------|-------------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and design | Architects, Developers |
| [PRD.md](./PRD.md) | Product requirements and vision | Product, Business |
| [CONTRACTS.md](./CONTRACTS.md) | Solana program documentation | Smart Contract Developers |
| [SDK.md](./SDK.md) | TypeScript SDK reference | Frontend Developers |
| [API.md](./API.md) | Backend REST API reference | Backend Developers |
| [MOBILE.md](./MOBILE.md) | Mobile app documentation | Mobile Developers |
| [ZK_PROOFS.md](./ZK_PROOFS.md) | Zero-knowledge circuit guide | Cryptographers, ZK Developers |

---

## Getting Started

### For Users

1. **Web App**: Visit the frontend at `http://localhost:3000` (development)
2. **Mobile App**: Download from App Store / Play Store (coming soon)
3. **CLI**: Use the SDK directly via Node.js

### For Developers

1. **Start with**: [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview
2. **Frontend/SDK**: [SDK.md](./SDK.md) for TypeScript integration
3. **Smart Contracts**: [CONTRACTS.md](./CONTRACTS.md) for on-chain operations
4. **ZK Circuits**: [ZK_PROOFS.md](./ZK_PROOFS.md) for proof generation

### For Product/Business

1. **Vision**: [PRD.md](./PRD.md) for product requirements
2. **Features**: Core features section in PRD
3. **Roadmap**: Future plans in PRD

---

## Document Summaries

### [ARCHITECTURE.md](./ARCHITECTURE.md)

System-level architecture documentation covering:

- Core architecture diagrams
- Component relationships
- Privacy model explanation
- Cryptography stack (Poseidon2, Grumpkin, Groth16)
- Data flow for deposits, claims, and withdrawals
- Security model and trust assumptions

### [PRD.md](./PRD.md)

Product Requirements Document covering:

- Vision and mission
- Target user personas
- Core feature specifications
- User stories and acceptance criteria
- Non-functional requirements
- Success metrics and KPIs
- Product roadmap

### [CONTRACTS.md](./CONTRACTS.md)

Solana program documentation covering:

- Program IDs (devnet)
- All 12 instruction handlers with discriminators
- Account structures (PoolState, CommitmentTree, etc.)
- PDA derivation patterns
- Error codes and handling
- Compute unit costs
- TypeScript usage examples

### [SDK.md](./SDK.md)

TypeScript SDK reference covering:

- Installation and quick start
- 6 main functions (deposit, claim, split, withdraw, sendLink, sendStealth)
- Client API reference
- Note operations and serialization
- Cryptographic utilities (Poseidon2, Grumpkin, Taproot)
- Stealth address operations
- Name registry (.zkey)
- Deposit watcher system
- React hooks
- Complete type reference

### [API.md](./API.md)

Backend REST API documentation covering:

- Health check endpoint
- Redemption API (POST /api/redeem, GET /api/withdrawal/:id)
- Stealth API (prepare, status, announce)
- WebSocket API for real-time updates
- Status lifecycle diagrams
- Error handling and codes
- Configuration and environment variables

### [MOBILE.md](./MOBILE.md)

Mobile app documentation covering:

- Platform support (iOS, Android)
- Tech stack (Expo, React Native)
- App structure and navigation
- Security model (Keychain, biometrics)
- Native ZK proof generation
- Development setup
- Building and distribution

### [ZK_PROOFS.md](./ZK_PROOFS.md)

Zero-knowledge circuit documentation covering:

- Circuit overview and purposes
- Cryptographic primitives (Poseidon2, Grumpkin)
- Claim circuit (prove commitment ownership)
- Split circuit (1-in-2-out with amount conservation)
- Transfer circuit (1-in-1-out refresh)
- Partial withdraw circuit
- Proof of Innocence circuit (compliance)
- Proof generation (browser, mobile, CLI)
- On-chain verification (alt_bn128 syscalls)
- Merkle tree configuration

---

## Additional Resources

### Existing Documentation

| File | Description |
|------|-------------|
| [USER_FLOW.md](./USER_FLOW.md) | Complete user journey walkthrough |
| [PINOCCHIO_MIGRATION_PLAN.md](./PINOCCHIO_MIGRATION_PLAN.md) | Migration from Anchor to Pinocchio |

### External Links

- **Solana Devnet Explorer**: [explorer.solana.com](https://explorer.solana.com/?cluster=devnet)
- **Bitcoin Testnet Explorer**: [blockstream.info/testnet](https://blockstream.info/testnet)
- **Noir Language**: [noir-lang.org](https://noir-lang.org)
- **Pinocchio Framework**: [github.com/anza-xyz/pinocchio](https://github.com/anza-xyz/pinocchio)

---

## Contributing to Documentation

### Style Guide

- Use Markdown tables for structured data
- Include code examples where applicable
- Link between documents for related topics
- Keep language concise and technical
- Update the last modified date when editing

### File Naming

- Use SCREAMING_SNAKE_CASE for top-level docs
- Use lowercase with hyphens for subsections
- Keep file names descriptive

### Review Process

1. Make changes in a feature branch
2. Ensure all links work
3. Verify code examples compile/run
4. Submit PR for review

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-25 | Initial documentation structure |

---

## Questions?

- **Technical Issues**: Open a GitHub issue
- **General Questions**: Contact the team
- **Security Issues**: Report privately
