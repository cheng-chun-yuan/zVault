/**
 * Yield Pool Deposit Functions
 *
 * Functions for creating stealth pool deposits.
 */

import {
  bigintToBytes,
  generateGrumpkinKeyPair,
  grumpkinEcdh,
  pointToCompressedBytes,
} from "../crypto";
import { poseidonHashSync } from "../poseidon";
import type { ZVaultKeys, StealthMetaAddress } from "../keys";
import { parseStealthMetaAddress } from "../keys";
import type { StealthPoolPosition } from "./types";
import { deriveStealthPubKey } from "./stealth";

/**
 * Create a stealth pool deposit for a recipient
 *
 * Uses EIP-5564/DKSAP pattern:
 * 1. Generate ephemeral Grumpkin keypair
 * 2. sharedSecret = ECDH(ephemeral.priv, recipientViewingPub)
 * 3. stealthPub = spendingPub + hash(sharedSecret) * G
 * 4. commitment = Poseidon(stealthPub.x, principal, depositEpoch)
 *
 * @param recipientMeta - Recipient's stealth meta-address (spending + viewing pubkeys)
 * @param principal - Amount to deposit in satoshis
 * @param depositEpoch - Current epoch at deposit time
 * @param poolId - Pool identifier
 * @returns Stealth pool position ready for on-chain announcement
 */
export function createStealthPoolDeposit(
  recipientMeta: StealthMetaAddress,
  principal: bigint,
  depositEpoch: bigint,
  poolId: Uint8Array
): Omit<StealthPoolPosition, "leafIndex"> & { ephemeralPriv: bigint } {
  // Parse recipient's public keys
  const { spendingPubKey, viewingPubKey } = parseStealthMetaAddress(recipientMeta);

  // Generate ephemeral Grumpkin keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with viewing key (for recipient scanning)
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(spendingPubKey, sharedSecret);

  // Compute pool commitment: Poseidon(stealthPub.x, principal, depositEpoch)
  const commitment = poseidonHashSync([stealthPub.x, principal, depositEpoch]);

  return {
    poolId,
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    ephemeralPriv: ephemeral.privKey, // Keep this for testing, don't store!
    principal,
    depositEpoch,
    stealthPub,
    commitment,
    commitmentBytes: bigintToBytes(commitment),
  };
}

/**
 * Create self-deposit (depositing to own stealth address)
 *
 * Same as createStealthPoolDeposit but uses own keys.
 */
export function createSelfStealthPoolDeposit(
  keys: ZVaultKeys,
  principal: bigint,
  depositEpoch: bigint,
  poolId: Uint8Array
): Omit<StealthPoolPosition, "leafIndex"> & { ephemeralPriv: bigint } {
  // Generate ephemeral keypair
  const ephemeral = generateGrumpkinKeyPair();

  // Compute shared secret with own viewing key
  const sharedSecret = grumpkinEcdh(ephemeral.privKey, keys.viewingPubKey);

  // Derive stealth public key
  const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

  // Compute pool commitment
  const commitment = poseidonHashSync([stealthPub.x, principal, depositEpoch]);

  return {
    poolId,
    ephemeralPub: pointToCompressedBytes(ephemeral.pubKey),
    ephemeralPriv: ephemeral.privKey,
    principal,
    depositEpoch,
    stealthPub,
    commitment,
    commitmentBytes: bigintToBytes(commitment),
  };
}
