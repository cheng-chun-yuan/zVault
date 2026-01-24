/**
 * Test Data for sbBTC Demo
 *
 * Simple seed-based demo notes. The seed IS the claim link!
 * Format: free-coupon-01, free-coupon-02, etc.
 */

export interface TestNote {
  seed: string;
  amountSats: number;
  claimLink: string;
  description: string;
}

/**
 * Pre-defined demo notes with simple seed-based claim links.
 *
 * To claim: just enter the seed (e.g., "free-coupon-01")
 * The nullifier and secret are derived from the seed automatically.
 */
export const DEMO_NOTES: TestNote[] = [
  {
    seed: "free-coupon-01",
    amountSats: 100000,
    claimLink: "free-coupon-01",
    description: "Coupon #1: 0.001 BTC (100,000 sats)",
  },
  {
    seed: "free-coupon-02",
    amountSats: 50000,
    claimLink: "free-coupon-02",
    description: "Coupon #2: 0.0005 BTC (50,000 sats)",
  },
  {
    seed: "free-coupon-03",
    amountSats: 200000,
    claimLink: "free-coupon-03",
    description: "Coupon #3: 0.002 BTC (200,000 sats) - Split Demo",
  },
  {
    seed: "free-coupon-04",
    amountSats: 75000,
    claimLink: "free-coupon-04",
    description: "Coupon #4: 0.00075 BTC (75,000 sats)",
  },
  {
    seed: "free-coupon-05",
    amountSats: 150000,
    claimLink: "free-coupon-05",
    description: "Coupon #5: 0.0015 BTC (150,000 sats)",
  },
  {
    seed: "free-coupon-06",
    amountSats: 25000,
    claimLink: "free-coupon-06",
    description: "Coupon #6: 0.00025 BTC (25,000 sats)",
  },
  {
    seed: "free-coupon-07",
    amountSats: 500000,
    claimLink: "free-coupon-07",
    description: "Coupon #7: 0.005 BTC (500,000 sats) - Large",
  },
  {
    seed: "free-coupon-08",
    amountSats: 80000,
    claimLink: "free-coupon-08",
    description: "Coupon #8: 0.0008 BTC (80,000 sats)",
  },
  {
    seed: "free-coupon-09",
    amountSats: 120000,
    claimLink: "free-coupon-09",
    description: "Coupon #9: 0.0012 BTC (120,000 sats)",
  },
  {
    seed: "free-coupon-10",
    amountSats: 300000,
    claimLink: "free-coupon-10",
    description: "Coupon #10: 0.003 BTC (300,000 sats)",
  },
];

/**
 * In-memory store for claimed seeds (demo mode)
 */
export const claimedSeeds = new Set<string>();

/**
 * Find a demo note by seed
 */
export function findDemoNote(seed: string): TestNote | undefined {
  return DEMO_NOTES.find(note => note.seed === seed);
}

/**
 * Check if a seed has been claimed
 */
export function isSeedClaimed(seed: string): boolean {
  return claimedSeeds.has(seed);
}

/**
 * Mark a seed as claimed
 */
export function markSeedClaimed(seed: string): void {
  claimedSeeds.add(seed);
}

/**
 * Reset claimed seeds (for demo reset)
 */
export function resetClaimedSeeds(): void {
  claimedSeeds.clear();
}

/**
 * Get full claim URL for a test note
 */
export function getClaimUrl(note: TestNote, baseUrl = "http://localhost:3000"): string {
  return `${baseUrl}/claim?note=${encodeURIComponent(note.claimLink)}`;
}

/**
 * Get all demo claim links for display
 */
export function getDemoClaimLinks(baseUrl = "http://localhost:3000"): Array<{
  url: string;
  amount: string;
  description: string;
}> {
  return DEMO_NOTES.map(note => ({
    url: getClaimUrl(note, baseUrl),
    amount: `${(note.amountSats / 100_000_000).toFixed(8)} BTC`,
    description: note.description,
  }));
}
