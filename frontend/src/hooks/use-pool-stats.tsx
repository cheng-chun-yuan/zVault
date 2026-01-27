"use client";

import { useState, useEffect, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { ZVAULT_PROGRAM_ID } from "@/lib/solana/instructions";

export interface PoolStats {
  depositCount: number;
  totalMinted: bigint;
  totalBurned: bigint;
  pendingRedemptions: number;
  totalShielded: bigint;
}

/**
 * Decode PoolState account data from on-chain
 * Layout (see contracts/programs/zvault/src/state/pool.rs):
 * - 0: discriminator (1 byte)
 * - 1: bump (1 byte)
 * - 2: flags (1 byte)
 * - 3: padding (1 byte)
 * - 4-35: authority (32 bytes)
 * - 36-67: zbtc_mint (32 bytes)
 * - 68-99: privacy_cash_pool (32 bytes)
 * - 100-131: pool_vault (32 bytes)
 * - 132-163: frost_vault (32 bytes)
 * - 164-171: deposit_count (u64 LE)
 * - 172-179: total_minted (u64 LE)
 * - 180-187: total_burned (u64 LE)
 * - 188-195: pending_redemptions (u64 LE)
 * - 196-203: direct_claims (u64 LE)
 * - 204-211: split_count (u64 LE)
 * - 212-219: last_update (u64 LE)
 * - 220-227: min_deposit (u64 LE)
 * - 228-235: max_deposit (u64 LE)
 * - 236-243: total_shielded (u64 LE)
 */
function decodePoolState(data: Buffer): PoolStats | null {
  if (data.length < 244) {
    console.warn("Pool state data too short:", data.length);
    return null;
  }

  // Check discriminator
  if (data[0] !== 0x01) {
    console.warn("Invalid pool state discriminator:", data[0]);
    return null;
  }

  const readU64LE = (offset: number): bigint => {
    return data.readBigUInt64LE(offset);
  };

  return {
    depositCount: Number(readU64LE(164)),
    totalMinted: readU64LE(172),
    totalBurned: readU64LE(180),
    pendingRedemptions: Number(readU64LE(188)),
    totalShielded: readU64LE(236),
  };
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

      const [poolStatePDA] = derivePoolStatePDA();
      const accountInfo = await connection.getAccountInfo(poolStatePDA);

      if (!accountInfo) {
        // Pool not initialized yet - use zeros
        setStats({
          depositCount: 0,
          totalMinted: 0n,
          totalBurned: 0n,
          pendingRedemptions: 0,
          totalShielded: 0n,
        });
        return;
      }

      const decoded = decodePoolState(Buffer.from(accountInfo.data));
      if (decoded) {
        setStats(decoded);
      } else {
        setError("Failed to decode pool state");
      }
    } catch (err) {
      console.error("Error fetching pool stats:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, isLoading, error, refresh: fetchStats };
}
