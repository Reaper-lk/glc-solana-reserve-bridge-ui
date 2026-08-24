import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";

/**
 * Regression coverage for the "Min 99 GLC" bug: the UI used to display and
 * enforce `GET /limits`' `min_transfer_amount` (99 GLC-equivalent) as the
 * minimum amount a user may enter. That figure is a NET-side on-chain
 * check (`limits.rs::enforce_transfer_amount` compares it against the
 * amount AFTER the 1% bridge fee) — the correct GROSS entry-side minimum,
 * in both directions, is a fixed 100 GLC
 * (`MINIMUM_GROSS_BRIDGE_AMOUNT_GLC`), independent of whatever
 * `min_transfer_amount` happens to be configured to.
 *
 * `limitsFixture()` reports the real production `min_transfer_amount`
 * (99 GLC-equivalent, not a rounder 100) specifically so these tests
 * exercise the actual divergence rather than a coincidence where the two
 * numbers already match.
 *
 * Kept as its own file (not added to bridge-card.test.tsx) for the same
 * reason as bridge-card-sol-to-glc-redirect.test.tsx: the SolToGlc cases
 * need a `glcAddressVersions` env mock and a connected wallet that the
 * shared file's other ~30 tests do not need.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_SOLANA_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_GOLDCOIN_RECIPIENT = encodeBase58Check(111, new Uint8Array(20));

const walletConnection = {
  status: "connected" as const,
  address: WALLET_ADDRESS as string | null,
  wallet: null,
  wallets: [],
  canSign: true,
  error: null,
  platform: "desktop" as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  dismissError: vi.fn(),
};

const depositCapability = vi.fn(() => ({ available: true as const }));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: vi.fn() }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
}));

function glcToSolQuote() {
  return {
    direction: "GlcToSol" as const,
    gross_amount: 100_00000000,
    gross_display_amount: "100.00000000",
    fee_bps: 100,
    fee_amount: 1_00000000,
    fee_display_amount: "1.00000000",
    net_amount: 99_000000,
    net_display_amount: "99.000000",
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

function solToGlcQuote() {
  return {
    direction: "SolToGlc" as const,
    gross_amount: 100_000000,
    gross_display_amount: "100.000000",
    fee_bps: 100,
    fee_amount: 1_00000000,
    fee_display_amount: "1.00000000",
    net_amount: 99_00000000,
    net_display_amount: "99.00000000",
    source_decimals: 6,
    destination_decimals: 8,
    source_asset: "GLC (Solana)",
    destination_asset: "GLC (Goldcoin)",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  envState.glcAddressVersions = [111];
  walletConnection.status = "connected";
  walletConnection.address = WALLET_ADDRESS;
  walletConnection.canSign = true;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  depositCapability.mockReturnValue({ available: true });
});

async function typeGlcToSolAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Solana recipient address"),
    VALID_SOLANA_RECIPIENT,
  );
}

/** The "minimum transfer" message renders in more than one place at once
 * (an inline field error and an accessible description on the disabled
 * submit button), so it must be asserted with `findAllByText`, not
 * `findByText` (which throws on more than one match). */
async function expectMinimumMessage() {
  expect(
    (await screen.findAllByText(/The minimum transfer is 100 GLC/i)).length,
  ).toBeGreaterThan(0);
}

async function typeSolToGlcAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  await user.click(screen.getByRole("radio", { name: /GLC on Solana.*GLC L1/i }));
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Goldcoin destination address"),
    VALID_GOLDCOIN_RECIPIENT,
  );
}

describe("BridgeCard — minimum bridge amount (Goldcoin -> Solana)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(glcToSolQuote());
  });

  it("always displays a 100 GLC minimum, never the backend's 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    expect(await screen.findByText(/Min 100 GLC/)).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC/)).not.toBeInTheDocument();
  });

  it("rejects 99 GLC", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "99");
    await expectMinimumMessage();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });

  it("rejects 99.99 GLC", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "99.99");
    await expectMinimumMessage();
    expect(
      screen.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });

  it("accepts exactly 100 GLC", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "100");
    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above 100 GLC", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    const submit = await screen.findByRole("button", { name: /Create deposit request/i });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — minimum bridge amount (Solana -> Goldcoin)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(solToGlcQuote());
  });

  it("always displays a 100 GLC minimum, never the backend's 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    expect(await screen.findByText(/Min 100 GLC/)).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC/)).not.toBeInTheDocument();
  });

  it("rejects 99 GLC", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "99");
    await expectMinimumMessage();
    expect(screen.getByRole("button", { name: /Deposit from wallet/i })).toBeDisabled();
  });

  it("rejects 99.99 GLC", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "99.99");
    await expectMinimumMessage();
    expect(screen.getByRole("button", { name: /Deposit from wallet/i })).toBeDisabled();
  });

  it("accepts exactly 100 GLC", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "100");
    const submit = await screen.findByRole("button", { name: /Deposit from wallet/i });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above 100 GLC", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    const submit = await screen.findByRole("button", { name: /Deposit from wallet/i });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});
