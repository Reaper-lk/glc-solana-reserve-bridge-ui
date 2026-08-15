import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import { ActivityView } from "@/features/activity/ActivityView";
import * as fixtures from "@/lib/api/mock/fixtures";

const listTransfers = vi.fn();
vi.mock("@/lib/api", () => ({
  bridgeApi: { listTransfers: (...args: unknown[]) => listTransfers(...args) },
}));

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

const walletConnection: { address: string | null; status: "disconnected" | "connected" } =
  {
    address: null,
    status: "disconnected",
  };
vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
}));

beforeEach(() => {
  vi.resetAllMocks();
  searchParams = new URLSearchParams();
  walletConnection.address = null;
  walletConnection.status = "disconnected";
});

describe("ActivityView", () => {
  it("shows an empty-address prompt when nothing is connected or searched", () => {
    renderWithQueryClient(<ActivityView />);
    expect(screen.getByText(/No address to search/i)).toBeInTheDocument();
    expect(listTransfers).not.toHaveBeenCalled();
  });

  it("uses the connected wallet address as a default", async () => {
    walletConnection.address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    walletConnection.status = "connected";
    listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });

    renderWithQueryClient(<ActivityView />);

    await waitFor(() =>
      expect(listTransfers).toHaveBeenCalledWith(
        expect.objectContaining({ address: walletConnection.address }),
        expect.anything(),
      ),
    );
  });

  it("renders an empty state for a real zero-result search", async () => {
    searchParams = new URLSearchParams(
      "address=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );
    listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });

    renderWithQueryClient(<ActivityView />);

    expect(await screen.findByText(/No transfers yet/i)).toBeInTheDocument();
  });

  it("renders transfer rows for a real result set", async () => {
    searchParams = new URLSearchParams(
      "address=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );
    listTransfers.mockResolvedValue({
      items: fixtures.transfersFixture().slice(0, 2),
      next_cursor: null,
      as_of: 0,
    });

    renderWithQueryClient(<ActivityView />);

    expect(await screen.findAllByText(/#\d+/)).toHaveLength(2);
  });

  it("surfaces an API failure rather than an empty state", async () => {
    searchParams = new URLSearchParams(
      "address=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );
    listTransfers.mockRejectedValue(new Error("down"));

    renderWithQueryClient(<ActivityView />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No transfers yet/i)).not.toBeInTheDocument();
  });

  it("updates the URL when a manual search is submitted", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ActivityView />);

    await user.type(screen.getByLabelText(/Solana address/i), "SomeAddress111");
    await user.click(screen.getByRole("button", { name: /Search/i }));

    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("address=SomeAddress111"),
    );
  });
});
