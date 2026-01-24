import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR");
const NULLIFIER_SEED = Buffer.from("nullifier");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // From coupon-notes.json - free-coupon-01
  const nullifierHash = "3005510763385824175376771089252463163066704810906628074678168965486248234834";
  const nullifierHashBytes = bigintToBytes32(BigInt(nullifierHash));
  
  // Derive nullifier PDA
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [NULLIFIER_SEED, nullifierHashBytes],
    PROGRAM_ID
  );
  
  console.log("Nullifier PDA:", nullifierPda.toBase58());
  
  // Check if nullifier account exists
  const nullifierAccount = await connection.getAccountInfo(nullifierPda);
  console.log("\nNullifier Account:");
  if (nullifierAccount) {
    console.log("  exists: true");
    console.log("  owner:", nullifierAccount.owner.toBase58());
    console.log("  data length:", nullifierAccount.data.length);
    console.log("  lamports:", nullifierAccount.lamports);
  } else {
    console.log("  exists: false - ACCOUNT NOT CREATED!");
    console.log("  The claim instruction needs to create this PDA.");
  }
  
  // Check token account
  const userTokenAccount = new PublicKey("7fhFYuMkXeWa7HrheEDDiNn1CxE7vVXYKFCTHiVrFMyj");
  const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
  console.log("\nUser Token Account:");
  if (tokenAccountInfo) {
    console.log("  exists: true");
    console.log("  owner:", tokenAccountInfo.owner.toBase58());
    console.log("  data length:", tokenAccountInfo.data.length);
  } else {
    console.log("  exists: false - TOKEN ACCOUNT NOT FOUND!");
  }
}

function bigintToBytes32(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

main().catch(console.error);
