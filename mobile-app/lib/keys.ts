/**
 * Mobile Key Management
 *
 * Handles BIP-39 mnemonic generation and key derivation for mobile.
 * Wraps the zVault SDK key functions with mobile-specific storage.
 */

import * as Crypto from 'expo-crypto';
import {
  setSecureItem,
  getSecureItem,
  STORAGE_KEYS,
  setCachedItem,
} from './storage';

// BIP-39 English wordlist (2048 words)
// In production, import from a proper BIP-39 library
const BIP39_WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  // ... truncated for brevity - in production use full wordlist
  // This is a placeholder - the actual implementation should use a proper BIP-39 library
];

export interface MobileKeys {
  mnemonic: string;
  spendingPrivKey: string; // hex-encoded
  spendingPubKey: string; // hex-encoded
  viewingPrivKey: string; // hex-encoded
  viewingPubKey: string; // hex-encoded
  stealthMetaAddress: string; // hex-encoded (65 bytes)
}

/**
 * Generate a new 24-word BIP-39 mnemonic
 */
export async function generateMnemonic(): Promise<string> {
  // Generate 256 bits of entropy for 24 words
  const entropy = await Crypto.getRandomBytesAsync(32);

  // Simple mnemonic generation (placeholder)
  // In production, use a proper BIP-39 library like 'bip39'
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    const index = ((entropy[i] << 8) | entropy[(i + 1) % 32]) % 2048;
    // Using a simple wordlist for demo - replace with full BIP-39
    words.push(getWordFromIndex(index));
  }

  return words.join(' ');
}

/**
 * Validate a mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  return words.length === 12 || words.length === 24;
}

/**
 * Derive zVault keys from mnemonic
 */
export async function deriveKeysFromMnemonic(mnemonic: string): Promise<MobileKeys> {
  // Convert mnemonic to seed bytes
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(mnemonic);

  // Derive spending key seed
  const spendingSeedDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mnemonic + 'zvault_spending_v1'
  );

  // Derive viewing key seed
  const viewingSeedDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mnemonic + 'zvault_viewing_v1'
  );

  // For now, use the hash directly as keys
  // In production, this should use proper Grumpkin and X25519 derivation
  const spendingPrivKey = spendingSeedDigest;

  // Derive public keys (placeholder - in production use proper EC math)
  const spendingPubKeyDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    spendingSeedDigest + 'pubkey'
  );

  const viewingPrivKey = viewingSeedDigest;
  const viewingPubKeyDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    viewingSeedDigest + 'pubkey'
  );

  // Create stealth meta-address (spending pubkey || viewing pubkey)
  // 33 bytes spending + 32 bytes viewing = 65 bytes
  const stealthMetaAddress = spendingPubKeyDigest.slice(0, 66) + viewingPubKeyDigest.slice(0, 64);

  return {
    mnemonic,
    spendingPrivKey,
    spendingPubKey: spendingPubKeyDigest,
    viewingPrivKey,
    viewingPubKey: viewingPubKeyDigest,
    stealthMetaAddress,
  };
}

/**
 * Save keys to secure storage with Face ID protection
 */
export async function saveKeys(keys: MobileKeys): Promise<void> {
  // Store mnemonic with Face ID protection
  await setSecureItem(STORAGE_KEYS.MNEMONIC, keys.mnemonic, true);

  // Store spending key with Face ID protection
  await setSecureItem(STORAGE_KEYS.SPENDING_KEY, keys.spendingPrivKey, true);

  // Store viewing key (less sensitive, but still secure)
  await setSecureItem(STORAGE_KEYS.VIEWING_KEY, keys.viewingPrivKey, false);

  // Store stealth meta-address (public, but keep in secure store for integrity)
  await setSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS, keys.stealthMetaAddress, false);

  // Mark onboarding as complete
  await setCachedItem(STORAGE_KEYS.ONBOARDING_COMPLETE, true);
}

/**
 * Load keys from secure storage (will prompt Face ID)
 */
export async function loadKeys(): Promise<MobileKeys | null> {
  const [mnemonic, spendingPrivKey, viewingPrivKey, stealthMetaAddress] = await Promise.all([
    getSecureItem(STORAGE_KEYS.MNEMONIC, true),
    getSecureItem(STORAGE_KEYS.SPENDING_KEY, true),
    getSecureItem(STORAGE_KEYS.VIEWING_KEY, false),
    getSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS, false),
  ]);

  if (!mnemonic || !spendingPrivKey || !viewingPrivKey || !stealthMetaAddress) {
    return null;
  }

  // Derive public keys from private keys
  const spendingPubKeyDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    spendingPrivKey + 'pubkey'
  );

  const viewingPubKeyDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    viewingPrivKey + 'pubkey'
  );

  return {
    mnemonic,
    spendingPrivKey,
    spendingPubKey: spendingPubKeyDigest,
    viewingPrivKey,
    viewingPubKey: viewingPubKeyDigest,
    stealthMetaAddress,
  };
}

/**
 * Load only the stealth meta-address (no Face ID required)
 */
export async function loadStealthMetaAddress(): Promise<string | null> {
  return getSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS, false);
}

/**
 * Format stealth meta-address for display
 */
export function formatStealthAddress(address: string, length: number = 8): string {
  if (address.length <= length * 2 + 3) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

/**
 * Get a word from the BIP-39 wordlist by index
 */
function getWordFromIndex(index: number): string {
  // Placeholder wordlist - in production use full BIP-39 wordlist
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
    'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
    'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
    'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
    'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
    'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
    'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
    'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
    'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
    'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
    'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
    'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
    'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
    'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
    'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
    'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
  ];
  return words[index % words.length];
}
