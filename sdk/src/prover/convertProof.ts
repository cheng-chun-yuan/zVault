/**
 * Convert bb.js UltraHonk proof from split format to affine format
 *
 * bb.js format: G1 points are 128 bytes (x_0, x_1, y_0, y_1) where x = x_1 << 136 | x_0
 * Affine format: G1 points are 64 bytes (x, y)
 *
 * Proof structure:
 * - Preamble: 256 bytes (8 Fr pairing points) - unchanged
 * - Witness G1s: 8 × 128 bytes → 8 × 64 bytes
 * - Sumcheck univariates: logN × 8 × 32 bytes - unchanged
 * - Sumcheck evals: 41 × 32 bytes - unchanged
 * - Gemini fold comms: (logN-1) × 128 bytes → (logN-1) × 64 bytes
 * - Gemini evals: logN × 32 bytes - unchanged
 * - shplonk_q: 128 bytes → 64 bytes
 * - kzg_quotient: 128 bytes → 64 bytes
 */

const PREAMBLE_SIZE = 8 * 32; // 256 bytes (PAIRING_POINTS_SIZE = 8 Fr elements)
const NUM_WITNESS_G1 = 8;
const BATCHED_RELATION_PARTIAL_LENGTH = 8;
const NUMBER_OF_ENTITIES = 41;

/**
 * Convert a single split-format G1 point (128 bytes) to affine format (64 bytes)
 *
 * Split format: x_0(32) + x_1(32) + y_0(32) + y_1(32)
 * where x = x_1 << 136 | x_0 (68-bit limbs, 136-bit split)
 *
 * Affine format: x(32) + y(32)
 * Reassembly: x[0..15] = x_1[17..32], x[15..32] = x_0[15..32]
 */
function convertSplitG1ToAffine(splitPoint: Uint8Array): Uint8Array {
  if (splitPoint.length !== 128) {
    throw new Error(`Invalid split G1 point size: ${splitPoint.length}`);
  }

  const x_0 = splitPoint.slice(0, 32);
  const x_1 = splitPoint.slice(32, 64);
  const y_0 = splitPoint.slice(64, 96);
  const y_1 = splitPoint.slice(96, 128);

  // Check if identity (all zeros)
  const isIdentity = [...x_0, ...x_1, ...y_0, ...y_1].every(b => b === 0);
  if (isIdentity) {
    return new Uint8Array(64); // Return zero point
  }

  const affine = new Uint8Array(64);

  // Combine x coordinate: high 15 bytes from x_1, low 17 bytes from x_0
  affine.set(x_1.slice(17, 32), 0);      // x[0..15] = x_1[17..32]
  affine.set(x_0.slice(15, 32), 15);     // x[15..32] = x_0[15..32]

  // Combine y coordinate: high 15 bytes from y_1, low 17 bytes from y_0
  affine.set(y_1.slice(17, 32), 32);     // y[0..15] = y_1[17..32]
  affine.set(y_0.slice(15, 32), 47);     // y[15..32] = y_0[15..32]

  return affine;
}

/**
 * Convert bb.js proof from split format to affine format
 *
 * @param splitProof bb.js proof with split-format G1 points
 * @param logN circuit size log (e.g., 15 for 32768 gates)
 * @returns Proof in affine format ready for on-chain verification
 */
export function convertBBJSProofToAffine(
  splitProof: Uint8Array,
  logN: number
): Uint8Array {
  if (logN < 1 || logN > 28) {
    throw new Error(`Invalid logN: ${logN}`);
  }

  let readOffset = 0;
  const parts: Uint8Array[] = [];

  // 1. Copy preamble (pairing points, 256 bytes) - unchanged
  parts.push(splitProof.slice(readOffset, readOffset + PREAMBLE_SIZE));
  readOffset += PREAMBLE_SIZE;

  // 2. Convert witness G1s: 8 × 128 bytes → 8 × 64 bytes
  for (let i = 0; i < NUM_WITNESS_G1; i++) {
    const splitG1 = splitProof.slice(readOffset, readOffset + 128);
    parts.push(convertSplitG1ToAffine(splitG1));
    readOffset += 128;
  }

  // 3. Copy sumcheck univariates: logN × 8 × 32 bytes - unchanged
  const sumcheckUnivSize = logN * BATCHED_RELATION_PARTIAL_LENGTH * 32;
  parts.push(splitProof.slice(readOffset, readOffset + sumcheckUnivSize));
  readOffset += sumcheckUnivSize;

  // 4. Copy sumcheck evaluations: 41 × 32 bytes - unchanged
  const sumcheckEvalSize = NUMBER_OF_ENTITIES * 32;
  parts.push(splitProof.slice(readOffset, readOffset + sumcheckEvalSize));
  readOffset += sumcheckEvalSize;

  // 5. Convert gemini fold commitments: (logN-1) × 128 bytes → (logN-1) × 64 bytes
  const numGeminiFold = logN - 1;
  for (let i = 0; i < numGeminiFold; i++) {
    const splitG1 = splitProof.slice(readOffset, readOffset + 128);
    parts.push(convertSplitG1ToAffine(splitG1));
    readOffset += 128;
  }

  // 6. Copy gemini evaluations: logN × 32 bytes - unchanged
  const geminiEvalSize = logN * 32;
  parts.push(splitProof.slice(readOffset, readOffset + geminiEvalSize));
  readOffset += geminiEvalSize;

  // 7. Convert shplonk_q: 128 bytes → 64 bytes
  const shplonkQ = splitProof.slice(readOffset, readOffset + 128);
  parts.push(convertSplitG1ToAffine(shplonkQ));
  readOffset += 128;

  // 8. Convert kzg_quotient: 128 bytes → 64 bytes
  const kzgQuotient = splitProof.slice(readOffset, readOffset + 128);
  parts.push(convertSplitG1ToAffine(kzgQuotient));
  readOffset += 128;

  // Calculate total size
  const totalSize = parts.reduce((sum, part) => sum + part.length, 0);
  const affineProof = new Uint8Array(totalSize);

  // Concatenate all parts
  let writeOffset = 0;
  for (const part of parts) {
    affineProof.set(part, writeOffset);
    writeOffset += part.length;
  }

  console.log(`[ProofConvert] Split proof: ${splitProof.length} bytes → Affine proof: ${affineProof.length} bytes`);
  console.log(`[ProofConvert] Expected size for logN=${logN}: ${calculateExpectedAffineSize(logN)} bytes`);

  return affineProof;
}

/**
 * Calculate expected affine proof size for given logN
 */
function calculateExpectedAffineSize(logN: number): number {
  const preamble = 512;
  const witnessG1s = NUM_WITNESS_G1 * 64;
  const sumcheckUniv = logN * BATCHED_RELATION_PARTIAL_LENGTH * 32;
  const sumcheckEval = NUMBER_OF_ENTITIES * 32;
  const geminiFold = (logN - 1) * 64;
  const geminiEval = logN * 32;
  const shplonkQ = 64;
  const kzgQuotient = 64;

  return preamble + witnessG1s + sumcheckUniv + sumcheckEval +
         geminiFold + geminiEval + shplonkQ + kzgQuotient;
}

/**
 * Verify a G1 point is on the BN254 curve (basic sanity check)
 * This is a simplified check - full verification requires modular arithmetic
 */
function isG1OnCurve(point: Uint8Array): boolean {
  if (point.length !== 64) return false;

  // Check if identity (all zeros)
  if (point.every(b => b === 0)) return true;

  // For non-identity points, check x and y are not both zero
  const xZero = point.slice(0, 32).every(b => b === 0);
  const yZero = point.slice(32, 64).every(b => b === 0);

  return !(xZero && !yZero) && !(!xZero && yZero);
}
