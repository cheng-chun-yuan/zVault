/**
 * Taproot address utilities for zVault
 *
 * Generates commitment-bound Taproot addresses following BIP-340/341.
 * The deposit address is derived from the commitment, ensuring
 * cryptographic binding between the BTC deposit and the claim.
 */
/**
 * Derive a Taproot address from a commitment
 *
 * Following BIP-341:
 * tweak = H_TapTweak(internal_key || commitment)
 * output_key = internal_key + tweak * G
 * address = bech32m encode(output_key)
 *
 * @param commitment - 32-byte commitment hash
 * @param network - 'mainnet' | 'testnet' | 'regtest'
 * @param internalKey - Optional custom internal key (x-only, 32 bytes)
 * @returns Taproot address (bc1p... or tb1p...)
 */
export declare function deriveTaprootAddress(commitment: Uint8Array, network?: "mainnet" | "testnet" | "regtest", internalKey?: Uint8Array): Promise<{
    address: string;
    outputKey: Uint8Array;
    tweak: Uint8Array;
}>;
/**
 * Verify that a Taproot address is correctly derived from a commitment
 *
 * @param address - Taproot address to verify
 * @param commitment - Expected commitment
 * @param internalKey - Optional internal key
 * @returns true if address matches expected derivation
 */
export declare function verifyTaprootAddress(address: string, commitment: Uint8Array, internalKey?: Uint8Array): Promise<boolean>;
/**
 * Generate a P2TR (Pay-to-Taproot) script pubkey
 *
 * @param outputKey - 32-byte output key (x-only)
 * @returns Script pubkey bytes (OP_1 <32-byte key>)
 */
export declare function createP2TRScriptPubkey(outputKey: Uint8Array): Uint8Array;
/**
 * Parse P2TR script pubkey to extract output key
 *
 * @param scriptPubkey - Script pubkey bytes
 * @returns Output key or null if not P2TR
 */
export declare function parseP2TRScriptPubkey(scriptPubkey: Uint8Array): Uint8Array | null;
/**
 * Validate a Bitcoin address format
 */
export declare function isValidBitcoinAddress(address: string): {
    valid: boolean;
    type: "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr" | "unknown";
    network: "mainnet" | "testnet" | "unknown";
};
/**
 * Get the internal key used by zVault
 * In production, this would be the FROST threshold public key
 */
export declare function getInternalKey(): Uint8Array;
/**
 * Set a custom internal key (for testing or custom deployments)
 */
export declare function createCustomInternalKey(key: Uint8Array): Uint8Array;
