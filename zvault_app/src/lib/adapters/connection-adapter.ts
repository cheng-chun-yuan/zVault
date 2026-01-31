import { Connection, PublicKey } from "@solana/web3.js";
import type { ConnectionAdapter } from "@zvault/sdk";

/**
 * Create a ConnectionAdapter that wraps @solana/web3.js Connection
 * for use with @zvault/sdk functions.
 *
 * The SDK uses string-based addresses (from @solana/kit), while the frontend
 * uses PublicKey objects. This adapter bridges the two.
 */
export function createConnectionAdapter(connection: Connection): ConnectionAdapter {
  return {
    getAccountInfo: async (pubkey: string) => {
      const pk = new PublicKey(pubkey);
      const info = await connection.getAccountInfo(pk);
      return info ? { data: new Uint8Array(info.data) } : null;
    },
  };
}

/**
 * Get a Connection instance using the configured RPC URL.
 */
export function getConnection(): Connection {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  return new Connection(rpcUrl);
}

/**
 * Get a ConnectionAdapter using the configured RPC URL.
 * Convenience function that combines getConnection and createConnectionAdapter.
 */
export function getConnectionAdapter(): ConnectionAdapter {
  return createConnectionAdapter(getConnection());
}
