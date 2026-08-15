import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";

/**
 * Component-level coverage for the primary bridge form. Every backend call
 * is mocked so each test controls exactly one condition (paused, insufficient
 * liquidity, a specific quote) without depending on the mock backend's own
 * scenario wiring, which is already covered separately in mock-client.test.ts.
 */

const getStatus = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const walletConnection = {
  status: "disconnected" as const,
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

const depositCapability = vi.fn(() => ({
  available: false,
  reason: "wallet-disconnected" as const,
  message: "Connect a Solana wallet to deposit.",
}));
const depositFn = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: depositFn }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
}));

const VALID_SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function goodQuote(overrides: Partial<ReturnType<typeof baseQuote>> = {}) {
  return { ...baseQuote(), ...overrides };
}

function baseQuote() {
  return {
    direction: "GlcToSol" as const,
    gross_amount: 1_000_00000000,
    gross_display_amount: "1000.00000000",
    fee_bps: 100,
    fee_amount: 10_00000000,
    fee_display_amount: "10.00000000",
    net_amount: 990_00000000,
    net_display_amount: "990.00000000",
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  push.mockReset();
  walletConnection.status = "disconnected";
  walletConnection.address = null;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue(baseQuote());
  depositCapability.mockReturnValue({
    available: false,
    reason: "wallet-disconnected",
    message: "Connect a Solana wallet to deposit.",
  });
});

describe("BridgeCard — direction switching", () => {
  it("defaults to Goldcoin -> Solana and switches to Solana -> Goldcoin", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    expect(screen.getByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Solana recipient address")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Solana.*Goldcoin/i }));

    expect(screen.getByLabelText("Goldcoin destination address")).toBeInTheDocument();
  });

  it("clears amount and recipient when switching direction", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    const amountInput = screen.getByLabelText(/Amount in GLC/i);
    await user.type(amountInput, "100");
    expect(amountInput).toHaveValue("100");

    await user.click(screen.getByRole("radio", { name: /Solana.*Goldcoin/i }));

    const newAmountInput = screen.getByLabelText(/Amount in GLC/i);
    expect(newAmountInput).toHaveValue("");
  });
});

describe("BridgeCard — amount entry and validation", () => {
  it("shows a validation message for a malformed amount", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "12.34.56");

    await waitFor(() =>
      expect(screen.getAllByText(/digits only/i).length).toBeGreaterThan(0),
    );
  });

  it("rejects an amount below the published minimum", async () => {
    getLimits.mockResolvedValue({
      min_transfer_amount: 100_00000000,
      per_transfer_limit: 250_000_00000000,
      bridge_fee_bps: 100,
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1");

    await waitFor(() =>
      expect(screen.getAllByText(/minimum transfer is/i).length).toBeGreaterThan(0),
    );
  });
});

describe("BridgeCard — POST /quote integration and fee presentation", () => {
  it("requests a quote for the canonical gross amount and shows the exact 1% breakdown", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    await waitFor(() => {
      expect(getQuote).toHaveBeenCalledWith(
        { direction: "GlcToSol", gross_amount: 1_000_00000000 },
        expect.anything(),
      );
    });

    expect(await screen.findByText("You bridge")).toBeInTheDocument();
    expect(screen.getByText("Bridge fee (1%)")).toBeInTheDocument();
    expect(screen.getByText("You receive")).toBeInTheDocument();
    expect(screen.getByText(/1000\.00000000/)).toBeInTheDocument();
    expect(screen.getByText(/−10\.00000000/)).toBeInTheDocument();
    expect(screen.getByText(/990\.00000000/)).toBeInTheDocument();
  });

  it("never displays a fee/net figure it computed itself — only what the quote returned", async () => {
    getQuote.mockResolvedValue(
      goodQuote({ fee_display_amount: "7.77000000", net_display_amount: "992.23000000" }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");

    expect(await screen.findByText(/7\.77000000/)).toBeInTheDocument();
    expect(screen.getByText(/992\.23000000/)).toBeInTheDocument();
  });
});

describe("BridgeCard — reserve capacity and pause gating", () => {
  it("disables submission with a stated reason when the direction is paused", async () => {
    getStatus.mockResolvedValue({
      goldcoin_paused: false,
      solana_paused: true,
      vault_address: "GLCVau1t111111111111111111111111111111111",
      next_solana_obligation_index: 1,
      glc_to_sol_available: false,
      sol_to_glc_available: true,
    });
    renderWithQueryClient(<BridgeCard />);

    expect(
      await screen.findByText(/currently paused or unavailable/i),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /Create deposit request/i });
    expect(submit).toBeDisabled();
  });

  it("disables submission with a stated reason when reserve capacity is exhausted", async () => {
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: 5_000_00000000,
      solana_available_capacity: 0,
    });
    renderWithQueryClient(<BridgeCard />);

    expect(
      await screen.findByText(/insufficient reserve liquidity/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });
});

describe("BridgeCard — transfer submission", () => {
  it("creates a GlcToSol transfer and shows deposit instructions with the OP_RETURN binding", async () => {
    createTransfer.mockResolvedValue({
      request_id: 4242,
      deposit_vault_address: "GLCVau1t111111111111111111111111111111111",
      deposit_binding_hex: "ab".repeat(32),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Solana recipient address"),
      VALID_SOLANA_ADDRESS,
    );

    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByText(/Send your deposit/i)).toBeInTheDocument();
    expect(screen.getAllByText(/OP_RETURN/i).length).toBeGreaterThan(0);
    expect(screen.getByText("ab".repeat(32))).toBeInTheDocument();
    expect(createTransfer).toHaveBeenCalledWith({
      amount_atomic: 1_000_00000000,
      recipient: VALID_SOLANA_ADDRESS,
    });
  });

  it("surfaces a submission failure as an error state without fabricating success", async () => {
    createTransfer.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "1000");
    await user.type(
      screen.getByLabelText("Solana recipient address"),
      VALID_SOLANA_ADDRESS,
    );

    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Send your deposit/i)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — API failure states", () => {
  it("states the bridge status is unavailable rather than assuming operational", async () => {
    getStatus.mockRejectedValue(new Error("network down"));
    renderWithQueryClient(<BridgeCard />);

    expect(await screen.findByText(/Bridge status is unavailable/i)).toBeInTheDocument();
  });
});

describe("BridgeCard — Solana -> Goldcoin wallet-disconnected gating", () => {
  it("keeps submission disabled while no wallet is connected", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);

    await user.click(screen.getByRole("radio", { name: /Solana.*Goldcoin/i }));
    await waitFor(() => expect(getLimits).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/Amount in GLC/i), "100");
    await user.type(
      screen.getByLabelText("Goldcoin destination address"),
      "not-checked-here",
    );

    const submit = await screen.findByRole("button", { name: /Deposit from wallet/i });
    expect(submit).toBeDisabled();
  });
});

describe("BridgeCard — loading states", () => {
  it("does not enable submission before limits/status/reserve have loaded", () => {
    getStatus.mockReturnValue(new Promise(() => {}));
    getLimits.mockReturnValue(new Promise(() => {}));
    getReserve.mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<BridgeCard />);

    expect(screen.getByText(/Loading bridge status/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });
});
