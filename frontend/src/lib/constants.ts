// Centralized application constants

// Timing constants
export const POLLING_INTERVAL_MS = 30_000;
export const COPY_TIMEOUT_MS = 2_000;
export const STATS_REFRESH_MS = 60_000;

// Bitcoin constants
export const SATS_PER_BTC = 100_000_000;

// Validation limits
export const MIN_DEPOSIT_SATS = 1_000;
export const MAX_DEPOSIT_SATS = 10_000_000_000; // 100 BTC
export const MIN_WITHDRAWAL_SATS = 10_000;

// Bitcoin address regex (bech32 and legacy)
export const BTC_ADDRESS_REGEX = /^(bc1|[13]|tb1)[a-zA-HJ-NP-Z0-9]{25,62}$/;

// zVault Solana Program Configuration
export const ZVAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || "AtztELZfz3GHA8hFQCv7aT9Mt47Xhknv3ZCNb3fmXsgf";
export const POOL_STATE_ADDRESS = process.env.NEXT_PUBLIC_POOL_STATE || "8bbcVecB619HHsHn2TQMraJ8R8WjQjApdZY7h9JCJW7b";
export const COMMITMENT_TREE_ADDRESS = process.env.NEXT_PUBLIC_COMMITMENT_TREE || "HtfDXZ5mBQNBdZrDxJMbXCDkyUqFdTDj7zAqo3aqrqiA";
export const SBBTC_MINT_ADDRESS = process.env.NEXT_PUBLIC_SBBTC_MINT || "HiDyAcEBTS7SRiLA49BZ5B6XMBAksgwLEAHpvteR8vbV";
