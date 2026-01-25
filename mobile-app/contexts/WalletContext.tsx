/**
 * Wallet Context
 *
 * Global state management for the zVault wallet.
 * Uses React Context + Zustand for persistent state.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { create } from 'zustand';
import {
  MobileKeys,
  loadKeys,
  loadStealthMetaAddress,
  loadStealthMetaAddressEncoded,
  saveKeys,
  deriveKeysFromMnemonic,
  generateMnemonic,
} from '../lib/keys';
import {
  isWalletInitialized,
  getCachedItem,
  setCachedItem,
  STORAGE_KEYS,
} from '../lib/storage';
import {
  deriveNote,
  deriveTaprootAddress,
  createClaimLink,
  prepareStealthDeposit,
  decodeStealthMetaAddress,
  bigintToBytes,
  type StealthMetaAddress,
  type Note as SDKNote,
} from '@zvault/sdk';
import * as Crypto from 'expo-crypto';

// Types
export interface Note {
  id: string;
  nullifier: string;
  secret: string;
  amount: number; // satoshis
  commitment: string;
  status: 'pending' | 'confirmed' | 'spent';
  createdAt: number;
}

export interface Deposit {
  id: string;
  amount: number; // satoshis
  taprootAddress: string;
  commitment: string;
  status: 'waiting' | 'detected' | 'confirming' | 'claimable' | 'claimed';
  confirmations: number;
  txHash?: string;
  createdAt: number;
  claimedAt?: number;
}

interface WalletState {
  // Initialization
  isInitialized: boolean;
  isLoading: boolean;

  // Keys (only public parts stored in state)
  stealthMetaAddress: string | null;
  viewingPubKey: string | null;

  // Balance
  balance: number; // satoshis
  notes: Note[];

  // Deposits
  deposits: Deposit[];

  // Actions
  setInitialized: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setStealthMetaAddress: (address: string) => void;
  setBalance: (balance: number) => void;
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  setDeposits: (deposits: Deposit[]) => void;
  addDeposit: (deposit: Deposit) => void;
  updateDeposit: (id: string, updates: Partial<Deposit>) => void;
}

// Zustand store
export const useWalletStore = create<WalletState>((set) => ({
  isInitialized: false,
  isLoading: true,
  stealthMetaAddress: null,
  viewingPubKey: null,
  balance: 0,
  notes: [],
  deposits: [],

  setInitialized: (value) => set({ isInitialized: value }),
  setLoading: (value) => set({ isLoading: value }),
  setStealthMetaAddress: (address) => set({ stealthMetaAddress: address }),
  setBalance: (balance) => set({ balance }),
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set((state) => ({ notes: [...state.notes, note] })),
  updateNote: (id, updates) =>
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  setDeposits: (deposits) => set({ deposits }),
  addDeposit: (deposit) => set((state) => ({ deposits: [...state.deposits, deposit] })),
  updateDeposit: (id, updates) =>
    set((state) => ({
      deposits: state.deposits.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    })),
}));

// Context for additional wallet operations
interface WalletContextValue {
  // Wallet operations
  createWallet: () => Promise<string>; // Returns mnemonic
  importWallet: (mnemonic: string) => Promise<void>;
  unlockWallet: () => Promise<MobileKeys | null>;

  // Deposit operations
  createDeposit: (amount: number) => Promise<Deposit>;

  // Send operations
  sendToStealth: (recipientAddress: string, amount: number) => Promise<string>;
  sendByNote: (amount: number) => Promise<{ claimLink: string; note: Note }>;

  // Claim operations
  claimNote: (claimLink: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const store = useWalletStore();

  // Initialize wallet state on mount
  useEffect(() => {
    initializeWallet();
  }, []);

  async function initializeWallet() {
    store.setLoading(true);
    try {
      const initialized = await isWalletInitialized();
      store.setInitialized(initialized);

      if (initialized) {
        // Load stealth meta-address as encoded string (doesn't require Face ID)
        const stealthAddressEncoded = await loadStealthMetaAddressEncoded();
        if (stealthAddressEncoded) {
          store.setStealthMetaAddress(stealthAddressEncoded);
        }

        // Load cached deposits
        const cachedDeposits = await getCachedItem<Deposit[]>(STORAGE_KEYS.PENDING_DEPOSITS);
        if (cachedDeposits) {
          store.setDeposits(cachedDeposits);
        }

        // Load cached notes
        const cachedNotes = await getCachedItem<Note[]>(STORAGE_KEYS.SCANNED_NOTES);
        if (cachedNotes) {
          store.setNotes(cachedNotes);
          // Calculate balance from confirmed notes
          const balance = cachedNotes
            .filter((n) => n.status === 'confirmed')
            .reduce((sum, n) => sum + n.amount, 0);
          store.setBalance(balance);
        }
      }
    } catch (error) {
      console.error('Failed to initialize wallet:', error);
    } finally {
      store.setLoading(false);
    }
  }

  // Create a new wallet
  async function createWallet(): Promise<string> {
    const mnemonic = generateMnemonic();
    const keys = deriveKeysFromMnemonic(mnemonic);
    await saveKeys(keys);

    store.setStealthMetaAddress(keys.stealthMetaAddressEncoded);
    store.setInitialized(true);

    return mnemonic;
  }

  // Import wallet from mnemonic
  async function importWallet(mnemonic: string): Promise<void> {
    const keys = deriveKeysFromMnemonic(mnemonic);
    await saveKeys(keys);

    store.setStealthMetaAddress(keys.stealthMetaAddressEncoded);
    store.setInitialized(true);
  }

  // Unlock wallet (prompts Face ID)
  async function unlockWallet(): Promise<MobileKeys | null> {
    return loadKeys();
  }

  // Create a new deposit with real SDK integration
  async function createDeposit(amount: number): Promise<Deposit> {
    // Generate cryptographically secure random seed
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const seed = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Derive note from seed using SDK
    const amountSats = BigInt(amount);
    const note = deriveNote(seed, 0, amountSats);

    // Convert commitment to bytes for Taproot derivation
    const commitmentBytes = bigintToBytes(note.commitment);

    // Derive real Taproot address from commitment (async)
    const taprootResult = await deriveTaprootAddress(commitmentBytes, 'testnet');

    // Generate claim link for recovery (takes a Note object)
    const claimLink = createClaimLink(note);

    // Generate unique deposit ID
    const id = Date.now().toString();

    const deposit: Deposit = {
      id,
      amount,
      taprootAddress: taprootResult.address,
      commitment: note.commitment.toString(16).padStart(64, '0'),
      status: 'waiting',
      confirmations: 0,
      createdAt: Date.now(),
    };

    // Store claim link separately (for recovery)
    await setCachedItem(`claim_link_${id}`, claimLink);

    store.addDeposit(deposit);

    // Persist deposits
    const deposits = [...store.deposits, deposit];
    await setCachedItem(STORAGE_KEYS.PENDING_DEPOSITS, deposits);

    return deposit;
  }

  // Send to stealth address (prepares deposit data)
  async function sendToStealth(recipientAddress: string, amount: number): Promise<string> {
    // Parse recipient's stealth meta-address (132 hex chars = 66 bytes)
    let recipientMeta: StealthMetaAddress;
    try {
      recipientMeta = decodeStealthMetaAddress(recipientAddress);
    } catch (err) {
      throw new Error('Invalid stealth address format');
    }

    // Prepare stealth deposit using SDK (async, amount-independent)
    const stealthDeposit = await prepareStealthDeposit({
      recipientMeta,
      network: 'testnet',
    });

    // The stealth deposit contains:
    // - btcDepositAddress: where to send BTC
    // - opReturnData: commitment data for the BTC transaction
    // - stealthData.ephemeralPub: for recipient to derive shared secret

    // For mobile, we return the Taproot address for the user to send BTC to
    // In a full implementation, this would integrate with a Bitcoin wallet
    const depositInfo = {
      btcDepositAddress: stealthDeposit.btcDepositAddress,
      amount: amount.toString(),
      recipient: recipientAddress.slice(0, 16) + '...',
      opReturnData: Buffer.from(stealthDeposit.opReturnData).toString('hex'),
    };

    // Store the pending stealth send
    const id = Date.now().toString();
    await setCachedItem(`stealth_send_${id}`, depositInfo);

    // Return the Taproot address for the BTC send
    return stealthDeposit.btcDepositAddress;
  }

  // Send by shareable note
  async function sendByNote(amount: number): Promise<{ claimLink: string; note: Note }> {
    const nullifier = Math.random().toString(36).substring(2);
    const secret = Math.random().toString(36).substring(2);

    const note: Note = {
      id: Date.now().toString(),
      nullifier,
      secret,
      amount,
      commitment: `${nullifier}:${secret}`,
      status: 'confirmed',
      createdAt: Date.now(),
    };

    // Generate claim link
    const claimData = Buffer.from(JSON.stringify({ nullifier, secret, amount })).toString('base64');
    const claimLink = `zvault://claim/${claimData}`;

    return { claimLink, note };
  }

  // Claim a note from link
  async function claimNote(claimLink: string): Promise<void> {
    // Parse claim link
    const data = claimLink.replace('zvault://claim/', '');
    const { nullifier, secret, amount } = JSON.parse(Buffer.from(data, 'base64').toString());

    // TODO: Implement claim
    // 1. Verify note exists in merkle tree
    // 2. Generate claim ZK proof
    // 3. Submit claim transaction
    console.log('Claiming note:', { nullifier, secret, amount });
  }

  const value: WalletContextValue = {
    createWallet,
    importWallet,
    unlockWallet,
    createDeposit,
    sendToStealth,
    sendByNote,
    claimNote,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}

// Helper hook for balance display
export function useFormattedBalance() {
  const balance = useWalletStore((state) => state.balance);

  const btc = balance / 100_000_000;
  const sats = balance;

  return {
    btc: btc.toFixed(8),
    sats: sats.toLocaleString(),
    usd: (btc * 100000).toFixed(2), // Placeholder BTC price
  };
}
