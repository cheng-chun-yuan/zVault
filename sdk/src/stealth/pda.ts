/**
 * Stealth PDA Derivation
 *
 * Program Derived Address utilities for stealth announcements and nullifiers.
 */

import { getProgramDerivedAddress, address } from "@solana/kit";
import { bigintToBytes } from "../crypto";
import { poseidonHashSync } from "../poseidon";

/**
 * Derive StealthAnnouncement PDA address from ephemeral pubkey
 *
 * PDA seed: ["stealth", ephemeral_pub[1..33]]
 * Uses bytes 1-32 of compressed ephemeral pubkey (skips prefix byte)
 *
 * @param ephemeralPub - 33-byte compressed Grumpkin pubkey
 * @param programId - ZVault program ID
 * @returns PDA address string (base58)
 */
export async function deriveStealthAnnouncementPda(
  ephemeralPub: Uint8Array,
  programId: string
): Promise<string> {
  if (ephemeralPub.length !== 33) {
    throw new Error("Ephemeral pubkey must be 33 bytes (compressed Grumpkin)");
  }

  // Use bytes 1-32 (skip prefix byte, use 32-byte x-coordinate)
  const seed = ephemeralPub.slice(1, 33);

  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode("stealth"),
      seed,
    ],
  });

  return pda.toString();
}

/**
 * Derive nullifier record PDA address
 *
 * PDA seed: ["nullifier", nullifier_hash]
 *
 * @param nullifierHash - 32-byte nullifier hash (Poseidon(nullifier))
 * @param programId - ZVault program ID
 * @returns PDA address string (base58)
 */
export async function deriveNullifierPda(
  nullifierHash: Uint8Array,
  programId: string
): Promise<string> {
  if (nullifierHash.length !== 32) {
    throw new Error("Nullifier hash must be 32 bytes");
  }

  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode("nullifier"),
      nullifierHash,
    ],
  });

  return pda.toString();
}

/**
 * Derive commitment leaf PDA address
 *
 * PDA seed: ["commitment", commitment]
 *
 * @param commitment - 32-byte commitment hash
 * @param programId - ZVault program ID
 * @returns PDA address string (base58)
 */
export async function deriveCommitmentPda(
  commitment: Uint8Array,
  programId: string
): Promise<string> {
  if (commitment.length !== 32) {
    throw new Error("Commitment must be 32 bytes");
  }

  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode("commitment"),
      commitment,
    ],
  });

  return pda.toString();
}

/**
 * Compute nullifier hash for PDA derivation
 *
 * nullifierHash = Poseidon(nullifier)
 *
 * @param nullifier - Nullifier value (bigint)
 * @returns 32-byte nullifier hash
 */
export function computeNullifierHash(nullifier: bigint): Uint8Array {
  const nullifierHash = poseidonHashSync([nullifier]);
  return bigintToBytes(nullifierHash);
}
