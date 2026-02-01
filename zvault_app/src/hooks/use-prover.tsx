"use client";

/**
 * Proof Generation Hook for zVault
 *
 * Integrates with @zvault/sdk/prover for client-side ZK proof generation.
 * Used for SPEND_SPLIT (private send) and SPEND_PARTIAL_PUBLIC (public send).
 *
 * Uses dynamic imports to defer loading heavy WASM modules (~2-4MB) until
 * proof generation is actually needed, improving initial page load time.
 */

import { useState, useCallback, useRef } from "react";

// Types imported statically (no runtime cost)
import type {
  SpendSplitInputs,
  SpendPartialPublicInputs,
  ProofData,
} from "@zvault/sdk/prover";

interface MerkleProofResponse {
  success: boolean;
  commitment: string;
  leafIndex: string;
  root: string;
  siblings: string[];
  indices: number[];
  error?: string;
}

interface ProverState {
  isInitialized: boolean;
  isGenerating: boolean;
  error: string | null;
  progress: string;
}

// Cached module references after dynamic import
let proverModule: typeof import("@zvault/sdk/prover") | null = null;
let sdkModule: typeof import("@zvault/sdk") | null = null;

/**
 * Dynamically load the prover WASM modules.
 * Only called when proof generation is actually needed.
 */
async function loadProverModules() {
  if (!proverModule || !sdkModule) {
    // Load both modules in parallel
    const [prover, sdk] = await Promise.all([
      import("@zvault/sdk/prover"),
      import("@zvault/sdk"),
    ]);
    proverModule = prover;
    sdkModule = sdk;
  }
  return { prover: proverModule, sdk: sdkModule };
}

export function useProver() {
  const [state, setState] = useState<ProverState>({
    isInitialized: false,
    isGenerating: false,
    error: null,
    progress: "",
  });

  const initRef = useRef(false);

  /**
   * Initialize the prover (preload WASM modules)
   */
  const initialize = useCallback(async () => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      setState((s) => ({ ...s, progress: "Loading WASM modules..." }));

      // Dynamically import heavy WASM modules
      const { prover } = await loadProverModules();

      // Set circuit path for browser
      prover.setCircuitPath("/circuits/noir");

      await prover.initProver();

      const available = await prover.isProverAvailable();
      if (!available) {
        throw new Error("Circuit artifacts not found. Ensure circuits are compiled.");
      }

      setState((s) => ({ ...s, isInitialized: true, progress: "Prover ready" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize prover";
      setState((s) => ({ ...s, error: message, progress: "" }));
      initRef.current = false;
    }
  }, []);

  /**
   * Fetch merkle proof for a commitment
   */
  const fetchMerkleProof = useCallback(async (commitmentHex: string): Promise<MerkleProofResponse> => {
    const response = await fetch(`/api/merkle/proof?commitment=${commitmentHex}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch merkle proof");
    }

    return data;
  }, []);

  /**
   * Generate SPEND_SPLIT proof (private send)
   *
   * Splits one commitment into two: one for recipient, one for change.
   */
  const generateSplitProof = useCallback(
    async (params: {
      /** User's private key (bigint) */
      privKey: bigint;
      /** User's public key X coordinate */
      pubKeyX: bigint;
      /** Input commitment amount */
      amount: bigint;
      /** Input commitment hex */
      commitmentHex: string;
      /** Amount to send to recipient */
      sendAmount: bigint;
      /** Recipient's public key X coordinate */
      recipientPubKeyX: bigint;
      /** Change public key X coordinate (usually same as sender) */
      changePubKeyX: bigint;
    }): Promise<{
      proof: ProofData;
      nullifierHash: bigint;
      outputCommitment1: bigint;
      outputCommitment2: bigint;
      merkleRoot: bigint;
    }> => {
      setState((s) => ({ ...s, isGenerating: true, error: null, progress: "Fetching merkle proof..." }));

      try {
        // Ensure modules are loaded
        const { prover, sdk } = await loadProverModules();

        // Debug: Verify commitment matches what circuit will compute
        const expectedCommitment = await sdk.computeUnifiedCommitment(params.pubKeyX, params.amount);
        const expectedHex = expectedCommitment.toString(16).padStart(64, "0");
        console.log("[Prover] Debug commitment verification (split):");
        console.log("[Prover]   Input commitmentHex:", params.commitmentHex);
        console.log("[Prover]   pubKeyX:", params.pubKeyX.toString(16));
        console.log("[Prover]   amount:", params.amount.toString());
        console.log("[Prover]   Expected (computed):", expectedHex);
        console.log("[Prover]   Match:", params.commitmentHex.toLowerCase() === expectedHex.toLowerCase());

        // If they don't match, use the computed commitment for merkle lookup
        const commitmentForLookup = params.commitmentHex.toLowerCase() === expectedHex.toLowerCase()
          ? params.commitmentHex
          : expectedHex;

        if (params.commitmentHex.toLowerCase() !== expectedHex.toLowerCase()) {
          console.warn("[Prover] Commitment mismatch detected! Using computed commitment for merkle lookup.");
        }

        // 1. Fetch merkle proof using the correct commitment
        const merkleProof = await fetchMerkleProof(commitmentForLookup);

        setState((s) => ({ ...s, progress: "Preparing proof inputs..." }));

        // 2. Prepare inputs
        const changeAmount = params.amount - params.sendAmount;
        if (changeAmount < 0n) {
          throw new Error("Send amount exceeds input amount");
        }

        const leafIndex = BigInt(merkleProof.leafIndex);
        const merkleRoot = BigInt("0x" + merkleProof.root);
        const siblings = merkleProof.siblings.map((s) => BigInt("0x" + s));
        const indices = merkleProof.indices;

        // 3. Compute output commitments (async)
        const [outputCommitment1, outputCommitment2] = await Promise.all([
          sdk.computeUnifiedCommitment(params.recipientPubKeyX, params.sendAmount),
          sdk.computeUnifiedCommitment(params.changePubKeyX, changeAmount),
        ]);

        // 4. Compute nullifier hash (async)
        const nullifier = await sdk.computeNullifier(params.privKey, leafIndex);
        const nullifierHash = await sdk.hashNullifier(nullifier);

        const inputs: SpendSplitInputs = {
          privKey: params.privKey,
          pubKeyX: params.pubKeyX,
          amount: params.amount,
          leafIndex,
          merkleRoot,
          merkleProof: { siblings, indices },
          output1PubKeyX: params.recipientPubKeyX,
          output1Amount: params.sendAmount,
          output2PubKeyX: params.changePubKeyX,
          output2Amount: changeAmount,
        };

        setState((s) => ({ ...s, progress: "Generating ZK proof (this may take 30-60s)..." }));

        // 5. Generate proof
        const proof = await prover.generateSpendSplitProof(inputs);

        setState((s) => ({ ...s, isGenerating: false, progress: "Proof generated!" }));

        return {
          proof,
          nullifierHash,
          outputCommitment1,
          outputCommitment2,
          merkleRoot,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Proof generation failed";
        setState((s) => ({ ...s, isGenerating: false, error: message, progress: "" }));
        throw error;
      }
    },
    [fetchMerkleProof]
  );

  /**
   * Generate SPEND_PARTIAL_PUBLIC proof (public send)
   *
   * Transfers part of commitment to a public wallet, rest as change.
   */
  const generatePartialPublicProof = useCallback(
    async (params: {
      /** User's private key (bigint) */
      privKey: bigint;
      /** User's public key X coordinate */
      pubKeyX: bigint;
      /** Input commitment amount */
      amount: bigint;
      /** Input commitment hex */
      commitmentHex: string;
      /** Amount to send publicly */
      publicAmount: bigint;
      /** Change public key X coordinate */
      changePubKeyX: bigint;
      /** Recipient Solana address (as Uint8Array or hex string) */
      recipient: Uint8Array | string;
    }): Promise<{
      proof: ProofData;
      nullifierHash: bigint;
      changeCommitment: bigint;
      merkleRoot: bigint;
    }> => {
      setState((s) => ({ ...s, isGenerating: true, error: null, progress: "Fetching merkle proof..." }));

      try {
        // Ensure modules are loaded
        const { prover, sdk } = await loadProverModules();

        // Debug: Verify commitment matches what circuit will compute
        const expectedCommitment = await sdk.computeUnifiedCommitment(params.pubKeyX, params.amount);
        const expectedHex = expectedCommitment.toString(16).padStart(64, "0");
        console.log("[Prover] Debug commitment verification (partial public):");
        console.log("[Prover]   Input commitmentHex:", params.commitmentHex);
        console.log("[Prover]   pubKeyX:", params.pubKeyX.toString(16));
        console.log("[Prover]   amount:", params.amount.toString());
        console.log("[Prover]   Expected (computed):", expectedHex);
        console.log("[Prover]   Match:", params.commitmentHex.toLowerCase() === expectedHex.toLowerCase());

        // If they don't match, use the computed commitment for merkle lookup
        const commitmentForLookup = params.commitmentHex.toLowerCase() === expectedHex.toLowerCase()
          ? params.commitmentHex
          : expectedHex;

        if (params.commitmentHex.toLowerCase() !== expectedHex.toLowerCase()) {
          console.warn("[Prover] Commitment mismatch detected! Using computed commitment for merkle lookup.");
        }

        // 1. Fetch merkle proof using the correct commitment
        const merkleProof = await fetchMerkleProof(commitmentForLookup);

        setState((s) => ({ ...s, progress: "Preparing proof inputs..." }));

        // 2. Prepare inputs
        const changeAmount = params.amount - params.publicAmount;
        if (changeAmount < 0n) {
          throw new Error("Public amount exceeds input amount");
        }

        const leafIndex = BigInt(merkleProof.leafIndex);
        const merkleRoot = BigInt("0x" + merkleProof.root);
        const siblings = merkleProof.siblings.map((s) => BigInt("0x" + s));
        const indices = merkleProof.indices;

        // 3. Convert recipient to bigint
        let recipientBigInt: bigint;
        if (typeof params.recipient === "string") {
          // Hex string
          recipientBigInt = BigInt("0x" + params.recipient.replace("0x", ""));
        } else {
          // Uint8Array
          recipientBigInt = BigInt(
            "0x" +
              Array.from(params.recipient)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
          );
        }

        // 4. Compute change commitment (async)
        const changeCommitment = await sdk.computeUnifiedCommitment(params.changePubKeyX, changeAmount);

        // 5. Compute nullifier hash (async)
        const nullifier = await sdk.computeNullifier(params.privKey, leafIndex);
        const nullifierHash = await sdk.hashNullifier(nullifier);

        const inputs: SpendPartialPublicInputs = {
          privKey: params.privKey,
          pubKeyX: params.pubKeyX,
          amount: params.amount,
          leafIndex,
          merkleRoot,
          merkleProof: { siblings, indices },
          publicAmount: params.publicAmount,
          changePubKeyX: params.changePubKeyX,
          changeAmount,
          recipient: recipientBigInt,
        };

        setState((s) => ({ ...s, progress: "Generating ZK proof (this may take 30-60s)..." }));

        // 6. Generate proof
        const proof = await prover.generateSpendPartialPublicProof(inputs);

        setState((s) => ({ ...s, isGenerating: false, progress: "Proof generated!" }));

        return {
          proof,
          nullifierHash,
          changeCommitment,
          merkleRoot,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Proof generation failed";
        setState((s) => ({ ...s, isGenerating: false, error: message, progress: "" }));
        throw error;
      }
    },
    [fetchMerkleProof]
  );

  return {
    ...state,
    initialize,
    generateSplitProof,
    generatePartialPublicProof,
  };
}
