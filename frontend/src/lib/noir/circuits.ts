/**
 * Noir Circuit Artifact Management
 *
 * Manages loading and caching of compiled Noir circuit artifacts.
 */

export interface NoirCircuitArtifact {
  name: string;
  bytecode: Uint8Array;
  abi: {
    parameters: Array<{
      name: string;
      type: string;
      visibility: "public" | "private";
    }>;
  };
}

const CIRCUIT_CACHE = new Map<string, NoirCircuitArtifact>();

// Circuit CDN URL - defaults to local public folder
const CIRCUIT_CDN_URL = process.env.NEXT_PUBLIC_CIRCUIT_CDN_URL || "/circuits/noir";

/**
 * Load a Noir circuit artifact
 */
export async function loadCircuitArtifact(
  circuitName: string
): Promise<NoirCircuitArtifact> {
  // Check cache first
  if (CIRCUIT_CACHE.has(circuitName)) {
    return CIRCUIT_CACHE.get(circuitName)!;
  }

  // Load from CDN or public directory
  const artifactPath = `${CIRCUIT_CDN_URL}/${circuitName}.json`;
  const response = await fetch(artifactPath);
  
  if (!response.ok) {
    throw new Error(
      `Failed to load Noir circuit artifact: ${circuitName} (${response.status})`
    );
  }

  const artifact = await response.json();
  CIRCUIT_CACHE.set(circuitName, artifact);

  return artifact;
}

/**
 * Get list of available Noir circuits
 */
export function getAvailableCircuits(): string[] {
  return ["claim", "transfer", "split", "partial_withdraw"];
}

/**
 * Check if a circuit artifact exists
 */
export async function circuitExists(circuitName: string): Promise<boolean> {
  try {
    await loadCircuitArtifact(circuitName);
    return true;
  } catch {
    return false;
  }
}
