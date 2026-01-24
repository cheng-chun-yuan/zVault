/**
 * Secure Storage Layer with Face ID Protection
 *
 * Uses expo-secure-store for sensitive data (keys) with biometric authentication
 * Uses AsyncStorage for less sensitive cached data
 */

import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
export const STORAGE_KEYS = {
  // Secure (Face ID protected)
  MNEMONIC: 'zvault_mnemonic',
  SPENDING_KEY: 'zvault_spending_key',
  VIEWING_KEY: 'zvault_viewing_key',
  STEALTH_META_ADDRESS: 'zvault_stealth_meta_address',

  // AsyncStorage (cached data)
  PENDING_DEPOSITS: 'zvault_pending_deposits',
  SCANNED_NOTES: 'zvault_scanned_notes',
  SETTINGS: 'zvault_settings',
  ONBOARDING_COMPLETE: 'zvault_onboarding_complete',
} as const;

// Secure store options with Face ID
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
};

// Secure store options without Face ID (for viewing key export, etc)
const SECURE_OPTIONS_NO_AUTH: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

/**
 * Check if device supports biometric authentication
 */
export async function checkBiometricSupport(): Promise<{
  supported: boolean;
  enrolled: boolean;
  types: LocalAuthentication.AuthenticationType[];
}> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  return {
    supported: hasHardware,
    enrolled: isEnrolled,
    types,
  };
}

/**
 * Authenticate user with Face ID / Touch ID
 */
export async function authenticateBiometric(
  reason: string = 'Authenticate to access your wallet'
): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use Passcode',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });

  return result.success;
}

/**
 * Store sensitive data with Face ID protection
 */
export async function setSecureItem(
  key: string,
  value: string,
  requireAuth: boolean = true
): Promise<void> {
  await SecureStore.setItemAsync(
    key,
    value,
    requireAuth ? SECURE_OPTIONS : SECURE_OPTIONS_NO_AUTH
  );
}

/**
 * Retrieve sensitive data (will prompt Face ID if required)
 */
export async function getSecureItem(
  key: string,
  requireAuth: boolean = true
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(
      key,
      requireAuth ? SECURE_OPTIONS : SECURE_OPTIONS_NO_AUTH
    );
  } catch (error) {
    console.error('Error retrieving secure item:', error);
    return null;
  }
}

/**
 * Delete sensitive data
 */
export async function deleteSecureItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/**
 * Store non-sensitive cached data
 */
export async function setCachedItem<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * Retrieve cached data
 */
export async function getCachedItem<T>(key: string): Promise<T | null> {
  const value = await AsyncStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Delete cached data
 */
export async function deleteCachedItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/**
 * Check if wallet has been set up
 */
export async function isWalletInitialized(): Promise<boolean> {
  const onboardingComplete = await getCachedItem<boolean>(STORAGE_KEYS.ONBOARDING_COMPLETE);
  return onboardingComplete === true;
}

/**
 * Clear all wallet data (for reset)
 */
export async function clearAllData(): Promise<void> {
  // Clear secure items
  await Promise.all([
    deleteSecureItem(STORAGE_KEYS.MNEMONIC),
    deleteSecureItem(STORAGE_KEYS.SPENDING_KEY),
    deleteSecureItem(STORAGE_KEYS.VIEWING_KEY),
    deleteSecureItem(STORAGE_KEYS.STEALTH_META_ADDRESS),
  ]);

  // Clear cached items
  await Promise.all([
    deleteCachedItem(STORAGE_KEYS.PENDING_DEPOSITS),
    deleteCachedItem(STORAGE_KEYS.SCANNED_NOTES),
    deleteCachedItem(STORAGE_KEYS.SETTINGS),
    deleteCachedItem(STORAGE_KEYS.ONBOARDING_COMPLETE),
  ]);
}
