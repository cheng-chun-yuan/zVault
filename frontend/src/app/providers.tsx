"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "sonner";
import { BitcoinWalletProvider } from "@/contexts/bitcoin-wallet-context";
import { NoteStorageProvider } from "@/hooks/use-note-storage";
import { ZVaultKeysProvider } from "@/hooks/use-zvault-keys";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  // Use Solana devnet by default, can be configured via env
  const endpoint = useMemo(() => {
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC;
    return rpcUrl || clusterApiUrl("devnet");
  }, []);

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
          <ZVaultKeysProvider>
            <BitcoinWalletProvider>
              <NoteStorageProvider>
                {children}
                <Toaster
                  position="top-right"
                  toastOptions={{
                    style: {
                      background: "#16161B",
                      border: "1px solid rgba(139, 138, 158, 0.15)",
                      color: "#C7C5D1",
                    },
                    classNames: {
                      success: "!border-[#14F195]/30 !bg-[#14F195]/10",
                      error: "!border-red-500/30 !bg-red-500/10",
                      warning: "!border-[#FFA726]/30 !bg-[#FFA726]/10",
                    },
                  }}
                />
              </NoteStorageProvider>
            </BitcoinWalletProvider>
          </ZVaultKeysProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
