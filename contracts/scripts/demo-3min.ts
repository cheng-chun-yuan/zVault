/**
 * sbBTC 3-Minute Demo
 *
 * Run: bun run scripts/demo-3min.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { buildPoseidon } from 'circomlibjs';

const BTC_LIGHT_CLIENT = new PublicKey("8GCjjPpzRP1DhWa9PLcRhSV7aLFkE8x7vf5royAQzUfG");
const ZVAULT = new PublicKey("4qCkVgFUWQENxPXq86ccN7ZjBgyx7ehbkkfCXxCmrn4F");

const toHex = (bn: bigint): string => bn.toString(16).padStart(64, '0').slice(0, 16);

const randomField = (): bigint => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + Buffer.from(bytes).toString('hex')) %
    BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
};

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const poseidon = await buildPoseidon();
  const hash = (...inputs: bigint[]): bigint =>
    poseidon.F.toObject(poseidon(inputs.map(i => poseidon.F.e(i))));

  // Get live status
  const [lcPda] = PublicKey.findProgramAddressSync([Buffer.from("light_client")], BTC_LIGHT_CLIENT);
  const lcAccount = await connection.getAccountInfo(lcPda);
  const tipHeight = lcAccount ? lcAccount.data.readBigUInt64LE(9) : 0n;

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    sbBTC - PRIVACY BITCOIN BRIDGE                     ║
╠══════════════════════════════════════════════════════════════════════╣
║  Problem: Bridges require trust + all transactions are traceable      ║
║  Solution: SPV proofs (trustless) + ZK proofs (private)              ║
╚══════════════════════════════════════════════════════════════════════╝

📡 LIVE STATUS
   Bitcoin Light Client: Block ${tipHeight} synced
   Relayer: Running 24/7 on Railway (permissionless!)
`);

  // DEPOSIT
  const nullifier = randomField();
  const secret = randomField();
  const commitment = hash(nullifier, secret);
  const nullifierHash = hash(nullifier);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 STEP 1: DEPOSIT BTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   User generates secrets locally:
   ┌─────────────────────────────────────────────────────────────────┐
   │  nullifier: 0x${toHex(nullifier)}...  (private - never shared)    │
   │  secret:    0x${toHex(secret)}...  (private - never shared)    │
   │  commitment: 0x${toHex(commitment)}...  (goes in Bitcoin TX)      │
   └─────────────────────────────────────────────────────────────────┘

   Bitcoin TX: Send BTC to Taproot address + OP_RETURN(commitment)

   SPV Verify: Anyone can call verify_deposit (no trusted oracle!)
   → Contract checks merkle proof against on-chain block headers
   → Commitment stored in Merkle tree
`);

  // CLAIM
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 STEP 2: CLAIM sbBTC (Privacy Magic!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   ZK Proof proves: "I know secrets for SOME commitment in the tree"
   WITHOUT revealing WHICH commitment!

   ┌─────────────────────────────────────────────────────────────────┐
   │  PUBLIC (everyone sees):           PRIVATE (only user knows):   │
   │  • nullifier_hash: 0x${toHex(nullifierHash)}...  • nullifier         │
   │  • merkle_root                     • secret              │
   │  • amount: 100,000 sats            • which commitment    │
   └─────────────────────────────────────────────────────────────────┘

   Result: User gets sbBTC, but deposit → claim link is BROKEN!
`);

  // SPLIT
  const friendCommit = hash(randomField(), randomField());
  const changeCommit = hash(randomField(), randomField());
  const claimLink = Buffer.from(JSON.stringify({n: toHex(randomField()), s: toHex(randomField()), a: "60000"})).toString('base64');

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✂️  STEP 3: SPLIT (Create Claim Links)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Split 100k sats → 60k (friend) + 40k (change)

   ┌────────────────┐         ┌────────────────┐
   │  INPUT         │         │  60,000 sats   │ → Friend's link
   │  100,000 sats  │  ────►  ├────────────────┤
   │  (nullified)   │         │  40,000 sats   │ → Your change
   └────────────────┘         └────────────────┘

   Claim Link: https://sbbtc.app/claim#${claimLink.slice(0,20)}...

   Friend opens link → generates ZK proof → claims 60k sbBTC!
`);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   sbBTC vs Others:
   ┌──────────────────┬─────────┬─────────┬──────────────┐
   │                  │  sbBTC  │  WBTC   │ Other Bridge │
   ├──────────────────┼─────────┼─────────┼──────────────┤
   │ Trustless        │   ✅    │   ❌    │      ❌      │
   │ Private          │   ✅    │   ❌    │      ❌      │
   │ Self-custody     │   ✅    │   ❌    │      ❌      │
   └──────────────────┴─────────┴─────────┴──────────────┘

   Programs: zVault (${ZVAULT.toBase58().slice(0,8)}...)
             btc-light-client (${BTC_LIGHT_CLIENT.toBase58().slice(0,8)}...)

╔══════════════════════════════════════════════════════════════════════╗
║  "sbBTC: Trustless deposits, private claims, shareable links"        ║
╚══════════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
