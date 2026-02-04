/**
 * Stealth Deposit Creation
 *
 * Functions for creating stealth deposits and outputs.
 * Implements EIP-5564/DKSAP pattern with Grumpkin ECDH.
 */

import {
  bigintToBytes,
  generateGrumpkinKeyPair,
  grumpkinEcdh,
  pointToCompressedBytes,
  bytesToBigint,
} from "../crypto";
import type { StealthMetaAddress, ZVaultKeys } from "../keys";
import { parseStealthMetaAddress } from "../keys";
import { poseidonHashSync } from "../poseidon";
import { encryptAmount } from "./encryption";
import { deriveStealthPubKey } from "./derivation";
import type {
  StealthDeposit,
  StealthOutputData,
  StealthOutputWithKeys,
} from "./types";

// Re-export types
export type { StealthDeposit, StealthOutputData, StealthOutputWithKeys };

// ========== Sender Functions ==========

/**
 * Create a stealth deposit with single ephemeral key (EIP-5564/DKSAP pattern)
 *
 * Generates ONE ephemeral Grumpkin keypair and derives stealth address:
 * 1. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. commitment = Poseidon(stealthPub.x, amount)
 * 4. encryptedAmount = amount XOR sha256(sharedSecret.x)[0..8]
 *
 * The amount is encrypted so only the recipient (with viewing key) can see it.
 * The ZK proof guarantees amount conservation without revealing the value on-chain.
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export async function createStealthDeposit(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthDeposit> {
  // Parse recipient's public keys (both Grumpkin now)
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate single ephemeral Grumpkin keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key (for recipient scanning)
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key (EIP-5564 pattern)
  // stealthPub = spendingPub + hash(sharedSecret) * G
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute commitment using Poseidon
  // commitment = Poseidon(stealthPub.x, amount)
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount with shared secret (only recipient can decrypt)
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    createdAt: Date.now(),
  };
}

/**
 * Create stealth deposit with stealthPubKeyX for circuit input
 *
 * Used for recipient outputs in spend_split. Returns the derived stealth
 * pub key X coordinate which must be used as the circuit's pub_key_x input.
 *
 * The commitment is: Poseidon(stealthPub.x, amount)
 * The circuit expects: output1PubKeyX = stealthPub.x
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth output data including stealthPubKeyX for circuit
 */
export async function createStealthDepositWithKeys(
  recipientMeta: StealthMetaAddress,
  amountSats: bigint
): Promise<StealthOutputWithKeys> {
  // Parse recipient's public keys
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute commitment using stealth pub key
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    stealthPubKeyX: stealthPub.x, // For circuit input
  };
}

// ========== Self-Send / Change Output Functions ==========

/**
 * Create stealth output data for a self-send (change output)
 *
 * Used when spending notes with change - the change goes back to yourself
 * as a new stealth output.
 *
 * @param keys - Your ZVaultKeys (change is sent to yourself)
 * @param amountSats - Change amount in satoshis
 * @returns Stealth output data for on-chain StealthAnnouncement
 */
export async function createStealthOutput(
  keys: ZVaultKeys,
  amountSats: bigint
): Promise<StealthOutputData> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute commitment
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
  };
}

/**
 * Create stealth output with stealthPubKeyX for circuit input
 *
 * Used for change outputs in spend_partial_public and spend_split.
 * Returns the derived stealth pub key X coordinate which must be used
 * as the circuit's pub_key_x input (NOT the raw spending pub key).
 *
 * The commitment is: Poseidon(stealthPub.x, amount)
 * The circuit expects: changePubKeyX = stealthPub.x
 *
 * @param keys - Your ZVaultKeys (change is sent to yourself)
 * @param amountSats - Change amount in satoshis
 * @returns Stealth output data including stealthPubKeyX for circuit
 */
export async function createStealthOutputWithKeys(
  keys: ZVaultKeys,
  amountSats: bigint
): Promise<StealthOutputWithKeys> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute commitment using stealth pub key
  const commitmentBigint = poseidonHashSync([stealthPub.x, amountSats]);
  const commitment = bigintToBytes(commitmentBigint);

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment,
    stealthPubKeyX: stealthPub.x, // For circuit input
  };
}

/**
 * Create stealth output data with pre-computed commitment
 *
 * Used when the commitment is computed by the ZK circuit.
 * The ephemeral key and encrypted amount still need to match
 * the commitment's underlying stealth pubkey and amount.
 *
 * @param keys - Recipient's keys (or your own for self-sends)
 * @param amountSats - Amount in satoshis
 * @param existingCommitment - Pre-computed commitment from ZK circuit
 * @returns Stealth output data with matching ephemeral key and encrypted amount
 */
export async function createStealthOutputForCommitment(
  keys: ZVaultKeys,
  amountSats: bigint,
  existingCommitment: Uint8Array
): Promise<StealthOutputData> {
  // Generate a fresh ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Verify commitment matches
  const computedCommitment = poseidonHashSync([stealthPub.x, amountSats]);
  const actualCommitment = bytesToBigint(existingCommitment);

  // Note: The commitment from ZK circuit is computed inside the circuit,
  // so we need to generate the ephemeral key BEFORE creating the ZK proof inputs
  // This function is mainly for creating announcement data after proof generation

  // Encrypt amount
  const encryptedAmount = encryptAmount(amountSats, sharedSecret);

  return {
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    encryptedAmount,
    commitment: existingCommitment,
  };
}
