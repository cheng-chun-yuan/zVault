import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection, isHeliusConfigured } from "@/lib/helius-server";
import { DEVNET_CONFIG } from "@zvault/sdk";

export const runtime = "nodejs";

// Commitment tree PDA from SDK (single source of truth)
const COMMITMENT_TREE_ADDRESS = DEVNET_CONFIG.commitmentTreePda;

// Discriminator for CommitmentTree account
const COMMITMENT_TREE_DISCRIMINATOR = 0x05;
const ROOT_HISTORY_SIZE = 100;

interface CommitmentTreeState {
  discriminator: number;
  bump: number;
  currentRoot: string;
  nextIndex: string;
  rootHistoryIndex: number;
}

/**
 * GET /api/solana/commitment-tree
 *
 * Fetch commitment tree state from Solana via Helius RPC.
 * Returns current root, next index, and other state.
 */
export async function GET(request: NextRequest) {
  try {
    const connection = getHeliusConnection("devnet");

    console.log("[CommitmentTree API] Fetching from:", COMMITMENT_TREE_ADDRESS);
    console.log("[CommitmentTree API] Using Helius:", isHeliusConfigured());

    const pubkey = new PublicKey(COMMITMENT_TREE_ADDRESS);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo) {
      return NextResponse.json(
        { success: false, error: "Commitment tree account not found" },
        { status: 404 }
      );
    }

    const data = accountInfo.data;

    // Validate discriminator
    if (data[0] !== COMMITMENT_TREE_DISCRIMINATOR) {
      return NextResponse.json(
        { success: false, error: "Invalid commitment tree discriminator" },
        { status: 400 }
      );
    }

    // Parse state
    const discriminator = data[0];
    const bump = data[1];
    // Skip 6 bytes padding (indices 2-7)
    const currentRoot = Buffer.from(data.slice(8, 40)).toString("hex");
    const nextIndex = readU64LE(data, 40).toString();

    // Skip root history for now (100 * 32 bytes)
    const rootHistoryOffset = 48 + ROOT_HISTORY_SIZE * 32;
    const rootHistoryIndex =
      data[rootHistoryOffset] |
      (data[rootHistoryOffset + 1] << 8) |
      (data[rootHistoryOffset + 2] << 16) |
      (data[rootHistoryOffset + 3] << 24);

    const state: CommitmentTreeState = {
      discriminator,
      bump,
      currentRoot,
      nextIndex,
      rootHistoryIndex,
    };

    return NextResponse.json({
      success: true,
      helius: isHeliusConfigured(),
      address: COMMITMENT_TREE_ADDRESS,
      state,
    });
  } catch (error) {
    console.error("[CommitmentTree API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch commitment tree",
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
