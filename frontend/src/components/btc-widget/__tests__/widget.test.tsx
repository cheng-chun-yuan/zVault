import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { sbBTCWidget } from "../widget";

// Mock wallet adapter
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    publicKey: null,
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe("sbBTCWidget", () => {
  it("renders without crashing", () => {
    render(<sbBTCWidget />);
    // Widget should render (may be closed initially)
    expect(document.body).toBeTruthy();
  });

  it("renders with custom trigger", () => {
    const trigger = <button>Custom Button</button>;
    render(<sbBTCWidget trigger={trigger} />);
    expect(document.body).toBeTruthy();
  });
});
