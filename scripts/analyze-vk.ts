#!/usr/bin/env bun
/**
 * Analyze UltraHonk Verification Key Format
 *
 * This script examines the binary VK files to understand their structure.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const VK_DIR = join(__dirname, "../noir-circuits/target");

// BN254 curve constants
const G1_POINT_SIZE = 64; // 2 * 32 bytes (x, y)
const G2_POINT_SIZE = 128; // 2 * 64 bytes (x.c0, x.c1, y.c0, y.c1)
const FIELD_SIZE = 32;

function analyzeVK(vkPath: string) {
  const name = vkPath.split("/").pop()!;
  const data = readFileSync(vkPath);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`VK File: ${name}`);
  console.log(`Size: ${data.length} bytes`);
  console.log(`SHA256: ${createHash("sha256").update(data).digest("hex")}`);

  // Try to parse the structure
  // UltraHonk VK format (from barretenberg):
  // - circuit_size: u32 (4 bytes)
  // - num_public_inputs: u32 (4 bytes)
  // - Multiple G1 commitments for selector polynomials
  // - G2 point for pairing (q_comm or similar)

  let offset = 0;

  // First 4 bytes might be circuit size or version
  const first4 = data.readUInt32LE(0);
  const first4BE = data.readUInt32BE(0);
  console.log(`\nFirst 4 bytes (LE): ${first4} (0x${first4.toString(16)})`);
  console.log(`First 4 bytes (BE): ${first4BE} (0x${first4BE.toString(16)})`);

  // Check if first byte is circuit_size_log
  console.log(`First byte: ${data[0]} (could be circuit_size_log)`);

  // Count how many G1 points could fit
  const remainingAfter8 = data.length - 8;
  const possibleG1Points = Math.floor(remainingAfter8 / G1_POINT_SIZE);
  const possibleG2Points = Math.floor(remainingAfter8 / G2_POINT_SIZE);

  console.log(`\nIf header is 8 bytes:`);
  console.log(`  Remaining: ${remainingAfter8} bytes`);
  console.log(`  Could fit ${possibleG1Points} G1 points (64 bytes each)`);
  console.log(`  Could fit ${possibleG2Points} G2 points (128 bytes each)`);

  // Check (size - 128) / 64 to see if it ends with G2 + G1s
  const sizeMinusG2 = data.length - G2_POINT_SIZE;
  if (sizeMinusG2 > 0) {
    const headerPlusG1s = sizeMinusG2;
    console.log(`\nIf ends with G2 point:`);
    console.log(`  Header + G1s: ${headerPlusG1s} bytes`);
    console.log(`  G1 points: ${Math.floor((headerPlusG1s - 8) / G1_POINT_SIZE)}`);
  }

  // Hex dump first 64 bytes
  console.log(`\nFirst 64 bytes (hex):`);
  for (let i = 0; i < Math.min(64, data.length); i += 16) {
    const hex = Array.from(data.slice(i, i + 16))
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");
    console.log(`  ${i.toString(16).padStart(4, "0")}: ${hex}`);
  }

  // Check last 128 bytes (potential G2)
  if (data.length >= 128) {
    console.log(`\nLast 128 bytes (potential G2):`);
    const g2Start = data.length - 128;
    for (let i = 0; i < 128; i += 32) {
      const hex = Array.from(data.slice(g2Start + i, g2Start + i + 32))
        .map(b => b.toString(16).padStart(2, "0"))
        .join(" ");
      console.log(`  ${(g2Start + i).toString(16).padStart(4, "0")}: ${hex}`);
    }
  }
}

// Find all VK files
const vkFiles = readdirSync(VK_DIR)
  .filter(f => f.endsWith(".vk"))
  .map(f => join(VK_DIR, f));

console.log(`Found ${vkFiles.length} VK files in ${VK_DIR}`);

for (const vkFile of vkFiles) {
  analyzeVK(vkFile);
}

// Summary
console.log(`\n${"=".repeat(60)}`);
console.log("SUMMARY");
console.log("=".repeat(60));
console.log("\nVK Hashes for config.ts:");
for (const vkFile of vkFiles) {
  const name = vkFile.split("/").pop()!.replace("zvault_", "").replace(".vk", "");
  const data = readFileSync(vkFile);
  const hash = createHash("sha256").update(data).digest("hex");
  console.log(`  ${name}: "${hash}",`);
}
