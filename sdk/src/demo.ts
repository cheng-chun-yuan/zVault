/**
 * Demo Instruction Builders
 *
 * Utilities for building demo/test instructions.
 * These are only available on devnet/localnet (demo mode).
 *
 * @module demo
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Demo instruction discriminators
 */
export const DEMO_INSTRUCTION = {
  /** Add a demo stealth announcement (for testing) */
  ADD_DEMO_STEALTH: 22,
} as const;

// =============================================================================
// Instruction Builders
// =============================================================================

/**
 * Build instruction data for ADD_DEMO_STEALTH
 *
 * Layout:
 * - discriminator: 1 byte (22)
 * - ephemeral_pub: 33 bytes (compressed point)
 * - commitment: 32 bytes
 * - encrypted_amount: 8 bytes
 * Total: 74 bytes
 *
 * @param ephemeralPub - Compressed ephemeral public key (33 bytes)
 * @param commitment - Commitment hash (32 bytes)
 * @param encryptedAmount - Encrypted amount (8 bytes)
 * @returns Instruction data buffer
 */
export function buildAddDemoStealthData(
  ephemeralPub: Uint8Array,
  commitment: Uint8Array,
  encryptedAmount: Uint8Array
): Uint8Array {
  // Validate inputs
  if (ephemeralPub.length !== 33) {
    throw new Error(`Ephemeral pub must be 33 bytes, got ${ephemeralPub.length}`);
  }
  if (commitment.length !== 32) {
    throw new Error(`Commitment must be 32 bytes, got ${commitment.length}`);
  }
  if (encryptedAmount.length !== 8) {
    throw new Error(`Encrypted amount must be 8 bytes, got ${encryptedAmount.length}`);
  }

  // Total size: 1 + 33 + 32 + 8 = 74 bytes
  const data = new Uint8Array(74);
  let offset = 0;

  // Discriminator
  data[offset++] = DEMO_INSTRUCTION.ADD_DEMO_STEALTH;

  // Ephemeral public key (33 bytes - compressed)
  data.set(ephemeralPub, offset);
  offset += 33;

  // Commitment (32 bytes)
  data.set(commitment, offset);
  offset += 32;

  // Encrypted amount (8 bytes)
  data.set(encryptedAmount, offset);

  return data;
}

/**
 * Parse ADD_DEMO_STEALTH instruction data
 *
 * @param data - Instruction data buffer
 * @returns Parsed instruction fields
 */
export function parseAddDemoStealthData(data: Uint8Array): {
  ephemeralPub: Uint8Array;
  commitment: Uint8Array;
  encryptedAmount: Uint8Array;
} {
  if (data.length !== 74) {
    throw new Error(`Invalid data length: expected 74, got ${data.length}`);
  }

  if (data[0] !== DEMO_INSTRUCTION.ADD_DEMO_STEALTH) {
    throw new Error(
      `Invalid discriminator: expected ${DEMO_INSTRUCTION.ADD_DEMO_STEALTH}, got ${data[0]}`
    );
  }

  return {
    ephemeralPub: data.slice(1, 34),
    commitment: data.slice(34, 66),
    encryptedAmount: data.slice(66, 74),
  };
}
