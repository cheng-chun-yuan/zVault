"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.solanaKeyToX25519 = solanaKeyToX25519;
exports.solanaPubKeyToX25519 = solanaPubKeyToX25519;
exports.generateStealthKeys = generateStealthKeys;
exports.getStealthSharedSecret = getStealthSharedSecret;
exports.createStealthDeposit = createStealthDeposit;
exports.createStealthDepositForSolana = createStealthDepositForSolana;
exports.scanAnnouncements = scanAnnouncements;
exports.scanAnnouncementsWithSolana = scanAnnouncementsWithSolana;
const tweetnacl_1 = require("tweetnacl");
const ed2curve_1 = require("ed2curve");
const crypto_1 = require("./crypto");
// ========== Option A: Ed25519 → X25519 (Linked to Solana) ==========
function solanaKeyToX25519(ed25519PrivKey) {
    const viewPrivKey = (0, ed2curve_1.convertSecretKey)(ed25519PrivKey);
    const keyPair = tweetnacl_1.box.keyPair.fromSecretKey(viewPrivKey);
    return { viewPrivKey: viewPrivKey, viewPubKey: keyPair.publicKey };
}
function solanaPubKeyToX25519(ed25519PubKey) {
    return (0, ed2curve_1.convertPublicKey)(ed25519PubKey);
}
// ========== Option B: Native X25519 (Maximum Privacy) ==========
function generateStealthKeys() {
    const keyPair = tweetnacl_1.box.keyPair();
    return { viewPrivKey: keyPair.secretKey, viewPubKey: keyPair.publicKey };
}
// ========== Core Functions ==========
/**
 * Computes a shared secret using ECDH.
 * If no private key is provided, a new one is generated on the fly (ephemeral).
 */
function getStealthSharedSecret(recipientPubKey, senderPrivKey) {
    let priv = senderPrivKey;
    let pub;
    if (priv) {
        pub = tweetnacl_1.box.keyPair.fromSecretKey(priv).publicKey;
    }
    else {
        const keyPair = tweetnacl_1.box.keyPair();
        priv = keyPair.secretKey;
        pub = keyPair.publicKey;
    }
    const sharedSecret = (0, tweetnacl_1.scalarMult)(priv, recipientPubKey);
    return { sharedSecret, senderPubKey: pub };
}
/**
 * Derive deterministic values from shared secret using SHA256
 *
 * This KDF generates field elements that will be used as inputs to Noir circuits.
 * The circuits compute Poseidon2 hashes internally.
 */
function deriveStealthSecrets(sharedSecret, amount) {
    // Derive nullifier from H(sharedSecret || "nullifier" || amount)
    const encoder = new TextEncoder();
    const amountBytes = (0, crypto_1.bigintToBytes)(amount);
    const nullifierInput = new Uint8Array(32 + 9 + 32);
    nullifierInput.set(sharedSecret, 0);
    nullifierInput.set(encoder.encode("nullifier"), 32);
    nullifierInput.set(amountBytes, 41);
    const nullifierHash = (0, crypto_1.sha256Hash)(nullifierInput);
    const nullifier = (0, crypto_1.bytesToBigint)(nullifierHash) % crypto_1.BN254_FIELD_PRIME;
    // Derive secret from H(sharedSecret || "secret" || amount)
    const secretInput = new Uint8Array(32 + 6 + 32);
    secretInput.set(sharedSecret, 0);
    secretInput.set(encoder.encode("secret"), 32);
    secretInput.set(amountBytes, 38);
    const secretHash = (0, crypto_1.sha256Hash)(secretInput);
    const secret = (0, crypto_1.bytesToBigint)(secretHash) % crypto_1.BN254_FIELD_PRIME;
    // Derive amount encryption key from H(sharedSecret || "amount")
    const amountKeyInput = new Uint8Array(32 + 6);
    amountKeyInput.set(sharedSecret, 0);
    amountKeyInput.set(encoder.encode("amount"), 32);
    const amountKeyHash = (0, crypto_1.sha256Hash)(amountKeyInput);
    const amountKey = (0, crypto_1.bytesToBigint)(amountKeyHash);
    return { nullifier, secret, amountKey };
}
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
function createStealthDeposit(recipientX25519Pub, amountSats) {
    const { sharedSecret, senderPubKey: ephemeralPubKey } = getStealthSharedSecret(recipientX25519Pub);
    const { nullifier, secret, amountKey } = deriveStealthSecrets(sharedSecret, amountSats);
    // Encrypt amount with XOR
    const encryptedAmount = bigintToBytes8(amountSats ^ (amountKey & 0xffffffffffffffffn));
    // Generate recipient hint: first 4 bytes of recipient pubkey hash
    const recipientHash = (0, crypto_1.sha256Hash)(recipientX25519Pub);
    const recipientHint = recipientHash.slice(0, 4);
    return {
        ephemeralPubKey,
        encryptedAmount,
        recipientHint,
        nullifier,
        secret,
        amount: amountSats,
    };
}
/**
 * Create a stealth deposit for a Solana recipient
 */
function createStealthDepositForSolana(recipientSolanaPubKey, amountSats) {
    return createStealthDeposit(solanaPubKeyToX25519(recipientSolanaPubKey), amountSats);
}
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
function scanAnnouncements(viewPrivKey, _viewPubKey, // kept for API compatibility
announcements) {
    const found = [];
    const MAX_SATS = 21000000n * 100000000n; // 21M BTC in sats
    for (const ann of announcements) {
        // ECDH with our view private key (try all - no hint filtering)
        const { sharedSecret } = getStealthSharedSecret(ann.ephemeralPubKey, viewPrivKey);
        // Decrypt amount
        const encoder = new TextEncoder();
        const amountKeyInput = new Uint8Array(32 + 6);
        amountKeyInput.set(sharedSecret, 0);
        amountKeyInput.set(encoder.encode("amount"), 32);
        const amountKeyHash = (0, crypto_1.sha256Hash)(amountKeyInput);
        const amountKey = (0, crypto_1.bytesToBigint)(amountKeyHash);
        const amount = bytes8ToBigint(ann.encryptedAmount) ^ (amountKey & 0xffffffffffffffffn);
        // Basic sanity check: amount should be reasonable
        // If wrong key, decrypted amount will likely be garbage (huge number)
        if (amount <= 0n || amount > MAX_SATS) {
            continue; // Probably not ours
        }
        // Derive secrets
        const { nullifier, secret } = deriveStealthSecrets(sharedSecret, amount);
        // Note: We cannot verify commitment here without Poseidon2
        // The caller should verify via Noir circuit if needed
        found.push({ nullifier, secret, amount });
    }
    return found;
}
/**
 * Scan announcements using Solana keypair
 */
function scanAnnouncementsWithSolana(solanaPrivKey, announcements) {
    const { viewPrivKey, viewPubKey } = solanaKeyToX25519(solanaPrivKey);
    return scanAnnouncements(viewPrivKey, viewPubKey, announcements);
}
// ========== Utilities ==========
function bigintToBytes8(value) {
    const bytes = new Uint8Array(8);
    let v = value;
    for (let i = 7; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}
function bytes8ToBigint(bytes) {
    let result = 0n;
    for (let i = 0; i < 8; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}
// arraysEqual removed - no longer needed without recipient hint filtering
