import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection, isHeliusConfigured } from "@/lib/helius-server";
import { DEVNET_CONFIG, bytesToBigint } from "@zvault/sdk";

export const runtime = "nodejs";

// Pool state PDA from SDK (single source of truth)
const POOL_STATE_ADDRESS = DEVNET_CONFIG.poolStatePda;

// Discriminator for PoolState account (not exported by SDK yet)
const POOL_STATE_DISCRIMINATOR = 0x01;

interface PoolStateData {
  discriminator: number;
  bump: number;
  authority: string;
  zbtcMint: string;
  poolVault: string;
  minDeposit: string;
  totalMinted: string;
  totalBurned: string;
  totalShielded: string;
  depositCount: string;
  directClaims: string;
  stealthClaims: string;
  isPaused: boolean;
  lastUpdate: number;
}

/**
 * GET /api/solana/pool-state
 *
 * Fetch zVault pool state from Solana via Helius RPC.
 */
export async function GET(request: NextRequest) {
  try {
    const connection = getHeliusConnection("devnet");

    console.log("[PoolState API] Fetching from:", POOL_STATE_ADDRESS);
    console.log("[PoolState API] Using Helius:", isHeliusConfigured());

    const pubkey = new PublicKey(POOL_STATE_ADDRESS);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo) {
      return NextResponse.json(
        { success: false, error: "Pool state account not found" },
        { status: 404 }
      );
    }

    const data = accountInfo.data;

    // Validate discriminator
    if (data[0] !== POOL_STATE_DISCRIMINATOR) {
      return NextResponse.json(
        { success: false, error: "Invalid pool state discriminator" },
        { status: 400 }
      );
    }

    // Parse state (simplified - matches PoolState struct layout)
    // Using SDK's bytesToBigint for u64 parsing
    const state: PoolStateData = {
      discriminator: data[0],
      bump: data[1],
      authority: new PublicKey(data.slice(8, 40)).toBase58(),
      zbtcMint: new PublicKey(data.slice(40, 72)).toBase58(),
      poolVault: new PublicKey(data.slice(72, 104)).toBase58(),
      minDeposit: bytesToBigint(data.slice(104, 112)).toString(),
      totalMinted: bytesToBigint(data.slice(112, 120)).toString(),
      totalBurned: bytesToBigint(data.slice(120, 128)).toString(),
      totalShielded: bytesToBigint(data.slice(128, 136)).toString(),
      depositCount: bytesToBigint(data.slice(136, 144)).toString(),
      directClaims: bytesToBigint(data.slice(144, 152)).toString(),
      stealthClaims: bytesToBigint(data.slice(152, 160)).toString(),
      isPaused: data[160] !== 0,
      lastUpdate: Number(bytesToBigint(data.slice(168, 176))),
    };

    return NextResponse.json({
      success: true,
      helius: isHeliusConfigured(),
      address: POOL_STATE_ADDRESS,
      state,
    });
  } catch (error) {
    console.error("[PoolState API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch pool state",
      },
      { status: 500 }
    );
  }
}
