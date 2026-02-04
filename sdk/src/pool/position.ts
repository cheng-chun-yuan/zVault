/**
 * Yield Pool Position Management
 *
 * Helper functions for managing pool positions including serialization.
 */

import { bigintToBytes } from "../crypto";
import type { StealthPoolPosition, SerializedStealthPoolPosition } from "./types";

/**
 * Serialize a pool position for storage
 */
export function serializePoolPosition(
  position: StealthPoolPosition
): SerializedStealthPoolPosition {
  return {
    poolId: Buffer.from(position.poolId).toString("hex"),
    ephemeralPub: Buffer.from(position.ephemeralPub).toString("hex"),
    principal: position.principal.toString(),
    depositEpoch: position.depositEpoch.toString(),
    stealthPubX: position.stealthPub.x.toString(),
    stealthPubY: position.stealthPub.y.toString(),
    commitment: position.commitment.toString(),
    leafIndex: position.leafIndex,
  };
}

/**
 * Deserialize a pool position from storage
 */
export function deserializePoolPosition(
  data: SerializedStealthPoolPosition
): StealthPoolPosition {
  return {
    poolId: new Uint8Array(Buffer.from(data.poolId, "hex")),
    ephemeralPub: new Uint8Array(Buffer.from(data.ephemeralPub, "hex")),
    principal: BigInt(data.principal),
    depositEpoch: BigInt(data.depositEpoch),
    stealthPub: {
      x: BigInt(data.stealthPubX),
      y: BigInt(data.stealthPubY),
    },
    commitment: BigInt(data.commitment),
    leafIndex: data.leafIndex,
    commitmentBytes: bigintToBytes(BigInt(data.commitment)),
  };
}
