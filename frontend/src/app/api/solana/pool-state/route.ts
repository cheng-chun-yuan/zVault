import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection, isHeliusConfigured } from "@/lib/helius-server";

export const runtime = "nodejs";

// Pool state PDA from constants
const POOL_STATE_ADDRESS = process.env.NEXT_PUBLIC_POOL_STATE || "BWFTGsxcQrVyvvHJx6wwkRvLtgM1J3BimuaxMf2NjSE3";

// Discriminator for PoolState account
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
    const state: PoolStateData = {
      discriminator: data[0],
      bump: data[1],
      authority: new PublicKey(data.slice(8, 40)).toBase58(),
      zbtcMint: new PublicKey(data.slice(40, 72)).toBase58(),
      poolVault: new PublicKey(data.slice(72, 104)).toBase58(),
      minDeposit: readU64LE(data, 104).toString(),
      totalMinted: readU64LE(data, 112).toString(),
      totalBurned: readU64LE(data, 120).toString(),
      totalShielded: readU64LE(data, 128).toString(),
      depositCount: readU64LE(data, 136).toString(),
      directClaims: readU64LE(data, 144).toString(),
      stealthClaims: readU64LE(data, 152).toString(),
      isPaused: data[160] !== 0,
      lastUpdate: Number(readI64LE(data, 168)),
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

// Read little-endian u64
function readU64LE(buffer: Buffer | Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(buffer[offset + i]) << BigInt(i * 8);
  }
  return result;
}

// Read little-endian i64
function readI64LE(buffer: Buffer | Uint8Array, offset: number): bigint {
  const unsigned = readU64LE(buffer, offset);
  // Convert to signed if negative
  if (unsigned >= 0x8000000000000000n) {
    return unsigned - 0x10000000000000000n;
  }
  return unsigned;
}
