"use client";

import { useEffect } from "react";
import { useBitcoinWalletStore } from "./bitcoin-wallet-store";
import { useZVaultStore } from "./zvault-store";

/**
 * Component to hydrate Zustand stores on mount.
 * Handles localStorage restoration and Poseidon initialization.
 */
export function StoreHydration() {
  const hydrateBtcWallet = useBitcoinWalletStore((s) => s._hydrate);
  const initPoseidon = useZVaultStore((s) => s.initPoseidon);

  useEffect(() => {
    // Hydrate Bitcoin wallet from localStorage
    hydrateBtcWallet();

    // Initialize Poseidon for cryptographic operations
    initPoseidon();
  }, [hydrateBtcWallet, initPoseidon]);

  return null;
}
