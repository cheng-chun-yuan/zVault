/**
 * Wallet Context
 *
 * Manages wallet state including:
 * - ZVault keys (viewing/spending)
 * - zkBTC notes
 * - Stealth address
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { usePhantom } from '@phantom/react-native-wallet-sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Storage keys
const STORAGE_KEYS = {
  NOTES: 'zvault_notes',
  KEYS_DERIVED: 'zvault_keys_derived',
};

// Simple note structure
export interface WalletNote {
  id: string;
  amount: number; // satoshis
  createdAt: number;
  status: 'available' | 'pending' | 'spent';
}

// Simplified keys (just track if derived)
interface WalletKeys {
  viewingKeyHash: string;
  stealthAddress: string;
  derived: boolean;
}

interface WalletContextValue {
  // Connection
  isConnected: boolean;
  address: string | null;

  // Keys
  keysDerived: boolean;
  stealthAddress: string | null;
  deriveKeys: () => Promise<void>;
  isDerivingKeys: boolean;

  // Balance
  notes: WalletNote[];
  totalBalance: number;
  availableBalance: number;

  // Actions
  refreshNotes: () => Promise<void>;
  addDemoNote: (amount: number) => Promise<void>;
  isLoading: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, addresses, phantom } = usePhantom();

  // State
  const [keysDerived, setKeysDerived] = useState(false);
  const [stealthAddress, setStealthAddress] = useState<string | null>(null);
  const [notes, setNotes] = useState<WalletNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDerivingKeys, setIsDerivingKeys] = useState(false);

  // Get Solana address from Phantom addresses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const solanaAddress = (() => {
    if (!addresses) return null;
    // Handle different Phantom SDK address formats
    const addrs = addresses as any;
    if (Array.isArray(addrs)) {
      const found = addrs.find((a: any) => a.chain === 'solana' || a.blockchain === 'solana');
      return found?.address ?? found?.publicKey ?? null;
    }
    return addrs.solana ?? null;
  })();

  // Calculate balances
  const totalBalance = notes.reduce((sum, n) => sum + n.amount, 0);
  const availableBalance = notes
    .filter((n) => n.status === 'available')
    .reduce((sum, n) => sum + n.amount, 0);

  // Load saved data on mount
  useEffect(() => {
    loadSavedData();
  }, [solanaAddress]);

  const loadSavedData = async () => {
    if (!solanaAddress) {
      setKeysDerived(false);
      setStealthAddress(null);
      setNotes([]);
      return;
    }

    try {
      // Check if keys were derived for this address
      const keysData = await AsyncStorage.getItem(`${STORAGE_KEYS.KEYS_DERIVED}_${solanaAddress}`);
      if (keysData) {
        const keys = JSON.parse(keysData) as WalletKeys;
        setKeysDerived(keys.derived);
        setStealthAddress(keys.stealthAddress);
      }

      // Load notes
      const notesData = await AsyncStorage.getItem(`${STORAGE_KEYS.NOTES}_${solanaAddress}`);
      if (notesData) {
        setNotes(JSON.parse(notesData));
      }
    } catch (err) {
      console.error('Failed to load wallet data:', err);
    }
  };

  // Derive viewing/spending keys via signature
  const deriveKeys = useCallback(async () => {
    if (!phantom || !solanaAddress) return;

    setIsDerivingKeys(true);
    try {
      // Sign a message to derive keys deterministically
      const message = `zVault Key Derivation\n\nAddress: ${solanaAddress}\nTimestamp: ${Date.now()}`;
      const encodedMessage = new TextEncoder().encode(message);

      const result = await phantom.providers.solana.signMessage(encodedMessage);
      const signature = result.signature;

      // Derive a mock stealth address from signature
      const hash = sha256(signature);
      const stealthAddr = `zkey:${bytesToHex(hash).slice(0, 40)}`;

      // Save keys state
      const keysState: WalletKeys = {
        viewingKeyHash: bytesToHex(hash.slice(0, 16)),
        stealthAddress: stealthAddr,
        derived: true,
      };

      await AsyncStorage.setItem(
        `${STORAGE_KEYS.KEYS_DERIVED}_${solanaAddress}`,
        JSON.stringify(keysState)
      );

      setKeysDerived(true);
      setStealthAddress(stealthAddr);
    } catch (err) {
      console.error('Failed to derive keys:', err);
      throw err;
    } finally {
      setIsDerivingKeys(false);
    }
  }, [phantom, solanaAddress]);

  // Refresh notes (scan for new deposits)
  const refreshNotes = useCallback(async () => {
    if (!solanaAddress || !keysDerived) return;

    setIsLoading(true);
    try {
      // TODO: Implement real scanning via SDK
      // For now, just reload from storage
      await loadSavedData();
    } catch (err) {
      console.error('Failed to refresh notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [solanaAddress, keysDerived]);

  // Add demo note (for testing)
  const addDemoNote = useCallback(async (amount: number) => {
    if (!solanaAddress) return;

    const newNote: WalletNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      amount,
      createdAt: Date.now(),
      status: 'available',
    };

    const updatedNotes = [...notes, newNote];
    setNotes(updatedNotes);

    await AsyncStorage.setItem(
      `${STORAGE_KEYS.NOTES}_${solanaAddress}`,
      JSON.stringify(updatedNotes)
    );
  }, [solanaAddress, notes]);

  const value: WalletContextValue = {
    isConnected: isLoggedIn,
    address: solanaAddress,
    keysDerived,
    stealthAddress,
    deriveKeys,
    isDerivingKeys,
    notes,
    totalBalance,
    availableBalance,
    refreshNotes,
    addDemoNote,
    isLoading,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
