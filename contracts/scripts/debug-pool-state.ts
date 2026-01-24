import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("CBzbSQPcUXMYdmSvnA24HPZrDQPuEpq4qq2mcmErrWPR");
const POOL_STATE_SEED = Buffer.from("pool_state");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const [poolStatePda] = PublicKey.findProgramAddressSync([POOL_STATE_SEED], PROGRAM_ID);
  console.log("Pool State PDA:", poolStatePda.toBase58());
  
  const poolAccount = await connection.getAccountInfo(poolStatePda);
  if (!poolAccount) {
    console.log("Pool not initialized!");
    return;
  }
  
  console.log("\nPool State Data (first 200 bytes):");
  console.log("Length:", poolAccount.data.length);
  console.log("Owner:", poolAccount.owner.toBase58());
  
  // Parse pool state
  const data = poolAccount.data;
  console.log("\nParsed fields:");
  console.log("  discriminator:", data[0]);
  console.log("  bump:", data[1]);
  console.log("  flags:", data[2]);
  console.log("  authority:", new PublicKey(data.slice(4, 36)).toBase58());
  console.log("  sbbtc_mint:", new PublicKey(data.slice(36, 68)).toBase58());
  
  // Check if the mint exists
  const sbbtcMint = new PublicKey(data.slice(36, 68));
  const mintAccount = await connection.getAccountInfo(sbbtcMint);
  console.log("\nsbBTC Mint account:");
  if (mintAccount) {
    console.log("  exists: true");
    console.log("  owner:", mintAccount.owner.toBase58());
    console.log("  data length:", mintAccount.data.length);
  } else {
    console.log("  exists: false - MINT NOT FOUND!");
  }
}

main().catch(console.error);
