"use client";

import { useState, useCallback, useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  scanPoolAnnouncements,
  calculateYield,
  calculateTotalValue,
  createStealthPoolDeposit,
  STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR,
  STEALTH_POOL_ANNOUNCEMENT_SIZE,
  type ZVaultKeys,
  type StealthMetaAddress,
  type ScannedPoolPosition,
} from "@zvault/sdk";
import { ZVAULT_PROGRAM_ID } from "@/lib/constants";

// ============================================================================
// Types
// ============================================================================

export interface PoolStats {
  totalPrincipal: bigint;
  totalDeposits: number;
  totalWithdrawals: number;
  currentEpoch: bigint;
  yieldRateBps: number;
  epochDuration: number;
}

export interface EnrichedPoolPosition extends ScannedPoolPosition {
  currentValue: bigint;
  earnedYield: bigint;
  createdAt: number;
}

// Local type for pool announcements (matches SDK OnChainStealthPoolAnnouncement)
interface PoolAnnouncement {
  poolId: Uint8Array;
  ephemeralPub: Uint8Array;
  principal: bigint;
  depositEpoch: bigint;
  poolCommitment: Uint8Array;
  leafIndex: number;
  createdAt: number;  // Timestamp in seconds
}

// ============================================================================
// Hook
// ============================================================================

export function useYieldPool(keys: ZVaultKeys | null) {
  const { connection } = useConnection();

  // State
  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [positions, setPositions] = useState<EnrichedPoolPosition[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<number | null>(null);

  // Load pool stats from chain (real data when available, mock for now)
  const fetchPoolStats = useCallback(async () => {
    try {
      // TODO: Fetch real pool stats from YieldPool PDA
      // const [poolPda] = PublicKey.findProgramAddressSync(
      //   [Buffer.from("yield_pool"), poolId],
      //   new PublicKey(ZVAULT_PROGRAM_ID)
      // );
      // const accountInfo = await connection.getAccountInfo(poolPda);

      // Mock stats until contract deployed
      setPoolStats({
        totalPrincipal: 1_234_567_890n,
        totalDeposits: 42,
        totalWithdrawals: 15,
        currentEpoch: 100n,
        yieldRateBps: 500,
        epochDuration: 86400,
      });
    } catch (err) {
      console.error("[YieldPool] Failed to fetch stats:", err);
      setError("Failed to fetch pool stats");
    }
  }, [connection]);

  // Scan for user's positions using viewing key (REAL SDK FUNCTION)
  const scanForPositions = useCallback(async () => {
    if (!keys) {
      setPositions([]);
      return;
    }

    setIsScanning(true);
    setError(null);

    try {
      const programId = new PublicKey(ZVAULT_PROGRAM_ID);

      // Fetch pool announcement accounts from chain
      const accounts = await connection.getProgramAccounts(programId, {
        filters: [{ dataSize: STEALTH_POOL_ANNOUNCEMENT_SIZE }],
      });

      // Parse announcements from on-chain data
      const announcements: PoolAnnouncement[] = [];

      for (const account of accounts) {
        const data = new Uint8Array(account.account.data);
        if (data[0] !== STEALTH_POOL_ANNOUNCEMENT_DISCRIMINATOR) continue;

        try {
          let offset = 1;

          const poolId = data.slice(offset, offset + 8);
          offset += 8;

          const ephemeralPub = data.slice(offset, offset + 33);
          offset += 33;

          const view = new DataView(data.buffer, data.byteOffset);
          const principal = view.getBigUint64(offset, true);
          offset += 8;

          const depositEpoch = view.getBigUint64(offset, true);
          offset += 8;

          const poolCommitment = data.slice(offset, offset + 32);
          offset += 32;

          const leafIndex = Number(view.getBigUint64(offset, true));
          offset += 8;

          const createdAt = Number(view.getBigInt64(offset, true));

          announcements.push({
            poolId,
            ephemeralPub,
            principal,
            depositEpoch,
            poolCommitment,
            leafIndex,
            createdAt,  // Already number
          });
        } catch {
          // Skip malformed accounts
        }
      }

      // Use real SDK function to scan with viewing key
      const scanned = scanPoolAnnouncements(keys, announcements);

      // Enrich with yield calculations using real SDK functions
      const currentEpoch = poolStats?.currentEpoch ?? 100n;
      const yieldRateBps = poolStats?.yieldRateBps ?? 500;

      const enriched: EnrichedPoolPosition[] = scanned.map((pos) => {
        const earnedYield = calculateYield(pos.principal, pos.depositEpoch, currentEpoch, yieldRateBps);
        const matchingAnn = announcements.find((a) => a.leafIndex === pos.leafIndex);
        const createdAt = matchingAnn ? matchingAnn.createdAt * 1000 : Date.now();  // Convert seconds to ms

        return {
          ...pos,
          earnedYield,
          currentValue: calculateTotalValue(pos, currentEpoch, yieldRateBps),
          createdAt,
        };
      });

      setPositions(enriched);
      setLastScan(Date.now());
    } catch (err) {
      console.error("[YieldPool] Scan error:", err);
      setError(err instanceof Error ? err.message : "Failed to scan positions");
    } finally {
      setIsScanning(false);
    }
  }, [keys, connection, poolStats]);

  // Create deposit position (TODO: needs backend/contract)
  const createDeposit = useCallback(
    async (recipientMeta: StealthMetaAddress, principal: bigint, poolId: Uint8Array) => {
      if (!poolStats) throw new Error("Pool stats not loaded");

      setIsLoading(true);
      setError(null);

      try {
        // Use real SDK function to create position data
        const position = createStealthPoolDeposit(
          recipientMeta,
          principal,
          poolStats.currentEpoch,
          poolId
        );

        // TODO: Submit transaction to chain (needs backend/contract)
        // const tx = await buildDepositToPoolTransaction(connection, position, payer);
        // await sendAndConfirmTransaction(connection, tx, [payer]);

        console.log("[YieldPool] Created deposit position:", position);
        return position;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deposit failed";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [poolStats]
  );

  // Total portfolio calculations
  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0n);
  const totalYield = positions.reduce((sum, p) => sum + p.earnedYield, 0n);
  const totalPrincipal = positions.reduce((sum, p) => sum + p.principal, 0n);

  // Auto-fetch pool stats on mount
  useEffect(() => {
    fetchPoolStats();
  }, [fetchPoolStats]);

  // Update position yields when pool stats change
  useEffect(() => {
    if (poolStats && positions.length > 0) {
      setPositions((prev) =>
        prev.map((pos) => {
          const earnedYield = calculateYield(
            pos.principal,
            pos.depositEpoch,
            poolStats.currentEpoch,
            poolStats.yieldRateBps
          );
          return {
            ...pos,
            earnedYield,
            currentValue: pos.principal + earnedYield,
            createdAt: pos.createdAt,
          };
        })
      );
    }
  }, [poolStats]);

  return {
    poolStats,
    positions,
    isScanning,
    isLoading,
    error,
    lastScan,
    totalValue,
    totalYield,
    totalPrincipal,
    positionCount: positions.length,
    fetchPoolStats,
    scanForPositions,
    createDeposit,
  };
}
