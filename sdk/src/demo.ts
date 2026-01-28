/**
 * Demo Instruction Builders for zVault
 *
 * These allow adding mock commitments without real BTC deposits.
 * Useful for testing, demos, and development.
 *
 * Platform-agnostic builders that return instruction data as Uint8Array.
 * Consumers can use these with their preferred Solana library.
 *
 * @example
 * ```typescript
 * import { buildAddDemoNoteData, DEMO_INSTRUCTION } from '@zvault/sdk';
 *
 * // Build instruction data
 * const data = buildAddDemoNoteData(secret);
 *
 * // Use with @solana/web3.js
 * const instruction = new TransactionInstruction({
 *   keys: [...],
 *   programId: ZVAULT_PROGRAM_ID,
 *   data: Buffer.from(data),
 * });
 * ```
 */

import { ZVAULT_PROGRAM_ID } from "./name-registry";

// ========== Constants ==========

/** Demo instruction discriminators */
export const DEMO_INSTRUCTION = {
  /** Add a demo note (self deposit) */
  ADD_DEMO_NOTE: 21,
  /** Add a demo stealth deposit */
  ADD_DEMO_STEALTH: 22,
} as const;

/** PDA seeds for demo instructions */
export const DEMO_SEEDS = {
  POOL_STATE: new TextEncoder().encode("pool_state"),
  COMMITMENT_TREE: new TextEncoder().encode("commitment_tree"),
  STEALTH: new TextEncoder().encode("stealth"),
} as const;

// ========== Types ==========

/**
 * Parameters for ADD_DEMO_NOTE instruction
 */
export interface AddDemoNoteParams {
  /** 32-byte secret (contract derives nullifier and commitment) */
  secret: Uint8Array;
}

/**
 * Parameters for ADD_DEMO_STEALTH instruction
 */
export interface AddDemoStealthParams {
  /** 33-byte ephemeral public key (compressed Grumpkin) */
  ephemeralPub: Uint8Array;
  /** 32-byte commitment */
  commitment: Uint8Array;
  /** 8-byte encrypted amount (XOR with sha256(sharedSecret)[0:8]) */
  encryptedAmount: Uint8Array;
}

/**
 * PDA derivation result
 */
export interface PDASeed {
  /** Seeds for PDA derivation */
  seeds: Uint8Array[];
}

// ========== PDA Seed Helpers ==========

/**
 * Get seeds for Pool State PDA derivation
 *
 * Use with your preferred Solana library:
 * ```typescript
 * const { seeds } = getPoolStatePDASeeds();
 * const [pda] = PublicKey.findProgramAddressSync(
 *   seeds.map(s => Buffer.from(s)),
 *   programId
 * );
 * ```
 */
export function getPoolStatePDASeeds(): PDASeed {
  return {
    seeds: [DEMO_SEEDS.POOL_STATE],
  };
}

/**
 * Get seeds for Commitment Tree PDA derivation
 */
export function getCommitmentTreePDASeeds(): PDASeed {
  return {
    seeds: [DEMO_SEEDS.COMMITMENT_TREE],
  };
}

/**
 * Get seeds for Stealth Announcement PDA derivation
 *
 * @param ephemeralPub - The ephemeral public key (uses bytes 1-32)
 */
export function getStealthAnnouncementPDASeeds(ephemeralPub: Uint8Array): PDASeed {
  if (ephemeralPub.length < 33) {
    throw new Error("Ephemeral pub must be at least 33 bytes");
  }
  // Use bytes 1-32 of ephemeral pub (skip the prefix byte)
  return {
    seeds: [DEMO_SEEDS.STEALTH, ephemeralPub.slice(1, 33)],
  };
}

// ========== Instruction Data Builders ==========

/**
 * Build instruction data for ADD_DEMO_NOTE
 *
 * Layout (33 bytes):
 * - discriminator (1 byte) = 21
 * - secret (32 bytes)
 *
 * @param secret - 32-byte secret
 * @returns Instruction data as Uint8Array
 */
export function buildAddDemoNoteData(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error("Secret must be 32 bytes");
  }

  const data = new Uint8Array(33);
  data[0] = DEMO_INSTRUCTION.ADD_DEMO_NOTE;
  data.set(secret, 1);

  return data;
}

/**
 * Build instruction data for ADD_DEMO_STEALTH
 *
 * Layout (74 bytes):
 * - discriminator (1 byte) = 22
 * - ephemeral_pub (33 bytes) - compressed Grumpkin point
 * - commitment (32 bytes)
 * - encrypted_amount (8 bytes) - XOR encrypted with shared secret
 *
 * @param ephemeralPub - 33-byte compressed Grumpkin public key
 * @param commitment - 32-byte commitment
 * @param encryptedAmount - 8-byte encrypted amount
 * @returns Instruction data as Uint8Array
 */
export function buildAddDemoStealthData(
  ephemeralPub: Uint8Array,
  commitment: Uint8Array,
  encryptedAmount: Uint8Array
): Uint8Array {
  if (ephemeralPub.length !== 33) {
    throw new Error("Ephemeral pub must be 33 bytes (compressed Grumpkin)");
  }
  if (commitment.length !== 32) {
    throw new Error("Commitment must be 32 bytes");
  }
  if (encryptedAmount.length !== 8) {
    throw new Error("Encrypted amount must be 8 bytes");
  }

  const data = new Uint8Array(74);
  let offset = 0;

  // Discriminator
  data[offset++] = DEMO_INSTRUCTION.ADD_DEMO_STEALTH;

  // Ephemeral public key
  data.set(ephemeralPub, offset);
  offset += 33;

  // Commitment
  data.set(commitment, offset);
  offset += 32;

  // Encrypted amount (8 bytes)
  data.set(encryptedAmount, offset);

  return data;
}

/**
 * Build instruction data from params object for ADD_DEMO_NOTE
 */
export function buildAddDemoNoteDataFromParams(params: AddDemoNoteParams): Uint8Array {
  return buildAddDemoNoteData(params.secret);
}

/**
 * Build instruction data from params object for ADD_DEMO_STEALTH
 */
export function buildAddDemoStealthDataFromParams(params: AddDemoStealthParams): Uint8Array {
  return buildAddDemoStealthData(
    params.ephemeralPub,
    params.commitment,
    params.encryptedAmount
  );
}

// ========== Account Keys Helpers ==========

/**
 * Get the list of account keys needed for ADD_DEMO_NOTE instruction
 *
 * Returns the account order for constructing the instruction:
 * 1. Pool State (writable)
 * 2. Commitment Tree (writable)
 * 3. Payer (signer)
 * 4. zBTC Mint (writable)
 * 5. Pool Vault (writable)
 * 6. Token-2022 Program
 */
export function getDemoNoteAccountMetas(): {
  name: string;
  writable: boolean;
  signer: boolean;
}[] {
  return [
    { name: "poolState", writable: true, signer: false },
    { name: "commitmentTree", writable: true, signer: false },
    { name: "payer", writable: false, signer: true },
    { name: "zbtcMint", writable: true, signer: false },
    { name: "poolVault", writable: true, signer: false },
    { name: "tokenProgram", writable: false, signer: false },
  ];
}

/**
 * Get the list of account keys needed for ADD_DEMO_STEALTH instruction
 *
 * Returns the account order for constructing the instruction:
 * 1. Pool State (writable)
 * 2. Commitment Tree (writable)
 * 3. Stealth Announcement (writable)
 * 4. Payer (signer, writable for rent)
 * 5. System Program
 * 6. zBTC Mint (writable)
 * 7. Pool Vault (writable)
 * 8. Token-2022 Program
 */
export function getDemoStealthAccountMetas(): {
  name: string;
  writable: boolean;
  signer: boolean;
}[] {
  return [
    { name: "poolState", writable: true, signer: false },
    { name: "commitmentTree", writable: true, signer: false },
    { name: "stealthAnnouncement", writable: true, signer: false },
    { name: "payer", writable: true, signer: true },
    { name: "systemProgram", writable: false, signer: false },
    { name: "zbtcMint", writable: true, signer: false },
    { name: "poolVault", writable: true, signer: false },
    { name: "tokenProgram", writable: false, signer: false },
  ];
}

// ========== Re-export Program ID ==========

export { ZVAULT_PROGRAM_ID } from "./name-registry";
