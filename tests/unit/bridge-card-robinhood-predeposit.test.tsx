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
import {
  ELIGIBILITY_BLOCKED_BOTH_TITLE,
  ELIGIBILITY_BLOCKED_TITLE,
  ELIGIBILITY_UNAVAILABLE_TITLE,
} from "@/lib/bridge/eligibility";
import { ROBINHOOD_V2_BRIDGE_ADDRESS } from "@/lib/evm/robinhood-target";
import type * as EnvModule from "@/lib/config/env";
import type * as EvmModule from "@/lib/evm";
import { BridgeCard } from "@/features/bridge/BridgeCard";

/**
 * The `RhnToGlc` pre-deposit gate, from the form's point of view.
 *
 * # What makes this route different from every other one
 *
 * A `RhnToGlc` deposit is an `eth_sendTransaction` straight to the custody
 * contract. There is no `POST /transfers` in front of it that the backend
 * could refuse, and a deposit that arrives while the Goldcoin reserve is
 * closed — or from a wallet still inside its rolling 24-hour window — is
 * not rejected: it is folded and parked in `ManualReview` with the user's
 * GLC already committed. That happened in production because the UI read
 * `/chains`' `enabled`, which is the route gate's verdict and reads no
 * reserve state at all.
 *
 * So every test below asserts the same thing in a different state: the
 * button is disabled, and `deposit` — the function that opens the wallet —
 * was never called. A message on screen is secondary; the deposit not
 * happening is the requirement.
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

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
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

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "disconnected" as const,
    address: null,
    wallet: null,
    wallets: [],
    canSign: false,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => false,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
  buildDeepLinks: () => [],
}));

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  // The PINNED V2 contract. A fixture naming anything else is refused
  // before the gate under test is reached, which is the point of the pin.
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

/** The connected EVM wallet, as a browser reports it: EIP-55 mixed case. */
const WALLET_A = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
/** The same 20 bytes as the backend spells them back: lowercase hex. */
const WALLET_A_ECHO = WALLET_A.toLowerCase();
const WALLET_B = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const WALLET_B_ECHO = WALLET_B.toLowerCase();

const evm = vi.hoisted(() => ({
  address: null as string | null,
  chainId: null as number | null,
}));

const depositFn = vi.fn();

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => DEPLOYMENT,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: evm.address,
      chainId: evm.chainId,
      connecting: false,
      deployment: DEPLOYMENT,
      onExpectedChain: evm.chainId === DEPLOYMENT.chainId,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: depositFn }),
    // A real figure: the FROM panel renders it, and a `known` state with
    // no digits is not a state this hook can be in.
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: { raw: "10000000000000000000000", decimals: 18, symbol: "GLC" },
    }),
  };
});

const ADDRESS_A = encodeBase58Check(111, new Uint8Array(20));
const ADDRESS_B = encodeBase58Check(111, new Uint8Array(20).fill(7));

/** `/chains` with `RhnToGlc` switched on, and `available` set explicitly. */
function chains(options: {
  available: boolean | undefined;
  unavailableReason?: string | null;
}) {
  const base = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route) => {
      if (route.id !== "RhnToGlc") return route;
      if (options.available === undefined) {
        // A deployment predating backend PR #76: it publishes `enabled`
        // and nothing else, which is exactly the half-answer that used to
        // be read as a yes.
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }
      return {
        ...route,
        available: options.available,
        unavailable_reason: options.available
          ? null
          : (options.unavailableReason ?? null),
      };
    }),
  };
}

function eligibility(overrides: Record<string, unknown> = {}) {
  return {
    direction: "RhnToGlc",
    address: ADDRESS_A,
    wallet: WALLET_A_ECHO,
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    source_wallet_retry_after: null,
    recipient_retry_after: null,
    window_seconds: 86_400,
    ...overrides,
  };
}

/** A plausible unix SECOND: the reopen instant the backend publishes. */
const RETRY_AT = 1_800_000_000;

function sourceWalletBlocked(overrides: Record<string, unknown> = {}) {
  return eligibility({
    eligible: false,
    blocked_reason: "source_wallet_rate_limited",
    blocked_reasons: ["source_wallet_rate_limited"],
    retry_after: RETRY_AT,
    retry_after_seconds: 3_600,
    source_wallet_retry_after: RETRY_AT,
    ...overrides,
  });
}

function recipientBlocked(overrides: Record<string, unknown> = {}) {
  return eligibility({
    eligible: false,
    blocked_reason: "recipient_rate_limited",
    blocked_reasons: ["recipient_rate_limited"],
    retry_after: RETRY_AT,
    retry_after_seconds: 7_200,
    recipient_retry_after: RETRY_AT,
    ...overrides,
  });
}

function rhnQuote() {
  return {
    direction: "RhnToGlc" as const,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "1500000000",
    fee_display_amount: "15.00000000",
    net_amount: "48500000000",
    net_display_amount: "485.00000000",
    source_decimals: 18,
    destination_decimals: 8,
    source_asset: "GLC (Robinhood)",
    destination_asset: "GLC (Goldcoin)",
  };
}

/**
 * Fills the RhnToGlc form the way a user does: pick the two networks, type
 * an amount, type a Goldcoin destination.
 *
 * "500" at 18 decimals is an exact multiple of the custody contract's
 * 10^10 canonical scale, so the amount leg of the gate is satisfied and
 * what these tests observe is the pre-deposit gate alone.
 */
async function fillRhnForm(
  user: ReturnType<typeof userEvent.setup>,
  address: string = ADDRESS_A,
) {
  await selectNetwork(user, "Source network", /Robinhood/);
  await selectNetwork(user, "Destination network", /Goldcoin/);
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText("Goldcoin destination address"), address);
}

beforeEach(() => {
  vi.resetAllMocks();
  push.mockReset();
  depositFn.mockReset();
  envState.glcAddressVersions = [111];
  evm.address = WALLET_A;
  evm.chainId = DEPLOYMENT.chainId;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(chains({ available: true }));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue(rhnQuote());
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: ADDRESS_A,
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
  getRhnToGlcRecipientEligibility.mockResolvedValue(eligibility());
  depositFn.mockResolvedValue({ hash: "0xabcdef0123456789" });
});

describe("BridgeCard — RhnToGlc route availability", () => {
  it("disables the deposit when the route is ENABLED but not available", async () => {
    // The production launch-blocker exactly: the route gate open, the
    // Goldcoin reserve's admission closed. `enabled` alone said yes.
    getChains.mockResolvedValue(
      chains({ available: false, unavailableReason: "Bridge capacity reached." }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("renders the backend's own `unavailable_reason`, not a locally authored line", async () => {
    const reason = "Bridge capacity reached for this direction.";
    getChains.mockResolvedValue(chains({ available: false, unavailableReason: reason }));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    expect((await screen.findAllByText(reason)).length).toBeGreaterThan(0);
    expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument();
  });

  it("fails closed when the backend never published availability at all", async () => {
    // An older deployment answers `enabled: true` and omits `available`.
    // Reading that as permission is the whole defect; unknown is a refusal.
    getChains.mockResolvedValue(chains({ available: undefined }));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("fails closed when /chains itself is unreachable", async () => {
    getChains.mockRejectedValue(new Error("network down"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Robinhood/);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });
});

describe("BridgeCard — RhnToGlc eligibility", () => {
  it("checks the connected EVM wallet AND the entered Goldcoin destination", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    await waitFor(() =>
      expect(getRhnToGlcRecipientEligibility).toHaveBeenCalledWith(ADDRESS_A, WALLET_A),
    );
  });

  it("disables the deposit when the SOURCE WALLET's 24h window blocks, with its reopen time", async () => {
    getRhnToGlcRecipientEligibility.mockResolvedValue(sourceWalletBlocked());

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    // The reopen time the backend published, rendered compactly beside
    // the row it belongs to and derived from the ABSOLUTE instant rather
    // than the seconds-from-now figure, which decays while the page sits
    // open.
    expect(screen.getByText(/Source wallet is eligible again in/)).toBeInTheDocument();
    // The destination's own message must not also appear: only one limit
    // is blocking, and naming both would send the user to fix the wrong one.
    expect(
      screen.queryByText(ELIGIBILITY_BLOCKED_TITLE.destination),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("disables the deposit when the GOLDCOIN DESTINATION's 24h window blocks, with its reopen time", async () => {
    getRhnToGlcRecipientEligibility.mockResolvedValue(recipientBlocked());

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.destination)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Destination wallet is eligible again in/),
    ).toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("fails closed when the eligibility endpoint cannot be read", async () => {
    // Every route now fails closed on an unreadable verdict, not just
    // this one — but this is the route where the cost of the old
    // fail-open behaviour was a user's GLC parked in ManualReview rather
    // than a slower transfer.
    getRhnToGlcRecipientEligibility.mockRejectedValue(new Error("500"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("invalidates a prior clearance when the connected WALLET changes", async () => {
    // Wallet A is clear; wallet B is inside its window. The verdict A
    // earned must not carry across the switch — it is an answer about a
    // different wallet, and B's own answer is a refusal.
    getRhnToGlcRecipientEligibility.mockImplementation(
      async (_address: string, wallet: string) =>
        wallet === WALLET_A
          ? eligibility()
          : sourceWalletBlocked({ wallet: WALLET_B_ECHO }),
    );

    const user = userEvent.setup({ delay: null });
    const { rerender } = renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    evm.address = WALLET_B;
    rerender(<BridgeCard />);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(getRhnToGlcRecipientEligibility).toHaveBeenCalledWith(ADDRESS_A, WALLET_B);
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("invalidates a prior clearance when the DESTINATION changes", async () => {
    getRhnToGlcRecipientEligibility.mockImplementation(async (address: string) =>
      address === ADDRESS_A ? eligibility() : recipientBlocked({ address: ADDRESS_B }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    const field = screen.getByLabelText("Goldcoin destination address");
    await user.clear(field);
    await user.type(field, ADDRESS_B);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("falls back to a relative wait when the backend sent only `retry_after_seconds`", async () => {
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      recipientBlocked({
        retry_after: null,
        recipient_retry_after: null,
        retry_after_seconds: 7_200,
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    // Falls through to the seconds figure the backend did send, rendered
    // in the compact h/m form.
    expect(
      await screen.findByText(/Destination wallet is eligible again in 2h/),
    ).toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("shows NO retry line, and still refuses, when the backend published no time", async () => {
    // "Try again in 24 hours" would be a number the backend never said.
    // The refusal does not depend on having one.
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      sourceWalletBlocked({
        retry_after: null,
        retry_after_seconds: null,
        source_wallet_retry_after: null,
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/eligible again in/)).not.toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("times the two limits separately when both windows block", async () => {
    // Both windows are reported, each with its OWN reopen time, because a
    // user waiting out two limits needs both waits — the old gate could
    // surface only the higher-precedence one.
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      sourceWalletBlocked({
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        source_wallet_retry_after: RETRY_AT,
        recipient_retry_after: RETRY_AT + 86_400,
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    // The compact rows time each side independently.
    expect(
      await screen.findByText(/Source wallet is eligible again in/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Destination wallet is eligible again in/),
    ).toBeInTheDocument();
    // And the callout names both sides rather than picking one.
    expect(screen.getAllByText(ELIGIBILITY_BLOCKED_BOTH_TITLE).length).toBeGreaterThan(0);
  });

  it("accepts the backend's lowercase echo of a checksummed wallet address", async () => {
    // The wallet reports EIP-55 mixed case; the backend answers in
    // lowercase hex. A case-sensitive echo check would refuse every real
    // deposit, so this pins that it does not.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
  });
});

describe("BridgeCard — RhnToGlc submit-time re-check", () => {
  it("refuses a stale clearance: eligibility that flips between the click and the send", async () => {
    // Form-time: eligible, so the button enables. Every later read: the
    // wallet deposited from another tab in the meantime.
    getRhnToGlcRecipientEligibility
      .mockResolvedValueOnce(eligibility())
      .mockResolvedValue(sourceWalletBlocked());

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    // Decisive: no EVM transaction was ever built.
    await waitFor(() =>
      expect(getRhnToGlcRecipientEligibility.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(depositFn).not.toHaveBeenCalled();
    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    // The submit-time refusal states the reopen time too, not just the
    // form's own callout — it is built from the same verdict, so the two
    // can never quote different times.
    expect(
      (await screen.findAllByText(/Source wallet is eligible again in/)).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a stale clearance: the route closing between the click and the send", async () => {
    getChains
      .mockResolvedValueOnce(chains({ available: true }))
      .mockResolvedValue(chains({ available: false, unavailableReason: "Closed now." }));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    expect((await screen.findAllByText("Closed now.")).length).toBeGreaterThan(0);
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("refuses when the submit-time eligibility read itself fails", async () => {
    getRhnToGlcRecipientEligibility
      .mockResolvedValueOnce(eligibility())
      .mockRejectedValue(new Error("gateway timeout"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    expect(depositFn).not.toHaveBeenCalled();
  });

  it("sends the deposit when availability AND eligibility both clear, re-read fresh", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnForm(user);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    await waitFor(() => expect(depositFn).toHaveBeenCalledTimes(1));
    // The 18-decimal figure the user typed, never re-widened from the
    // canonical one.
    expect(depositFn.mock.calls[0]![0].amountRaw).toBe(500_000_000_000_000_000_000n);
    expect(await screen.findByText("Deposit submitted")).toBeInTheDocument();
    // Both halves really were re-read immediately before the send.
    expect(getChains.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getRhnToGlcRecipientEligibility.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("BridgeCard — the Solana routes are untouched by this gate", () => {
  it("never calls the RhnToGlc eligibility endpoint for a SolToGlc transfer", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(screen.getByLabelText("Goldcoin destination address"), ADDRESS_A);

    await waitFor(() => expect(getSolToGlcRecipientEligibility).toHaveBeenCalled());
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("never asks the RhnToGlc endpoint about a GlcToSol transfer", async () => {
    // A Goldcoin→Solana transfer draws on a different reserve entirely,
    // and its windows are not the ones this endpoint reports. The
    // Robinhood gate closing must not reach it, and neither must its
    // eligibility question: asking `/recipients/rhn-to-glc/eligibility`
    // about `GlcToSol` would be asking about a limit that does not govern
    // it.
    //
    // GlcToSol is nonetheless NOT submittable, and deliberately so: the
    // backend publishes no eligibility endpoint for it yet, and every
    // route now requires an authoritative verdict. What this test pins is
    // that the reason is its OWN missing verdict, never Robinhood's
    // capacity.
    getChains.mockResolvedValue(
      chains({ available: false, unavailableReason: "Bridge capacity reached." }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Goldcoin/);
    await selectNetwork(user, "Destination network", /Solana/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(
      screen.getByLabelText("Solana recipient address"),
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Bridge capacity reached.")).not.toBeInTheDocument();
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
  });
});
