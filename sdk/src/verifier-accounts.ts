/**
 * Sunspot Groth16 Verifier Account Management
 *
 * Utilities for creating and managing VK (Verification Key) accounts
 * in the Sunspot Groth16 verifier program.
 *
 * @module verifier-accounts
 */

import { address, type Address, AccountRole } from "@solana/kit";
import { VERIFIER_DISCRIMINATORS } from "./instructions/types";
import type { Instruction } from "./instructions/types";

/**
 * Build INIT_VK instruction for Sunspot Groth16 verifier
 *
 * This initializes a VK account with the verification key bytes.
 * The VK account must be pre-created with enough space.
 *
 * Accounts: [vk_account (WRITABLE), authority (SIGNER), system_program]
 * Data: [discriminator(1)] + VK bytes
 */
export function buildInitVkInstruction(options: {
  verifierProgramId: Address;
  vkAddress: Address;
  authority: Address;
  vkBytes: Uint8Array;
}): Instruction {
  const { verifierProgramId, vkAddress, authority, vkBytes } = options;

  // Data format: [discriminator] + VK bytes
  const data = new Uint8Array(1 + vkBytes.length);
  data[0] = VERIFIER_DISCRIMINATORS.INIT_VK;
  data.set(vkBytes, 1);

  const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

  return {
    programAddress: verifierProgramId,
    accounts: [
      { address: vkAddress, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
    ],
    data,
  };
}
