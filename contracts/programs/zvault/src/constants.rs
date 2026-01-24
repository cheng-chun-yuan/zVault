//! Program constants

/// Minimum deposit amount in satoshis (0.0001 BTC)
pub const MIN_DEPOSIT_SATS: u64 = 10_000;

/// Maximum deposit amount in satoshis (1000 BTC)
pub const MAX_DEPOSIT_SATS: u64 = 100_000_000_000;

/// Required Bitcoin confirmations
pub const REQUIRED_CONFIRMATIONS: u32 = 2;

/// Groth16 proof size in bytes
pub const PROOF_SIZE: usize = 256;

/// Maximum BTC address length (bech32m)
pub const MAX_BTC_ADDRESS_LEN: usize = 62;

/// Maximum Bitcoin txid length (hex string)
pub const MAX_BTC_TXID_LEN: usize = 64;

/// Token-2022 program ID (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
pub const TOKEN_2022_PROGRAM_ID: [u8; 32] = [
    0x06, 0xdd, 0xf6, 0xe1, 0xee, 0x75, 0x8f, 0xde,
    0x18, 0x42, 0x5d, 0xbc, 0xe4, 0x6c, 0xcd, 0xda,
    0xb6, 0x1a, 0xfc, 0x4d, 0x83, 0xb9, 0x0d, 0x27,
    0xfe, 0xbd, 0xf9, 0x28, 0xd8, 0xa1, 0x8b, 0xfc,
];
