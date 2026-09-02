import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import { encodeBase58Check, routes } from "@/lib/bridge";
import type * as SolanaLib from "@/lib/solana";
import type * as QueryHooks from "@/lib/query/hooks";
import type * as DirectionState from "@/lib/bridge/direction-state";
import type * as EnvModule from "@/lib/config/env";

/**
 * UI-1 call-site regression: `BridgeCard.submit()` must dispatch on the
 * settlement-leg decision, and must never re-derive it from the raw route
 * with a two-way `direction === "GlcToSol" ? … : …` branch.
 *
 * # Why this needs its own file and these mocks
 *
 * The original defect sent every unbuilt route into the `else` — the
 * SolToGlc branch, which signs a real `deposit_to_reserve` with the user's
 * Solana wallet. That leg never touches the HTTP API, so unlike every other
 * path there is no backend 409 behind it: a fall-through moves funds on a
 * chain the user did not select, with nothing able to refuse it.
 *
 * Every other test of this component stops short of the dispatch, because
 * two guards in the submit gate fire first for a route with no settled
 * direction:
 *
 *   1. `useQuote` is disabled when the direction is `null`, so `quote`
 *      stays `isPending` forever and the gate returns "Fetching quote…".
 *   2. `recipientValidation` has no address format to validate against, so
 *      it reports invalid.
 *
 * Those guards are real and good, but they mean a test that merely fills the
 * form proves only that the guards work — the dispatch itself is never
 * reached, so reverting it stays green. (Measured: reverting `submit()` to
 * the inline branch left all 629 tests passing; only `tsc` noticed, via an
 * unused import.)
 *
 * So this file stubs exactly those two guards, and nothing else:
 *
 *   - `useQuote` is overridden to resolve.
 *   - `routeDirection` is overridden to claim `GlcToRhn` settles as
 *     `SolToGlc`, which satisfies `recipientValidation`.
 *
 * `settlementLegFor` is deliberately left REAL. It reads the static route
 * table rather than `routeDirection`, so it still answers `null` for
 * `GlcToRhn`. That is the whole point: the two disagree, and the test asks
 * which one `submit()` actually trusts.
 *
 * This models the situation the guards exist for — an upstream check
 * relaxed, or a route mis-classified — and asserts the dispatch refuses on
 * its own authority rather than inheriting someone else's verdict. No
 * production code was changed to make it possible.
 */

const getChains = vi.fn();
const getStatus = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  bridgeApi: {
    getChains: (...a: unknown[]) => getChains(...a),
    getStatus: (...a: unknown[]) => getStatus(...a),
    getLimits: (...a: unknown[]) => getLimits(...a),
    getReserve: (...a: unknown[]) => getReserve(...a),
    getQuote: (...a: unknown[]) => getQuote(...a),
    createTransfer: (...a: unknown[]) => createTransfer(...a),
    listTransfers: (...a: unknown[]) => listTransfers(...a),
    getSolToGlcRecipientEligibility: (...a: unknown[]) =>
      getSolToGlcRecipientEligibility(...a),
  },
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Goldcoin address validation is unavailable unless the deployment declares
// its version bytes, and it refuses an address it cannot verify. Same mock
// the existing SolToGlc suites use, for the same reason.
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, env: { ...actual.env, glcAddressVersions: [111] } };
});

/** The Solana wallet send. Must never fire for a route with no direction. */
const depositFn = vi.fn();

vi.mock("@/lib/solana", async () => {
  const actual = await vi.importActual<typeof SolanaLib>("@/lib/solana");
  return {
    ...actual,
    useWalletConnection: () => ({
      status: "connected" as const,
      address: "5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG",
      wallet: { name: "Phantom" },
      wallets: [],
      canSign: true,
      error: null,
      platform: "desktop" as const,
      connect: vi.fn(),
      disconnect: vi.fn(),
      dismissError: vi.fn(),
    }),
    useDepositToReserve: () => ({
      capability: () => ({ available: true as const }),
      deposit: depositFn,
    }),
  };
});

// GUARD STUB 1 — a resolved quote, so the gate does not stop at
// "Fetching quote…" for a route whose real `useQuote` is disabled.
vi.mock("@/lib/query/hooks", async () => {
  const actual = await vi.importActual<typeof QueryHooks>("@/lib/query/hooks");
  return {
    ...actual,
    useQuote: () => ({
      data: {
        direction: "GlcToSol",
        gross_amount: 50_000_000_000,
        gross_display_amount: "500.00000000",
        fee_bps: 300,
        fee_amount: 1_500_000_000,
        fee_display_amount: "15.00000000",
        net_amount: 48_500_000_000,
        net_display_amount: "485.00000000",
        source_decimals: 8,
        destination_decimals: 6,
        source_asset: "GLC (Goldcoin)",
        destination_asset: "GLC (Solana)",
      },
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

// GUARD STUB 2 — claim GlcToRhn settles as SolToGlc, satisfying
// `recipientValidation`. `settlementLegFor` is NOT mocked and still reads
// the real route table, so it disagrees — which is exactly what this test
// exists to exercise.
vi.mock("@/lib/bridge/direction-state", async () => {
  const actual = await vi.importActual<typeof DirectionState>(
    "@/lib/bridge/direction-state",
  );
  return {
    ...actual,
    routeDirection: (route: string) =>
      route === "GlcToRhn" ? "SolToGlc" : actual.routeDirection(route as never),
  };
});

/** A Goldcoin address valid under the version byte mocked above. */
const GOLDCOIN_ADDRESS = encodeBase58Check(111, new Uint8Array(20));

beforeEach(() => {
  vi.clearAllMocks();
  // The server reports GlcToRhn OPEN — the worst case, and the only one in
  // which the form renders for it at all.
  getChains.mockResolvedValue({
    ...fixtures.chainsFixture(),
    routes: fixtures
      .chainsFixture()
      .routes.map((r) =>
        r.id === "GlcToRhn"
          ? { ...r, enabled: true, implemented: true, disabled_reason: null }
          : r,
      ),
  });
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: GOLDCOIN_ADDRESS,
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
});

async function fillFormForRobinhoodRoute() {
  const user = userEvent.setup();
  renderWithQueryClient(<BridgeCard />);

  const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
  await waitFor(() => expect(glcToRhn).toBeEnabled());
  await user.click(glcToRhn);

  // GlcToRhn's SOURCE is Goldcoin (8 decimals), so the amount path is not
  // short-circuited by the null-decimals guard — this route really does
  // reach the submit gate.
  await user.type(await screen.findByLabelText(/Amount in GLC/i), "500");
  await user.type(screen.getByLabelText(/address/i), GOLDCOIN_ADDRESS);
  return user;
}

describe("BridgeCard.submit() dispatch — UI-1 call site", () => {
  it("reaches the submit gate for a Robinhood route (test setup is meaningful)", async () => {
    // Asserted separately and first: if the gate ever stops this route
    // earlier again, the dispatch test below would silently stop testing
    // the dispatch, exactly as it did before this file existed.
    await fillFormForRobinhoodRoute();
    const submitButton = await screen.findByRole("button", {
      name: /create deposit request|deposit from wallet|unavailable/i,
    });
    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("never invokes the Solana wallet deposit for a route with no settlement leg", async () => {
    const user = await fillFormForRobinhoodRoute();

    const submitButton = await screen.findByRole("button", {
      name: /create deposit request|deposit from wallet|unavailable/i,
    });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    // THE assertion. With the correct dispatch, `settlementLegFor("GlcToRhn")`
    // is null and submit() throws before either leg runs. With the old
    // inline `direction === "GlcToSol" ? … : …`, GlcToRhn falls into the
    // else and this fires — signing a real deposit_to_reserve on Solana for
    // a route the user selected as Goldcoin -> Robinhood.
    await waitFor(() => {
      expect(depositFn).not.toHaveBeenCalled();
    });
    // The other leg must not fire either: a route with no settlement leg
    // belongs to neither.
    expect(createTransfer).not.toHaveBeenCalled();

    // The refusal is surfaced rather than swallowed, and the flow never
    // advanced to the post-deposit screen.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/track this transfer/i)).toBeNull();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
  });

  it("still dispatches the live routes to their correct legs", async () => {
    // The other half of the guarantee: making the dispatch strict must not
    // break the two routes that do settle. GlcToSol goes through the
    // backend, never the wallet.
    const user = userEvent.setup();
    createTransfer.mockResolvedValue({ request_id: 7, deposit_address: "GLCdeposit" });
    renderWithQueryClient(<BridgeCard />);

    await user.type(await screen.findByLabelText(/Amount in GLC/i), "500");
    await user.type(
      screen.getByLabelText(/address/i),
      "5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG",
    );
    const submitButton = screen.getByRole("button", { name: /create deposit request/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => expect(createTransfer).toHaveBeenCalledTimes(1));
    expect(depositFn).not.toHaveBeenCalled();
  });
});
