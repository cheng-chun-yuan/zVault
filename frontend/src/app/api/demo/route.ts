import { NextRequest, NextResponse } from "next/server";
import {
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  buildAddDemoNoteTransaction,
  buildAddDemoStealthTransaction,
} from "@/lib/solana/demo-instructions";
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
  } catch (error) {
    console.error("[Demo API] Failed to parse ADMIN_KEYPAIR:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, secret, ephemeralPub, commitment, encryptedAmount } = body;

    // Validate type
    if (!type || !["note", "stealth"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Invalid type. Must be 'note' or 'stealth'" },
        { status: 400 }
      );
    }

    // Validate note mode params
    if (type === "note") {
      if (!secret || typeof secret !== "string" || secret.length !== 64) {
        return NextResponse.json(
          { success: false, error: "Invalid secret. Must be 64 hex characters (32 bytes)" },
          { status: 400 }
        );
      }
    }

    // Validate stealth mode params
    if (type === "stealth") {
      if (!ephemeralPub || typeof ephemeralPub !== "string" || ephemeralPub.length !== 66) {
        return NextResponse.json(
          { success: false, error: "Invalid ephemeralPub. Must be 66 hex characters (33 bytes)" },
          { status: 400 }
        );
      }
      if (!commitment || typeof commitment !== "string" || commitment.length !== 64) {
        return NextResponse.json(
          { success: false, error: "Invalid commitment. Must be 64 hex characters (32 bytes)" },
          { status: 400 }
        );
      }
      if (!encryptedAmount || typeof encryptedAmount !== "string" || encryptedAmount.length !== 16) {
        return NextResponse.json(
          { success: false, error: "Invalid encryptedAmount. Must be 16 hex characters (8 bytes)" },
          { status: 400 }
        );
      }
    }

    console.log(`[Demo API] Processing ${type} deposit...`);

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

    // Build transaction based on type
    let tx;
    if (type === "note") {
      // Convert hex secret to bytes
      const secretBytes = hexToBytes(secret);
      tx = await buildAddDemoNoteTransaction(connection, {
        payer: admin.publicKey,
        secret: secretBytes,
      });
    } else {
      // Stealth mode
      const ephemeralPubBytes = hexToBytes(ephemeralPub);
      const commitmentBytes = hexToBytes(commitment);
      const encryptedAmountBytes = hexToBytes(encryptedAmount);
      tx = await buildAddDemoStealthTransaction(connection, {
        payer: admin.publicKey,
        ephemeralPub: ephemeralPubBytes,
        commitment: commitmentBytes,
        encryptedAmount: encryptedAmountBytes,
      });
    }

    // Sign and send transaction with admin keypair
    try {
      const signature = await sendAndConfirmTransaction(connection, tx, [admin], {
        commitment: "confirmed",
      });

      console.log("[Demo API] Transaction confirmed:", signature);

      return NextResponse.json({
        success: true,
        type,
        signature,
        message: `Demo ${type} deposit added on-chain`,
      });
    } catch (txError: unknown) {
      console.error("[Demo API] Transaction failed:", txError);
      const errorMessage = txError instanceof Error ? txError.message : "Transaction failed";

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Demo API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

// Convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
