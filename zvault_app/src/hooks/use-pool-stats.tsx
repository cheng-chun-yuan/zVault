"use client";

import { useState, useEffect, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ZVAULT_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, derivezBTCMintPDA } from "@/lib/solana/instructions";

export interface PoolStats {
  depositCount: number;
  vaultBalance: bigint;
  pendingRedemptions: number;
}

/**
 * Derive Pool State PDA
 */
function derivePoolStatePDA(programId: PublicKey = ZVAULT_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state")],
    programId
  );
}

/**
 * Derive Pool Vault ATA (where zBTC is held)
 */
function derivePoolVaultATA(programId: PublicKey = ZVAULT_PROGRAM_ID): PublicKey {
  const [poolState] = derivePoolStatePDA(programId);
  const [zbtcMint] = derivezBTCMintPDA(programId);

  return getAssociatedTokenAddressSync(
    zbtcMint,
    poolState,
    true,
    TOKEN_2022_PROGRAM_ID
  );
}

export function usePoolStats() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      let depositCount = 0;
      let pendingRedemptions = 0;
      let vaultBalance = 0n;

      // Fetch pool state for counts
      const [poolStatePDA] = derivePoolStatePDA();
      const poolInfo = await connection.getAccountInfo(poolStatePDA);

      if (poolInfo && poolInfo.data.length >= 196 && poolInfo.data[0] === 0x01) {
        const view = new DataView(poolInfo.data.buffer, poolInfo.data.byteOffset, poolInfo.data.byteLength);
        depositCount = Number(view.getBigUint64(164, true));
        pendingRedemptions = Number(view.getBigUint64(188, true));
      }

      // Fetch vault balance
      try {
        const poolVault = derivePoolVaultATA();
        const vaultInfo = await connection.getAccountInfo(poolVault);

        if (vaultInfo && vaultInfo.data.length >= 72) {
          const view = new DataView(vaultInfo.data.buffer, vaultInfo.data.byteOffset, vaultInfo.data.byteLength);
          vaultBalance = view.getBigUint64(64, true);
        }
      } catch {
        // Vault may not exist yet
      }

      setStats({ depositCount, vaultBalance, pendingRedemptions });
    } catch (err) {
      console.error("Error fetching pool stats:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, isLoading, error, refresh: fetchStats };
}
