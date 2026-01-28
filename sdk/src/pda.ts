/**
 * PDA (Program Derived Address) Derivation Utilities
 *
 * Centralized module for all zVault PDA derivations.
 * Prevents code duplication across api.ts, zvault.ts, etc.
 *
 * @module pda
 */

import {
  address,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";

/** Default zVault program ID (Solana Devnet) */
export const ZVAULT_PROGRAM_ID: Address = address(
  "5S5ynMni8Pgd6tKkpYaXiPJiEXgw927s7T2txDtDivRK"
);

/** BTC Light Client program ID */
export const BTC_LIGHT_CLIENT_PROGRAM_ID: Address = address(
  "95vWurTc9BhjBvEbBdUKoTZHMPPyB1iQZEuXEaR7wPpd"
);

// =============================================================================
// PDA Seeds
// =============================================================================

export const PDA_SEEDS = {
  POOL_STATE: "pool_state",
  COMMITMENT_TREE: "commitment_tree",
  LIGHT_CLIENT: "light_client",
  BLOCK_HEADER: "block_header",
  DEPOSIT: "deposit",
  NULLIFIER: "nullifier",
  STEALTH: "stealth",
  NAME_REGISTRY: "name",
  YIELD_POOL: "yield_pool",
  POOL_COMMITMENT_TREE: "pool_commitment_tree",
  POOL_NULLIFIER: "pool_nullifier",
  STEALTH_POOL_ANNOUNCEMENT: "stealth_pool_announcement",
} as const;

// =============================================================================
// Core zVault PDAs
// =============================================================================

/**
 * Derive Pool State PDA
 */
export async function derivePoolStatePDA(
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.POOL_STATE)],
  });
  return [result[0], result[1]];
}

/**
 * Derive Commitment Tree PDA
 */
export async function deriveCommitmentTreePDA(
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.COMMITMENT_TREE)],
  });
  return [result[0], result[1]];
}

/**
 * Derive Nullifier Record PDA
 */
export async function deriveNullifierRecordPDA(
  nullifierHash: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.NULLIFIER), nullifierHash],
  });
  return [result[0], result[1]];
}

/**
 * Derive Stealth Announcement PDA
 */
export async function deriveStealthAnnouncementPDA(
  ephemeralPubOrCommitment: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.STEALTH), ephemeralPubOrCommitment],
  });
  return [result[0], result[1]];
}

/**
 * Derive Deposit Record PDA
 */
export async function deriveDepositRecordPDA(
  txid: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.DEPOSIT), txid],
  });
  return [result[0], result[1]];
}

// =============================================================================
// BTC Light Client PDAs
// =============================================================================

/**
 * Derive BTC Light Client PDA
 */
export async function deriveLightClientPDA(
  programId: Address = BTC_LIGHT_CLIENT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.LIGHT_CLIENT)],
  });
  return [result[0], result[1]];
}

/**
 * Derive Block Header PDA
 */
export async function deriveBlockHeaderPDA(
  height: number,
  programId: Address = BTC_LIGHT_CLIENT_PROGRAM_ID
): Promise<[Address, number]> {
  const heightBuffer = new Uint8Array(8);
  const view = new DataView(heightBuffer.buffer);
  view.setBigUint64(0, BigInt(height), true);
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.BLOCK_HEADER), heightBuffer],
  });
  return [result[0], result[1]];
}

// =============================================================================
// Name Registry PDAs
// =============================================================================

/**
 * Derive Name Registry PDA
 */
export async function deriveNameRegistryPDA(
  nameHash: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.NAME_REGISTRY), nameHash],
  });
  return [result[0], result[1]];
}

// =============================================================================
// Yield Pool PDAs
// =============================================================================

/**
 * Derive Yield Pool PDA
 */
export async function deriveYieldPoolPDA(
  poolId: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.YIELD_POOL), poolId],
  });
  return [result[0], result[1]];
}

/**
 * Derive Pool Commitment Tree PDA
 */
export async function derivePoolCommitmentTreePDA(
  poolId: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode(PDA_SEEDS.POOL_COMMITMENT_TREE), poolId],
  });
  return [result[0], result[1]];
}

/**
 * Derive Pool Nullifier PDA
 */
export async function derivePoolNullifierPDA(
  poolId: Uint8Array,
  nullifierHash: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      new TextEncoder().encode(PDA_SEEDS.POOL_NULLIFIER),
      poolId,
      nullifierHash,
    ],
  });
  return [result[0], result[1]];
}

/**
 * Derive Stealth Pool Announcement PDA
 */
export async function deriveStealthPoolAnnouncementPDA(
  poolId: Uint8Array,
  commitment: Uint8Array,
  programId: Address = ZVAULT_PROGRAM_ID
): Promise<[Address, number]> {
  const result = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      new TextEncoder().encode(PDA_SEEDS.STEALTH_POOL_ANNOUNCEMENT),
      poolId,
      commitment,
    ],
  });
  return [result[0], result[1]];
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert bigint commitment to bytes for PDA derivation
 */
export function commitmentToBytes(commitment: bigint): Uint8Array {
  const hex = commitment.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
