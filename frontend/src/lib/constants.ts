// Centralized application constants

// Import program IDs from SDK (single source of truth)
export { ZVAULT_PROGRAM_ID } from "@zvault/sdk";

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

// zVault Solana Program Configuration (other addresses from env)
export const BTC_LIGHT_CLIENT_ID = process.env.NEXT_PUBLIC_BTC_LIGHT_CLIENT || "8qntLj65faXiqMKcQypyJ389Yq6MBU5X7AB5qsLnvKgy";
export const POOL_STATE_ADDRESS = process.env.NEXT_PUBLIC_POOL_STATE || "9oEs3fjvP7xg3xhcwBhrS7Q5LNv53oTVViKuJauWqLT5";
export const COMMITMENT_TREE_ADDRESS = process.env.NEXT_PUBLIC_COMMITMENT_TREE || "oyKoCdXQ2Jh3FuV15KK4Ar9g7m57XF2L4edmYnLFXRb";
export const ZBTC_MINT_ADDRESS = process.env.NEXT_PUBLIC_ZBTC_MINT || "6dzRonQCS3xdtKPdf4eBnrjzQBFEHQH4Amh7TuedUyy3";
