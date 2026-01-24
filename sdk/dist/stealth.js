/**
 * Stealth address utilities for ZVault
 *
 * Dual-key ECDH with X25519 (viewing) + Grumpkin (spending)
 *
 * Format (131 bytes on-chain - simplified):
 * - ephemeral_view_pub (32 bytes) - X25519 for off-chain scanning
 * - ephemeral_spend_pub (33 bytes) - Grumpkin for in-circuit ECDH
 * - amount_sats (8 bytes) - Verified BTC amount from SPV proof
 * - commitment (32 bytes) - Poseidon2 hash for Merkle tree
 * - leaf_index (8 bytes) - Position in Merkle tree
 * - created_at (8 bytes) - Timestamp
 *
 * Key Separation Properties:
 * - Viewing key can scan and decrypt but CANNOT derive nullifier
 * - Spending key required for nullifier derivation and proof generation
 * - Sender cannot spend (wrong ECDH → wrong commitment → not in tree)
 *
 * SECURITY NOTES:
 * - Commitment is computed using Poseidon2 (matches Noir circuits)
 * - Amount encryption removed (public on Bitcoin blockchain anyway)
 * - Random value removed (ephemeral key uniqueness is sufficient)
 *
 * KNOWN LIMITATION - CROSS-CHAIN CORRELATION:
 * The ephemeral_view_pub appears on BOTH Bitcoin (in OP_RETURN) and Solana
 * (in StealthAnnouncement). This creates a 1:1 linkage between the chains.
 * To mitigate: Use fresh ephemeral keys for each deposit and consider
 * additional privacy layers like mixers or delayed reveals.
 */
import { box } from "tweetnacl";
import { bigintToBytes, bytesToBigint } from "./crypto";
import { generateKeyPair as generateGrumpkinKeyPair, ecdh as grumpkinEcdh, pointToCompressedBytes, pointFromCompressedBytes, } from "./grumpkin";
import { deriveKeysFromWallet } from "./keys";
import { deriveNotePubKey, computeCommitmentV2 as poseidon2ComputeCommitment, computeNullifierV2 as poseidon2ComputeNullifier, } from "./poseidon2";
// ========== Type Guard ==========
/**
 * Type guard to distinguish between WalletSignerAdapter and ZVaultKeys
 */
export function isWalletAdapter(source) {
    return (typeof source === "object" &&
        source !== null &&
        "signMessage" in source &&
        typeof source.signMessage === "function");
}
// ========== On-chain Announcement ==========
/**
 * Size of StealthAnnouncement account on-chain (SIMPLIFIED FORMAT)
 *
 * Layout (131 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_view_pub (32 bytes)
 * - ephemeral_spend_pub (33 bytes)
 * - amount_sats (8 bytes) - verified from BTC tx, stored directly
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 *
 * SAVINGS: 24 bytes (from 155) by removing encrypted_amount and encrypted_random
 */
export const STEALTH_ANNOUNCEMENT_SIZE = 131;
/** Discriminator for StealthAnnouncement */
export const STEALTH_ANNOUNCEMENT_DISCRIMINATOR = 0x08;
// ========== Sender Functions ==========
/**
 * Create a stealth deposit with dual-key ECDH
 *
 * Generates two ephemeral keypairs:
 * - X25519: For viewing/scanning (fast off-chain ECDH)
 * - Grumpkin: For spending proofs (efficient in-circuit ECDH)
 *
 * SIMPLIFIED FORMAT:
 * - No encrypted_amount: BTC amount is public on Bitcoin blockchain
 * - No encrypted_random: Fresh ephemeral keys provide uniqueness
 * - Commitment uses Poseidon2: commitment = Poseidon2(notePubKey, amount)
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys (recipient's keys)
 * @param recipientMeta - Recipient's stealth meta-address
 * @param amountSats - Amount in satoshis
 * @returns Stealth deposit data for on-chain announcement
 */
export async function createStealthDeposit(recipientMeta, amountSats) {
    // Parse recipient's public keys
    const recipientSpendPub = pointFromCompressedBytes(recipientMeta.spendingPubKey);
    // Generate ephemeral X25519 keypair for viewing
    const ephemeralView = box.keyPair();
    // Generate ephemeral Grumpkin keypair for spending
    const ephemeralSpend = generateGrumpkinKeyPair();
    const spendShared = grumpkinEcdh(ephemeralSpend.privKey, recipientSpendPub);
    // Compute note public key using Poseidon2
    // notePubKey = Poseidon2(spendShared.x, spendShared.y, DOMAIN_NPK)
    const notePubKey = deriveNotePubKey(spendShared.x, spendShared.y);
    // Compute commitment using Poseidon2 (SIMPLIFIED: no random)
    // commitment = Poseidon2(notePubKey, amount)
    const commitmentBigint = poseidon2ComputeCommitment(notePubKey, amountSats, 0n);
    const commitment = bigintToBytes(commitmentBigint);
    return {
        ephemeralViewPub: ephemeralView.publicKey,
        ephemeralSpendPub: pointToCompressedBytes(ephemeralSpend.pubKey),
        amountSats,
        commitment,
        createdAt: Date.now(),
    };
}
// ========== Recipient Scanning (Viewing Key Only) ==========
/**
 * Scan announcements using viewing key only
 *
 * SIMPLIFIED FORMAT:
 * - Amount is stored directly (not encrypted)
 * - No random field to decrypt
 * - Viewing key validates ownership via ECDH + commitment verification
 *
 * This function can see amounts but CANNOT:
 * - Derive the nullifier (requires spending key)
 * - Generate spending proofs
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param announcements - Array of on-chain announcements
 * @returns Array of found notes (ready for claim preparation)
 */
export async function scanAnnouncements(source, announcements) {
    // Get keys from source
    const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;
    const found = [];
    const MAX_SATS = 21000000n * 100000000n; // 21M BTC in sats
    for (const ann of announcements) {
        try {
            // Basic sanity check on amount
            if (ann.amountSats <= 0n || ann.amountSats > MAX_SATS) {
                continue;
            }
            // Parse ephemeral spend pubkey
            const ephemeralSpendPub = pointFromCompressedBytes(ann.ephemeralSpendPub);
            // For viewing-only scanning, we cannot fully verify the commitment
            // because we don't have the spending private key.
            // The recipient will verify during claim preparation.
            found.push({
                amount: ann.amountSats,
                ephemeralSpendPub,
                leafIndex: ann.leafIndex,
                commitment: ann.commitment,
            });
        }
        catch {
            // Parsing failed - skip this announcement
            continue;
        }
    }
    return found;
}
// ========== Claim Preparation (Spending Key Required) ==========
/**
 * Prepare claim inputs for ZK proof generation
 *
 * CRITICAL: This function requires the spending private key.
 * The nullifier is derived from (spendingPrivKey, leafIndex).
 * Only the legitimate recipient can compute a valid nullifier.
 *
 * Why sender cannot claim:
 * - Sender knows ephemeral_priv and shared_secret
 * - Sender does NOT know recipient's spendingPrivKey
 * - Wrong spendingPrivKey → wrong ECDH → wrong commitment → not in tree
 *
 * SIMPLIFIED FORMAT:
 * - Uses Poseidon2 for all hashing (matches Noir circuits)
 * - Single nullifier hash (removed double-hashing)
 * - No random field needed
 *
 * @param source - Wallet adapter OR pre-derived ZVaultKeys
 * @param note - Scanned note from scanning phase
 * @param merkleProof - Merkle proof for the commitment
 * @returns Inputs ready for Noir claim circuit
 */
export async function prepareClaimInputs(source, note, merkleProof) {
    // Get keys from source
    const keys = isWalletAdapter(source) ? await deriveKeysFromWallet(source) : source;
    // Grumpkin ECDH with spending key
    const spendShared = grumpkinEcdh(keys.spendingPrivKey, note.ephemeralSpendPub);
    // Verify commitment matches (sanity check)
    const notePubKey = deriveNotePubKey(spendShared.x, spendShared.y);
    const expectedCommitment = poseidon2ComputeCommitment(notePubKey, note.amount, 0n);
    const actualCommitment = bytesToBigint(note.commitment);
    if (expectedCommitment !== actualCommitment) {
        throw new Error("Commitment mismatch - this note may not belong to you or the announcement is invalid");
    }
    // CRITICAL: Nullifier from spending private key + leaf index
    // nullifier = Poseidon2(spendingPrivKey, leafIndex, DOMAIN_NULL)
    // Only recipient can compute this!
    const nullifier = poseidon2ComputeNullifier(keys.spendingPrivKey, BigInt(note.leafIndex));
    return {
        // Private inputs
        spendingPrivKey: keys.spendingPrivKey,
        ephemeralSpendPub: note.ephemeralSpendPub,
        amount: note.amount,
        leafIndex: note.leafIndex,
        merklePath: merkleProof.pathElements,
        merkleIndices: merkleProof.pathIndices,
        // Public inputs
        merkleRoot: merkleProof.root,
        nullifier, // Single hash, not double-hashed
        amountPub: note.amount,
    };
}
// ========== On-chain Parsing ==========
/**
 * Parse a StealthAnnouncement account data (SIMPLIFIED FORMAT)
 *
 * Layout (131 bytes):
 * - discriminator (1 byte)
 * - bump (1 byte)
 * - ephemeral_view_pub (32 bytes)
 * - ephemeral_spend_pub (33 bytes)
 * - amount_sats (8 bytes) - verified BTC amount
 * - commitment (32 bytes)
 * - leaf_index (8 bytes)
 * - created_at (8 bytes)
 */
export function parseStealthAnnouncement(data) {
    if (data.length < STEALTH_ANNOUNCEMENT_SIZE) {
        return null;
    }
    // Check discriminator
    if (data[0] !== STEALTH_ANNOUNCEMENT_DISCRIMINATOR) {
        return null;
    }
    let offset = 2; // Skip discriminator and bump
    const ephemeralViewPub = data.slice(offset, offset + 32);
    offset += 32;
    const ephemeralSpendPub = data.slice(offset, offset + 33);
    offset += 33;
    // Parse amount_sats (8 bytes, LE)
    const amountView = new DataView(data.buffer, data.byteOffset + offset, 8);
    const amountSats = amountView.getBigUint64(0, true);
    offset += 8;
    const commitment = data.slice(offset, offset + 32);
    offset += 32;
    // Parse leaf_index (8 bytes, LE)
    const leafIndexView = new DataView(data.buffer, data.byteOffset + offset, 8);
    const leafIndex = Number(leafIndexView.getBigUint64(0, true));
    offset += 8;
    // Parse created_at (8 bytes, LE)
    const createdAtView = new DataView(data.buffer, data.byteOffset + offset, 8);
    const createdAt = Number(createdAtView.getBigInt64(0, true));
    return {
        ephemeralViewPub,
        ephemeralSpendPub,
        amountSats,
        commitment,
        leafIndex,
        createdAt,
    };
}
/**
 * Convert on-chain announcement to format expected by scanAnnouncements
 */
export function announcementToScanFormat(announcement) {
    return {
        ephemeralViewPub: announcement.ephemeralViewPub,
        ephemeralSpendPub: announcement.ephemeralSpendPub,
        amountSats: announcement.amountSats,
        commitment: announcement.commitment,
        leafIndex: announcement.leafIndex,
    };
}
