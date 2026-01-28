/**
 * SDK Initialization for React Native
 *
 * Sets up AsyncStorage for the deposit watcher and initializes Poseidon.
 * Must be called before using SDK functions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAsyncStorage, initPoseidon, isPoseidonReady } from '@zvault/sdk';

let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the zVault SDK for React Native
 *
 * Sets up:
 * - AsyncStorage for deposit watcher persistence
 * - Poseidon hash function for ZK proofs
 *
 * Safe to call multiple times - initialization only happens once.
 */
export async function initSDK(): Promise<void> {
  // Return existing promise if initialization is in progress
  if (initPromise) {
    return initPromise;
  }

  // Skip if already initialized
  if (isInitialized) {
    return;
  }

  initPromise = (async () => {
    try {
      console.log('[SDK] Initializing zVault SDK...');

      // Set up AsyncStorage for deposit watcher
      setAsyncStorage(AsyncStorage);
      console.log('[SDK] AsyncStorage configured');

      // Initialize Poseidon if not already ready
      if (!isPoseidonReady()) {
        await initPoseidon();
        console.log('[SDK] Poseidon initialized');
      }

      isInitialized = true;
      console.log('[SDK] zVault SDK initialized successfully');
    } catch (error) {
      console.error('[SDK] Failed to initialize:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Check if SDK is initialized
 */
export function isSDKReady(): boolean {
  return isInitialized && isPoseidonReady();
}
