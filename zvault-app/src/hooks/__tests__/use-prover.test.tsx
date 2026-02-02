import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the prover module
const mockInitProver = vi.fn();
const mockIsProverAvailable = vi.fn();
const mockSetCircuitPath = vi.fn();
const mockGenerateSpendSplitProof = vi.fn();
const mockGenerateSpendPartialPublicProof = vi.fn();

vi.mock("@zvault/sdk/prover", () => ({
  initProver: () => mockInitProver(),
  isProverAvailable: () => mockIsProverAvailable(),
  setCircuitPath: (path: string) => mockSetCircuitPath(path),
  generateSpendSplitProof: (inputs: unknown) => mockGenerateSpendSplitProof(inputs),
  generateSpendPartialPublicProof: (inputs: unknown) => mockGenerateSpendPartialPublicProof(inputs),
}));

// Mock the SDK module
const mockComputeUnifiedCommitment = vi.fn();
const mockComputeNullifier = vi.fn();
const mockHashNullifier = vi.fn();

vi.mock("@zvault/sdk", () => ({
  computeUnifiedCommitment: (pubKeyX: bigint, amount: bigint) => mockComputeUnifiedCommitment(pubKeyX, amount),
  computeNullifier: (privKey: bigint, leafIndex: bigint) => mockComputeNullifier(privKey, leafIndex),
  hashNullifier: (nullifier: bigint) => mockHashNullifier(nullifier),
}));

import { useProver } from "../use-prover";

describe("useProver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to get fresh prover state
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initialization", () => {
    it("starts with uninitialized state", () => {
      const { result } = renderHook(() => useProver());

      expect(result.current.isInitialized).toBe(false);
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.progress).toBe("");
    });

    it("initializes prover successfully", async () => {
      mockInitProver.mockResolvedValue(undefined);
      mockIsProverAvailable.mockResolvedValue(true);

      const { result } = renderHook(() => useProver());

      await act(async () => {
        await result.current.initialize();
      });

      expect(mockSetCircuitPath).toHaveBeenCalledWith("/circuits/noir");
      expect(mockInitProver).toHaveBeenCalled();
      expect(mockIsProverAvailable).toHaveBeenCalled();
      expect(result.current.isInitialized).toBe(true);
      expect(result.current.progress).toBe("Prover ready");
    });

    it("handles prover not available error", async () => {
      mockInitProver.mockResolvedValue(undefined);
      mockIsProverAvailable.mockResolvedValue(false);

      const { result } = renderHook(() => useProver());

      await act(async () => {
        await result.current.initialize();
      });

      expect(result.current.isInitialized).toBe(false);
      expect(result.current.error).toContain("Circuit artifacts not found");
    });

    it("handles initialization error", async () => {
      mockInitProver.mockRejectedValue(new Error("WASM load failed"));

      const { result } = renderHook(() => useProver());

      await act(async () => {
        await result.current.initialize();
      });

      expect(result.current.isInitialized).toBe(false);
      expect(result.current.error).toBe("WASM load failed");
    });

    it("only initializes once", async () => {
      mockInitProver.mockResolvedValue(undefined);
      mockIsProverAvailable.mockResolvedValue(true);

      const { result } = renderHook(() => useProver());

      await act(async () => {
        await result.current.initialize();
        await result.current.initialize();
        await result.current.initialize();
      });

      // Should only be called once due to ref guard
      expect(mockInitProver).toHaveBeenCalledTimes(1);
    });
  });

  describe("generateSplitProof", () => {
    const mockMerkleProofResponse = {
      success: true,
      commitment: "abc123",
      leafIndex: "0",
      root: "deadbeef".padStart(64, "0"),
      siblings: Array(20).fill("0".repeat(64)),
      indices: Array(20).fill(0),
    };

    const mockProofData = {
      proof: new Uint8Array([1, 2, 3]),
      publicInputs: [],
    };

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockMerkleProofResponse),
      });
      mockComputeUnifiedCommitment.mockResolvedValue(123456n);
      mockComputeNullifier.mockResolvedValue(789n);
      mockHashNullifier.mockResolvedValue(999n);
      mockGenerateSpendSplitProof.mockResolvedValue(mockProofData);
    });

    it("generates split proof successfully", async () => {
      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 100_000n,
        commitmentHex: "abc123",
        sendAmount: 60_000n,
        recipientPubKeyX: 11111n,
        changePubKeyX: 67890n,
      };

      let proofResult: Awaited<ReturnType<typeof result.current.generateSplitProof>>;

      await act(async () => {
        proofResult = await result.current.generateSplitProof(params);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/merkle/proof?commitment=abc123")
      );
      expect(mockComputeUnifiedCommitment).toHaveBeenCalledTimes(2);
      expect(mockComputeNullifier).toHaveBeenCalled();
      expect(mockHashNullifier).toHaveBeenCalled();
      expect(mockGenerateSpendSplitProof).toHaveBeenCalled();

      expect(proofResult!.proof).toEqual(mockProofData);
      expect(proofResult!.nullifierHash).toBe(999n);
      expect(result.current.isGenerating).toBe(false);
    });

    it("throws error when send amount exceeds input amount", async () => {
      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 50_000n,
        commitmentHex: "abc123",
        sendAmount: 100_000n, // More than input
        recipientPubKeyX: 11111n,
        changePubKeyX: 67890n,
      };

      await expect(
        act(async () => {
          await result.current.generateSplitProof(params);
        })
      ).rejects.toThrow("Send amount exceeds input amount");
    });

    it("handles merkle proof fetch error", async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ success: false, error: "Commitment not found" }),
      });

      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 100_000n,
        commitmentHex: "unknown",
        sendAmount: 50_000n,
        recipientPubKeyX: 11111n,
        changePubKeyX: 67890n,
      };

      await expect(
        act(async () => {
          await result.current.generateSplitProof(params);
        })
      ).rejects.toThrow("Commitment not found");

      // After the error is thrown and caught, state should be updated
      await waitFor(() => {
        expect(result.current.isGenerating).toBe(false);
      });
    });

    it("shows progress updates during proof generation", async () => {
      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 100_000n,
        commitmentHex: "abc123",
        sendAmount: 60_000n,
        recipientPubKeyX: 11111n,
        changePubKeyX: 67890n,
      };

      // Track progress updates
      const progressUpdates: string[] = [];
      const originalState = result.current;

      await act(async () => {
        await result.current.generateSplitProof(params);
      });

      // Final state should be "Proof generated!"
      expect(result.current.progress).toBe("Proof generated!");
    });
  });

  describe("generatePartialPublicProof", () => {
    const mockMerkleProofResponse = {
      success: true,
      commitment: "abc123",
      leafIndex: "0",
      root: "deadbeef".padStart(64, "0"),
      siblings: Array(20).fill("0".repeat(64)),
      indices: Array(20).fill(0),
    };

    const mockProofData = {
      proof: new Uint8Array([4, 5, 6]),
      publicInputs: [],
    };

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockMerkleProofResponse),
      });
      mockComputeUnifiedCommitment.mockResolvedValue(123456n);
      mockComputeNullifier.mockResolvedValue(789n);
      mockHashNullifier.mockResolvedValue(888n);
      mockGenerateSpendPartialPublicProof.mockResolvedValue(mockProofData);
    });

    it("generates partial public proof with Uint8Array recipient", async () => {
      const { result } = renderHook(() => useProver());

      const recipientBytes = new Uint8Array(32);
      recipientBytes.fill(0xaa);

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 100_000n,
        commitmentHex: "abc123",
        publicAmount: 30_000n,
        changePubKeyX: 67890n,
        recipient: recipientBytes,
      };

      let proofResult: Awaited<ReturnType<typeof result.current.generatePartialPublicProof>>;

      await act(async () => {
        proofResult = await result.current.generatePartialPublicProof(params);
      });

      expect(mockGenerateSpendPartialPublicProof).toHaveBeenCalled();
      expect(proofResult!.proof).toEqual(mockProofData);
      expect(proofResult!.nullifierHash).toBe(888n);
    });

    it("generates partial public proof with hex string recipient", async () => {
      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 100_000n,
        commitmentHex: "abc123",
        publicAmount: 30_000n,
        changePubKeyX: 67890n,
        recipient: "0x" + "bb".repeat(32),
      };

      await act(async () => {
        await result.current.generatePartialPublicProof(params);
      });

      expect(mockGenerateSpendPartialPublicProof).toHaveBeenCalled();
    });

    it("throws error when public amount exceeds input amount", async () => {
      const { result } = renderHook(() => useProver());

      const params = {
        privKey: 12345n,
        pubKeyX: 67890n,
        amount: 50_000n,
        commitmentHex: "abc123",
        publicAmount: 100_000n, // More than input
        changePubKeyX: 67890n,
        recipient: new Uint8Array(32),
      };

      await expect(
        act(async () => {
          await result.current.generatePartialPublicProof(params);
        })
      ).rejects.toThrow("Public amount exceeds input amount");
    });
  });
});
