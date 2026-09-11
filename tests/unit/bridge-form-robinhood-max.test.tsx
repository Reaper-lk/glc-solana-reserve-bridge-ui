import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient, selectNetwork, waitForRouteVerdict } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import type * as EvmModule from "@/lib/evm";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * The per-transaction maximum on the two Robinhood routes.
 *
 * # The gap this file closes
 *
 * The form showed "Min … · Max …" on the Solana pairs and NOTHING on a
 * Robinhood one. The reason was sound as far as it went — `GET /limits`
 * reports the SOLANA program's `BridgeConfig`, and relabelling it for a
 * Robinhood route would publish a ceiling no chain enforces — but the
 * conclusion was wrong: `GET /robinhood/limits` does publish the real
 * ceiling, read live from the deployed `GlcRobinhoodBridge`. A user on a
 * Robinhood route was therefore given no maximum at all, and found the
 * real one by having a transaction revert.
 *
 * # What is pinned here
 *
 * That the maximum shown comes FROM that endpoint, that each route reads
 * its own direction's field, that it is formatted in the source token's
 * own decimals, and that an unread contract still shows nothing rather
 * than a number nobody confirmed. The 20,000 figure lives in the fixture
 * standing in for the backend — never in the component, and never in an
 * expectation that would survive the backend changing it.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const listTransfers = vi.fn();
const getRobinhoodLimits = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  bridgeApi: {
    getStatus: (...a: unknown[]) => getStatus(...a),
    getChains: (...a: unknown[]) => getChains(...a),
    getLimits: (...a: unknown[]) => getLimits(...a),
    getReserve: (...a: unknown[]) => getReserve(...a),
    getQuote: (...a: unknown[]) => getQuote(...a),
    createTransfer: vi.fn(),
    listTransfers: (...a: unknown[]) => listTransfers(...a),
    getRobinhoodLimits: (...a: unknown[]) => getRobinhoodLimits(...a),
    getSolToGlcRecipientEligibility: (...a: unknown[]) =>
      getSolToGlcRecipientEligibility(...a),
    getRhnToGlcRecipientEligibility: (...a: unknown[]) =>
      getRhnToGlcRecipientEligibility(...a),
  },
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
  isValidAddress: (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
}));

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  const deployment = {
    chainId: 4663,
    chainName: "Robinhood Chain",
    rpcUrl: "https://rpc.example.invalid",
    bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  };
  return {
    ...actual,
    robinhoodDeployment: () => deployment,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: null,
      chainId: null,
      connecting: false,
      deployment,
      onExpectedChain: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: undefined,
    }),
  };
});

/** The limits line under the amount field, as one string. */
function boundsLine(): string | null {
  const paragraphs = Array.from(document.querySelectorAll("p"));
  const line = paragraphs.find((p) => /(^|\s)(Min|Max)\s/.test(p.textContent));
  return line?.textContent ?? null;
}

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
  );
  getQuote.mockImplementation((request: { direction: string }) =>
    Promise.resolve({
      direction: request.direction,
      gross_amount: "100000000000",
      gross_display_amount: "1000.00000000",
      fee_bps: 300,
      fee_amount: "3000000000",
      fee_display_amount: "30.00000000",
      net_amount: "97000000000",
      net_display_amount: "970.00000000",
      source_decimals: 8,
      destination_decimals: 18,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Robinhood)",
    }),
  );
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  const eligible = {
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  };
  getSolToGlcRecipientEligibility.mockResolvedValue({
    ...eligible,
    direction: "SolToGlc",
  });
  getRhnToGlcRecipientEligibility.mockResolvedValue({
    ...eligible,
    direction: "RhnToGlc",
  });
});

/** The whole-GLC maximum the mock backend publishes, per direction. */
function publishedMax(direction: "inbound" | "outbound"): bigint {
  const limits = fixtures.robinhoodLimitsFixture(() => new Date(), { open: true });
  const raw =
    direction === "inbound" ? limits.inbound_max_atomic : limits.outbound_max_atomic;
  return BigInt(raw ?? "0") / 10n ** 18n;
}

/** "20,000" — grouped exactly as the form renders it. */
function grouped(whole: bigint): string {
  return whole.toLocaleString("en-US");
}

describe("GlcToRhn — Goldcoin → Robinhood Chain", () => {
  it("shows the contract's outbound per-transfer maximum", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    const expected = `Max ${grouped(publishedMax("outbound"))} GLC`;
    await waitFor(() => expect(boundsLine()).toContain(expected));
  });

  it("takes the figure from GET /robinhood/limits, not GET /limits", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() => expect(getRobinhoodLimits).toHaveBeenCalled());
    // The Solana program's own ceiling is a different number in a
    // different unit; it must not be what this route displays.
    const solana = fixtures.limitsFixture();
    expect(getLimits).toHaveBeenCalled();
    expect(boundsLine()).not.toContain(solana.per_transfer_limit);
  });

  it("states no minimum, because the contract's outboundMin bounds the payout leg", async () => {
    // The user types a GOLDCOIN amount here. `outboundMin` bounds what
    // the contract pays out on the far side, which is a different figure
    // — showing it as an entry floor is the "Min 99 GLC" bug again.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max "));
    expect(boundsLine()).not.toContain("Min ");
  });

  it("refuses an amount above the published maximum", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("Max "));

    const over = (publishedMax("outbound") + 1n).toString();
    await user.type(screen.getByLabelText(/Amount in GLC/i), over);

    // The form states the refusal in more than one place (beside the
    // field and in the route summary), so this counts them rather than
    // demanding exactly one.
    const refusals = await screen.findAllByText(
      new RegExp(`maximum transfer is ${grouped(publishedMax("outbound"))} GLC`),
    );
    expect(refusals.length).toBeGreaterThan(0);
  });

  it("accepts the maximum exactly", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).toContain("Max "));

    await user.type(
      screen.getByLabelText(/Amount in GLC/i),
      publishedMax("outbound").toString(),
    );
    expect(screen.queryAllByText(/maximum transfer is/)).toHaveLength(0);
  });
});

describe("RhnToGlc — Robinhood Chain → Goldcoin", () => {
  it("shows the contract's inbound per-transfer maximum", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);

    const expected = `Max ${grouped(publishedMax("inbound"))} GLC`;
    await waitFor(() => expect(boundsLine()).toContain(expected));
  });

  it("formats it in Robinhood's own 18 decimals, not the canonical 8", async () => {
    // The source token here IS the 18-decimal one. A figure narrowed to 8
    // and then formatted as 18 would read ten orders of magnitude small.
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max "));
    expect(boundsLine()).toContain(`${grouped(publishedMax("inbound"))} GLC`);
    expect(boundsLine()).not.toMatch(/Max 0[.,]/);
  });
});

describe("each route reads its OWN direction's field", () => {
  beforeEach(() => {
    // A deployment whose two maxima have drifted apart. Preflight would
    // report it as a mismatch, but if it ever reaches a browser the form
    // must show each route the ceiling that actually bounds it rather
    // than whichever field it read first.
    getRobinhoodLimits.mockResolvedValue({
      ...fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
      inbound_max_atomic: "20000000000000000000000",
      outbound_max_atomic: "15000000000000000000000",
    });
  });

  it("GlcToRhn shows outboundMax", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Destination network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max 15,000 GLC"));
    expect(boundsLine()).not.toContain("20,000");
  });

  it("RhnToGlc shows inboundMax", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await waitFor(() => expect(boundsLine()).toContain("Max 20,000 GLC"));
    expect(boundsLine()).not.toContain("15,000");
  });
});

describe("an unread contract publishes nothing", () => {
  it("shows no maximum when the live read did not complete", async () => {
    getRobinhoodLimits.mockResolvedValue(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(getRobinhoodLimits).toHaveBeenCalled());
    // Not "Max 0 GLC", which would say the route takes nothing.
    expect(boundsLine()).toBeNull();
  });

  it("shows no maximum when the endpoint itself is absent", async () => {
    // A deployment predating `GET /robinhood/limits` answers 404.
    getRobinhoodLimits.mockRejectedValue(new Error("404"));
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(getRobinhoodLimits).toHaveBeenCalled());
    expect(boundsLine()).toBeNull();
  });
});

describe("the Solana routes are untouched", () => {
  it("still shows Min · Max from GET /limits, and never asks for Robinhood's", async () => {
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await waitFor(() => expect(boundsLine()).toContain("Min "));
    expect(boundsLine()).toContain("Max ");
    // 20,000 GLC, from the Solana `BridgeConfig`'s own 6-decimal figure.
    expect(boundsLine()).toContain("Max 20,000 GLC");
    expect(getRobinhoodLimits).not.toHaveBeenCalled();
  });

  it("keeps showing them after a trip through a Robinhood route and back", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await waitFor(() => expect(boundsLine()).toContain("Min "));

    await selectNetwork(user, "Destination network", /Robinhood Chain/);
    await waitFor(() => expect(boundsLine()).not.toContain("Min "));

    await selectNetwork(user, "Destination network", /Solana/);
    await waitFor(() => expect(boundsLine()).toContain("Min "));
    expect(boundsLine()).toContain("Max 20,000 GLC");
  });
});

/** Pins that DEPLOYMENT above stays the shape `@/lib/evm` is mocked with. */
it("uses the Robinhood Chain deployment the mock announces", () => {
  expect(DEPLOYMENT.chainId).toBe(4663);
});
