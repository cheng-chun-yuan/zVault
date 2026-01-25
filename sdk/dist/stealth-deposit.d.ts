/**
 * Stealth Deposit utilities for ZVault
 *
 * Combines BTC deposit verification with automatic stealth announcement.
 * When a user deposits BTC to a recipient's stealth address, after SPV
 * verification the commitment goes directly to the recipient - no
 * separate claim step needed.
 *
 * OP_RETURN Format (MINIMAL - 32 bytes):
 * - [0-31]    commitment (32 bytes, raw Poseidon2 hash)
 *
 * NOTE: No magic/version header needed - program ID identifies the scheme.
 * Ephemeral key is stored on Solana StealthAnnouncement only.
 * Recipient matches commitment between Bitcoin and Solana to correlate.
 *
 * Benefits:
 * - 99 → 32 bytes (-68% reduction)
 * - Simpler parsing (just raw commitment)
 * - Ephemeral key remains on Solana only (no cross-chain correlation via OP_RETURN)
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { StealthMetaAddress } from "./keys";
/**
 * Total size of stealth OP_RETURN data
 * = 32 bytes (commitment only, no header needed - program ID identifies scheme)
 */
export declare const STEALTH_OP_RETURN_SIZE = 32;
/** Instruction discriminator for verify_stealth_deposit */
export declare const VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = 20;
/**
 * Prepared stealth deposit data for BTC transaction
 */
export interface PreparedStealthDeposit {
    /** Taproot address to send BTC to */
    btcDepositAddress: string;
    /** Hex data to embed in OP_RETURN output (34 bytes) */
    opReturnData: Uint8Array;
    /** Exact amount to send (in satoshis) */
    amountSats: bigint;
    /** Stealth data for Solana announcement */
    stealthData: StealthDepositData;
}
/**
 * Internal stealth deposit data (single ephemeral key)
 */
export interface StealthDepositData {
    /** Single Grumpkin ephemeral public key (33 bytes compressed) */
    ephemeralPub: Uint8Array;
    /** Commitment for Merkle tree (32 bytes) */
    commitment: Uint8Array;
}
/**
 * Parsed stealth data from OP_RETURN
 */
export interface ParsedStealthOpReturn {
    commitment: Uint8Array;
}
/**
 * Prepare a stealth deposit for a recipient (MINIMAL FORMAT)
 *
 * Uses EIP-5564/DKSAP pattern with single Grumpkin ephemeral key.
 *
 * BTC transaction outputs:
 * - Output 1: amount to btcDepositAddress (Taproot)
 * - Output 2: OP_RETURN with commitment only (34 bytes)
 *
 * Stealth derivation:
 * 1. sharedSecret = ECDH(ephemeral.priv, viewingPub)
 * 2. stealthPub = spendingPub + hash(sharedSecret) * G
 * 3. commitment = Poseidon2(stealthPub.x, amount)
 *
 * @param params - Deposit parameters
 * @returns Prepared deposit data
 */
export declare function prepareStealthDeposit(params: {
    recipientMeta: StealthMetaAddress;
    amountSats: bigint;
    network: "testnet" | "mainnet";
}): Promise<PreparedStealthDeposit>;
/**
 * Build the OP_RETURN script data (MINIMAL FORMAT)
 *
 * Layout (32 bytes):
 * - [0-31]   commitment (32 bytes, raw)
 *
 * No magic/version needed - program ID identifies the scheme.
 * Ephemeral key is stored on Solana StealthAnnouncement only.
 */
export declare function buildStealthOpReturn(params: {
    commitment: Uint8Array;
}): Uint8Array;
/**
 * Parse stealth data from OP_RETURN (32-byte commitment)
 */
export declare function parseStealthOpReturn(data: Uint8Array): ParsedStealthOpReturn | null;
/**
 * Derive stealth announcement PDA
 *
 * Uses ephemeral Grumpkin public key (33 bytes) as seed.
 */
export declare function deriveStealthAnnouncementPDA(programId: PublicKey, ephemeralPub: Uint8Array): [PublicKey, number];
/**
 * Verify a stealth deposit on Solana
 *
 * Calls the verify_stealth_deposit instruction which:
 * 1. Verifies the BTC transaction via SPV
 * 2. Parses commitment from OP_RETURN
 * 3. Adds commitment to Merkle tree
 * 4. Creates stealth announcement with leaf_index
 *
 * Note: The ephemeralPub must be provided separately since the OP_RETURN
 * only contains the commitment. The ephemeral key is stored in the
 * StealthAnnouncement for recipient scanning.
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param btcTxid - Bitcoin transaction ID (hex string)
 * @param expectedValue - Expected deposit value in satoshis
 * @param ephemeralPub - Grumpkin ephemeral public key (33 bytes)
 * @param network - Bitcoin network
 * @param programId - Optional program ID override
 * @returns Transaction signature
 */
export declare function verifyStealthDeposit(connection: Connection, payer: Keypair, btcTxid: string, expectedValue: bigint, ephemeralPub: Uint8Array, network?: "mainnet" | "testnet", programId?: PublicKey): Promise<string>;
