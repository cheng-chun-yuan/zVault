import { describe, it, expect, vi, beforeEach } from "vitest";
import { sbBTCApi } from "../client";

// Mock fetch
global.fetch = vi.fn();

describe("sbBTCApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prepares deposit correctly", async () => {
    const mockResponse = {
      commitment: "test_commitment",
      note_export: "test_note",
      amount_sats: 100000000,
      taproot_address: "bc1qtest",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await sbBTCApi.prepareDeposit(100000000, "test_address");
    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/deposit/prepare"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("100000000"),
      })
    );
  });

  it("gets balance correctly", async () => {
    const mockResponse = {
      sbbtc_balance: 50000000,
      pending_deposits: [],
      pending_withdrawals: [],
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await sbBTCApi.getBalance("test_address");
    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/balance/test_address"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("handles errors correctly", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "Not found" }),
    });

    await expect(sbBTCApi.getBalance("invalid")).rejects.toThrow();
  });
});
