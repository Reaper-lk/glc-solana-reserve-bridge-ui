import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  primaryCta,
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { ELIGIBILITY_UNAVAILABLE_TITLE } from "@/lib/bridge/eligibility";
import { ROBINHOOD_V2_BRIDGE_ADDRESS } from "@/lib/evm/robinhood-target";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";
import type * as EvmModule from "@/lib/evm";
import type { WalletStatus } from "@/lib/solana/types";

/**
 * The SUBMIT GATE against backend route state, for all six routes.
 *
 * # The defect this is the regression guard for
 *
 * `GET /chains`' `enabled` is the route gate's verdict over config, the
 * `bridge_routes` table and adapter capability. It reads NO reserve state.
 * In production it therefore stayed `true` while the Goldcoin reserve's
 * admission was closed, and every newly observed deposit folded into
 * `ManualReview` — users having made irreversible on-chain deposits
 * against a UI that had been told the route was fine.
 *
 * So: **`enabled: true` alone must never enable a submission.** Only a
 * positive `available: true` may, and an `available` the backend never
 * published is unknown, which is a refusal.
 *
 * Route availability is also never inferred from local configuration
 * here. There is no env var, no hardcoded route list and no
 * "the contract address is set, so the route must be open" shortcut —
 * which is what makes opening a route a backend-only change.
 *
 * The per-route figures (capacity, windows, minimums) are covered by
 * route-status.test.ts and status-view-routes.test.tsx; this file is only
 * about what the bridge form will and will not let a user send.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    getSolToGlcRecipientEligibility: (...args: unknown[]) =>
      getSolToGlcRecipientEligibility(...args),
    // The one method `fetchRouteEligibility` calls. Built from the
    // per-route mocks above by the same rule `HttpBridgeClient` uses, so
    // a route with no landed endpoint rejects here exactly as it would
    // against the real backend.
    getRouteEligibility: routeEligibilityFrom({
      SolToGlc: (address: string, wallet: string | null) =>
        getSolToGlcRecipientEligibility(address, wallet),
      RhnToGlc: (address: string, wallet: string | null) =>
        getRhnToGlcRecipientEligibility(address, wallet),
    }),
    getRhnToGlcRecipientEligibility: (...args: unknown[]) =>
      getRhnToGlcRecipientEligibility(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

const SOL_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_WALLET = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
const GLC_ADDRESS = encodeBase58Check(111, new Uint8Array(20));

const solanaDeposit = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "connected" as WalletStatus,
    address: SOL_WALLET,
    wallet: null,
    wallets: [],
    canSign: true,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: solanaDeposit,
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => ({
    isPending: false,
    isError: false,
    data: { raw: "1000000000000", decimals: 6, symbol: "GLC" },
  }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
  buildDeepLinks: () => [],
}));

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Network",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

const evmDeposit = vi.fn();

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => DEPLOYMENT,
    robinhoodDeploymentProblem: () => null,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: EVM_WALLET,
      chainId: 4663,
      connecting: false,
      deployment: DEPLOYMENT,
      onExpectedChain: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: evmDeposit }),
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: { raw: "10000000000000000000000", decimals: 18, symbol: "GLC" },
    }),
  };
});

/** Both sides of the rolling-24h check cleared, so only route state gates. */
function eligible(direction: "SolToGlc" | "RhnToGlc", wallet: string) {
  return {
    direction,
    address: GLC_ADDRESS,
    wallet: direction === "RhnToGlc" ? wallet.toLowerCase() : wallet,
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    source_wallet_retry_after: null,
    recipient_retry_after: null,
    window_seconds: 86_400,
  };
}

/** `/chains` with one route's state set explicitly and the rest wide open. */
function chainsWith(
  routeId: string,
  state: {
    enabled?: boolean;
    available?: boolean | undefined;
    unavailable_reason?: string | null;
    disabled_reason?: string | null;
    implemented?: boolean;
    min_transfer_atomic?: string;
  },
) {
  const base = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route) => {
      const open = {
        ...route,
        enabled: true,
        disabled_reason: null,
        implemented: true,
        available: true,
        unavailable_reason: null,
      };
      if (route.id !== routeId) return open;
      const next: Record<string, unknown> = { ...open, ...state };
      // `available: undefined` means the FIELD WAS NOT PUBLISHED, which
      // is a different thing from `false` — so it is removed rather than
      // set, exactly as an older backend would send it.
      if (state.available === undefined && "available" in state) {
        delete next.available;
        delete next.unavailable_reason;
      }
      return next as typeof route;
    }),
  };
}

function quoteFor(direction: string) {
  return {
    direction,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "1500000000",
    fee_display_amount: "15.00000000",
    net_amount: "48500000000",
    net_display_amount: "485.00000000",
    source_decimals: 8,
    destination_decimals: 8,
    source_asset: "GLC",
    destination_asset: "GLC",
  };
}

/** Drives a SolToGlc form: the route whose eligibility the backend answers. */
async function fillSolToGlc(user: ReturnType<typeof userEvent.setup>) {
  await selectNetwork(user, "Source network", /Solana/);
  await selectNetwork(user, "Destination network", /Goldcoin/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText("Goldcoin destination address"), GLC_ADDRESS);
}

async function fillRhnToGlc(user: ReturnType<typeof userEvent.setup>) {
  await selectNetwork(user, "Source network", /Robinhood/);
  await selectNetwork(user, "Destination network", /Goldcoin/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText("Goldcoin destination address"), GLC_ADDRESS);
}

beforeEach(() => {
  vi.resetAllMocks();
  envState.glcAddressVersions = [111];
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(chainsWith("none", {}));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockImplementation(async (request: { direction: string }) =>
    quoteFor(request.direction),
  );
  listTransfers.mockResolvedValue({
    items: [],
    next_cursor: null,
    as_of: 1_700_000_000,
  });
  getSolToGlcRecipientEligibility.mockResolvedValue(eligible("SolToGlc", SOL_WALLET));
  getRhnToGlcRecipientEligibility.mockResolvedValue(eligible("RhnToGlc", EVM_WALLET));
});

describe("the submit gate reads GET /chains, not local configuration", () => {
  it("enables submission when the backend positively answered available: true", async () => {
    // The control for every case below: everything else about this form
    // is identical, and only `/chains` moves.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
  });

  it("prevents submission when the backend reports available: false", async () => {
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", {
        enabled: true,
        available: false,
        unavailable_reason: "Transfers to Goldcoin are paused for maintenance.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    // The backend's own sentence, verbatim — this UI never authors a
    // second explanation of a backend decision.
    expect(
      (await screen.findAllByText("Transfers to Goldcoin are paused for maintenance."))
        .length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });

  it("does NOT treat enabled: true as usable when `available` was never published", async () => {
    // The exact production defect: the route gate said yes, the reserve
    // was never asked, and deposits folded into ManualReview. An
    // unpublished `available` is unknown, and unknown is a refusal.
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", { enabled: true, available: undefined }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });

  it("prevents submission on a route the backend has switched off", async () => {
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", {
        enabled: false,
        available: false,
        disabled_reason: "This route is closed.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Goldcoin/);

    expect((await screen.findAllByText("This route is closed.")).length).toBeGreaterThan(
      0,
    );
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("prevents submission when /chains itself cannot be read", async () => {
    // Unknown availability is not "probably fine". There is no local
    // fallback list of "routes we support" to fall back to.
    getChains.mockRejectedValue(new Error("503"));

    renderWithQueryClient(<BridgeCard />);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(solanaDeposit).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("closes one route without touching another", async () => {
    // Availability is per route, read per route. Closing the Robinhood
    // leg must not disturb a route on a different reserve.
    getChains.mockResolvedValue(
      chainsWith("RhnToGlc", {
        enabled: true,
        available: false,
        unavailable_reason: "Robinhood deposits are closed.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
  });

  it("prevents an irreversible RhnToGlc deposit on available: false, even with eligibility cleared", async () => {
    // The route this matters most on: the deposit reaches the custody
    // contract with no `POST /transfers` in front of it, so a closed
    // reserve is not a refusal, it is a park with the GLC already gone.
    getChains.mockResolvedValue(
      chainsWith("RhnToGlc", {
        enabled: true,
        available: false,
        unavailable_reason: "Goldcoin admission is closed.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user);

    expect(
      (await screen.findAllByText("Goldcoin admission is closed.")).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(evmDeposit).not.toHaveBeenCalled();
  });

  it("refuses a route the backend reports as not implemented", async () => {
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", {
        implemented: false,
        enabled: false,
        available: false,
        disabled_reason: "Coming soon.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Goldcoin/);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });
});

describe("route state and eligibility are independent gates", () => {
  it("an available route is still refused when eligibility cannot be established", async () => {
    // `available` is route-wide and knows no addresses; the rolling-24h
    // windows are per wallet. Both must pass, and neither substitutes for
    // the other.
    getSolToGlcRecipientEligibility.mockRejectedValue(new Error("503"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("reports the ROUTE's closure rather than an eligibility problem when both apply", async () => {
    // Ordering matters: a closed route is not a fact about this user's
    // wallets, and asking them to wait out a window they are not in
    // would be the wrong remedy.
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", {
        enabled: true,
        available: false,
        unavailable_reason: "Capacity reached.",
      }),
    );
    getSolToGlcRecipientEligibility.mockRejectedValue(new Error("503"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user);

    expect((await screen.findAllByText("Capacity reached.")).length).toBeGreaterThan(0);
    expect(screen.queryByText(ELIGIBILITY_UNAVAILABLE_TITLE)).not.toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("re-reads availability fresh before signing, and refuses a route that just closed", async () => {
    // The form's cached answer is not what authorizes the deposit: a
    // route can close between the button enabling and the click landing.
    getChains.mockResolvedValueOnce(chainsWith("none", {})).mockResolvedValue(
      chainsWith("RhnToGlc", {
        enabled: true,
        available: false,
        unavailable_reason: "Closed between render and click.",
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    expect(
      (await screen.findAllByText("Closed between render and click.")).length,
    ).toBeGreaterThan(0);
    expect(evmDeposit).not.toHaveBeenCalled();
  });
});

describe("the minimum is the backend's figure, not a derived one", () => {
  it("renders min_transfer_atomic as published, performing no fee arithmetic on it", async () => {
    // The bug this replaced: reconstructing a minimum from whichever
    // chain floor governed the route and grossing it up through the fee,
    // which produced entry minimums like "102.061856 GLC" — correct
    // arithmetic against the wrong rule.
    getChains.mockResolvedValue(
      // 250 GLC at canonical 8 decimals.
      chainsWith("SolToGlc", { min_transfer_atomic: "25000000000" }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Goldcoin/);

    expect((await screen.findAllByText(/250 GLC/)).length).toBeGreaterThan(0);
    // Not adjusted upward for the 3% fee, which would read 257.7…
    expect(screen.queryByText(/257\./)).not.toBeInTheDocument();
  });

  it("refuses an amount below the backend's published minimum", async () => {
    getChains.mockResolvedValue(
      chainsWith("SolToGlc", { min_transfer_atomic: "25000000000" }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Goldcoin/);
    await waitFor(() => expect(getLimits).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/Amount in GLC/i), "100");
    await user.type(screen.getByLabelText("Goldcoin destination address"), GLC_ADDRESS);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });
});
