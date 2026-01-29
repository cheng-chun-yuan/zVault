import { NextRequest, NextResponse } from "next/server";
import { getMerkleProof, getTreeStatus } from "@/lib/commitment-index";

export const runtime = "nodejs";

/**
 * GET /api/merkle/proof?commitment=xxx&root=xxx (optional)
 *
 * Get Merkle proof for a commitment.
 * Returns siblings and indices for Noir circuit input.
 */
export async function GET(request: NextRequest) {
  try {
    const commitment = request.nextUrl.searchParams.get("commitment");

    if (!commitment) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing commitment parameter",
        },
        { status: 400 }
      );
    }

    // Parse commitment as hex or decimal
    let commitmentBigInt: bigint;
    try {
      if (commitment.startsWith("0x")) {
        commitmentBigInt = BigInt(commitment);
      } else if (/^[0-9a-fA-F]+$/.test(commitment) && commitment.length >= 32) {
        // Hex without 0x prefix
        commitmentBigInt = BigInt("0x" + commitment);
      } else {
        // Decimal
        commitmentBigInt = BigInt(commitment);
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid commitment format. Use hex (0x...) or decimal.",
        },
        { status: 400 }
      );
    }

    const proof = getMerkleProof(commitmentBigInt);

    if (!proof) {
      return NextResponse.json(
        {
          success: false,
          error: "Commitment not found in tree",
        },
        { status: 404 }
      );
    }

    // Optional root verification
    const requestedRoot = request.nextUrl.searchParams.get("root");
    if (requestedRoot) {
      const currentRoot = getTreeStatus().root;
      if (requestedRoot.toLowerCase() !== currentRoot.toLowerCase()) {
        return NextResponse.json(
          {
            success: false,
            error: "Root mismatch - tree may have been updated",
            expectedRoot: requestedRoot,
            currentRoot,
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      commitment: commitment,
      leafIndex: proof.leafIndex.toString(),
      root: proof.root.toString(16).padStart(64, "0"),
      siblings: proof.siblings.map((s) => s.toString(16).padStart(64, "0")),
      indices: proof.indices,
    });
  } catch (error) {
    console.error("[Merkle Proof API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get Merkle proof",
      },
      { status: 500 }
    );
  }
}
