# zVault Mobile App Documentation

React Native mobile application for zVault built with Expo. Provides secure wallet management, native ZK proof generation, and stealth address operations.

---

## Table of Contents

1. [Overview](#overview)
2. [Platform Support](#platform-support)
3. [Tech Stack](#tech-stack)
4. [Features](#features)
5. [App Structure](#app-structure)
6. [Security Model](#security-model)
7. [ZK Proof Generation](#zk-proof-generation)
8. [Development](#development)
9. [Building & Distribution](#building--distribution)

---

## Overview

The zVault mobile app is a self-custody wallet for private Bitcoin deposits on Solana. Users can:

- Generate and store wallets with biometric protection
- Create BTC deposit addresses
- Scan QR codes to receive claim links
- Generate ZK proofs natively on-device
- Send via stealth addresses

---

## Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| iOS | Full | iPhone 8+ recommended |
| Android | Full | Android 8.0+ |
| Web | Limited | Reduced features |

### Native Features

| Feature | iOS | Android |
|---------|-----|---------|
| Biometric auth | Face ID, Touch ID | Fingerprint, Face |
| Secure storage | iOS Keychain | Android Keystore |
| Native ZK proofs | Yes | Yes |
| QR scanning | Yes | Yes |
| Deep links | Yes | Yes |

---

## Tech Stack

### Core Dependencies

```json
{
  "expo": "~54.0.32",
  "react": "19.1.0",
  "react-native": "0.81.5",
  "expo-router": "~6.0.22"
}
```

### Key Libraries

| Library | Purpose |
|---------|---------|
| `@zvault/sdk` | Core SDK (local link) |
| `expo-secure-store` | Keychain/Keystore access |
| `expo-local-authentication` | Biometric auth |
| `expo-camera` | QR code scanning |
| `noir-react-native` | Native Noir proof generation |
| `react-native-qrcode-svg` | QR code display |
| `zustand` | State management |
| `bip39` | Mnemonic generation |

---

## Features

### Wallet Management

- **BIP-39 Mnemonic**: 12/24 word seed phrase generation
- **Secure Storage**: Seeds encrypted in iOS Keychain / Android Keystore
- **Biometric Lock**: Face ID, Touch ID, or Fingerprint required
- **Multi-account**: Derive multiple accounts from single seed

### Deposit Flow

1. Generate deposit credentials (nullifier, secret, commitment)
2. Display QR code with Taproot address
3. Monitor for BTC deposit
4. Store note locally for later claiming

### Claim Flow

1. Scan claim link QR code (or paste link)
2. Parse note from claim link
3. Fetch Merkle proof from chain
4. Generate ZK proof natively
5. Submit claim transaction

### Send Flow

1. Choose send method:
   - **Claim Link**: Generate shareable QR code
   - **Stealth Send**: Enter recipient's .zkey name or stealth address
2. For stealth: ECDH key exchange, submit announcement
3. Display confirmation

### Receive Flow

1. Display stealth meta-address QR code
2. Or share .zkey name
3. Scan incoming announcements
4. Claim received notes

---

## App Structure

```
mobile-app/
├── app/                          # Expo Router pages
│   ├── _layout.tsx              # Root layout (auth guard)
│   ├── (tabs)/                  # Main tab navigation
│   │   ├── _layout.tsx         # Tab bar config
│   │   ├── index.tsx           # Home/Overview
│   │   ├── wallet.tsx          # Wallet balance & notes
│   │   ├── deposits.tsx        # Deposit history
│   │   ├── send.tsx            # Send flow
│   │   └── settings.tsx        # App settings
│   ├── onboarding/             # First-time setup
│   │   ├── welcome.tsx         # Welcome screen
│   │   ├── create-wallet.tsx   # New wallet
│   │   ├── import-wallet.tsx   # Import seed
│   │   ├── backup.tsx          # Seed backup
│   │   └── biometric.tsx       # Enable biometrics
│   ├── deposit/                # Deposit flow
│   │   ├── new.tsx             # Create deposit
│   │   └── status.tsx          # Deposit status
│   ├── claim/                  # Claim flow
│   │   ├── scan.tsx            # Scan QR
│   │   └── confirm.tsx         # Confirm claim
│   ├── send/                   # Send flow
│   │   ├── method.tsx          # Choose method
│   │   ├── link.tsx            # Generate link
│   │   └── stealth.tsx         # Stealth send
│   └── receive/                # Receive flow
│       └── address.tsx         # Show address
├── components/                  # Shared components
│   ├── QRCode.tsx              # QR display
│   ├── QRScanner.tsx           # QR scanner
│   ├── BiometricGate.tsx       # Auth wrapper
│   └── NoteCard.tsx            # Note display
├── hooks/                       # Custom hooks
│   ├── useWallet.ts            # Wallet state
│   ├── useNotes.ts             # Note management
│   └── useProver.ts            # ZK proofs
├── stores/                      # Zustand stores
│   ├── wallet.ts               # Wallet store
│   └── notes.ts                # Notes store
└── utils/                       # Utilities
    ├── secure-store.ts         # Keychain helpers
    └── prover.ts               # Noir prover wrapper
```

### Tab Navigation

| Tab | Screen | Purpose |
|-----|--------|---------|
| Home | `index.tsx` | Overview, quick actions |
| Wallet | `wallet.tsx` | Balance, note list |
| Deposits | `deposits.tsx` | Pending deposits |
| Send | `send.tsx` | Send flow entry |
| Settings | `settings.tsx` | App configuration |

---

## Security Model

### Key Storage

```
┌─────────────────────────────────────────────────┐
│                    App Layer                     │
├─────────────────────────────────────────────────┤
│            expo-secure-store                     │
├─────────────────────────────────────────────────┤
│    iOS Keychain    │    Android Keystore         │
├─────────────────────────────────────────────────┤
│  Secure Enclave    │    TrustZone / StrongBox   │
└─────────────────────────────────────────────────┘
```

### Storage Keys

| Key | Content | Protection |
|-----|---------|------------|
| `zvault_seed` | Encrypted mnemonic | Biometric required |
| `zvault_viewing_key` | Viewing key only | Device unlock |
| `zvault_notes` | Encrypted note data | Biometric required |
| `zvault_settings` | App preferences | None |

### Biometric Configuration

```typescript
// Using expo-local-authentication
const options = {
  promptMessage: 'Authenticate to access zVault',
  fallbackLabel: 'Use passcode',
  cancelLabel: 'Cancel',
  disableDeviceFallback: false,  // Allow passcode fallback
  requireConfirmation: true,      // Explicit confirmation
};
```

### Security Features

| Feature | Implementation |
|---------|----------------|
| Screen capture prevention | `expo-screen-capture` |
| Clipboard clearing | Auto-clear after 60s |
| Seed phrase backup | Require biometric to view |
| Note encryption | AES-256-GCM |
| Session timeout | Auto-lock after 5 min |

---

## ZK Proof Generation

### Native Noir Prover

Uses `noir-react-native` for on-device proof generation.

```typescript
import { generateProof, verifyProof } from 'noir-react-native';

// Load circuit
const circuit = require('../assets/circuits/claim.json');

// Generate proof
const { proof, publicInputs } = await generateProof(circuit, {
  nullifier: note.nullifier,
  secret: note.secret,
  amount: note.amount,
  merkle_path: merkleProof.pathElements,
  path_indices: merkleProof.pathIndices,
  merkle_root: merkleRoot,
  nullifier_hash: nullifierHash,
  amount_pub: note.amount,
});

// Verify locally (optional)
const isValid = await verifyProof(circuit, proof, publicInputs);
```

### Performance

| Circuit | iPhone 14 | Pixel 7 |
|---------|-----------|---------|
| Claim | ~3s | ~4s |
| Split | ~4s | ~5s |
| Transfer | ~3s | ~4s |

### Memory Requirements

- Claim circuit: ~200MB peak
- Background proof generation not recommended
- UI shows progress indicator during proof generation

---

## Development

### Prerequisites

- Node.js 18+
- Bun package manager
- Xcode (iOS)
- Android Studio (Android)
- Expo CLI

### Setup

```bash
cd mobile-app

# Install dependencies
bun install

# Install iOS pods
cd ios && pod install && cd ..

# Start Expo dev server
bun run start
```

### Running on Device

```bash
# iOS simulator
bun run ios

# Android emulator
bun run android

# Physical device (scan QR with Expo Go)
bun run start
```

### Environment

Create `.env.local`:

```env
EXPO_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
EXPO_PUBLIC_API_URL=http://localhost:8080
EXPO_PUBLIC_BITCOIN_NETWORK=testnet
```

### Development Builds

For native features (biometrics, secure store):

```bash
# Create development build
bun run prebuild

# Build locally
bun run build:ios
bun run build:android
```

---

## Building & Distribution

### EAS Build

```bash
# Install EAS CLI
bun add -g eas-cli

# Login to Expo
eas login

# Configure project
eas build:configure
```

### Build Commands

```bash
# Development builds
eas build --platform ios --profile development
eas build --platform android --profile development

# Production builds
eas build --platform ios --profile production
eas build --platform android --profile production
```

### App Store / Play Store

1. Configure `app.json`:

```json
{
  "expo": {
    "name": "zVault",
    "slug": "zvault",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.zvault.app",
      "buildNumber": "1"
    },
    "android": {
      "package": "com.zvault.app",
      "versionCode": 1
    }
  }
}
```

2. Build for submission:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

3. Submit:

```bash
eas submit --platform ios
eas submit --platform android
```

### TestFlight / Internal Testing

```bash
# iOS TestFlight
eas build --platform ios --profile preview
eas submit --platform ios --latest

# Android Internal Testing
eas build --platform android --profile preview
# Upload .aab to Play Console
```

---

## Testing

### Unit Tests

```bash
bun test
```

### E2E Tests (Detox)

```bash
# Build test app
detox build --configuration ios.sim.debug

# Run tests
detox test --configuration ios.sim.debug
```

### Manual Test Cases

1. **Wallet Creation**
   - [ ] Create new wallet
   - [ ] Backup seed phrase
   - [ ] Enable biometrics
   - [ ] Verify seed recovery

2. **Deposit Flow**
   - [ ] Generate deposit address
   - [ ] Display QR code
   - [ ] Copy address to clipboard
   - [ ] Monitor for confirmation

3. **Claim Flow**
   - [ ] Scan claim link QR
   - [ ] Generate ZK proof
   - [ ] Submit claim transaction
   - [ ] Verify note added to wallet

4. **Stealth Send**
   - [ ] Lookup .zkey name
   - [ ] Enter recipient address
   - [ ] Submit stealth announcement
   - [ ] Verify confirmation

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Biometrics not working | Ensure device has biometrics configured |
| Proof generation slow | Close other apps, ensure sufficient memory |
| QR scanner not loading | Check camera permissions |
| Deep links not working | Verify app URL scheme configuration |

### Debug Mode

Enable debug logging:

```typescript
// In app/_layout.tsx
if (__DEV__) {
  console.log('Debug mode enabled');
  // Additional debug config
}
```

### Crash Reporting

Uses Sentry for production crash reporting:

```bash
# Configure Sentry
bun add @sentry/react-native
```

---

## Related Documentation

- [SDK.md](./SDK.md) - TypeScript SDK reference
- [ZK_PROOFS.md](./ZK_PROOFS.md) - Circuit documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
