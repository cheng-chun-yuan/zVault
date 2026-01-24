/**
 * Stealth address utilities for ZVault
 *
 * Implements stealth address functionality using X25519 ECDH.
 * Minimal 40-byte announcement format for maximum privacy:
 * - ephemeral_pubkey (32 bytes) - required for ECDH
 * - encrypted_amount (8 bytes) - required to compute commitment
 * - NO recipient_hint - prevents linking deposits to same recipient
 *
 * IMPORTANT: Noir circuits use Poseidon2 hashing which is not directly
 * available in this SDK. The stealth key derivation uses SHA256-based
 * KDF, and the derived secrets (nullifier, secret) are used as inputs
 * to Noir circuits which compute the actual Poseidon2 hashes.
 */
export interface StealthKeys {
    viewPrivKey: Uint8Array;
    viewPubKey: Uint8Array;
}
export interface StealthDeposit {
    ephemeralPubKey: Uint8Array;
    encryptedAmount: Uint8Array;
    recipientHint: Uint8Array;
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
}
export declare function solanaKeyToX25519(ed25519PrivKey: Uint8Array): StealthKeys;
export declare function solanaPubKeyToX25519(ed25519PubKey: Uint8Array): Uint8Array;
export declare function generateStealthKeys(): StealthKeys;
/**
 * Computes a shared secret using ECDH.
 * If no private key is provided, a new one is generated on the fly (ephemeral).
 */
export declare function getStealthSharedSecret(recipientPubKey: Uint8Array, senderPrivKey?: Uint8Array): {
    sharedSecret: Uint8Array;
    senderPubKey: Uint8Array;
};
/**
 * Create a stealth deposit (minimal 40-byte format)
 *
 * Generates ephemeral keypair, derives secrets via ECDH + KDF.
 * The nullifier and secret are used as inputs to Noir circuits
 * which compute the Poseidon2-based commitment internally.
 *
 * No recipient hint is included for maximum privacy - recipient
 * must try ECDH on all announcements to find their deposits.
 */
export declare function createStealthDeposit(recipientX25519Pub: Uint8Array, amountSats: bigint): StealthDeposit;
/**
 * Create a stealth deposit for a Solana recipient
 */
export declare function createStealthDepositForSolana(recipientSolanaPubKey: Uint8Array, amountSats: bigint): StealthDeposit;
/**
 * Scan announcements for deposits belonging to us
 *
 * Maximum privacy mode: tries ECDH on ALL announcements (no hint filtering).
 * This prevents any linkability between deposits to the same recipient.
 *
 * To verify ownership, the function checks if the decrypted amount is
 * reasonable (> 0 and < 21M BTC). For full verification, use a Noir
 * helper circuit to compute and compare Poseidon2 commitments.
 */
export declare function scanAnnouncements(viewPrivKey: Uint8Array, _viewPubKey: Uint8Array, // kept for API compatibility
announcements: {
    ephemeralPubKey: Uint8Array;
    encryptedAmount: Uint8Array;
}[]): {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
}[];
/**
 * Scan announcements using Solana keypair
 */
export declare function scanAnnouncementsWithSolana(solanaPrivKey: Uint8Array, announcements: {
    ephemeralPubKey: Uint8Array;
    encryptedAmount: Uint8Array;
}[]): {
    nullifier: bigint;
    secret: bigint;
    amount: bigint;
}[];
