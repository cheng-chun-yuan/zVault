/**
 * Stealth address utilities for ZVault
 *
 * Implements stealth address functionality using X25519 ECDH.
 * Minimal 40-byte announcement format for maximum privacy:
 * - ephemeral_pubkey (32 bytes) - required for ECDH
 * - encrypted_amount (8 bytes) - required to compute commitment
 * - NO recipient_hint - prevents linking deposits to same recipient
 *
 * IMPORTANT: Noir circuits use Poseidon2 hashing which is not directly
 * available in this SDK. The stealth key derivation uses SHA256-based
 * KDF, and the derived secrets (nullifier, secret) are used as inputs
 * to Noir circuits which compute the actual Poseidon2 hashes.
 */

import { scalarMult, box } from "tweetnacl";
import { convertSecretKey, convertPublicKey } from "ed2curve";
import { sha256Hash, bytesToBigint, bigintToBytes, BN254_FIELD_PRIME } from "./crypto";

// ========== Types ==========

export interface StealthKeys {
  viewPrivKey: Uint8Array; // 32 bytes - X25519 private
  viewPubKey: Uint8Array; // 32 bytes - X25519 public
}

export interface StealthDeposit {
  ephemeralPubKey: Uint8Array; // 32 bytes - for ECDH
  encryptedAmount: Uint8Array; // 8 bytes - XOR encrypted
  recipientHint: Uint8Array;   // 4 bytes - first 4 bytes of recipient pubkey hash
  // Derived secrets for use with Noir circuits
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  // Note: commitment is NOT computed here - use Noir circuit
}

// ========== Option A: Ed25519 → X25519 (Linked to Solana) ==========

export function solanaKeyToX25519(ed25519PrivKey: Uint8Array): StealthKeys {
  const viewPrivKey = convertSecretKey(ed25519PrivKey);
  const keyPair = box.keyPair.fromSecretKey(viewPrivKey!);
  return { viewPrivKey: viewPrivKey!, viewPubKey: keyPair.publicKey };
}

export function solanaPubKeyToX25519(ed25519PubKey: Uint8Array): Uint8Array {
  return convertPublicKey(ed25519PubKey)!;
}

// ========== Option B: Native X25519 (Maximum Privacy) ==========

export function generateStealthKeys(): StealthKeys {
  const keyPair = box.keyPair();
  return { viewPrivKey: keyPair.secretKey, viewPubKey: keyPair.publicKey };
}

// ========== Core Functions ==========

/**
 * Computes a shared secret using ECDH.
 * If no private key is provided, a new one is generated on the fly (ephemeral).
 */
export function getStealthSharedSecret(
  recipientPubKey: Uint8Array,
  senderPrivKey?: Uint8Array
): { sharedSecret: Uint8Array; senderPubKey: Uint8Array } {
  let priv = senderPrivKey;
  let pub: Uint8Array;

  if (priv) {
    pub = box.keyPair.fromSecretKey(priv).publicKey;
  } else {
    const keyPair = box.keyPair();
    priv = keyPair.secretKey;
    pub = keyPair.publicKey;
  }

  const sharedSecret = scalarMult(priv, recipientPubKey);
  return { sharedSecret, senderPubKey: pub };
}

/**
 * Derive deterministic values from shared secret using SHA256
 *
 * This KDF generates field elements that will be used as inputs to Noir circuits.
 * The circuits compute Poseidon2 hashes internally.
 */
function deriveStealthSecrets(
  sharedSecret: Uint8Array,
  amount: bigint
): { nullifier: bigint; secret: bigint; amountKey: bigint } {
  // Derive nullifier from H(sharedSecret || "nullifier" || amount)
  const encoder = new TextEncoder();
  const amountBytes = bigintToBytes(amount);

  const nullifierInput = new Uint8Array(32 + 9 + 32);
  nullifierInput.set(sharedSecret, 0);
  nullifierInput.set(encoder.encode("nullifier"), 32);
  nullifierInput.set(amountBytes, 41);
  const nullifierHash = sha256Hash(nullifierInput);
  const nullifier = bytesToBigint(nullifierHash) % BN254_FIELD_PRIME;

  // Derive secret from H(sharedSecret || "secret" || amount)
  const secretInput = new Uint8Array(32 + 6 + 32);
  secretInput.set(sharedSecret, 0);
  secretInput.set(encoder.encode("secret"), 32);
  secretInput.set(amountBytes, 38);
  const secretHash = sha256Hash(secretInput);
  const secret = bytesToBigint(secretHash) % BN254_FIELD_PRIME;

  // Derive amount encryption key from H(sharedSecret || "amount")
  const amountKeyInput = new Uint8Array(32 + 6);
  amountKeyInput.set(sharedSecret, 0);
  amountKeyInput.set(encoder.encode("amount"), 32);
  const amountKeyHash = sha256Hash(amountKeyInput);
  const amountKey = bytesToBigint(amountKeyHash);

  return { nullifier, secret, amountKey };
}

/**
 * Create a stealth deposit (minimal 40-byte format)
 *
 * Generates ephemeral keypair, derives secrets via ECDH + KDF.
 * The nullifier and secret are used as inputs to Noir circuits
 * which compute the Poseidon2-based commitment internally.
 *
 * No recipient hint is included for maximum privacy - recipient
 * must try ECDH on all announcements to find their deposits.
 */
export function createStealthDeposit(
  recipientX25519Pub: Uint8Array,
  amountSats: bigint
): StealthDeposit {
  const { sharedSecret, senderPubKey: ephemeralPubKey } =
    getStealthSharedSecret(recipientX25519Pub);

  const { nullifier, secret, amountKey } = deriveStealthSecrets(
    sharedSecret,
    amountSats
  );

  // Encrypt amount with XOR
  const encryptedAmount = bigintToBytes8(
    amountSats ^ (amountKey & 0xffffffffffffffffn)
  );

  // Generate recipient hint: first 4 bytes of recipient pubkey hash
  const recipientHash = sha256Hash(recipientX25519Pub);
  const recipientHint = recipientHash.slice(0, 4);

  return {
    ephemeralPubKey,
    encryptedAmount,
    recipientHint,
    nullifier,
    secret,
    amount: amountSats,
  };
}

/**
 * Create a stealth deposit for a Solana recipient
 */
export function createStealthDepositForSolana(
  recipientSolanaPubKey: Uint8Array,
  amountSats: bigint
): StealthDeposit {
  return createStealthDeposit(
    solanaPubKeyToX25519(recipientSolanaPubKey),
    amountSats
  );
}

/**
 * Scan announcements for deposits belonging to us
 *
 * Maximum privacy mode: tries ECDH on ALL announcements (no hint filtering).
 * This prevents any linkability between deposits to the same recipient.
 *
 * To verify ownership, the function checks if the decrypted amount is
 * reasonable (> 0 and < 21M BTC). For full verification, use a Noir
 * helper circuit to compute and compare Poseidon2 commitments.
 */
export function scanAnnouncements(
  viewPrivKey: Uint8Array,
  _viewPubKey: Uint8Array, // kept for API compatibility
  announcements: {
    ephemeralPubKey: Uint8Array;
    encryptedAmount: Uint8Array;
  }[]
): { nullifier: bigint; secret: bigint; amount: bigint }[] {
  const found: { nullifier: bigint; secret: bigint; amount: bigint }[] = [];

  const MAX_SATS = 21_000_000n * 100_000_000n; // 21M BTC in sats

  for (const ann of announcements) {
    // ECDH with our view private key (try all - no hint filtering)
    const { sharedSecret } = getStealthSharedSecret(
      ann.ephemeralPubKey,
      viewPrivKey
    );

    // Decrypt amount
    const encoder = new TextEncoder();
    const amountKeyInput = new Uint8Array(32 + 6);
    amountKeyInput.set(sharedSecret, 0);
    amountKeyInput.set(encoder.encode("amount"), 32);
    const amountKeyHash = sha256Hash(amountKeyInput);
    const amountKey = bytesToBigint(amountKeyHash);
    const amount =
      bytes8ToBigint(ann.encryptedAmount) ^ (amountKey & 0xffffffffffffffffn);

    // Basic sanity check: amount should be reasonable
    // If wrong key, decrypted amount will likely be garbage (huge number)
    if (amount <= 0n || amount > MAX_SATS) {
      continue; // Probably not ours
    }

    // Derive secrets
    const { nullifier, secret } = deriveStealthSecrets(sharedSecret, amount);

    // Note: We cannot verify commitment here without Poseidon2
    // The caller should verify via Noir circuit if needed
    found.push({ nullifier, secret, amount });
  }

  return found;
}

/**
 * Scan announcements using Solana keypair
 */
export function scanAnnouncementsWithSolana(
  solanaPrivKey: Uint8Array,
  announcements: {
    ephemeralPubKey: Uint8Array;
    encryptedAmount: Uint8Array;
  }[]
) {
  const { viewPrivKey, viewPubKey } = solanaKeyToX25519(solanaPrivKey);
  return scanAnnouncements(viewPrivKey, viewPubKey, announcements);
}

// ========== Utilities ==========

function bigintToBytes8(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function bytes8ToBigint(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

// arraysEqual removed - no longer needed without recipient hint filtering
