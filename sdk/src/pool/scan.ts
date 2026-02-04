/**
 * Yield Pool Scanning Functions
 *
 * Functions for scanning stealth pool announcements using viewing key.
 */

import {
  bytesToBigint,
  grumpkinEcdh,
  pointFromCompressedBytes,
} from "../crypto";
import { poseidonHashSync } from "../poseidon";
import type { ZVaultKeys } from "../keys";
import type { ScannedPoolPosition, OnChainStealthPoolAnnouncement } from "./types";
import { deriveStealthPubKey } from "./stealth";

/**
 * Scan stealth pool announcements using viewing key
 *
 * For each announcement:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. Verify: commitment == Poseidon(stealthPub.x, principal, depositEpoch)
 *
 * This can DETECT positions but CANNOT derive stealthPriv for spending.
 *
 * @param keys - User's ZVaultKeys (needs viewing key)
 * @param announcements - Array of on-chain announcements
 * @returns Array of positions belonging to this user
 */
export function scanPoolAnnouncements(
  keys: ZVaultKeys,
  announcements: OnChainStealthPoolAnnouncement[]
): ScannedPoolPosition[] {
  const found: ScannedPoolPosition[] = [];

  for (const ann of announcements) {
    try {
      // Parse ephemeral pubkey
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, ephemeralPub);

      // Derive stealth public key
      const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

      // Compute expected commitment
      const expectedCommitment = poseidonHashSync([
        stealthPub.x,
        ann.principal,
        ann.depositEpoch,
      ]);
      const actualCommitment = bytesToBigint(ann.poolCommitment);

      if (expectedCommitment !== actualCommitment) {
        // Not for us
        continue;
      }

      // This position belongs to us!
      found.push({
        poolId: ann.poolId,
        ephemeralPub,
        principal: ann.principal,
        depositEpoch: ann.depositEpoch,
        stealthPub,
        commitment: ann.poolCommitment,
        leafIndex: ann.leafIndex,
        createdAt: ann.createdAt,
      });
    } catch {
      // Skip invalid announcements
      continue;
    }
  }

  return found;
}
