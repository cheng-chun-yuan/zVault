/**
 * Stealth Claim Preparation
 *
 * Prepares claim inputs for ZK proof generation.
 * Requires spending key for stealth private key derivation.
 */

import {
  grumpkinEcdh,
  pointMul,
  GRUMPKIN_GENERATOR,
  bigintToBytes,
} from "../crypto";
import type { ZVaultKeys, WalletSignerAdapter } from "../keys";
import { deriveKeysFromWallet } from "../keys";
import {
  computeNullifierSync as poseidonComputeNullifier,
  poseidonHashSync,
} from "../poseidon";
import { deriveStealthPrivKey } from "./derivation";
import type { ScannedNote, ClaimInputs } from "./types";
import { isWalletAdapter } from "./utils";

/**
 * Prepare claim inputs for ZK proof generation (EIP-5564/DKSAP pattern)
 *
 * CRITICAL: This function requires the spending private key.
 *
 * Derivation:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)  [already computed in scanning]
 * 2. stealthPriv = spendingPriv + hash(sharedSecret)
 * 3. nullifier = Poseidon(stealthPriv, leafIndex)
 *
 * Why sender cannot claim:
 * - Sender knows ephemeralPriv and can compute sharedSecret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Cannot derive stealthPriv without spendingPrivKey (ECDLP)
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param note - Scanned note from scanning phase
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir claim circuit
 */
export async function prepareClaimInputs(
  source: WalletSignerAdapter | ZVaultKeys,
  note: ScannedNote,
  merkleProof: {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
  }
): Promise<ClaimInputs> {
  // Get keys from source
  const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;

  // Recompute shared secret with viewing key
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, note.ephemeralPub);

  // Derive stealth private key (EIP-5564 pattern)
  // stealthPriv = spendingPriv + hash(sharedSecret)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // Verify stealth public key matches (sanity check)
  const expectedStealthPub = pointMul(stealthPrivKey, GRUMPKIN_GENERATOR);
  if (expectedStealthPub.x !== note.stealthPub.x || expectedStealthPub.y !== note.stealthPub.y) {
    throw new Error(
      "Stealth key mismatch - this note may not belong to you or the announcement is invalid"
    );
  }

  // CRITICAL: Nullifier from stealth private key + leaf index
  // nullifier = Poseidon(stealthPriv, leafIndex)
  // Only recipient can compute this!
  const nullifier = poseidonComputeNullifier(stealthPrivKey, BigInt(note.leafIndex));

  return {
    // Private inputs
    stealthPrivKey,
    amount: note.amount,
    leafIndex: note.leafIndex,
    merklePath: merkleProof.pathElements,
    merkleIndices: merkleProof.pathIndices,

    // Public inputs
    merkleRoot: merkleProof.root,
    nullifier,
    amountPub: note.amount,
  };
}

/**
 * Compute nullifier hash for a scanned note
 *
 * Used to check if a note has already been spent by looking up the
 * nullifier record PDA on-chain.
 *
 * Derivation:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPriv = spendingPriv + hash(sharedSecret)
 * 3. nullifier = Poseidon(stealthPriv, leafIndex)
 * 4. nullifierHash = Poseidon(nullifier)
 *
 * @param keys - Full ZVaultKeys (requires spending key)
 * @param note - Scanned note from scanning phase
 * @returns 32-byte nullifier hash for PDA lookup
 */
export function computeNullifierHashForNote(
  keys: ZVaultKeys,
  note: ScannedNote
): Uint8Array {
  // 1. Recompute shared secret (viewing key + ephemeral pub)
  const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, note.ephemeralPub);

  // 2. Derive stealth private key (spending key + shared secret)
  const stealthPrivKey = deriveStealthPrivKey(keys.spendingPrivKey, sharedSecret);

  // 3. Compute nullifier = Poseidon(stealthPriv, leafIndex)
  const nullifier = poseidonComputeNullifier(stealthPrivKey, BigInt(note.leafIndex));

  // 4. Hash nullifier for on-chain lookup
  const nullifierHash = poseidonHashSync([nullifier]);

  // 5. Convert to bytes for PDA derivation
  return bigintToBytes(nullifierHash);
}
