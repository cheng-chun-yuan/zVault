"use client";

import {
  useState,
  useCallback,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  deriveKeysFromWallet,
  createStealthMetaAddress,
  encodeStealthMetaAddress,
  type ZVaultKeys,
  type StealthMetaAddress,
} from "@zvault/sdk";

interface ZVaultKeysContextValue {
  // State
  keys: ZVaultKeys | null;
  stealthAddress: StealthMetaAddress | null;
  stealthAddressEncoded: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  deriveKeys: () => Promise<void>;
  clearKeys: () => void;

  // Status
  hasKeys: boolean;
  isWalletConnected: boolean;
}

const ZVaultKeysContext = createContext<ZVaultKeysContextValue | null>(null);

/**
 * Provider for zVault key management
 *
 * Derives keys from Solana wallet signature using the SDK.
 * Keys are stored in memory only (not persisted to localStorage for security).
 */
export function ZVaultKeysProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();

  const [keys, setKeys] = useState<ZVaultKeys | null>(null);
  const [stealthAddress, setStealthAddress] = useState<StealthMetaAddress | null>(null);
  const [stealthAddressEncoded, setStealthAddressEncoded] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear keys when wallet disconnects
  useEffect(() => {
    if (!wallet.connected) {
      setKeys(null);
      setStealthAddress(null);
      setStealthAddressEncoded(null);
      setError(null);
    }
  }, [wallet.connected]);

  /**
   * Derive zVault keys from wallet signature
   */
  const deriveKeys = useCallback(async () => {
    if (!wallet.connected || !wallet.signMessage || !wallet.publicKey) {
      setError("Wallet not connected or doesn't support message signing");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log("[zVault] Requesting wallet signature...");

      // Derive keys from wallet signature
      const derivedKeys = await deriveKeysFromWallet({
        publicKey: wallet.publicKey,
        signMessage: wallet.signMessage,
      });

      console.log("[zVault] Keys derived successfully");

      // Create stealth meta-address
      const meta = createStealthMetaAddress(derivedKeys);
      const encoded = encodeStealthMetaAddress(meta);

      console.log("[zVault] Stealth address created:", encoded.slice(0, 20) + "...");

      setKeys(derivedKeys);
      setStealthAddress(meta);
      setStealthAddressEncoded(encoded);
    } catch (err) {
      console.error("[zVault] Failed to derive keys:", err);

      // Better error messages for common issues
      let errorMessage = "Failed to derive keys";
      if (err instanceof Error) {
        if (err.message.includes("User rejected")) {
          errorMessage = "Signature request was rejected";
        } else if (err.message.includes("Internal JSON-RPC")) {
          errorMessage = "Wallet error - please try reconnecting your wallet";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  /**
   * Clear keys from memory
   */
  const clearKeys = useCallback(() => {
    setKeys(null);
    setStealthAddress(null);
    setStealthAddressEncoded(null);
    setError(null);
  }, []);

  const value: ZVaultKeysContextValue = {
    keys,
    stealthAddress,
    stealthAddressEncoded,
    isLoading,
    error,
    deriveKeys,
    clearKeys,
    hasKeys: keys !== null,
    isWalletConnected: wallet.connected,
  };

  return (
    <ZVaultKeysContext.Provider value={value}>
      {children}
    </ZVaultKeysContext.Provider>
  );
}

/**
 * Hook for accessing zVault keys derived from Solana wallet
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const { keys, stealthAddressEncoded, deriveKeys, isLoading } = useZVaultKeys();
 *
 *   if (!keys) {
 *     return <button onClick={deriveKeys}>Derive Keys</button>;
 *   }
 *
 *   return <div>Your stealth address: {stealthAddressEncoded}</div>;
 * }
 * ```
 */
export function useZVaultKeys(): ZVaultKeysContextValue {
  const context = useContext(ZVaultKeysContext);

  if (!context) {
    throw new Error("useZVaultKeys must be used within ZVaultKeysProvider");
  }

  return context;
}
