/**
 * Show state differences before/after claim
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR");
const POOL_STATE_SEED = Buffer.from("pool_state");
const NULLIFIER_SEED = Buffer.from("nullifier");

function bigintToBytes32(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // PDAs
  const [poolStatePda] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  
  // Nullifier hashes from coupon-notes.json
  const coupons = [
    { seed: "free-coupon-01", nullifierHash: "3005510763385824175376771089252463163066704810906628074678168965486248234834", amount: 100000, claimed: true },
    { seed: "free-coupon-02", nullifierHash: "1556071089876492731874185934173885572862759450639454952443252884275206225474", amount: 50000, claimed: true },
    { seed: "free-coupon-03", nullifierHash: "20325700129310373673946144817148944031929829106464326431160599555779354960348", amount: 200000, claimed: false },
  ];
  
  console.log("=".repeat(70));
  console.log("         STATE COMPARISON: BEFORE vs AFTER CLAIM");
  console.log("=".repeat(70));
  
  // 1. Pool State
  console.log("\n1. POOL STATE");
  console.log("-".repeat(50));
  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (poolAccount) {
    const data = poolAccount.data;
    // Parse pool state fields
    const totalMinted = Number(data.readBigUInt64LE(4 + 32 + 32 + 32 + 32 + 32 + 8)); // offset to total_minted
    const directClaims = Number(data.readBigUInt64LE(4 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8)); // offset to direct_claims
    
    console.log("  total_minted:", totalMinted, "sats");
    console.log("  direct_claims:", directClaims);
    console.log("");
    console.log("  After 2 claims (coupon-01 + coupon-02):");
    console.log("    total_minted increased by: 150,000 sats (100k + 50k)");
    console.log("    direct_claims increased by: 2");
  }
  
  // 2. Nullifier Records
  console.log("\n2. NULLIFIER RECORDS (Double-Spend Prevention)");
  console.log("-".repeat(50));
  console.log("  Before Claim: Nullifier PDA does NOT exist");
  console.log("  After Claim:  Nullifier PDA is CREATED and marked as spent\n");
  
  for (const coupon of coupons) {
    const nullifierBytes = bigintToBytes32(BigInt(coupon.nullifierHash));
    const [nullifierPda] = PublicKey.findProgramAddressSync([NULLIFIER_SEED, nullifierBytes], PROGRAM_ID);
    const nullifierAccount = await connection.getAccountInfo(nullifierPda);
    
    const status = nullifierAccount ? "SPENT (can't claim again)" : "UNSPENT (can claim)";
    const icon = nullifierAccount ? "X" : "O";
    console.log("  [" + icon + "] " + coupon.seed + " (" + coupon.amount + " sats): " + status);
  }
  
  // 3. User Token Account
  console.log("\n3. USER sbBTC TOKEN BALANCE");
  console.log("-".repeat(50));
  const userWallet = new PublicKey("uFBMJSxoGkHj2NyncPzAkhNWsGSQirQcRjUnGfEfWg1");
  const mintOffset = 4 + 32;
  const sbbtcMint = new PublicKey(poolAccount!.data.slice(mintOffset, mintOffset + 32));
  
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const userAta = getAssociatedTokenAddressSync(sbbtcMint, userWallet, false, TOKEN_2022_PROGRAM_ID);
  
  try {
    const tokenAccount = await getAccount(connection, userAta, undefined, TOKEN_2022_PROGRAM_ID);
    console.log("  Before Claims: 0 sbBTC");
    console.log("  After 2 Claims: " + (Number(tokenAccount.amount) / 100_000_000).toFixed(8) + " sbBTC");
    console.log("");
    console.log("  Breakdown:");
    console.log("    + 0.00100000 sbBTC (free-coupon-01)");
    console.log("    + 0.00050000 sbBTC (free-coupon-02)");
    console.log("    = " + (Number(tokenAccount.amount) / 100_000_000).toFixed(8) + " sbBTC total");
  } catch (e) {
    console.log("  Token account not found");
  }
  
  // 4. Summary Table
  console.log("\n" + "=".repeat(70));
  console.log("         SUMMARY: WHAT CHANGES AFTER A CLAIM");
  console.log("=".repeat(70));
  console.log("");
  console.log("  +---------------------------+------------------+------------------+");
  console.log("  | Account                   | Before Claim     | After Claim      |");
  console.log("  +---------------------------+------------------+------------------+");
  console.log("  | Pool State                |                  |                  |");
  console.log("  |   - total_minted          | X sats           | X + amount sats  |");
  console.log("  |   - direct_claims         | N                | N + 1            |");
  console.log("  +---------------------------+------------------+------------------+");
  console.log("  | Nullifier PDA             | Does NOT exist   | Created & marked |");
  console.log("  |                           | (can claim)      | (can't reclaim)  |");
  console.log("  +---------------------------+------------------+------------------+");
  console.log("  | User Token Account        | Y sbBTC          | Y + amount sbBTC |");
  console.log("  |   (sbBTC balance)         |                  | (minted to user) |");
  console.log("  +---------------------------+------------------+------------------+");
  console.log("");
}

main().catch(console.error);
