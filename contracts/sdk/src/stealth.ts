/**
 * Stealth address utilities for ZVault
 *
 * V1 (Legacy): Single X25519 ECDH for both viewing and spending
 * V2 (New): Dual-key ECDH with X25519 (viewing) + Grumpkin (spending)
 *
 * V2 Format (148 bytes on-chain):
 * - ephemeral_view_pub (32 bytes) - X25519 for off-chain scanning
 * - ephemeral_spend_pub (33 bytes) - Grumpkin for in-circuit ECDH
 * - encrypted_amount (8 bytes) - XOR encrypted with view shared secret
 * - encrypted_random (32 bytes) - for commitment reconstruction
 * - commitment (32 bytes) - Poseidon2 hash for Merkle tree
 *
 * Key Separation Properties:
 * - Viewing key can scan and decrypt but CANNOT derive nullifier
 * - Spending key required for nullifier derivation and proof generation
 * - Sender cannot spend (wrong ECDH → wrong commitment → not in tree)
 *
 * IMPORTANT: Noir circuits use Poseidon2 hashing which is not directly
 * available in this SDK. Hash values that must match circuits should be
 * computed via Noir circuit execution.
 */

import { scalarMult, box } from "tweetnacl";
import { convertSecretKey, convertPublicKey } from "ed2curve";
import { sha256 } from "@noble/hashes/sha256";
import { sha256Hash, bytesToBigint, bigintToBytes, BN254_FIELD_PRIME } from "./crypto";
import {
  generateKeyPair as generateGrumpkinKeyPair,
  ecdh as grumpkinEcdh,
  pointMul,
  scalarFromBytes,
  scalarToBytes,
  pointToCompressedBytes,
  pointFromCompressedBytes,
  GRUMPKIN_GENERATOR,
  type GrumpkinPoint,
} from "./grumpkin";
import type { StealthMetaAddress, ZVaultKeys } from "./keys";

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

// ========================================================================
// V2: Dual-Key ECDH (X25519 Viewing + Grumpkin Spending)
// ========================================================================

// ========== V2 Types ==========

/**
 * V2 Stealth Deposit with dual-key ECDH
 * Uses X25519 for fast off-chain scanning and Grumpkin for in-circuit spending proofs
 */
export interface StealthDepositV2 {
  /** X25519 ephemeral public key (32 bytes) - for viewing/scanning */
  ephemeralViewPub: Uint8Array;

  /** Grumpkin ephemeral public key (33 bytes compressed) - for spending proofs */
  ephemeralSpendPub: Uint8Array;

  /** XOR-encrypted amount (8 bytes) - decrypted with view shared secret */
  encryptedAmount: Uint8Array;

  /** XOR-encrypted random value (32 bytes) - for commitment reconstruction */
  encryptedRandom: Uint8Array;

  /** Commitment for Merkle tree (32 bytes) - Poseidon2(notePubKey, amount, random) */
  commitment: Uint8Array;

  /** Unix timestamp when created */
  createdAt: number;
}

/**
 * Scanned note from V2 announcement (viewing key can decrypt)
 */
export interface ScannedNoteV2 {
  /** Decrypted amount in satoshis */
  amount: bigint;

  /** Decrypted random value for commitment */
  random: bigint;

  /** Grumpkin ephemeral public key (needed for spending) */
  ephemeralSpendPub: GrumpkinPoint;

  /** Leaf index in Merkle tree */
  leafIndex: number;

  /** Original announcement commitment */
  commitment: Uint8Array;
}

/**
 * Prepared claim inputs for ZK proof (requires spending key)
 */
export interface ClaimInputsV2 {
  // Private inputs for ZK proof
  spendingPrivKey: bigint;
  ephemeralSpendPub: GrumpkinPoint;
  amount: bigint;
  random: bigint;
  leafIndex: number;
  merklePath: bigint[];
  merkleIndices: number[];

  // Public inputs
  merkleRoot: bigint;
  nullifierHash: bigint;
  amountPub: bigint;
}

// ========== V2 Domain Separators ==========

/** Domain separator for note public key derivation */
const DOMAIN_NPK = 0x6e706bn; // "npk" as field element

/** Domain separator for random value encryption */
const DOMAIN_RANDOM = "random";

// ========== V2 Sender Functions ==========

/**
 * Create a V2 stealth deposit with dual-key ECDH
 *
 * Generates two ephemeral keypairs:
 * - X25519: For viewing/scanning (fast off-chain ECDH)
 * - Grumpkin: For spending proofs (efficient in-circuit ECDH)
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amount - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export function createStealthDepositV2(
  recipientMeta: StealthMetaAddress,
  amount: bigint
): StealthDepositV2 {
  // Parse recipient's public keys
  const recipientViewPub = recipientMeta.viewingPubKey;
  const recipientSpendPub = pointFromCompressedBytes(recipientMeta.spendingPubKey);

  // Generate ephemeral X25519 keypair for viewing
  const ephemeralView = box.keyPair();
  const viewShared = scalarMult(ephemeralView.secretKey, recipientViewPub);

  // Generate ephemeral Grumpkin keypair for spending
  const ephemeralSpend = generateGrumpkinKeyPair();
  const spendShared = grumpkinEcdh(ephemeralSpend.privKey, recipientSpendPub);

  // Generate random value for commitment
  const random = randomFieldElement();
  const randomBytes = bigintToBytes(random);

  // Derive encryption key from view shared secret
  const encKey = sha256(viewShared);

  // Encrypt amount (first 8 bytes of encKey)
  const encryptedAmount = xorBytes(
    bigintToBytes8(amount),
    encKey.slice(0, 8)
  );

  // Encrypt random (next 32 bytes via additional hash)
  const randomEncKey = sha256(concatBytes(encKey, textToBytes(DOMAIN_RANDOM)));
  const encryptedRandom = xorBytes(randomBytes, randomEncKey);

  // Compute note public key from spend shared secret
  // notePubKey = H(spendShared.x, spendShared.y, DOMAIN_NPK)
  // NOTE: This should be Poseidon2 for circuit compatibility
  // For now, we use a placeholder - actual commitment computed by Noir
  const notePubKeyInput = concatBytes(
    bigintToBytes(spendShared.x),
    bigintToBytes(spendShared.y),
    bigintToBytes(BigInt(DOMAIN_NPK))
  );
  const notePubKeyPlaceholder = sha256(notePubKeyInput);

  // Compute commitment placeholder
  // commitment = H(notePubKey, amount, random)
  // NOTE: Actual Poseidon2 commitment computed by recipient via Noir
  const commitmentInput = concatBytes(
    notePubKeyPlaceholder,
    bigintToBytes(amount),
    randomBytes
  );
  const commitment = sha256(commitmentInput);

  return {
    ephemeralViewPub: ephemeralView.publicKey,
    ephemeralSpendPub: pointToCompressedBytes(ephemeralSpend.pubKey),
    encryptedAmount,
    encryptedRandom,
    commitment,
    createdAt: Date.now(),
  };
}

/**
 * Create V2 stealth deposit from ZVaultKeys
 */
export function createStealthDepositV2FromKeys(
  recipientKeys: ZVaultKeys,
  amount: bigint
): StealthDepositV2 {
  const meta: StealthMetaAddress = {
    spendingPubKey: pointToCompressedBytes(recipientKeys.spendingPubKey),
    viewingPubKey: recipientKeys.viewingPubKey,
  };
  return createStealthDepositV2(meta, amount);
}

// ========== V2 Recipient Scanning (Viewing Key Only) ==========

/**
 * Scan V2 announcements using viewing key only
 *
 * This function can decrypt amounts and random values but CANNOT:
 * - Derive the nullifier (requires spending key)
 * - Generate spending proofs
 *
 * @param viewingPrivKey - X25519 viewing private key
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes (ready for claim preparation)
 */
export function scanAnnouncementsV2(
  viewingPrivKey: Uint8Array,
  announcements: {
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    encryptedAmount: Uint8Array;
    encryptedRandom: Uint8Array;
    commitment: Uint8Array;
    leafIndex: number;
  }[]
): ScannedNoteV2[] {
  const found: ScannedNoteV2[] = [];
  const MAX_SATS = 21_000_000n * 100_000_000n; // 21M BTC in sats

  for (const ann of announcements) {
    try {
      // X25519 ECDH with viewing key
      const viewShared = scalarMult(viewingPrivKey, ann.ephemeralViewPub);

      // Derive encryption key
      const encKey = sha256(viewShared);

      // Decrypt amount
      const decryptedAmountBytes = xorBytes(
        ann.encryptedAmount,
        encKey.slice(0, 8)
      );
      const amount = bytes8ToBigint(decryptedAmountBytes);

      // Basic sanity check
      if (amount <= 0n || amount > MAX_SATS) {
        continue; // Probably not ours (garbage decryption)
      }

      // Decrypt random
      const randomEncKey = sha256(concatBytes(encKey, textToBytes(DOMAIN_RANDOM)));
      const decryptedRandomBytes = xorBytes(ann.encryptedRandom, randomEncKey);
      const random = bytesToBigint(decryptedRandomBytes) % BN254_FIELD_PRIME;

      // Parse ephemeral spend pubkey
      const ephemeralSpendPub = pointFromCompressedBytes(ann.ephemeralSpendPub);

      found.push({
        amount,
        random,
        ephemeralSpendPub,
        leafIndex: ann.leafIndex,
        commitment: ann.commitment,
      });
    } catch {
      // ECDH or parsing failed - not our note
      continue;
    }
  }

  return found;
}

/**
 * Scan V2 announcements using ZVaultKeys
 */
export function scanAnnouncementsV2WithKeys(
  keys: ZVaultKeys,
  announcements: {
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    encryptedAmount: Uint8Array;
    encryptedRandom: Uint8Array;
    commitment: Uint8Array;
    leafIndex: number;
  }[]
): ScannedNoteV2[] {
  return scanAnnouncementsV2(keys.viewingPrivKey, announcements);
}

// ========== V2 Claim Preparation (Spending Key Required) ==========

/**
 * Prepare claim inputs for ZK proof generation
 *
 * CRITICAL: This function requires the spending private key.
 * The nullifier is derived from (spendingPrivKey, leafIndex).
 * Only the legitimate recipient can compute a valid nullifier.
 *
 * Why sender cannot claim:
 * - Sender knows ephemeral_priv and shared_secret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Wrong spendingPrivKey → wrong ECDH → wrong commitment → not in tree
 *
 * @param spendingPrivKey - Grumpkin spending private key
 * @param note - Scanned note from scanning phase
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir claim_v2 circuit
 */
export function prepareClaimInputsV2(
  spendingPrivKey: bigint,
  note: ScannedNoteV2,
  merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
  }
): ClaimInputsV2 {
  // Grumpkin ECDH with spending key
  const spendShared = grumpkinEcdh(spendingPrivKey, note.ephemeralSpendPub);

  // Derive note public key (same as sender computed)
  // notePubKey = Poseidon2(spendShared.x, spendShared.y, DOMAIN_NPK)
  // This will be verified inside the circuit

  // CRITICAL: Nullifier from spending private key + leaf index
  // nullifier = Poseidon2(spendingPrivKey, leafIndex)
  // Only recipient can compute this!
  const nullifierInput = concatBytes(
    scalarToBytes(spendingPrivKey),
    bigintToBytes(BigInt(note.leafIndex))
  );
  // NOTE: Actual Poseidon2 computed in Noir circuit
  // This is a placeholder for the hash
  const nullifierPlaceholder = sha256(nullifierInput);
  const nullifier = bytesToBigint(nullifierPlaceholder) % BN254_FIELD_PRIME;

  // Nullifier hash (double hash for public input)
  const nullifierHashPlaceholder = sha256(nullifierPlaceholder);
  const nullifierHash = bytesToBigint(nullifierHashPlaceholder) % BN254_FIELD_PRIME;

  return {
    // Private inputs
    spendingPrivKey,
    ephemeralSpendPub: note.ephemeralSpendPub,
    amount: note.amount,
    random: note.random,
    leafIndex: note.leafIndex,
    merklePath: merkleProof.pathElements,
    merkleIndices: merkleProof.pathIndices,

    // Public inputs
    merkleRoot: merkleProof.root,
    nullifierHash,
    amountPub: note.amount,
  };
}

/**
 * Prepare claim inputs using ZVaultKeys
 */
export function prepareClaimInputsV2WithKeys(
  keys: ZVaultKeys,
  note: ScannedNoteV2,
  merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
  }
): ClaimInputsV2 {
  return prepareClaimInputsV2(keys.spendingPrivKey, note, merkleProof);
}

// ========== V2 Utilities ==========

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBigint(bytes) % BN254_FIELD_PRIME;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
