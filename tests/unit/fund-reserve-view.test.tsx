import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import { solanaSendError } from "@/lib/api/errors";
import { FundReserveView } from "@/features/admin/FundReserveView";

/**
 * Component-level coverage for the operator-only reserve funding page.
 * Every wallet/chain call is mocked (`@/lib/solana` in full) so each test
 * controls exactly one condition without a real Phantom connection or RPC.
 */

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const {
  RESERVE_ADDRESS,
  walletConnection,
  authorizationResult,
  fundFn,
  walletBalanceRefetch,
  reserveBalanceRefetch,
} = vi.hoisted(() => ({
  RESERVE_ADDRESS: "5AFssVkaz9nzS2tSQowUqYYmpg7wPSJa1mLKxuHKP2kp",
  walletConnection: {
    status: "disconnected" as string,
    address: null as string | null,
    wallet: null,
    wallets: [] as unknown[],
    canSign: false,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  },
  authorizationResult: vi.fn(),
  fundFn: vi.fn(),
  walletBalanceRefetch: vi.fn(),
  reserveBalanceRefetch: vi.fn(),
}));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useTokenBalance: () => ({
    data: { raw: "5000000", decimals: 6, symbol: "GLC" },
    refetch: walletBalanceRefetch,
  }),
  useReserveTokenAccountBalance: () => ({
    data: { raw: "10000000000", decimals: 6, symbol: "GLC" },
    refetch: reserveBalanceRefetch,
  }),
  useOperatorAuthorization: () => authorizationResult(),
  useFundReserve: () => ({
    ready: true,
    walletAddress: walletConnection.address,
    canSign: true,
    fund: fundFn,
  }),
  glcToAtomic: (input: string) => {
    if (!/^\d+(\.\d+)?$/.test(input.trim()) || Number(input) <= 0) {
      throw new Error("Amount must be a plain positive decimal number.");
    }
    return BigInt(Math.round(Number(input) * 1_000_000));
  },
  isValidAddress: () => true,
  RESERVE_TOKEN_ACCOUNT_ADDRESS: RESERVE_ADDRESS,
  RESERVE_MINT_DECIMALS: 6,
}));

vi.mock("@/features/wallet/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  walletConnection.status = "disconnected";
  walletConnection.address = null;
  authorizationResult.mockReturnValue({
    isPending: false,
    isError: false,
    data: { authorized: false },
  });
});

describe("FundReserveView — access", () => {
  it("prompts to connect a wallet when none is connected, with no funding form", () => {
    renderWithQueryClient(<FundReserveView />);
    expect(
      screen.getByText(/connect the operator's phantom wallet/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount in GLC/i)).not.toBeInTheDocument();
  });

  it("shows an unauthorized message and renders no funding form for a connected but non-allowlisted wallet", () => {
    walletConnection.status = "connected";
    walletConnection.address = WALLET_ADDRESS;
    authorizationResult.mockReturnValue({
      isPending: false,
      isError: false,
      data: { authorized: false },
    });
    renderWithQueryClient(<FundReserveView />);

    expect(screen.getByText(/not authorized to fund the reserve/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount in GLC/i)).not.toBeInTheDocument();
    expect(screen.queryByText(RESERVE_ADDRESS)).not.toBeInTheDocument();
  });

  it("treats an authorization check failure the same as unauthorized — never renders the funding form", () => {
    walletConnection.status = "connected";
    walletConnection.address = WALLET_ADDRESS;
    authorizationResult.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
    renderWithQueryClient(<FundReserveView />);

    expect(screen.getByText(/not authorized to fund the reserve/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount in GLC/i)).not.toBeInTheDocument();
  });
});

describe("FundReserveView — authorized operator flow", () => {
  beforeEach(() => {
    walletConnection.status = "connected";
    walletConnection.address = WALLET_ADDRESS;
    authorizationResult.mockReturnValue({
      isPending: false,
      isError: false,
      data: { authorized: true },
    });
  });

  it("shows the connected address, both balances, and the exact reserve token account", () => {
    renderWithQueryClient(<FundReserveView />);
    expect(screen.getByText(/Connected Phantom address/i)).toBeInTheDocument();
    expect(screen.getAllByText(RESERVE_ADDRESS).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Amount in GLC/i)).toBeInTheDocument();
  });

  it("shows a confirmation screen with the exact amount, mint, and destination before signing", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<FundReserveView />);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "2.5");
    await user.click(screen.getByRole("button", { name: /^Review$/i }));

    expect(
      screen.getByText(/you are funding the solana bridge reserve/i),
    ).toBeInTheDocument();
    expect(screen.getByText("2.5 GLC")).toBeInTheDocument();
    expect(screen.getAllByText(RESERVE_ADDRESS).length).toBeGreaterThan(0);
    expect(fundFn).not.toHaveBeenCalled();
  });

  it("only calls fund() after explicit confirmation, never on Review alone", async () => {
    const user = userEvent.setup();
    fundFn.mockResolvedValue({ signature: "sig123" });
    renderWithQueryClient(<FundReserveView />);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1");
    await user.click(screen.getByRole("button", { name: /^Review$/i }));
    expect(fundFn).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm.*sign/i }));
    await waitFor(() => expect(fundFn).toHaveBeenCalledWith({ amountGlc: "1" }));
  });

  it("shows the resulting transaction signature and refreshes balances after a successful funding", async () => {
    const user = userEvent.setup();
    fundFn.mockResolvedValue({ signature: "5xyzSignatureExample" });
    renderWithQueryClient(<FundReserveView />);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1");
    await user.click(screen.getByRole("button", { name: /^Review$/i }));
    await user.click(screen.getByRole("button", { name: /confirm.*sign/i }));

    expect(await screen.findByText("5xyzSignatureExample")).toBeInTheDocument();
    await waitFor(() => expect(walletBalanceRefetch).toHaveBeenCalled());
    await waitFor(() => expect(reserveBalanceRefetch).toHaveBeenCalled());
  });

  it("shows a transaction-specific error on a funding failure, never the generic page error", async () => {
    const user = userEvent.setup();
    fundFn.mockRejectedValue(solanaSendError(new Error("wallet rejected")));
    renderWithQueryClient(<FundReserveView />);

    await user.type(screen.getByLabelText(/Amount in GLC/i), "1");
    await user.click(screen.getByRole("button", { name: /^Review$/i }));
    await user.click(screen.getByRole("button", { name: /confirm.*sign/i }));

    expect(
      await screen.findByText(/The Solana transaction could not be submitted\./i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Something went wrong loading this page\./i),
    ).not.toBeInTheDocument();
  });

  it("disables Review until a valid amount is entered", () => {
    renderWithQueryClient(<FundReserveView />);
    expect(screen.getByRole("button", { name: /^Review$/i })).toBeDisabled();
  });
});
