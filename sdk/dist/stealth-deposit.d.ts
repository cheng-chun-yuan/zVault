/**
 * Stealth Deposit utilities for ZVault
 *
 * Combines BTC deposit verification with automatic stealth announcement.
 * When a user deposits BTC to a recipient's stealth address, after SPV
 * verification the commitment goes directly to the recipient - no
 * separate claim step needed.
 *
 * OP_RETURN Format (SIMPLIFIED - 99 bytes, down from 142):
 * - [0]       Magic: 0x7A ('z' for zVault stealth)
 * - [1]       Version (1 byte)
 * - [2-33]    ephemeral_view_pub (32 bytes, X25519)
 * - [34-66]   ephemeral_spend_pub (33 bytes, Grumpkin compressed)
 * - [67-98]   commitment (32 bytes, Poseidon2 hash)
 *
 * SECURITY IMPROVEMENTS:
 * - Removed encrypted_amount (8 bytes): BTC amount is public on blockchain
 * - Removed encrypted_random (32 bytes): Ephemeral key uniqueness sufficient
 * - Reduced version field (3 bytes saved): 1 byte is enough
 * - Total savings: 43 bytes (142 → 99)
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { StealthMetaAddress } from "./keys";
/** Magic byte for stealth OP_RETURN */
export declare const STEALTH_OP_RETURN_MAGIC = 122;
/** Current version for stealth OP_RETURN format (simplified) */
export declare const STEALTH_OP_RETURN_VERSION = 2;
/**
 * Total size of stealth OP_RETURN data (SIMPLIFIED)
 * = 1 (magic) + 1 (version) + 32 (view pub) + 33 (spend pub) + 32 (commitment)
 */
export declare const STEALTH_OP_RETURN_SIZE = 99;
/** Legacy size for backward compatibility parsing */
export declare const STEALTH_OP_RETURN_SIZE_V1 = 142;
/** Instruction discriminator for verify_stealth_deposit */
export declare const VERIFY_STEALTH_DEPOSIT_DISCRIMINATOR = 20;
/**
 * Prepared stealth deposit data for BTC transaction
 */
export interface PreparedStealthDeposit {
    /** Taproot address to send BTC to */
    btcDepositAddress: string;
    /** Hex data to embed in OP_RETURN output */
    opReturnData: Uint8Array;
    /** Exact amount to send (in satoshis) */
    amountSats: bigint;
    /** Stealth data for verification later */
    stealthData: StealthDepositData;
}
/**
 * Internal stealth deposit data (SIMPLIFIED)
 */
export interface StealthDepositData {
    /** X25519 ephemeral public key (32 bytes) */
    ephemeralViewPub: Uint8Array;
    /** Grumpkin ephemeral public key (33 bytes compressed) */
    ephemeralSpendPub: Uint8Array;
    /** Commitment for Merkle tree (32 bytes) */
    commitment: Uint8Array;
}
/**
 * Parsed stealth data from OP_RETURN (SIMPLIFIED)
 */
export interface ParsedStealthOpReturn {
    version: number;
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    commitment: Uint8Array;
}
/**
 * Prepare a stealth deposit for a recipient (SIMPLIFIED FORMAT)
 *
 * Generates ephemeral keypairs and creates the OP_RETURN.
 * The sender then creates a BTC transaction with:
 * - Output 1: amount to btcDepositAddress
 * - Output 2: OP_RETURN with opReturnData
 *
 * SECURITY IMPROVEMENTS:
 * - Uses Poseidon2 for commitment (matches Noir circuits)
 * - No encrypted_amount: BTC amount is public on blockchain
 * - No encrypted_random: Fresh ephemeral keys provide uniqueness
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
 * Build the OP_RETURN script data (SIMPLIFIED FORMAT)
 *
 * Layout (99 bytes):
 * - [0]      Magic: 0x7A
 * - [1]      Version: 2
 * - [2-33]   ephemeral_view_pub (32 bytes)
 * - [34-66]  ephemeral_spend_pub (33 bytes)
 * - [67-98]  commitment (32 bytes)
 */
export declare function buildStealthOpReturn(params: {
    ephemeralViewPub: Uint8Array;
    ephemeralSpendPub: Uint8Array;
    commitment: Uint8Array;
}): Uint8Array;
/**
 * Parse stealth data from OP_RETURN (SIMPLIFIED FORMAT)
 *
 * Supports both V1 (legacy 142 bytes) and V2 (simplified 99 bytes) formats.
 */
export declare function parseStealthOpReturn(data: Uint8Array): ParsedStealthOpReturn | null;
/**
 * Derive stealth announcement PDA
 */
export declare function deriveStealthAnnouncementPDA(programId: PublicKey, ephemeralViewPub: Uint8Array): [PublicKey, number];
/**
 * Verify a stealth deposit on Solana
 *
 * Calls the verify_stealth_deposit instruction which:
 * 1. Verifies the BTC transaction via SPV
 * 2. Parses stealth data from OP_RETURN
 * 3. Adds commitment to Merkle tree
 * 4. Creates stealth announcement with leaf_index
 *
 * @param connection - Solana connection
 * @param payer - Transaction fee payer
 * @param btcTxid - Bitcoin transaction ID (hex string)
 * @param expectedValue - Expected deposit value in satoshis
 * @param network - Bitcoin network
 * @param programId - Optional program ID override
 * @returns Transaction signature
 */
export declare function verifyStealthDeposit(connection: Connection, payer: Keypair, btcTxid: string, expectedValue: bigint, network?: "mainnet" | "testnet", programId?: PublicKey): Promise<string>;
