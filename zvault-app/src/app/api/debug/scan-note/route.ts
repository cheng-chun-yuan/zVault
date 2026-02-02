import { NextRequest, NextResponse } from "next/server";
import {
  initPoseidon,
  poseidonHashSync,
  pointFromCompressedBytes,
  grumpkinEcdh,
  pointMul,
  pointAdd,
  GRUMPKIN_GENERATOR,
  decryptAmount,
  hexToBytes,
  bytesToBigint,
} from "@zvault/sdk";
import { sha256 } from "@noble/hashes/sha2.js";

export const runtime = "nodejs";

// Domain separator for stealth key derivation (must match SDK)
const STEALTH_KEY_DOMAIN = new TextEncoder().encode("zVault-stealth-v1");

function scalarFromBytes(bytes: Uint8Array): bigint {
  const GRUMPKIN_ORDER = 21888242871839275222246405745257275088614511777268538073601725287587578984328n;
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result % GRUMPKIN_ORDER;
}

function pointToCompressedBytes(point: { x: bigint; y: bigint }): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes[0] = point.y % 2n === 0n ? 0x02 : 0x03;
  const xBytes = new Uint8Array(32);
  let x = point.x;
  for (let i = 31; i >= 0; i--) {
    xBytes[i] = Number(x & 0xffn);
    x = x >> 8n;
  }
  bytes.set(xBytes, 1);
  return bytes;
}

/**
 * Debug endpoint to trace stealth scanning and commitment derivation
 *
 * POST /api/debug/scan-note
 * Body: {
 *   spendingPubKeyX: string (hex),
 *   spendingPubKeyY: string (hex),
 *   viewingPrivKey: string (hex),
 *   ephemeralPub: string (hex, compressed 33 bytes),
 *   encryptedAmount: string (hex, 8 bytes),
 *   storedCommitment: string (hex, 32 bytes)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      spendingPubKeyX,
      spendingPubKeyY,
      viewingPrivKey,
      ephemeralPub,
      encryptedAmount,
      storedCommitment,
    } = body;

    await initPoseidon();

    console.log("\n[Debug ScanNote] ===== STEALTH SCAN DEBUG =====");
    console.log("[Debug ScanNote] Input values:");
    console.log("  spendingPubKeyX:", spendingPubKeyX);
    console.log("  spendingPubKeyY:", spendingPubKeyY);
    console.log("  viewingPrivKey:", viewingPrivKey?.slice(0, 16) + "...");
    console.log("  ephemeralPub:", ephemeralPub);
    console.log("  encryptedAmount:", encryptedAmount);
    console.log("  storedCommitment:", storedCommitment);

    // Parse inputs
    const spendingPubKey = {
      x: BigInt("0x" + spendingPubKeyX),
      y: BigInt("0x" + spendingPubKeyY),
    };
    const viewingPriv = BigInt("0x" + viewingPrivKey);
    const ephemeralPubBytes = hexToBytes(ephemeralPub);
    const encryptedAmountBytes = hexToBytes(encryptedAmount);
    const storedCommitmentBigint = BigInt("0x" + storedCommitment);

    // Step 1: Parse ephemeral pubkey
    console.log("\n[Debug ScanNote] Step 1: Parse ephemeral pubkey");
    const ephemeralPubPoint = pointFromCompressedBytes(ephemeralPubBytes);
    console.log("  ephemeralPub.x:", ephemeralPubPoint.x.toString(16).slice(0, 16) + "...");
    console.log("  ephemeralPub.y:", ephemeralPubPoint.y.toString(16).slice(0, 16) + "...");

    // Step 2: Compute shared secret
    console.log("\n[Debug ScanNote] Step 2: Compute shared secret (ECDH)");
    const sharedSecret = grumpkinEcdh(viewingPriv, ephemeralPubPoint);
    console.log("  sharedSecret.x:", sharedSecret.x.toString(16).slice(0, 16) + "...");
    console.log("  sharedSecret.y:", sharedSecret.y.toString(16).slice(0, 16) + "...");

    // Step 3: Decrypt amount
    console.log("\n[Debug ScanNote] Step 3: Decrypt amount");
    const decryptedAmount = decryptAmount(encryptedAmountBytes, sharedSecret);
    console.log("  decrypted amount:", decryptedAmount.toString(), "sats");

    // Step 4: Derive stealth scalar (must match SDK's deriveStealthScalar)
    console.log("\n[Debug ScanNote] Step 4: Derive stealth scalar");
    const sharedBytes = pointToCompressedBytes(sharedSecret);
    const hashInput = new Uint8Array(sharedBytes.length + STEALTH_KEY_DOMAIN.length);
    hashInput.set(sharedBytes, 0);
    hashInput.set(STEALTH_KEY_DOMAIN, sharedBytes.length);
    const hash = sha256(hashInput);
    const stealthScalar = scalarFromBytes(hash);
    console.log("  stealth scalar:", stealthScalar.toString(16).slice(0, 16) + "...");

    // Step 5: Derive stealth public key
    console.log("\n[Debug ScanNote] Step 5: Derive stealth public key");
    const scalarPoint = pointMul(stealthScalar, GRUMPKIN_GENERATOR);
    const stealthPub = pointAdd(spendingPubKey, scalarPoint);
    console.log("  stealthPub.x:", stealthPub.x.toString(16).padStart(64, "0"));
    console.log("  stealthPub.y:", stealthPub.y.toString(16).slice(0, 16) + "...");

    // Step 6: Compute commitment
    console.log("\n[Debug ScanNote] Step 6: Compute commitment");
    const computedCommitment = poseidonHashSync([stealthPub.x, decryptedAmount]);
    const computedCommitmentHex = computedCommitment.toString(16).padStart(64, "0");
    console.log("  computed commitment:", computedCommitmentHex);
    console.log("  stored commitment:  ", storedCommitment);
    console.log("  MATCH:", computedCommitmentHex.toLowerCase() === storedCommitment.toLowerCase());

    console.log("\n[Debug ScanNote] ===== END DEBUG =====\n");

    return NextResponse.json({
      success: true,
      steps: {
        ephemeralPub: {
          x: ephemeralPubPoint.x.toString(16),
          y: ephemeralPubPoint.y.toString(16),
        },
        sharedSecret: {
          x: sharedSecret.x.toString(16),
          y: sharedSecret.y.toString(16),
        },
        decryptedAmount: decryptedAmount.toString(),
        stealthScalar: stealthScalar.toString(16),
        stealthPub: {
          x: stealthPub.x.toString(16).padStart(64, "0"),
          y: stealthPub.y.toString(16),
        },
        computedCommitment: computedCommitmentHex,
        storedCommitment: storedCommitment,
        match: computedCommitmentHex.toLowerCase() === storedCommitment.toLowerCase(),
      },
    });
  } catch (error) {
    console.error("[Debug ScanNote] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
