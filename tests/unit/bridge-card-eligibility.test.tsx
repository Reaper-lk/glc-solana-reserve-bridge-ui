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
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";
import type * as EvmModule from "@/lib/evm";
import type { WalletStatus } from "@/lib/solana/types";

/**
 * The rolling 24-hour wallet eligibility gate, from the form's point of
 * view, across ALL SIX routes.
 *
 * # The one property, stated many ways
 *
 * **Submission is enabled only when the backend has positively cleared
 * BOTH the source wallet and the destination wallet for this route.**
 * Every other state — either side blocked, an unreadable answer, a route
 * the backend publishes no endpoint for — disables the button AND leaves
 * the wallet unopened. A message on screen is secondary; the transfer not
 * happening is the requirement.
 *
 * # Why "no endpoint" is a refusal and not a pass
 *
 * The backend answers for two routes today (`SolToGlc`, `RhnToGlc`) and
 * four are outstanding. Those four are therefore NOT submittable from
 * this UI, deliberately: a transfer the bridge would hold back cannot be
 * reversed once it is sent, so "we could not establish eligibility" must
 * not authorize one. These tests pin that, so the day the endpoint lands
 * the change is visible as a test change rather than as a silent
 * loosening.
 *
 * This file replaces bridge-card-recipient-rate-limit.test.tsx and
 * bridge-card-source-wallet-rate-limit.test.tsx, whose coverage it
 * carries forward — the same-wallet/different-recipient bypass, the
 * different-wallet/same-recipient block, the pre-submit race re-check and
 * the auto-unblock poll are all still here, now asked once per side
 * rather than once per route-specific endpoint.
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

const SOL_WALLET_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL_WALLET_B = "6dNVEw6yzmCPBUyrCrhPbHSQEHkRxUSVBCKzSFEKQfoT";
const SOL_RECIPIENT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
/** The connected EVM wallet, as a browser reports it: EIP-55 mixed case. */
const EVM_WALLET_A = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
const EVM_WALLET_B = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const GLC_ADDRESS_A = encodeBase58Check(111, new Uint8Array(20));
const GLC_ADDRESS_B = encodeBase58Check(111, new Uint8Array(20).fill(7));
const RETRY_AT = 1_800_000_000;

const solana = vi.hoisted(() => ({
  status: "connected" as WalletStatus,
  address: null as string | null,
}));
const solanaDeposit = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: solana.status,
    address: solana.address,
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
  // The PINNED V2 contract on the pinned chain. Anything else is refused
  // before a gate is reached, which is what the pin is for.
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: "0xaf0172DDEa4ce60dB3EBab05748A00B14fC8e433",
};

const evm = vi.hoisted(() => ({
  address: null as string | null,
  chainId: 4663 as number | null,
}));
const evmDeposit = vi.fn();

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => DEPLOYMENT,
    robinhoodDeploymentProblem: () => null,
    useEvmWallet: () => ({
      // The NETWORK identity, which the real hook always resolves: it is
      // what the wallet control reads, and it never depends on contract
      // configuration or on a route being open.
      network: {
        chainId: DEPLOYMENT.chainId,
        chainName: DEPLOYMENT.chainName,
        rpcUrl: DEPLOYMENT.rpcUrl,
      },
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
    useRobinhoodDeposit: () => ({ deposit: evmDeposit }),
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: { raw: "10000000000000000000000", decimals: 18, symbol: "GLC" },
    }),
  };
});

/* -------------------------------------------------------------------- */
/* Backend responses                                                     */
/* -------------------------------------------------------------------- */

/** A `RecipientEligibility` response with both sides clear. */
function clear(direction: "SolToGlc" | "RhnToGlc", address: string, wallet: string) {
  return {
    direction,
    address,
    // Lowercase for the EVM leg, exactly as the backend echoes it.
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

/** The SOURCE wallet inside its window; the destination is clear. */
function sourceBlocked(
  direction: "SolToGlc" | "RhnToGlc",
  address: string,
  wallet: string,
) {
  return {
    ...clear(direction, address, wallet),
    eligible: false,
    blocked_reason: "source_wallet_rate_limited" as const,
    blocked_reasons: ["source_wallet_rate_limited"],
    retry_after: RETRY_AT,
    retry_after_seconds: 40_000,
    source_wallet_retry_after: RETRY_AT,
  };
}

/** The DESTINATION inside its window; the source wallet is clear. */
function destinationBlocked(
  direction: "SolToGlc" | "RhnToGlc",
  address: string,
  wallet: string,
) {
  return {
    ...clear(direction, address, wallet),
    eligible: false,
    blocked_reason: "recipient_rate_limited" as const,
    blocked_reasons: ["recipient_rate_limited"],
    retry_after: RETRY_AT,
    retry_after_seconds: 40_000,
    recipient_retry_after: RETRY_AT,
  };
}

function bothBlocked(
  direction: "SolToGlc" | "RhnToGlc",
  address: string,
  wallet: string,
) {
  return {
    ...sourceBlocked(direction, address, wallet),
    blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
    recipient_retry_after: RETRY_AT + 3_600,
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

/** Every route open and positively available, so only eligibility gates. */
function allRoutesOpen() {
  const base = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route) => ({
      ...route,
      enabled: true,
      disabled_reason: null,
      implemented: true,
      available: true,
      unavailable_reason: null,
    })),
  };
}

/* -------------------------------------------------------------------- */
/* Form drivers                                                          */
/* -------------------------------------------------------------------- */

/** Picks a pair, enters an amount, and enters a destination. */
async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  source: RegExp,
  destination: RegExp,
  destinationLabel: string | RegExp,
  destinationValue: string,
) {
  await selectNetwork(user, "Source network", source);
  await selectNetwork(user, "Destination network", destination);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText(destinationLabel), destinationValue);
}

const fillSolToGlc = (user: ReturnType<typeof userEvent.setup>, address: string) =>
  fillForm(user, /Solana/, /Goldcoin/, "Goldcoin destination address", address);

const fillRhnToGlc = (user: ReturnType<typeof userEvent.setup>, address: string) =>
  fillForm(user, /Robinhood/, /Goldcoin/, "Goldcoin destination address", address);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  envState.glcAddressVersions = [111];
  solana.status = "connected";
  solana.address = SOL_WALLET_A;
  evm.address = EVM_WALLET_A;
  evm.chainId = 4663;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(allRoutesOpen());
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
});

/* ==================================================================== */

describe("BridgeCard eligibility — SolToGlc (backend endpoint landed)", () => {
  it("enables submission when BOTH sides are positively clear", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
    // Both rows read Eligible, and nothing claims a limit.
    expect(screen.getByText("Source wallet")).toBeInTheDocument();
    expect(screen.getByText("Destination wallet")).toBeInTheDocument();
    expect(screen.getAllByText("Eligible").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(ELIGIBILITY_BLOCKED_TITLE.source)).not.toBeInTheDocument();
    // Asked with BOTH sides: destination as `?address=`, source as `?wallet=`.
    expect(getSolToGlcRecipientEligibility).toHaveBeenCalledWith(
      GLC_ADDRESS_A,
      SOL_WALLET_A,
    );
  });

  it("disables submission when the SOURCE wallet is inside its window", async () => {
    // The destination is fresh and would read eligible on its own. This
    // is the bypass the source-side window closes: one wallet, many
    // different destinations.
    getSolToGlcRecipientEligibility.mockResolvedValue(
      sourceBlocked("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    // The other side's message must NOT appear: only one window blocks,
    // and naming both would send the user to fix the wrong thing.
    expect(
      screen.queryByText(ELIGIBILITY_BLOCKED_TITLE.destination),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Used in last 24h")).toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());

    // A click on the disabled button is inert: the wallet never opens.
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("disables submission when the DESTINATION is inside its window", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      destinationBlocked("SolToGlc", GLC_ADDRESS_B, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_B);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.destination)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(ELIGIBILITY_BLOCKED_TITLE.source)).not.toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });

  it("names BOTH sides, with both waits, when both windows block", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      bothBlocked("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_BOTH_TITLE)).length,
    ).toBeGreaterThan(0);
    // Each side times independently: the two windows can reopen at
    // different moments and a user waiting out both needs both.
    expect(screen.getByText(/Source wallet is eligible again in/)).toBeInTheDocument();
    expect(
      screen.getByText(/Destination wallet is eligible again in/),
    ).toBeInTheDocument();
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("disables submission when the eligibility API is unavailable", async () => {
    // No local policy fills the gap, and no cached clearance carries it:
    // an unreadable verdict is a refusal.
    getSolToGlcRecipientEligibility.mockRejectedValue(new Error("503"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    // Both rows report it: neither side has an establishable verdict.
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });

  it("re-enables submission as soon as the backend says the window expired", async () => {
    // The re-enable is the BACKEND's answer changing on the next poll —
    // there is no local timer counting down to it, and no localStorage
    // record to expire.
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(sourceBlocked("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A))
      .mockResolvedValue(clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());

    await vi.advanceTimersByTimeAsync(30_000);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
    expect(screen.queryByText(ELIGIBILITY_BLOCKED_TITLE.source)).not.toBeInTheDocument();
  });

  it("re-checks fresh before signing, and refuses a verdict that flipped", async () => {
    // Form-time: clear, so the button enables. Every later read: the
    // wallet deposited from another tab in between.
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A))
      .mockResolvedValue(sourceBlocked("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    // Decisive: the wallet was never opened and no obligation was created.
    await waitFor(() =>
      expect(getSolToGlcRecipientEligibility.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(solanaDeposit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
  });

  it("refuses when the pre-submit read itself fails", async () => {
    getSolToGlcRecipientEligibility
      .mockResolvedValueOnce(clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A))
      .mockRejectedValue(new Error("gateway timeout"));

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    await user.click(primaryCta());

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    expect(solanaDeposit).not.toHaveBeenCalled();
  });

  it("refuses an answer that left the source side unevaluated", async () => {
    // The backend answered without the wallet leg. Half an answer is not
    // an answer to a two-sided policy, however eligible it claims to be.
    getSolToGlcRecipientEligibility.mockResolvedValue({
      ...clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
      wallet: null,
    });

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });
});

describe("BridgeCard eligibility — RhnToGlc, keyed by the EVM wallet", () => {
  it("enables submission when both sides clear, accepting the lowercase echo", async () => {
    // The wallet reports EIP-55 mixed case; the backend answers in
    // lowercase. Same 20 bytes, and the match must not be case-sensitive.
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      clear("RhnToGlc", GLC_ADDRESS_A, EVM_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user, GLC_ADDRESS_A);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
    expect(getRhnToGlcRecipientEligibility).toHaveBeenCalledWith(
      GLC_ADDRESS_A,
      EVM_WALLET_A,
    );
  });

  it("never opens the wallet for a blocked EVM source", async () => {
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      sourceBlocked("RhnToGlc", GLC_ADDRESS_A, EVM_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user, GLC_ADDRESS_A);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(evmDeposit).not.toHaveBeenCalled();
  });

  it("does not charge a Solana wallet's window against an EVM one", async () => {
    // Separate windows on separate chains, never pooled. The Solana
    // endpoint is not even consulted for this route.
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      clear("RhnToGlc", GLC_ADDRESS_A, EVM_WALLET_A),
    );
    getSolToGlcRecipientEligibility.mockResolvedValue(
      sourceBlocked("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user, GLC_ADDRESS_A);

    await waitFor(() => expect(primaryCta()).toBeEnabled());
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
  });
});

describe("BridgeCard eligibility — the four routes awaiting the backend", () => {
  /**
   * `GlcToSol`, `GlcToRhn`, `SolToRhn` and `RhnToSol`.
   *
   * Each is fully open on `/chains` here, the amount and destination are
   * valid, and the wallet is connected — so eligibility is the only thing
   * left, and it cannot be established because the backend publishes no
   * endpoint for these routes. Submission is refused.
   *
   * When the route-agnostic endpoint lands, these four expectations
   * invert. That is the intended shape of the change: one table entry per
   * route in `@/lib/bridge/eligibility`, and these tests updated to
   * assert the cleared path.
   */
  const cases = [
    {
      route: "GlcToSol",
      source: /Goldcoin/,
      destination: /Solana/,
      label: "Solana recipient address",
      value: SOL_RECIPIENT,
    },
    {
      route: "GlcToRhn",
      source: /Goldcoin/,
      destination: /Robinhood/,
      label: /Robinhood/i,
      value: EVM_WALLET_B,
    },
    {
      route: "SolToRhn",
      source: /Solana/,
      destination: /Robinhood/,
      label: /Robinhood/i,
      value: EVM_WALLET_B,
    },
    {
      route: "RhnToSol",
      source: /Robinhood/,
      destination: /Solana/,
      label: "Solana recipient address",
      value: SOL_RECIPIENT,
    },
  ] as const;

  for (const testCase of cases) {
    it(`refuses ${testCase.route}: no authoritative verdict exists yet`, async () => {
      const user = userEvent.setup({ delay: null });
      renderWithQueryClient(<BridgeCard />);
      await fillForm(
        user,
        testCase.source,
        testCase.destination,
        testCase.label,
        testCase.value,
      );

      expect(
        (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
      ).toBeGreaterThan(0);
      await waitFor(() => expect(primaryCta()).toBeDisabled());
      await user.click(primaryCta());
      // Nothing was signed, created or sent on any of the three funding
      // paths.
      expect(solanaDeposit).not.toHaveBeenCalled();
      expect(evmDeposit).not.toHaveBeenCalled();
      expect(createTransfer).not.toHaveBeenCalled();
    });
  }

  it("never asks a Goldcoin-payout endpoint about a route that pays out elsewhere", async () => {
    // Substituting one of the two landed endpoints would be asking about
    // a window that does not govern these routes.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillForm(user, /Solana/, /Robinhood/, /Robinhood/i, EVM_WALLET_B);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
  });
});

describe("BridgeCard eligibility — refresh triggers", () => {
  it("re-asks when the DESTINATION address changes", async () => {
    // A verdict is a statement about exactly one pair; a clearance earned
    // by one address must not carry to another.
    getSolToGlcRecipientEligibility.mockImplementation(async (address: string) =>
      address === GLC_ADDRESS_A
        ? clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A)
        : destinationBlocked("SolToGlc", GLC_ADDRESS_B, SOL_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    const field = screen.getByLabelText("Goldcoin destination address");
    await user.clear(field);
    await user.type(field, GLC_ADDRESS_B);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.destination)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("re-asks when the connected SOURCE WALLET changes", async () => {
    // Wallet A is clear; wallet B is inside its window.
    getSolToGlcRecipientEligibility.mockImplementation(
      async (address: string, wallet: string | null) =>
        wallet === SOL_WALLET_A
          ? clear("SolToGlc", address, SOL_WALLET_A)
          : sourceBlocked("SolToGlc", address, SOL_WALLET_B),
    );

    const user = userEvent.setup({ delay: null });
    const { rerender } = renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    // The same event as an account switch inside one wallet, from this
    // query's point of view: the connected address changed.
    solana.address = SOL_WALLET_B;
    rerender(<BridgeCard />);

    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("re-asks when the ROUTE changes", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      sourceBlocked("RhnToGlc", GLC_ADDRESS_A, EVM_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    // A different route is a different question, asked of a different
    // endpoint. The form clears the destination on a pair change — an
    // address is only meaningful on one network — so it is re-entered
    // here, which is exactly what a user would do.
    await selectNetwork(user, "Source network", /Robinhood/);
    await selectNetwork(user, "Destination network", /Goldcoin/);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    // The pair change clears the amount as well as the address: both are
    // only meaningful for the route they were entered on.
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(screen.getByLabelText("Goldcoin destination address"), GLC_ADDRESS_A);

    await waitFor(() => expect(getRhnToGlcRecipientEligibility).toHaveBeenCalled());
    // The clearance SolToGlc earned does not carry across: this route's
    // own verdict is a refusal.
    expect(
      (await screen.findAllByText(ELIGIBILITY_BLOCKED_TITLE.source)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
  });

  it("re-asks when the NETWORK changes under the same address", async () => {
    // The connected address is an identity on a chain. A verdict obtained
    // before a network switch must not be reused after it.
    getRhnToGlcRecipientEligibility.mockResolvedValue(
      clear("RhnToGlc", GLC_ADDRESS_A, EVM_WALLET_A),
    );

    const user = userEvent.setup({ delay: null });
    const { rerender } = renderWithQueryClient(<BridgeCard />);
    await fillRhnToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());
    const before = getRhnToGlcRecipientEligibility.mock.calls.length;

    evm.chainId = 1;
    rerender(<BridgeCard />);

    // Wrong chain also refuses on its own — the point here is that the
    // verdict was not carried across the switch.
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    evm.chainId = 4663;
    rerender(<BridgeCard />);
    await waitFor(() =>
      expect(getRhnToGlcRecipientEligibility.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("re-asks after a successful submission consumes the window", async () => {
    getSolToGlcRecipientEligibility.mockResolvedValue(
      clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A),
    );
    solanaDeposit.mockResolvedValue({ signature: "sig" });

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);
    await waitFor(() => expect(primaryCta()).toBeEnabled());

    const before = getSolToGlcRecipientEligibility.mock.calls.length;
    await user.click(primaryCta());
    await waitFor(() => expect(solanaDeposit).toHaveBeenCalled());

    // A submission consumes this route's window for both wallets, so the
    // held verdict is stale the moment it succeeds.
    await waitFor(() =>
      expect(getSolToGlcRecipientEligibility.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("holds submission while the first answer is still in flight", async () => {
    // "Checking" is a refusal too: a question that has not been answered
    // is not permission.
    let release: (value: unknown) => void = () => {};
    getSolToGlcRecipientEligibility.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );

    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await fillSolToGlc(user, GLC_ADDRESS_A);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    expect(screen.getAllByText("Checking…").length).toBeGreaterThan(0);

    release(clear("SolToGlc", GLC_ADDRESS_A, SOL_WALLET_A));
    await waitFor(() => expect(primaryCta()).toBeEnabled());
  });
});
