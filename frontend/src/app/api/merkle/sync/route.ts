import { NextRequest, NextResponse } from "next/server";
import { checkSyncStatus, fetchOnChainTreeState } from "@/lib/commitment-index";

export const runtime = "nodejs";

/**
 * POST /api/merkle/sync
 *
 * Trigger sync from on-chain commitment tree.
 * Currently just reports sync status - full sync requires
 * parsing on-chain commitment events.
 *
 * Future: Will parse deposit events to rebuild local index.
 */
export async function POST(request: NextRequest) {
  try {
    // Fetch on-chain state
    const onChainState = await fetchOnChainTreeState();

    // Check sync status
    const syncStatus = await checkSyncStatus();

    if (syncStatus.synced) {
      return NextResponse.json({
        success: true,
        message: "Already synced",
        localRoot: syncStatus.localRoot,
        onChainRoot: syncStatus.onChainRoot,
        localSize: syncStatus.localSize,
        onChainNextIndex: syncStatus.onChainNextIndex.toString(),
        synced: true,
      });
    }

    // TODO: Implement full sync by parsing on-chain deposit events
    // For now, just report the mismatch
    return NextResponse.json({
      success: true,
      message: "Sync check complete - manual commitment addition required",
      localRoot: syncStatus.localRoot,
      onChainRoot: syncStatus.onChainRoot,
      localSize: syncStatus.localSize,
      onChainNextIndex: syncStatus.onChainNextIndex.toString(),
      synced: false,
      hint: "Add missing commitments via POST /api/merkle/commitment",
    });
  } catch (error) {
    console.error("[Merkle Sync API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync with on-chain state",
      },
      { status: 500 }
    );
  }
}
