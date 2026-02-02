/**
 * Stealth Announcement Scanning
 *
 * Scanning functions for detecting stealth deposits using viewing keys.
 * Supports full key scanning and view-only scanning for portfolio tracking.
 */

import {
  pointFromCompressedBytes,
  pointToCompressedBytes,
  bytesToBigint,
  grumpkinEcdh,
} from "../crypto";
import type { ZVaultKeys, WalletSignerAdapter } from "../keys";
import { deriveKeysFromWallet, constantTimeCompare } from "../keys";
import { lookupZkeyName, type ZkeyStealthAddress } from "../name-registry";
import { poseidonHashSync } from "../poseidon";
import { decryptAmount } from "./encryption";
import { deriveStealthPubKey } from "./derivation";
import type {
  ScannedNote,
  ViewOnlyKeys,
  ViewOnlyScannedNote,
  ConnectionAdapter,
  AnnouncementScanFormat,
} from "./types";
import { isWalletAdapter } from "./utils";

// Re-export types and constants from types.ts
export {
  STEALTH_ANNOUNCEMENT_SIZE,
  STEALTH_ANNOUNCEMENT_DISCRIMINATOR,
  type ScannedNote,
  type ClaimInputs,
  type OnChainStealthAnnouncement,
  type ViewOnlyKeys,
  type ViewOnlyScannedNote,
  type ConnectionAdapter,
  type StealthDeposit,
  type StealthOutputData,
  type StealthOutputWithKeys,
  type CircuitStealthOutput,
  type AnnouncementScanFormat,
} from "./types";

// Re-export encryption functions
export { encryptAmount, decryptAmount } from "./encryption";

// Re-export parsing functions
export {
  parseStealthAnnouncement,
  announcementToScanFormat,
  extractYSign,
  extractX,
  packEncryptedAmountWithSign,
  unpackEncryptedAmountWithSign,
  reconstructCompressedPub,
  packStealthOutputForCircuit,
} from "./parse";

// Re-export derivation functions
export {
  deriveStealthScalar,
  deriveStealthPubKey,
  deriveStealthPrivKey,
} from "./derivation";

// Re-export PDA functions
export {
  deriveStealthAnnouncementPda,
  deriveNullifierPda,
  deriveCommitmentPda,
  computeNullifierHash,
} from "./pda";

// Re-export claim functions
export {
  prepareClaimInputs,
  computeNullifierHashForNote,
} from "./claim";

// Re-export utility functions
export { isWalletAdapter } from "./utils";

// ========== Recipient Scanning (Viewing Key Only) ==========

/**
 * Scan announcements using viewing key only (EIP-5564/DKSAP pattern)
 *
 * For each announcement, computes:
 * 1. sharedSecret = ECDH(viewingPriv, ephemeralPub)
 * 2. amount = decrypt(encryptedAmount, sharedSecret)
 * 3. stealthPub = spendingPub + hash(sharedSecret) * G
 * 4. Verifies: commitment == Poseidon(stealthPub.x, amount)
 *
 * KEY PRIVACY FEATURE: The viewing key can:
 * - Decrypt the amount (only you can see how much was sent)
 * - Detect which deposits are for you
 * - View your balance without spending capability
 *
 * The viewing key CANNOT:
 * - Derive stealthPriv (requires spending key)
 * - Generate nullifier or spending proofs
 * - Spend your funds
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements (with encrypted amounts)
 * @returns Array of found notes with decrypted amounts
 */
export async function scanAnnouncements(
  source: WalletSignerAdapter | ZVaultKeys,
  announcements: AnnouncementScanFormat[]
): Promise<ScannedNote[]> {
  // Get keys from source
  const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;

  const found: ScannedNote[] = [];
  const MAX_SATS = 21_000_000n * 100_000_000n; // 21M BTC in sats

  for (const ann of announcements) {
    try {
      // Parse ephemeral pubkey
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(keys.viewingPrivKey, ephemeralPub);

      // Decrypt amount using shared secret (only viewing key holder can do this!)
      const amount = decryptAmount(ann.encryptedAmount, sharedSecret);

      // Basic sanity check on decrypted amount
      if (amount <= 0n || amount > MAX_SATS) {
        continue;
      }

      // Derive stealth public key
      const stealthPub = deriveStealthPubKey(keys.spendingPubKey, sharedSecret);

      // Verify commitment matches decrypted amount
      // Try standard stealth commitment first: Poseidon(stealthPub.x, amount)
      const expectedCommitmentStealth = poseidonHashSync([stealthPub.x, amount]);
      const actualCommitment = bytesToBigint(ann.commitment);

      // Also try raw commitment for change outputs from current circuit
      // The circuit computes: Poseidon(rawSpendingPub.x, amount) for change outputs
      // This is a workaround for circuit/announcement mismatch
      const expectedCommitmentRaw = poseidonHashSync([keys.spendingPubKey.x, amount]);

      if (expectedCommitmentStealth !== actualCommitment &&
          expectedCommitmentRaw !== actualCommitment) {
        // Not for us - commitment doesn't match either formula
        continue;
      }

      // This announcement is for us! Amount successfully decrypted.
      found.push({
        amount,
        ephemeralPub,
        stealthPub,
        leafIndex: ann.leafIndex,
        commitment: ann.commitment,
      });
    } catch {
      // Parsing failed - skip this announcement
      continue;
    }
  }

  return found;
}

// ========== View-Only Scanning (No Spending Key Required) ==========

/**
 * Scan announcements with VIEW-ONLY keys (no spending capability)
 *
 * This function is designed for:
 * - Portfolio trackers (view balance without spending risk)
 * - Watch-only wallets
 * - Delegated viewing (give viewing key to accountant)
 *
 * The viewing key can:
 * - Decrypt the amount (see how much was sent)
 * - Detect which deposits are for you
 * - Calculate total balance
 *
 * The viewing key CANNOT:
 * - Derive the stealth private key
 * - Generate the nullifier
 * - Spend your funds
 *
 * @param viewOnlyKeys - Viewing private key + spending public key
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes with decrypted amounts
 *
 * @example
 * ```typescript
 * // Create view-only keys (export from full keys)
 * const viewOnly: ViewOnlyKeys = {
 *   viewingPrivKey: keys.viewingPrivKey,
 *   spendingPubKey: keys.spendingPubKey,
 * };
 *
 * // Scan without spending capability
 * const notes = await scanAnnouncementsViewOnly(viewOnly, announcements);
 * const totalBalance = notes.reduce((sum, n) => sum + n.amount, 0n);
 * console.log(`Balance: ${totalBalance} sats`);
 * ```
 */
export async function scanAnnouncementsViewOnly(
  viewOnlyKeys: ViewOnlyKeys,
  announcements: AnnouncementScanFormat[]
): Promise<ViewOnlyScannedNote[]> {
  const found: ViewOnlyScannedNote[] = [];
  const MAX_SATS = 21_000_000n * 100_000_000n;

  for (const ann of announcements) {
    try {
      const ephemeralPub = pointFromCompressedBytes(ann.ephemeralPub);

      // Compute shared secret with viewing key
      const sharedSecret = grumpkinEcdh(viewOnlyKeys.viewingPrivKey, ephemeralPub);

      // Decrypt amount
      const amount = decryptAmount(ann.encryptedAmount, sharedSecret);

      if (amount <= 0n || amount > MAX_SATS) {
        continue;
      }

      // Derive stealth public key to verify commitment
      const stealthPub = deriveStealthPubKey(viewOnlyKeys.spendingPubKey, sharedSecret);

      // Verify commitment
      const expectedCommitment = poseidonHashSync([stealthPub.x, amount]);
      const actualCommitment = bytesToBigint(ann.commitment);

      if (expectedCommitment !== actualCommitment) {
        continue;
      }

      found.push({
        amount,
        leafIndex: ann.leafIndex,
        commitment: ann.commitment,
        ephemeralPub: ann.ephemeralPub,
      });
    } catch {
      continue;
    }
  }

  return found;
}

/**
 * Export view-only keys from full ZVaultKeys
 *
 * Use this to create a view-only version of your keys that can
 * scan and decrypt amounts but cannot spend funds.
 *
 * @example
 * ```typescript
 * const fullKeys = await deriveKeysFromWallet(wallet);
 * const viewOnly = exportViewOnlyKeys(fullKeys);
 *
 * // Give viewOnly to a portfolio tracker app
 * // They can see your balance but cannot spend
 * ```
 */
export function exportViewOnlyKeys(keys: ZVaultKeys): ViewOnlyKeys {
  return {
    viewingPrivKey: keys.viewingPrivKey,
    spendingPubKey: keys.spendingPubKey,
  };
}

// ========== Scan by .zkey.sol Name ==========

/**
 * Scan stealth announcements for deposits sent to a .zkey.sol name
 *
 * Combines name lookup + scanning in one call. Verifies that the
 * provided keys match the registered .zkey.sol name before scanning.
 *
 * IMPORTANT: Scanning requires the viewing private key. This function
 * verifies that your spending public key matches the registered .zkey.sol name,
 * then scans using your viewing key.
 *
 * @param keys - User's full ZVaultKeys (spending + viewing keys required)
 * @param expectedName - The .zkey.sol name to verify ownership (e.g., "alice" or "alice.zkey.sol")
 * @param connection - Solana connection (must have getAccountInfo method)
 * @param announcements - Array of on-chain stealth announcements to scan
 * @param programId - Optional program ID (defaults to devnet)
 * @returns Array of found notes belonging to this address
 * @throws Error if name not found or keys don't match registered name
 *
 * @example
 * ```typescript
 * const keys = await deriveKeysFromWallet(wallet);
 * const notes = await scanByZkeyName(
 *   keys,
 *   "alice",
 *   connection,
 *   announcements
 * );
 * console.log(`Found ${notes.length} deposits for alice.zkey.sol`);
 * ```
 */
export async function scanByZkeyName(
  keys: ZVaultKeys,
  expectedName: string,
  connection: ConnectionAdapter,
  announcements: AnnouncementScanFormat[],
  programId?: string
): Promise<ScannedNote[]> {
  // 1. Lookup .zkey.sol name to get registered stealth address
  const zkeyAddress = await lookupZkeyName(connection, expectedName, programId);
  if (!zkeyAddress) {
    throw new Error(`Name "${expectedName}.zkey.sol" not found`);
  }

  // 2. Verify keys match registered name
  const userSpendingPub = pointToCompressedBytes(keys.spendingPubKey);
  if (!constantTimeCompare(userSpendingPub, zkeyAddress.spendingPubKey)) {
    throw new Error(
      `Keys do not match "${expectedName}.zkey.sol" registration. ` +
      `The provided spending key does not match the registered spending key.`
    );
  }

  // Optional: Also verify viewing key matches
  const userViewingPub = pointToCompressedBytes(keys.viewingPubKey);
  if (!constantTimeCompare(userViewingPub, zkeyAddress.viewingPubKey)) {
    throw new Error(
      `Keys do not match "${expectedName}.zkey.sol" registration. ` +
      `The provided viewing key does not match the registered viewing key.`
    );
  }

  // 3. Scan using user's viewing key (keys verified to match name)
  return scanAnnouncements(keys, announcements);
}

/**
 * Look up a .zkey.sol name and return the stealth address
 *
 * For scanning deposits, use scanByZkeyName() which requires keys.
 *
 * @param connection - Solana connection
 * @param name - The .zkey.sol name to look up (e.g., "alice" or "alice.zkey.sol")
 * @param programId - Optional program ID
 * @returns Stealth address or null if not found
 */
export async function resolveZkeyName(
  connection: ConnectionAdapter,
  name: string,
  programId?: string
): Promise<ZkeyStealthAddress | null> {
  return lookupZkeyName(connection, name, programId);
}
