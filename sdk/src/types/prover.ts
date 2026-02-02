/**
 * Prover Types
 *
 * Type definitions for ZK proof generation in zVault.
 *
 * @module types/prover
 */

// ==========================================================================
// Core Prover Types
// ==========================================================================

/**
 * Merkle proof input for circuits
 */
export interface MerkleProofInput {
  siblings: bigint[];
  indices: number[];
}

/**
 * Generated proof data
 */
export interface ProofData {
  proof: Uint8Array;
  publicInputs: string[];
  verificationKey?: Uint8Array;
}

/**
 * Circuit types available in zVault
 */
export type CircuitType =
  | "claim"
  | "spend_split"
  | "spend_partial_public"
  | "pool_deposit"
  | "pool_withdraw"
  | "pool_claim_yield";

// ==========================================================================
// Circuit Input Types
// ==========================================================================

/**
 * Claim proof inputs (Unified Model)
 *
 * Claims commitment to a public Solana wallet.
 */
export interface ClaimInputs {
  /** Spending private key */
  privKey: bigint;
  /** Public key x-coordinate (derives from privKey) */
  pubKeyX: bigint;
  /** Amount in satoshis */
  amount: bigint;
  /** Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Recipient address (32 bytes as bigint) - bound to proof, cannot be changed */
  recipient: bigint;
}

/**
 * Spend split proof inputs (Unified Model)
 *
 * Splits one commitment into two commitments.
 */
export interface SpendSplitInputs {
  /** Input: Spending private key */
  privKey: bigint;
  /** Input: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input: Amount in satoshis */
  amount: bigint;
  /** Input: Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Output 1: Recipient's public key x-coordinate */
  output1PubKeyX: bigint;
  /** Output 1: Amount in satoshis */
  output1Amount: bigint;
  /** Output 2: Recipient's public key x-coordinate */
  output2PubKeyX: bigint;
  /** Output 2: Amount in satoshis */
  output2Amount: bigint;
  /** Output 1: Ephemeral pubkey x-coordinate for stealth announcement */
  output1EphemeralPubX: bigint;
  /** Output 1: Packed encrypted amount with y_sign */
  output1EncryptedAmountWithSign: bigint;
  /** Output 2: Ephemeral pubkey x-coordinate for stealth announcement */
  output2EphemeralPubX: bigint;
  /** Output 2: Packed encrypted amount with y_sign */
  output2EncryptedAmountWithSign: bigint;
}

/**
 * Spend partial public proof inputs (Unified Model)
 *
 * Performs partial public claim: Commitment -> Public Amount + Change Commitment
 */
export interface SpendPartialPublicInputs {
  /** Input: Spending private key */
  privKey: bigint;
  /** Input: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input: Amount in satoshis */
  amount: bigint;
  /** Input: Position in Merkle tree */
  leafIndex: bigint;
  /** Merkle tree root */
  merkleRoot: bigint;
  /** Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Public amount to claim (revealed) */
  publicAmount: bigint;
  /** Change: Public key x-coordinate */
  changePubKeyX: bigint;
  /** Change: Amount in satoshis */
  changeAmount: bigint;
  /** Recipient Solana wallet (as bigint from 32 bytes) */
  recipient: bigint;
  /** Change: Ephemeral pubkey x-coordinate for stealth announcement */
  changeEphemeralPubX: bigint;
  /** Change: Packed encrypted amount with y_sign */
  changeEncryptedAmountWithSign: bigint;
}

/**
 * Pool deposit proof inputs (Unified Model)
 *
 * Input:  Unified Commitment = Poseidon(pub_key_x, amount)
 * Output: Pool Position = Poseidon(pool_pub_key_x, principal, deposit_epoch)
 */
export interface PoolDepositInputs {
  /** Input commitment: Spending private key */
  privKey: bigint;
  /** Input commitment: Public key x-coordinate */
  pubKeyX: bigint;
  /** Input commitment: Amount (becomes principal) */
  amount: bigint;
  /** Input commitment: Position in Merkle tree */
  leafIndex: bigint;
  /** Input Merkle tree root */
  merkleRoot: bigint;
  /** Input Merkle proof (20 levels) */
  merkleProof: MerkleProofInput;
  /** Pool position: Public key x-coordinate (for pool position commitment) */
  poolPubKeyX: bigint;
  /** Current epoch when depositing */
  depositEpoch: bigint;
}

/**
 * Pool withdraw proof inputs (Unified Model)
 *
 * Input:  Pool Position = Poseidon(pub_key_x, principal, deposit_epoch)
 * Output: Unified Commitment = Poseidon(output_pub_key_x, principal + yield)
 */
export interface PoolWithdrawInputs {
  /** Pool position: Private key */
  privKey: bigint;
  /** Pool position: Public key x-coordinate */
  pubKeyX: bigint;
  /** Principal amount */
  principal: bigint;
  /** Epoch when deposited */
  depositEpoch: bigint;
  /** Position in pool Merkle tree */
  leafIndex: bigint;
  /** Pool Merkle tree root */
  poolMerkleRoot: bigint;
  /** Pool Merkle proof (20 levels) */
  poolMerkleProof: MerkleProofInput;
  /** Output: Public key x-coordinate for output commitment */
  outputPubKeyX: bigint;
  /** Current epoch */
  currentEpoch: bigint;
  /** Yield rate in basis points */
  yieldRateBps: bigint;
  /** Pool ID */
  poolId: bigint;
}

/**
 * Pool claim yield proof inputs (Unified Model)
 *
 * Input:  Pool Position = Poseidon(old_pub_key_x, principal, deposit_epoch)
 * Output: 1. New Pool Position = Poseidon(new_pub_key_x, principal, current_epoch)
 *         2. Yield as Unified Commitment = Poseidon(yield_pub_key_x, yield_amount)
 */
export interface PoolClaimYieldInputs {
  /** Old position: Private key */
  oldPrivKey: bigint;
  /** Old position: Public key x-coordinate */
  oldPubKeyX: bigint;
  /** Principal amount */
  principal: bigint;
  /** Epoch when deposited */
  depositEpoch: bigint;
  /** Position in pool Merkle tree */
  leafIndex: bigint;
  /** Pool Merkle tree root */
  poolMerkleRoot: bigint;
  /** Pool Merkle proof (20 levels) */
  poolMerkleProof: MerkleProofInput;
  /** New position: Public key x-coordinate */
  newPubKeyX: bigint;
  /** Yield output: Public key x-coordinate */
  yieldPubKeyX: bigint;
  /** Current epoch */
  currentEpoch: bigint;
  /** Yield rate in basis points */
  yieldRateBps: bigint;
  /** Pool ID */
  poolId: bigint;
}
