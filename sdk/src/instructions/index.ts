/**
 * ZVault Instruction Builders
 *
 * Low-level instruction building for ZVault operations.
 * All proofs use inline mode (Groth16 proofs are only 388 bytes).
 *
 * @module instructions
 */

// Types
export type {
  Instruction,
  ClaimInstructionOptions,
  SplitInstructionOptions,
  SpendPartialPublicInstructionOptions,
  PoolDepositInstructionOptions,
  PoolWithdrawInstructionOptions,
  PoolClaimYieldInstructionOptions,
  RedemptionRequestInstructionOptions,
} from "./types";

export {
  INSTRUCTION_DISCRIMINATORS,
  VERIFIER_DISCRIMINATORS,
} from "./types";

// Utilities
export {
  bs58Decode,
  addressToBytes,
  hexToBytes,
  bytesToHex,
  bigintTo32Bytes,
  bytes32ToBigint,
  SYSTEM_PROGRAM_ADDRESS,
  INSTRUCTIONS_SYSVAR,
} from "./utils";

// Claim
export { buildClaimInstructionData } from "./claim";

// Split
export { buildSplitInstructionData } from "./split";

// Spend Partial Public
export { buildSpendPartialPublicInstructionData } from "./spend-partial-public";

// Pool Deposit
export { buildPoolDepositInstructionData } from "./pool-deposit";

// Pool Withdraw
export { buildPoolWithdrawInstructionData } from "./pool-withdraw";

// Pool Claim Yield
export { buildPoolClaimYieldInstructionData } from "./pool-claim-yield";

// Redemption
export { buildRedemptionRequestInstructionData } from "./redemption";

// Verifier (inline mode only - Groth16 proofs are 388 bytes)
export {
  GROTH16_PROOF_SIZE,
  buildVerifyInstruction,
  buildClaimVerifierInputs,
  buildPartialPublicVerifierInputs,
  buildSplitVerifierInputs,
} from "./verifier";

// Legacy alias for backwards compatibility
import { buildVerifyInstruction } from "./verifier";
export const buildVerifyFromBufferInstruction = buildVerifyInstruction;

// =============================================================================
// Legacy Exports (for backwards compatibility)
// =============================================================================

import { address, AccountRole } from "@solana/kit";
import { getConfig, TOKEN_2022_PROGRAM_ID } from "../config";

import type {
  Instruction,
  ClaimInstructionOptions,
  SplitInstructionOptions,
  SpendPartialPublicInstructionOptions,
  PoolDepositInstructionOptions,
  PoolWithdrawInstructionOptions,
  PoolClaimYieldInstructionOptions,
  RedemptionRequestInstructionOptions,
} from "./types";

import { buildClaimInstructionData } from "./claim";
import { buildSplitInstructionData } from "./split";
import { buildSpendPartialPublicInstructionData } from "./spend-partial-public";
import { buildPoolDepositInstructionData } from "./pool-deposit";
import { buildPoolWithdrawInstructionData } from "./pool-withdraw";
import { buildPoolClaimYieldInstructionData } from "./pool-claim-yield";
import { buildRedemptionRequestInstructionData } from "./redemption";
import { SYSTEM_PROGRAM_ADDRESS, INSTRUCTIONS_SYSVAR } from "./utils";

const SYSTEM_PROGRAM = address(SYSTEM_PROGRAM_ADDRESS);
const INSTRUCTIONS = address(INSTRUCTIONS_SYSVAR);

/**
 * Build a complete claim instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.claim() instead
 */
export function buildClaimInstruction(options: ClaimInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildClaimInstructionData({
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    amountSats: options.amountSats,
    recipient: options.recipient,
    vkHash: options.vkHash,
  });

  // Contract expects: 0=pool_state, 1=commitment_tree, 2=nullifier_record, 3=zbtc_mint,
  // 4=pool_vault, 5=recipient_ata, 6=user, 7=token_program, 8=system_program,
  // 9=vk_registry, 10=sunspot_verifier, 11=instructions_sysvar
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: options.accounts.vkRegistry, role: AccountRole.READONLY },
    { address: config.sunspotVerifiers.claim, role: AccountRole.READONLY },
    { address: INSTRUCTIONS, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete split instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.split() instead
 */
export function buildSplitInstruction(options: SplitInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildSplitInstructionData({
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    outputCommitment1: options.outputCommitment1,
    outputCommitment2: options.outputCommitment2,
    vkHash: options.vkHash,
    output1EphemeralPubX: options.output1EphemeralPubX,
    output1EncryptedAmountWithSign: options.output1EncryptedAmountWithSign,
    output2EphemeralPubX: options.output2EphemeralPubX,
    output2EncryptedAmountWithSign: options.output2EncryptedAmountWithSign,
  });

  // Contract expects: 0=pool_state, 1=commitment_tree, 2=nullifier_record, 3=user,
  // 4=system_program, 5=stealth_announcement_1, 6=stealth_announcement_2, 7=sunspot_verifier
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: options.accounts.stealthAnnouncement1, role: AccountRole.WRITABLE },
    { address: options.accounts.stealthAnnouncement2, role: AccountRole.WRITABLE },
    { address: config.sunspotVerifiers.split, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete spend_partial_public instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.spendPartialPublic() instead
 */
export function buildSpendPartialPublicInstruction(options: SpendPartialPublicInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildSpendPartialPublicInstructionData({
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    publicAmountSats: options.publicAmountSats,
    changeCommitment: options.changeCommitment,
    recipient: options.recipient,
    vkHash: options.vkHash,
    changeEphemeralPubX: options.changeEphemeralPubX,
    changeEncryptedAmountWithSign: options.changeEncryptedAmountWithSign,
  });

  // Contract expects: 0-6=pool_state..user, 7=token_program, 8=system_program,
  // 9=stealth_announcement_change, 10=sunspot_verifier
  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: options.accounts.stealthAnnouncementChange, role: AccountRole.WRITABLE },
    { address: config.sunspotVerifiers.spendPartialPublic, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete pool deposit instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.poolDeposit() instead
 */
export function buildPoolDepositInstruction(options: PoolDepositInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolDepositInstructionData({
    proofBytes: options.proofBytes,
    root: options.root,
    nullifierHash: options.nullifierHash,
    poolCommitment: options.poolCommitment,
    amountSats: options.amountSats,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.nullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: config.sunspotVerifiers.poolDeposit, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete pool withdraw instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.poolWithdraw() instead
 */
export function buildPoolWithdrawInstruction(options: PoolWithdrawInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolWithdrawInstructionData({
    proofBytes: options.proofBytes,
    poolRoot: options.poolRoot,
    poolNullifierHash: options.poolNullifierHash,
    amountSats: options.amountSats,
    outputCommitment: options.outputCommitment,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.commitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.READONLY },
    { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: config.sunspotVerifiers.poolWithdraw, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete pool claim yield instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.poolClaimYield() instead
 */
export function buildPoolClaimYieldInstruction(options: PoolClaimYieldInstructionOptions): Instruction {
  const config = getConfig();

  const data = buildPoolClaimYieldInstructionData({
    proofBytes: options.proofBytes,
    poolRoot: options.poolRoot,
    poolNullifierHash: options.poolNullifierHash,
    newPoolCommitment: options.newPoolCommitment,
    yieldAmountSats: options.yieldAmountSats,
    recipient: options.recipient,
    vkHash: options.vkHash,
  });

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.READONLY },
    { address: options.accounts.yieldPool, role: AccountRole.WRITABLE },
    { address: options.accounts.poolCommitmentTree, role: AccountRole.WRITABLE },
    { address: options.accounts.poolNullifierRecord, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.poolVault, role: AccountRole.WRITABLE },
    { address: options.accounts.recipientAta, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: config.sunspotVerifiers.poolClaimYield, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}

/**
 * Build a complete redemption request instruction (legacy - uses global config)
 * @deprecated Use SDK.instructions.redemptionRequest() instead
 */
export function buildRedemptionRequestInstruction(
  options: RedemptionRequestInstructionOptions
): Instruction {
  const config = getConfig();

  const data = buildRedemptionRequestInstructionData(
    options.amountSats,
    options.btcAddress
  );

  const accounts: Instruction["accounts"] = [
    { address: options.accounts.poolState, role: AccountRole.WRITABLE },
    { address: options.accounts.zbtcMint, role: AccountRole.WRITABLE },
    { address: options.accounts.userTokenAccount, role: AccountRole.WRITABLE },
    { address: options.accounts.user, role: AccountRole.WRITABLE_SIGNER },
    { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: TOKEN_2022_PROGRAM_ID, role: AccountRole.READONLY },
  ];

  return {
    programAddress: config.zvaultProgramId,
    accounts,
    data,
  };
}
