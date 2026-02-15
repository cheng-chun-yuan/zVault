/**
 * Convert bb.js v3 UltraHonk proof format to Solana verifier format
 *
 * bb.js format:
 *   [0-511]:   Public inputs as 68-bit limbs (16 Fr = 4 PIs × 4 limbs each)
 *   [512+]:    G1 commitments + rest of proof
 *
 * Solana format:
 *   [0-255]:   Pairing points (8 Fr, derived from PIs)
 *   [256+]:    G1 commitments + rest of proof (same as bb.js from offset 512)
 */

function bytesToBigintBE(b: Uint8Array): bigint {
  let hex = "0x";
  for (const byte of b) hex += byte.toString(16).padStart(2, "0");
  return BigInt(hex);
}

function bigintToBytes32BE(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Reconstruct public input from 4 × 68-bit limbs
 *
 * bb.js encodes each PI as 4 limbs of 68 bits (with some bits overlapping)
 * We need to reconstruct the full 254-bit value
 */
function reconstructPIFromLimbs(limbs: bigint[]): bigint {
  if (limbs.length !== 4) {
    throw new Error(`Expected 4 limbs, got ${limbs.length}`);
  }

  // Each limb is 68 bits
  // Reconstruction: limb[0] + (limb[1] << 68) + (limb[2] << 136) + (limb[3] << 204)
  const LIMB_SIZE = 68n;
  let result = limbs[0];
  result += limbs[1] << LIMB_SIZE;
  result += limbs[2] << (LIMB_SIZE * 2n);
  result += limbs[3] << (LIMB_SIZE * 3n);

  return result;
}

/**
 * Generate pairing points from public inputs
 *
 * For Solana UltraHonk verifier, pairing points are:
 * - First N Fr: public input values
 * - Padded to 16 Fr total (PAIRING_POINTS_SIZE = 16)
 */
function generatePairingPoints(publicInputs: bigint[]): Uint8Array {
  const pairingPoints = new Uint8Array(16 * 32); // 16 Fr elements (512 bytes)

  // Copy public inputs to first N slots
  for (let i = 0; i < Math.min(publicInputs.length, 16); i++) {
    pairingPoints.set(bigintToBytes32BE(publicInputs[i]), i * 32);
  }

  // Rest are zeros (already zeroed by Uint8Array constructor)
  return pairingPoints;
}

/**
 * Convert bb.js v3 UltraHonk proof to Solana verifier format
 *
 * @param bbProof - Raw proof from bb.js (7680 bytes for log_n=15)
 * @param publicInputs - Public inputs from bb.js (already in correct format!)
 * @returns Converted proof in Solana format
 */
export function convertBBJSProofToSolana(
  bbProof: Uint8Array,
  publicInputs: string[]
): Uint8Array {
  console.log(`[ProofConvert] Converting bb.js proof (${bbProof.length} bytes, ${publicInputs.length} PIs)`);

  // bb.js proof structure:
  //   [0-511]:   Public input limbs (4 limbs per PI)
  //   [512+]:    G1 commitments + rest of proof
  //
  // Solana format:
  //   [0-511]:   Pairing points (16 Fr, PIs padded with zeros)
  //   [512+]:    G1 commitments + rest of proof

  const numPublicInputs = publicInputs.length;
  const limbsPerPI = 4;
  const limbBytes = numPublicInputs * limbsPerPI * 32; // 512 bytes for 4 PIs

  if (bbProof.length < limbBytes + 64) {
    throw new Error(`Proof too short: ${bbProof.length} bytes, expected at least ${limbBytes + 64}`);
  }

  // Convert public inputs from hex strings to bigints
  const piBigints: bigint[] = publicInputs.map(pi => {
    const hex = pi.startsWith("0x") ? pi : "0x" + pi;
    return BigInt(hex);
  });

  // Log PIs for debugging
  piBigints.forEach((pi, i) => {
    console.log(`[ProofConvert] PI[${i}]: 0x${pi.toString(16).slice(0, 32)}...`);
  });

  // Generate pairing points (16 Fr = 512 bytes)
  const pairingPoints = generatePairingPoints(piBigints);

  // Extract G1 commitments and rest of proof (from offset 512 onwards)
  const g1AndRest = bbProof.slice(limbBytes);

  // Construct Solana format: [pairing_points(512) | g1_and_rest]
  const solanaProof = new Uint8Array(pairingPoints.length + g1AndRest.length);
  solanaProof.set(pairingPoints, 0);
  solanaProof.set(g1AndRest, pairingPoints.length);

  console.log(`[ProofConvert] Converted proof: ${solanaProof.length} bytes`);
  console.log(`[ProofConvert]   Pairing points: ${pairingPoints.length} bytes`);
  console.log(`[ProofConvert]   G1 + rest: ${g1AndRest.length} bytes`);

  return solanaProof;
}
