"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  getAddress,
  sendBtcTransaction,
  type GetAddressResponse,
  BitcoinNetworkType,
  AddressPurpose,
} from "sats-connect";

export interface BitcoinWalletContextType {
  // Connection state
  connected: boolean;
  connecting: boolean;
  address: string | null;
  publicKey: string | null;
  balance: number | null; // Balance in satoshis

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  sendBtc: (toAddress: string, amountSats: number) => Promise<string>;
  refreshBalance: () => Promise<void>;

  // Error handling
  error: string | null;
  clearError: () => void;
}

const BitcoinWalletContext = createContext<BitcoinWalletContextType | null>(null);

const NETWORK = BitcoinNetworkType.Testnet;

export function BitcoinWalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch balance from testnet API
  const fetchBalance = useCallback(async (addr: string) => {
    try {
      // Use mempool.space testnet API for balance
      const response = await fetch(
        `https://mempool.space/testnet/api/address/${addr}`
      );
      if (response.ok) {
        const data = await response.json();
        // chain_stats.funded_txo_sum - chain_stats.spent_txo_sum
        const confirmed =
          (data.chain_stats?.funded_txo_sum || 0) -
          (data.chain_stats?.spent_txo_sum || 0);
        const unconfirmed =
          (data.mempool_stats?.funded_txo_sum || 0) -
          (data.mempool_stats?.spent_txo_sum || 0);
        setBalance(confirmed + unconfirmed);
      }
    } catch (err) {
      console.error("Failed to fetch balance:", err);
    }
  }, []);

  // Check if wallet was previously connected
  useEffect(() => {
    const savedAddress = localStorage.getItem("btc_wallet_address");
    const savedPubKey = localStorage.getItem("btc_wallet_pubkey");
    if (savedAddress && savedPubKey) {
      setAddress(savedAddress);
      setPublicKey(savedPubKey);
      setConnected(true);
      fetchBalance(savedAddress);
    }
  }, [fetchBalance]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    try {
      const response = await getAddress({
        payload: {
          purposes: [AddressPurpose.Payment, AddressPurpose.Ordinals],
          message: "Connect to zVault for BTC deposits",
          network: {
            type: NETWORK,
          },
        },
        onFinish: (response: GetAddressResponse) => {
          // Find the payment address (P2TR preferred, fallback to P2WPKH)
          const paymentAddr = response.addresses.find(
            (a) => a.purpose === AddressPurpose.Payment
          );

          if (paymentAddr) {
            setAddress(paymentAddr.address);
            setPublicKey(paymentAddr.publicKey);
            setConnected(true);

            // Persist connection
            localStorage.setItem("btc_wallet_address", paymentAddr.address);
            localStorage.setItem("btc_wallet_pubkey", paymentAddr.publicKey);

            // Fetch balance
            fetchBalance(paymentAddr.address);
          }
        },
        onCancel: () => {
          setError("Connection cancelled by user");
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      console.error("Bitcoin wallet connection error:", err);
    } finally {
      setConnecting(false);
    }
  }, [fetchBalance]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setAddress(null);
    setPublicKey(null);
    setBalance(null);
    localStorage.removeItem("btc_wallet_address");
    localStorage.removeItem("btc_wallet_pubkey");
  }, []);

  const refreshBalance = useCallback(async () => {
    if (address) {
      await fetchBalance(address);
    }
  }, [address, fetchBalance]);

  const sendBtc = useCallback(
    async (toAddress: string, amountSats: number): Promise<string> => {
      if (!connected || !address) {
        throw new Error("Wallet not connected");
      }

      return new Promise((resolve, reject) => {
        sendBtcTransaction({
          payload: {
            network: {
              type: NETWORK,
            },
            recipients: [
              {
                address: toAddress,
                amountSats: BigInt(amountSats),
              },
            ],
            senderAddress: address,
          },
          onFinish: (txid) => {
            resolve(txid);
          },
          onCancel: () => {
            reject(new Error("Transaction cancelled by user"));
          },
        });
      });
    },
    [connected, address]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <BitcoinWalletContext.Provider
      value={{
        connected,
        connecting,
        address,
        publicKey,
        balance,
        connect,
        disconnect,
        sendBtc,
        refreshBalance,
        error,
        clearError,
      }}
    >
      {children}
    </BitcoinWalletContext.Provider>
  );
}

export function useBitcoinWallet() {
  const context = useContext(BitcoinWalletContext);
  if (!context) {
    throw new Error("useBitcoinWallet must be used within BitcoinWalletProvider");
  }
  return context;
}
