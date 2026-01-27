/**
 * Helius SDK Configuration
 *
 * Provides Helius RPC endpoints and priority fee estimation utilities.
 * Falls back to public Solana RPC if API key is not configured.
 */

import {
  ComputeBudgetProgram,
  TransactionInstruction,
} from "@solana/web3.js";

const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY || "";

/** Helius RPC endpoint for devnet */
export const HELIUS_RPC_DEVNET = HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

/** Helius RPC endpoint for mainnet */
export const HELIUS_RPC_MAINNET = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";

/** Default compute unit limit for zVault transactions */
const DEFAULT_COMPUTE_UNITS = 200_000;

/** Default priority fee in microLamports when estimation fails */
const DEFAULT_PRIORITY_FEE = 1000;

/** Helius Priority Fee API endpoint */
const PRIORITY_FEE_API = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : null;

/**
 * Get priority fee instructions for a transaction
 *
 * Uses Helius Priority Fee API to estimate optimal priority fee based on account keys.
 * Falls back to minimal compute budget without priority fee if API unavailable.
 *
 * @param accountKeys - Array of account public key strings involved in the transaction
 * @returns Array of ComputeBudgetProgram instructions
 */
export async function getPriorityFeeInstructions(
  accountKeys: string[]
): Promise<TransactionInstruction[]> {
  if (!PRIORITY_FEE_API) {
    // Fallback: return minimal compute budget without priority fee
    return [
      ComputeBudgetProgram.setComputeUnitLimit({ units: DEFAULT_COMPUTE_UNITS }),
    ];
  }

  try {
    // Use Helius JSON-RPC method for priority fee estimation
    const response = await fetch(PRIORITY_FEE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "priority-fee",
        method: "getPriorityFeeEstimate",
        params: [{
          accountKeys,
          options: { recommended: true },
        }],
      }),
    });

    const data = await response.json();
    const priorityFee = data?.result?.priorityFeeEstimate || DEFAULT_PRIORITY_FEE;

    return [
      ComputeBudgetProgram.setComputeUnitLimit({ units: DEFAULT_COMPUTE_UNITS }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.round(priorityFee) }),
    ];
  } catch (error) {
    console.warn("Failed to get priority fee estimate:", error);
    return [
      ComputeBudgetProgram.setComputeUnitLimit({ units: DEFAULT_COMPUTE_UNITS }),
    ];
  }
}
