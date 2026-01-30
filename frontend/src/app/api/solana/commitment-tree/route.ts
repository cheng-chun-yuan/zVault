import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getHeliusConnection, isHeliusConfigured } from "@/lib/helius-server";
import { DEVNET_CONFIG, parseCommitmentTreeData } from "@zvault/sdk";

export const runtime = "nodejs";

// Commitment tree PDA from SDK (single source of truth)
const COMMITMENT_TREE_ADDRESS = DEVNET_CONFIG.commitmentTreePda;

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

    // Use SDK's parseCommitmentTreeData (handles validation + parsing)
    const parsed = parseCommitmentTreeData(new Uint8Array(accountInfo.data));

    const state = {
      discriminator: parsed.discriminator,
      bump: parsed.bump,
      currentRoot: Buffer.from(parsed.currentRoot).toString("hex"),
      nextIndex: parsed.nextIndex.toString(),
      rootHistoryIndex: parsed.rootHistoryIndex,
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
