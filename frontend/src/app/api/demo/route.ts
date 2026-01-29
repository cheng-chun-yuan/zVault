import { NextRequest, NextResponse } from "next/server";
import {
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { buildAddDemoStealthTransaction } from "@/lib/solana/demo-instructions";
import { getHeliusConnection, isHeliusConfigured } from "@/lib/helius-server";

export const runtime = "nodejs";

// Load admin keypair from environment variable
// Demo instructions require admin signature to add mock deposits
function getAdminKeypair(): Keypair | null {
  if (!process.env.ADMIN_KEYPAIR) {
    console.error("[Demo API] ADMIN_KEYPAIR env variable not set");
    return null;
  }

  try {
    const secretKey = JSON.parse(process.env.ADMIN_KEYPAIR);
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    // Don't log error details - could expose key format information
    console.error("[Demo API] Failed to parse ADMIN_KEYPAIR");
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ephemeralPub, commitment, encryptedAmount } = body;

    // Validate type - only stealth mode is supported
    if (type && type !== "stealth") {
      return NextResponse.json(
        { success: false, error: "Only 'stealth' type is supported. Use stealth deposits." },
        { status: 400 }
      );
    }

    // Validate stealth mode params with proper hex validation
    if (!isValidHex(ephemeralPub, 66)) {
      return NextResponse.json(
        { success: false, error: "Invalid ephemeralPub. Must be 66 valid hex characters (33 bytes)" },
        { status: 400 }
      );
    }
    if (!isValidHex(commitment, 64)) {
      return NextResponse.json(
        { success: false, error: "Invalid commitment. Must be 64 valid hex characters (32 bytes)" },
        { status: 400 }
      );
    }
    if (!isValidHex(encryptedAmount, 16)) {
      return NextResponse.json(
        { success: false, error: "Invalid encryptedAmount. Must be 16 valid hex characters (8 bytes)" },
        { status: 400 }
      );
    }

    console.log("[Demo API] Processing stealth deposit...");

    // Get admin keypair (required for demo instructions)
    const admin = getAdminKeypair();
    if (!admin) {
      return NextResponse.json(
        { success: false, error: "Admin not configured. Set ADMIN_KEYPAIR env variable." },
        { status: 500 }
      );
    }

    // Connect to Solana via Helius
    const connection = getHeliusConnection("devnet");
    console.log("[Demo API] Using Helius:", isHeliusConfigured());
    console.log("[Demo API] Admin:", admin.publicKey.toBase58());

    // Build stealth transaction
    const ephemeralPubBytes = hexToBytes(ephemeralPub);
    const commitmentBytes = hexToBytes(commitment);
    const encryptedAmountBytes = hexToBytes(encryptedAmount);
    const tx = await buildAddDemoStealthTransaction(connection, {
      payer: admin.publicKey,
      ephemeralPub: ephemeralPubBytes,
      commitment: commitmentBytes,
      encryptedAmount: encryptedAmountBytes,
    });

    // Sign and send transaction with admin keypair
    try {
      const signature = await sendAndConfirmTransaction(connection, tx, [admin], {
        commitment: "confirmed",
      });

      console.log("[Demo API] Transaction confirmed:", signature);

      return NextResponse.json({
        success: true,
        type: "stealth",
        signature,
        message: "Demo stealth deposit added on-chain",
      });
    } catch (txError: unknown) {
      // Log full error server-side for debugging, but don't expose to client
      console.error("[Demo API] Transaction failed:", txError);

      // Return generic error message to avoid leaking implementation details
      return NextResponse.json(
        { success: false, error: "Transaction processing failed. Please try again." },
        { status: 500 }
      );
    }
  } catch (error) {
    // Log full error server-side for debugging
    console.error("[Demo API] Error:", error);

    // Return generic error message to avoid leaking implementation details
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * Validate hex string format
 */
function isValidHex(hex: string, expectedLength: number): boolean {
  if (typeof hex !== "string" || hex.length !== expectedLength) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(hex);
}

/**
 * Convert hex string to bytes (assumes already validated)
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
