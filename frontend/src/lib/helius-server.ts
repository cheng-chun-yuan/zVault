/**
 * Server-side Helius Configuration
 *
 * Provides Helius RPC connection for Next.js API routes.
 * Uses server-side API key (not exposed to client).
 */

import { Connection } from "@solana/web3.js";

// Server-side Helius API key (more secure than client-side)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || process.env.NEXT_PUBLIC_HELIUS_API_KEY || "";

/** Get Helius RPC URL for the current network */
export function getHeliusRpcUrl(network: "devnet" | "mainnet" = "devnet"): string {
  if (HELIUS_API_KEY) {
    return network === "mainnet"
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
      : `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  }

  // Fallback to public RPC
  return network === "mainnet"
    ? "https://api.mainnet-beta.solana.com"
    : process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}

/** Get a Solana connection using Helius RPC */
export function getHeliusConnection(network: "devnet" | "mainnet" = "devnet"): Connection {
  const rpcUrl = getHeliusRpcUrl(network);
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60000,
  });
}

/** Check if Helius is configured */
export function isHeliusConfigured(): boolean {
  return !!HELIUS_API_KEY;
}

/**
 * Get priority fee estimate from Helius
 */
export async function getHeliusPriorityFee(
  accountKeys: string[],
  network: "devnet" | "mainnet" = "devnet"
): Promise<number> {
  if (!HELIUS_API_KEY) {
    return 1000; // Default 1000 microLamports
  }

  try {
    const rpcUrl = getHeliusRpcUrl(network);
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "priority-fee",
        method: "getPriorityFeeEstimate",
        params: [
          {
            accountKeys,
            options: { recommended: true },
          },
        ],
      }),
    });

    const data = await response.json();
    return data?.result?.priorityFeeEstimate || 1000;
  } catch (error) {
    console.warn("[Helius] Failed to get priority fee:", error);
    return 1000;
  }
}

/**
 * Enhanced getAccountInfo with Helius
 */
export async function getAccountInfo(
  connection: Connection,
  pubkey: string
): Promise<{ data: Buffer; lamports: number } | null> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const accountInfo = await connection.getAccountInfo(new PublicKey(pubkey));
    if (!accountInfo) return null;
    return {
      data: accountInfo.data as Buffer,
      lamports: accountInfo.lamports,
    };
  } catch (error) {
    console.error("[Helius] getAccountInfo failed:", error);
    return null;
  }
}
