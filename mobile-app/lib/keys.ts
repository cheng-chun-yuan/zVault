/**
 * Mobile Key Management
 *
 * Handles BIP-39 mnemonic generation and key derivation for mobile.
 * Uses the zVault SDK for proper Grumpkin + X25519 key derivation.
 */

import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import * as bip39 from 'bip39';
import {
  deriveKeysFromSeed,
  createStealthMetaAddress,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  scalarToBytes,
  type ZVaultKeys,
  type StealthMetaAddress,
} from '@zvault/sdk';
import {
  setSecureItem,
  getSecureItem,
  STORAGE_KEYS,
  setCachedItem,
} from './storage';

export interface MobileKeys {
  mnemonic: string;
  seed: Uint8Array;
  zvaultKeys: ZVaultKeys;
  stealthMetaAddress: StealthMetaAddress;
  stealthMetaAddressEncoded: string;
}

/**
 * Generate a new 24-word BIP-39 mnemonic
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(256); // 256 bits = 24 words
}

/**
 * Generate a 12-word mnemonic (easier to backup)
 */
export function generateMnemonic12(): string {
  return bip39.generateMnemonic(128); // 128 bits = 12 words
}

/**
 * Validate a mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

/**
 * Derive zVault keys from mnemonic
 */
export function deriveKeysFromMnemonic(mnemonic: string): MobileKeys {
  // Convert mnemonic to 32-byte seed (simple hash - mnemonic already has high entropy)
  const seed = sha256(new TextEncoder().encode(mnemonic.normalize('NFKD')));

  // Derive zVault keys from seed
  const zvaultKeys = deriveKeysFromSeed(seed);

  // Create stealth meta-address
  const stealthMetaAddress = createStealthMetaAddress(zvaultKeys);
  const stealthMetaAddressEncoded = encodeStealthMetaAddress(stealthMetaAddress);

  return {
    mnemonic,
    seed,
    zvaultKeys,
    stealthMetaAddress,
    stealthMetaAddressEncoded,
  };
}

/**
 * Save keys to secure storage with Face ID protection
 */
export async function saveKeys(keys: MobileKeys): Promise<void> {
  // Store mnemonic with Face ID protection
  await setSecureItem(STORAGE_KEYS.MNEMONIC, keys.mnemonic, true);

  // Store spending key with Face ID protection
  await setSecureItem(
    STORAGE_KEYS.SPENDING_KEY,
    Buffer.from(scalarToBytes(keys.zvaultKeys.spendingPrivKey)).toString('hex'),
    true
  );

  // Store viewing key (can be delegated, so less restrictive)
  await setSecureItem(
    STORAGE_KEYS.VIEWING_KEY,
    Buffer.from(keys.zvaultKeys.viewingPrivKey).toString('hex'),
    false
  );

  // Store stealth meta-address (public, for receiving)
  await setSecureItem(
    STORAGE_KEYS.STEALTH_META_ADDRESS,
    keys.stealthMetaAddressEncoded,
    false
  );

  // Mark onboarding as complete
  await setCachedItem(STORAGE_KEYS.ONBOARDING_COMPLETE, true);
}

/**
 * Load keys from secure storage (will prompt Face ID)
 */
export async function loadKeys(): Promise<MobileKeys | null> {
  const mnemonic = await getSecureItem(STORAGE_KEYS.MNEMONIC, true);
  if (!mnemonic) return null;

  return deriveKeysFromMnemonic(mnemonic);
}

/**
 * Load only the stealth meta-address (no Face ID required)
 */
export async function loadStealthMetaAddress(): Promise<StealthMetaAddress | null> {
  const encoded = await getSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS, false);
  if (!encoded) return null;

  return decodeStealthMetaAddress(encoded);
}

/**
 * Load stealth meta-address as encoded string
 */
export async function loadStealthMetaAddressEncoded(): Promise<string | null> {
  return getSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS, false);
}

/**
 * Format stealth meta-address for display
 */
export function formatStealthAddress(address: string, length: number = 8): string {
  if (address.length <= length * 2 + 3) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}
