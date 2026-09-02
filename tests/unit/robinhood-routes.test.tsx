import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import {
  directionGateState,
  routeAvailable,
  routeDirection,
  settlementLegFor,
  routeOrder,
  routes,
  closedRouteTitle,
  ROUTE_CLOSED_TITLE,
  ROUTE_COMING_SOON_TITLE,
  rollingVolumeRemaining,
  destinationPaused,
  quotaExhausted,
} from "@/lib/bridge";
import { chainsViewSchema, routeViewSchema } from "@/lib/api/schemas/chains";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import type { Route } from "@/lib/api/schemas/common";
import type * as SolanaLib from "@/lib/solana";

/**
 * Phase-1 Robinhood UI behaviour.
 *
 * The three claims under test, in order of importance:
 *
 * 1. A disabled route cannot be submitted — there is no submit control at
 *    all, and no network request is made for it.
 * 2. Nothing about a disabled route is fabricated: no quote, no balance, no
 *    fee, no capacity figure, no transaction status.
 * 3. Availability comes from the server. The UI has no local switch that
 *    could disagree with the backend, which is what makes enabling the
 *    route later a backend-only change.
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
    getChains: (...args: unknown[]) => getChains(...args),
    getStatus: (...args: unknown[]) => getStatus(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    getSolToGlcRecipientEligibility: (...args: unknown[]) =>
      getSolToGlcRecipientEligibility(...args),
  },
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const depositCapability = vi.fn(() => ({
  available: false,
  reason: "wallet-disconnected" as const,
  message: "Connect a Solana wallet to deposit.",
}));
/** Module-level so a test can assert the Solana wallet leg never fires. */
const depositFn = vi.fn();

vi.mock("@/lib/solana", async () => {
  const actual = await vi.importActual<typeof SolanaLib>("@/lib/solana");
  return {
    ...actual,
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
      capability: depositCapability,
      deposit: depositFn,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  getChains.mockResolvedValue(fixtures.chainsFixture());
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
});

// ------------------------------------------------------------ pure logic --

describe("route model", () => {
  it("exposes all four routes with Robinhood named for the user", () => {
    expect(routeOrder).toEqual(["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"]);
    expect(routes.GlcToRhn.to.chain.name).toBe("Robinhood Network");
    expect(routes.RhnToGlc.from.chain.name).toBe("Robinhood Network");
  });

  it("gives Robinhood routes no settlement direction and no reserve", () => {
    // Mirrors the backend's partial `Route -> Direction` conversion. A
    // route with no direction can never produce a transfer.
    expect(routeDirection("GlcToRhn")).toBeNull();
    expect(routeDirection("RhnToGlc")).toBeNull();
    expect(routes.GlcToRhn.destinationReserve).toBeNull();
    expect(routes.RhnToGlc.destinationReserve).toBeNull();

    expect(routeDirection("GlcToSol")).toBe("GlcToSol");
    expect(routeDirection("SolToGlc")).toBe("SolToGlc");
  });

  it("does not invent decimals for the Robinhood token", () => {
    // A placeholder here would flow straight into amount rendering.
    expect(routes.GlcToRhn.to.token.decimals).toBeNull();
    expect(routes.GlcToSol.to.token.decimals).toBe(6);
    expect(routes.GlcToSol.from.token.decimals).toBe(8);
  });

  it("REG-2b: a KNOWN route sent unparseably is treated as CLOSED, not as absent", () => {
    // The residual gap in the first fix: a dropped malformed entry was
    // indistinguishable from an absent one, so a garbled
    // {"id":"GlcToSol","enabled":false} fell back to the live route's
    // default of OPEN — silently reversing an operator's close.
    const unreadable = chainsWith([], ["GlcToSol"]);
    expect(routeAvailable(unreadable, "GlcToSol")).toBe(false);
    // …while a route the server said nothing about still gets its default.
    expect(routeAvailable(unreadable, "SolToGlc")).toBe(true);
    expect(routeAvailable(unreadable, "GlcToRhn")).toBe(false);
  });

  it("REG-2b: the schema records unreadable KNOWN ids and drops unknown ones", () => {
    const base = fixtures.chainsFixture();
    const parsed = chainsViewSchema.parse({
      ...base,
      routes: [
        ...base.routes.map((r) => (r.id === "GlcToSol" ? { ...r, enabled: "yes" } : r)),
        { id: "GlcToXyz", enabled: "also-bad" },
      ],
    });
    // Known-but-unreadable -> recorded, so it resolves to closed.
    expect(parsed.unreadableRouteIds).toContain("GlcToSol");
    expect(parsed.routes.some((r) => r.id === "GlcToSol")).toBe(false);
    expect(routeAvailable(parsed, "GlcToSol")).toBe(false);
    // Unknown id -> dropped entirely, and never recorded as a known route.
    expect(parsed.unreadableRouteIds).not.toContain("GlcToXyz" as never);
    // Everything else is untouched.
    expect(routeAvailable(parsed, "SolToGlc")).toBe(true);
    expect(routeAvailable(parsed, "GlcToRhn")).toBe(false);
  });

  it("REG-1: distinguishes an explicit server verdict from an unanswerable one", () => {
    // An EXPLICIT verdict is always obeyed, in both directions.
    expect(routeAvailable(chainsWith([openView("GlcToSol")]), "GlcToSol")).toBe(true);
    expect(
      routeAvailable(
        chainsWith([{ ...openView("GlcToSol"), enabled: false }]),
        "GlcToSol",
      ),
    ).toBe(false);
    expect(
      routeAvailable(
        chainsWith([{ ...closedView("GlcToRhn"), enabled: true }]),
        "GlcToRhn",
      ),
    ).toBe(true);
    expect(routeAvailable(chainsWith([closedView("GlcToRhn")]), "GlcToRhn")).toBe(false);

    // NO entry means the server did not say — fall back to the route's own
    // structural default, mirroring the backend's Ledger::route_enabled.
    // Live routes stay usable so a /chains outage cannot take the working
    // bridge down; unbuilt routes stay closed.
    expect(routeAvailable(undefined, "GlcToSol")).toBe(true);
    expect(routeAvailable(undefined, "SolToGlc")).toBe(true);
    expect(routeAvailable(undefined, "GlcToRhn")).toBe(false);
    expect(routeAvailable(undefined, "RhnToGlc")).toBe(false);
  });

  it("REG-3: derives closed-route copy from the route, never hardcoded Robinhood", () => {
    // A LIVE route the server has closed must not be explained with
    // Robinhood wording.
    expect(closedRouteTitle("GlcToSol")).toBe(ROUTE_CLOSED_TITLE);
    expect(closedRouteTitle("SolToGlc")).toBe(ROUTE_CLOSED_TITLE);
    expect(closedRouteTitle("GlcToRhn")).toBe(ROUTE_COMING_SOON_TITLE);
    expect(closedRouteTitle("RhnToGlc")).toBe(ROUTE_COMING_SOON_TITLE);
    expect(ROUTE_CLOSED_TITLE).not.toMatch(/robinhood/i);
  });

  it("reports no fabricated reserve status for a Robinhood route", () => {
    // The pre-refactor ternaries would have returned Goldcoin's pause flag
    // and Goldcoin's quota headroom for any non-GlcToSol route, presenting
    // one chain's state as another's.
    const s = status({ goldcoin_paused: true, sol_to_glc_quota_exhausted: true });
    for (const route of ["GlcToRhn", "RhnToGlc"] as Route[]) {
      expect(destinationPaused(s, route)).toBeNull();
      expect(quotaExhausted(s, route)).toBeNull();
      expect(rollingVolumeRemaining(s, route)).toBeNull();
    }
    // …while the live routes are unaffected.
    expect(destinationPaused(s, "SolToGlc")).toBe(true);
    expect(quotaExhausted(s, "SolToGlc")).toBe(true);
    expect(rollingVolumeRemaining(s, "SolToGlc")).toBe(100_000_000000);
  });

  it("resolves a Robinhood route to route-disabled regardless of reserve state", () => {
    const healthy = status();
    expect(
      directionGateState(healthy, "GlcToRhn", chainsWith([closedView("GlcToRhn")])),
    ).toBe("route-disabled");
    // …and with no entry at all, via the structural default.
    expect(directionGateState(healthy, "GlcToRhn", undefined)).toBe("route-disabled");
    // Even if a malformed server response claimed it was enabled, there is
    // no reserve behind it, so it still cannot read as active.
    expect(
      directionGateState(
        healthy,
        "GlcToRhn",
        chainsWith([{ ...closedView("GlcToRhn"), enabled: true }]),
      ),
    ).toBe("route-disabled");
  });

  it("leaves the live routes' derivation exactly as it was", () => {
    const healthy = status();
    expect(
      directionGateState(healthy, "GlcToSol", chainsWith([openView("GlcToSol")])),
    ).toBe("active");
    expect(
      directionGateState(healthy, "SolToGlc", chainsWith([openView("SolToGlc")])),
    ).toBe("active");
  });

  it("REG-1: a live route with no server entry still reports its real reserve state", () => {
    // The StatusView regression: with /chains unavailable the live
    // directions must report what the RESERVE says, not a fabricated
    // "paused".
    expect(directionGateState(status(), "GlcToSol", undefined)).toBe("active");
    expect(
      directionGateState(
        status({ solana_paused: true, glc_to_sol_available: false }),
        "GlcToSol",
        undefined,
      ),
    ).toBe("operator-paused");
  });
});

// -------------------------------------------------------------- fixtures --

describe("REG-2: /chains schema is forward-compatible", () => {
  // The component tests above mock `getChains` at the client boundary, so
  // they never exercise the schema. These parse real payloads through it.

  function payload(extra: { chains?: unknown[]; routes?: unknown[] } = {}) {
    const base = fixtures.chainsFixture();
    return {
      chains: [...base.chains, ...(extra.chains ?? [])],
      routes: [...base.routes, ...(extra.routes ?? [])],
      as_of: base.as_of,
    };
  }

  it("keeps every known route when the response carries an UNKNOWN route id", () => {
    const parsed = chainsViewSchema.parse(
      payload({
        routes: [
          {
            id: "GlcToXyz",
            source_chain: "goldcoin",
            destination_chain: "xyz",
            enabled: true,
            disabled_reason: null,
            implemented: true,
          },
        ],
      }),
    );
    // The whole response is NOT rejected…
    expect(parsed.routes.map((r) => r.id).sort()).toEqual([
      "GlcToRhn",
      "GlcToSol",
      "RhnToGlc",
      "SolToGlc",
    ]);
    // …and the unknown entry is dropped rather than admitted.
    expect(parsed.routes.some((r) => (r.id as string) === "GlcToXyz")).toBe(false);
  });

  it("keeps every known chain when the response carries an UNKNOWN chain id", () => {
    const parsed = chainsViewSchema.parse(
      payload({ chains: [{ id: "xyz", display_name: "Some Future Chain" }] }),
    );
    expect(parsed.chains.map((c) => c.id).sort()).toEqual([
      "goldcoin",
      "robinhood",
      "solana",
    ]);
  });

  it("drops a MALFORMED entry for a known route without failing the response", () => {
    const base = fixtures.chainsFixture();
    const parsed = chainsViewSchema.parse({
      ...base,
      routes: base.routes.map((r) =>
        r.id === "GlcToSol" ? { ...r, enabled: "yes" } : r,
      ),
    });
    // GlcToSol is dropped -> no entry -> `routeAvailable` falls back to its
    // structural default, which keeps the live route up.
    expect(parsed.routes.some((r) => r.id === "GlcToSol")).toBe(false);
    // Resolved from the PARSED response, not a bare `undefined` — the
    // malformed entry is recorded as unreadable, so it reads as closed.
    expect(routeAvailable(parsed, "GlcToSol")).toBe(false);
    // The other known routes survive untouched.
    expect(parsed.routes.some((r) => r.id === "SolToGlc")).toBe(true);
    expect(routeAvailable(parsed, "SolToGlc")).toBe(true);
  });

  it("would previously have thrown: a strict enum rejects the whole payload", () => {
    // Pins WHY the tolerant parse exists: the per-entry schema still
    // refuses an unknown id, so strictness at the array level would have
    // failed the entire response.
    expect(
      routeViewSchema.safeParse({
        id: "GlcToXyz",
        source_chain: "goldcoin",
        destination_chain: "xyz",
        enabled: true,
        disabled_reason: null,
        implemented: true,
      }).success,
    ).toBe(false);
  });
});

describe("the chains fixture", () => {
  it("parses against the real schema and reports Robinhood closed", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture());
    expect(parsed.chains.map((c) => c.id)).toContain("robinhood");
    for (const id of ["GlcToRhn", "RhnToGlc"] as Route[]) {
      const view = parsed.routes.find((r) => r.id === id)!;
      expect(view.enabled).toBe(false);
      expect(view.implemented).toBe(false);
      expect(view.disabled_reason).toBeTruthy();
    }
    for (const id of ["GlcToSol", "SolToGlc"] as Route[]) {
      const view = parsed.routes.find((r) => r.id === id)!;
      expect(view.enabled).toBe(true);
      expect(view.implemented).toBe(true);
    }
  });
});

// ------------------------------------------------------------- component --

describe("BridgeCard — Robinhood routes", () => {
  it("shows both Robinhood routes, visibly disabled and marked coming soon", async () => {
    renderWithQueryClient(<BridgeCard />);

    const glcToRhn = await screen.findByRole("radio", {
      name: routes.GlcToRhn.label,
    });
    const rhnToGlc = screen.getByRole("radio", { name: routes.RhnToGlc.label });

    // Visible — deliberately not hidden, since users have been told the
    // network is coming and a missing option reads as a broken page.
    expect(glcToRhn).toBeVisible();
    expect(rhnToGlc).toBeVisible();
    // And genuinely inert, not merely styled as such.
    await waitFor(() => expect(glcToRhn).toBeDisabled());
    expect(rhnToGlc).toBeDisabled();
    expect(glcToRhn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0);
  });

  it("leaves the live routes selectable and unaffected", async () => {
    renderWithQueryClient(<BridgeCard />);
    const glcToSol = await screen.findByRole("radio", { name: routes.GlcToSol.label });
    const solToGlc = screen.getByRole("radio", { name: routes.SolToGlc.label });
    await waitFor(() => expect(glcToSol).toBeEnabled());
    expect(solToGlc).toBeEnabled();
    // The form for the live route is present as before.
    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
  });

  it("cannot be selected by clicking, so the form never switches to it", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeCard />);
    const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
    await waitFor(() => expect(glcToRhn).toBeDisabled());

    await user.click(glcToRhn);

    // Still on the live route: the amount field is the GlcToSol one and the
    // closed-route panel was never rendered.
    expect(screen.getByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    // The badge is present on the disabled options; the closed-route PANEL
    // is not, because the selection never changed.
    expect(screen.queryByText(ROUTE_CLOSED_TITLE)).toBeNull();
    expect(screen.queryByText(ROUTE_COMING_SOON_TITLE)).toBeNull();
    expect(screen.getByRole("radio", { name: routes.GlcToSol.label })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("renders no form, no quote and NO submit control when a closed route is selected", async () => {
    // Force the closed route to be the selected one by reporting every
    // route closed — the strongest version of the check, and the state a
    // deep link or a future default could land a user in.
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      routes: fixtures
        .chainsFixture()
        .routes.map((r) => ({ ...r, enabled: false, implemented: false })),
    });

    renderWithQueryClient(<BridgeCard />);

    await screen.findByText(ROUTE_CLOSED_TITLE);

    // No form controls at all.
    expect(screen.queryByLabelText(/Amount in GLC/i)).toBeNull();
    expect(screen.queryByLabelText(/destination address/i)).toBeNull();
    // No submit control — absent from the tree, not present-and-disabled,
    // so there is no element to re-enable from devtools.
    expect(
      screen.queryByRole("button", { name: /bridge|continue|submit|deposit/i }),
    ).toBeNull();
    // Nothing fabricated: no quote, no capacity figure, no fee.
    expect(screen.queryByText(/available capacity/i)).toBeNull();
    expect(screen.queryByText(/bridge fee/i)).toBeNull();
    expect(screen.queryByText(/you receive/i)).toBeNull();
  });

  it("never requests a quote for a closed route", async () => {
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      routes: fixtures
        .chainsFixture()
        .routes.map((r) => ({ ...r, enabled: false, implemented: false })),
    });

    renderWithQueryClient(<BridgeCard />);
    await screen.findByText(ROUTE_CLOSED_TITLE);

    // The quote endpoint is the one that would fabricate fee/net figures.
    expect(getQuote).not.toHaveBeenCalled();
    // And nothing was ever created.
    expect(createTransfer).not.toHaveBeenCalled();
    // No Robinhood eligibility/RPC probing either.
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("takes its verdict from the server, with no local override", async () => {
    // The same build renders the route as OPEN when the server says so.
    // This is the proof that enabling Robinhood later needs no UI change:
    // nothing in the frontend hardcodes the closed state.
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

    renderWithQueryClient(<BridgeCard />);
    const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
    await waitFor(() => expect(glcToRhn).toBeEnabled());
  });

  // ---------------------------------------------------------- REG-1 --
  //
  // These replace an earlier test that asserted the opposite and was wrong:
  // it mocked `routes: []`, ran on the default LIVE GlcToSol route, and
  // asserted the amount field disappeared — codifying "a /chains outage
  // takes the working bridge down" as intended behaviour. An outage must
  // leave the live routes exactly as they were.

  it("REG-1: an EMPTY routes array leaves the live route fully usable", async () => {
    getChains.mockResolvedValue({ ...fixtures.chainsFixture(), routes: [] });

    renderWithQueryClient(<BridgeCard />);

    // The live GlcToSol form is still there — no closed-route panel.
    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    expect(screen.queryByText(ROUTE_COMING_SOON_TITLE)).toBeNull();
    expect(screen.queryByText(ROUTE_CLOSED_TITLE)).toBeNull();
    // And it is genuinely submittable-looking: a real submit control exists.
    expect(
      screen.getByRole("button", { name: /create deposit request/i }),
    ).toBeInTheDocument();
  });

  it("REG-1: a /chains ERROR leaves the live route usable and never blames Robinhood", async () => {
    // A 404 from a backend deployed after the UI, a 5xx, or a timeout.
    getChains.mockRejectedValue(new Error("network down"));

    renderWithQueryClient(<BridgeCard />);

    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    expect(screen.queryByText(ROUTE_COMING_SOON_TITLE)).toBeNull();
    // The live route must never be explained with Robinhood copy.
    expect(screen.queryByText(/robinhood network — coming soon/i)).toBeNull();
  });

  it("REG-1: a /chains error still leaves Robinhood closed and unselectable", async () => {
    getChains.mockRejectedValue(new Error("network down"));

    renderWithQueryClient(<BridgeCard />);

    const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
    await waitFor(() => expect(glcToRhn).toBeDisabled());
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("REG-1: an EXPLICIT enabled:false still closes a live route (fail closed)", async () => {
    // The property that actually matters is preserved: an affirmative
    // server "closed" is obeyed even for a live route.
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      routes: fixtures
        .chainsFixture()
        .routes.map((r) => (r.id === "GlcToSol" ? { ...r, enabled: false } : r)),
    });

    renderWithQueryClient(<BridgeCard />);

    await screen.findByText(ROUTE_CLOSED_TITLE);
    expect(screen.queryByLabelText(/Amount in GLC/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /create deposit request/i })).toBeNull();
    expect(getQuote).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------- REG-2 --

  it("REG-2: an unknown FUTURE route id is dropped without disabling known routes", async () => {
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      routes: [
        ...fixtures.chainsFixture().routes,
        {
          id: "GlcToXyz",
          source_chain: "goldcoin",
          destination_chain: "xyz",
          enabled: true,
          disabled_reason: null,
          implemented: true,
        },
      ],
    });

    renderWithQueryClient(<BridgeCard />);

    // The whole response is NOT rejected: the live route still works…
    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
    // …and the unknown route simply does not appear.
    expect(screen.queryByRole("radio", { name: /xyz/i })).toBeNull();
  });

  it("REG-2: an unknown chain id does not reject the response", async () => {
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      chains: [
        ...fixtures.chainsFixture().chains,
        { id: "xyz", display_name: "Some Future Chain" },
      ],
    });

    renderWithQueryClient(<BridgeCard />);
    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
  });

  it("REG-2: a malformed entry for a KNOWN route is dropped, falling back to its default", async () => {
    // Dropped -> no entry -> structural default. The live route stays up
    // rather than the whole payload failing.
    getChains.mockResolvedValue({
      ...fixtures.chainsFixture(),
      routes: fixtures
        .chainsFixture()
        .routes.map((r) => (r.id === "GlcToSol" ? { ...r, enabled: "yes" } : r)),
    });

    renderWithQueryClient(<BridgeCard />);
    expect(await screen.findByLabelText(/Amount in GLC/i)).toBeInTheDocument();
  });

  // ----------------------------------------------------------- UI-1 --

  it("UI-1: a Robinhood route never dispatches to the Solana wallet deposit leg", async () => {
    // The dangerous case: the server reports GlcToRhn ENABLED, so the full
    // form renders. The SolToGlc branch it used to fall through to signs a
    // real `deposit_to_reserve` and has NO backend request behind it, so
    // nothing server-side could refuse a mis-dispatch.
    const user = userEvent.setup();
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

    renderWithQueryClient(<BridgeCard />);

    const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
    await waitFor(() => expect(glcToRhn).toBeEnabled());
    await user.click(glcToRhn);

    // Fill the form as far as it will go. GlcToRhn's SOURCE is Goldcoin
    // (decimals 8), so the amount path is NOT blocked by the null-decimals
    // guard — this route really does reach the dispatch.
    const amount = await screen.findByLabelText(/Amount in GLC/i);
    await user.type(amount, "500");
    const recipientField = screen.getByLabelText(/address/i);
    await user.type(recipientField, "mfWxJ45yp2SFn7UciZyNpvDKrzbhyfKrY8");

    // N-3: the submit control must not claim this is a wallet deposit. The
    // old two-way ternary labelled every unbuilt route "Deposit from
    // wallet" — the exact wrong mental model for a route that settles
    // nowhere, and the label a user would have trusted before signing.
    expect(screen.queryByRole("button", { name: /deposit from wallet/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create deposit request/i })).toBeNull();
    const submitButton = screen.getByRole("button", { name: /unavailable/i });
    expect(submitButton).toBeDisabled();
    await user.click(submitButton).catch(() => {});

    // The two things that must never happen for a route with no settlement
    // direction, regardless of which guard stopped it.
    expect(depositFn).not.toHaveBeenCalled();
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it("N-3: an unbuilt route is never described as a Goldcoin/Solana transfer", async () => {
    // The residual two-way ternaries: label, aria-label and placeholder all
    // used to fall through to "Goldcoin destination address" for a route
    // whose destination is neither chain.
    const user = userEvent.setup();
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

    renderWithQueryClient(<BridgeCard />);
    const glcToRhn = await screen.findByRole("radio", { name: routes.GlcToRhn.label });
    await waitFor(() => expect(glcToRhn).toBeEnabled());
    await user.click(glcToRhn);

    expect(screen.queryByLabelText(/goldcoin destination address/i)).toBeNull();
    expect(screen.queryByLabelText(/solana recipient address/i)).toBeNull();
    expect(screen.getByLabelText(/^destination address$/i)).toBeInTheDocument();
  });

  it("UI-1: settlementLegFor never routes an unbuilt route to the wallet leg", () => {
    // THE regression guard. `submit()` dispatches on this function, so the
    // invariant is testable directly rather than only through a component
    // whose incidental guards (a pending quote, absent amount bounds)
    // happen to stop the click today.
    //
    // "wallet-deposit" is the dangerous value: that leg signs a real
    // Solana `deposit_to_reserve` and has NO backend request behind it, so
    // nothing server-side could refuse a mis-dispatch.
    expect(settlementLegFor("GlcToSol")).toBe("backend-create");
    expect(settlementLegFor("SolToGlc")).toBe("wallet-deposit");
    expect(settlementLegFor("GlcToRhn")).toBeNull();
    expect(settlementLegFor("RhnToGlc")).toBeNull();

    // Stated as an invariant over every route, so a route added later is
    // covered without anyone remembering to extend this test: a route may
    // only reach the wallet leg if it genuinely settles as SolToGlc.
    for (const route of routeOrder) {
      if (settlementLegFor(route) === "wallet-deposit") {
        expect(routeDirection(route)).toBe("SolToGlc");
      }
      if (routeDirection(route) === null) {
        expect(settlementLegFor(route)).toBeNull();
      }
    }
  });
});

// --------------------------------------------------------------- helpers --

function status(overrides: Partial<BridgeStatusDto> = {}): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: false,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 1,
    glc_to_sol_available: true,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: 100_000_000000,
    sol_to_glc_rolling_volume_remaining: 100_000_000000,
    ...overrides,
  };
}

function openView(id: Route): RouteViewDto {
  return {
    id,
    source_chain: routes[id].from.chain.id,
    destination_chain: routes[id].to.chain.id,
    enabled: true,
    disabled_reason: null,
    implemented: true,
  };
}

function closedView(id: Route): RouteViewDto {
  return {
    ...openView(id),
    enabled: false,
    implemented: false,
    disabled_reason: "closed",
  };
}

/** Wraps route views in a parsed `/chains` response shape. */
function chainsWith(
  views: RouteViewDto[],
  unreadableRouteIds: Route[] = [],
): ChainsViewDto {
  return { chains: [], routes: views, unreadableRouteIds, as_of: 0 };
}
