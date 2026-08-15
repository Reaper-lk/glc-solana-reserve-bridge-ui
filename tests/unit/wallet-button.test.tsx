import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { WalletButton } from "@/features/wallet/WalletButton";

const connection = {
  status: "initialising" as
    "initialising" | "unconfigured" | "disconnected" | "connecting" | "connected",
  address: null as string | null,
  wallet: null,
  wallets: [],
  canSign: false,
  error: null,
  platform: "desktop" as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  dismissError: vi.fn(),
};

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => connection,
  useSolBalance: () => ({ isPending: true, isError: false, data: undefined }),
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => false,
  needsDeepLink: () => false,
  canOfferInstall: () => true,
  buildDeepLinks: () => [],
}));

vi.mock("@/lib/config/links", () => ({
  solanaAddressUrl: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  connection.status = "initialising";
  connection.address = null;
});

describe("WalletButton — every wallet lifecycle state", () => {
  it("renders a neutral, stable-size placeholder before hydration settles", () => {
    connection.status = "initialising";
    const { container } = render(<WalletButton />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the control with a stated reason when no RPC is configured", () => {
    connection.status = "unconfigured";
    render(<WalletButton />);
    const button = screen.getByRole("button", { name: /Connect wallet/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/not configured/i));
  });

  it("offers Connect wallet when disconnected", () => {
    connection.status = "disconnected";
    render(<WalletButton />);
    expect(screen.getByRole("button", { name: /Connect wallet/i })).toBeEnabled();
  });

  it("shows a busy Connect wallet button while connecting, announced politely", () => {
    connection.status = "connecting";
    render(<WalletButton />);
    const button = screen.getByRole("button", { name: /Connect wallet/i });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Connecting wallet")).toBeInTheDocument();
  });

  it("shows the truncated address once connected", () => {
    connection.status = "connected";
    connection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    render(<WalletButton />);
    expect(screen.getAllByText(/9WzD/).length).toBeGreaterThan(0);
  });
});
