import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";

// zVault Program ID (Devnet)
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK"
);

// Derive block header PDA
function deriveBlockHeaderPDA(blockHeight: number): [PublicKey, number] {
  const heightBuffer = Buffer.alloc(8);
  heightBuffer.writeBigUInt64LE(BigInt(blockHeight));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("block_header"), heightBuffer],
    PROGRAM_ID
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ height: string }> }
) {
  try {
    const { height } = await params;
    const blockHeight = parseInt(height, 10);

    if (isNaN(blockHeight)) {
      return NextResponse.json(
        { exists: false, error: "Invalid block height" },
        { status: 400 }
      );
    }

    // Connect to Solana
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // Check if header exists
    const [headerPDA] = deriveBlockHeaderPDA(blockHeight);
    const accountInfo = await connection.getAccountInfo(headerPDA);

    if (accountInfo) {
      return NextResponse.json({
        exists: true,
        block_height: blockHeight,
        // Could parse account data here to get more info
      });
    }

    return NextResponse.json({
      exists: false,
      block_height: blockHeight,
    });
  } catch (error) {
    console.error("[Header Status API] Error:", error);
    return NextResponse.json(
      {
        exists: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
