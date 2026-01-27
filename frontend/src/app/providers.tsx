"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { Toaster } from "sonner";
import { BitcoinWalletProvider } from "@/contexts/bitcoin-wallet-context";
import { NoteStorageProvider } from "@/hooks/use-note-storage";
import { ZVaultProvider } from "@/hooks/use-zvault";
import { HELIUS_RPC_DEVNET } from "@/lib/helius";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  // Helius primary (supports getProgramAccounts), fallback to configured RPC
  const endpoint = useMemo(
    () => HELIUS_RPC_DEVNET || process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
    []
  );

  // Configure supported wallets
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      // Add more wallets as needed
      // new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ZVaultProvider>
            <BitcoinWalletProvider>
              <NoteStorageProvider>
                {children}
                <Toaster
                  position="top-right"
                  toastOptions={{
                    style: {
                      background: "var(--muted)",
                      border: "1px solid rgba(139, 138, 158, 0.15)",
                      color: "var(--color-gray-light)",
                    },
                    classNames: {
                      success: "!border-privacy/30 !bg-privacy/10",
                      error: "!border-error/30 !bg-error/10",
                      warning: "!border-warning-alt/30 !bg-warning-alt/10",
                    },
                  }}
                />
              </NoteStorageProvider>
            </BitcoinWalletProvider>
          </ZVaultProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
