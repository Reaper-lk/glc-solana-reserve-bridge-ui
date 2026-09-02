import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQueryClient } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import {
  directionGateState,
  routeDirection,
  routeEnabled,
  routeOrder,
  routes,
  ROUTE_DISABLED_TITLE,
  rollingVolumeRemaining,
  destinationPaused,
  quotaExhausted,
} from "@/lib/bridge";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
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
      deposit: vi.fn(),
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

  it("treats a missing server entry as disabled, never as enabled", () => {
    expect(routeEnabled(undefined)).toBe(false);
    expect(routeEnabled({ ...openView("GlcToSol"), enabled: false })).toBe(false);
    expect(routeEnabled(openView("GlcToSol"))).toBe(true);
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
    expect(directionGateState(healthy, "GlcToRhn", closedView("GlcToRhn"))).toBe(
      "route-disabled",
    );
    // Even if a malformed server response claimed it was enabled, there is
    // no reserve behind it, so it still cannot read as active.
    expect(
      directionGateState(healthy, "GlcToRhn", {
        ...closedView("GlcToRhn"),
        enabled: true,
      }),
    ).toBe("route-disabled");
  });

  it("leaves the live routes' derivation exactly as it was", () => {
    const healthy = status();
    expect(directionGateState(healthy, "GlcToSol", openView("GlcToSol"))).toBe("active");
    expect(directionGateState(healthy, "SolToGlc", openView("SolToGlc"))).toBe("active");
  });
});

// -------------------------------------------------------------- fixtures --

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
    expect(screen.queryByText(ROUTE_DISABLED_TITLE)).toBeNull();
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

    await screen.findByText(ROUTE_DISABLED_TITLE);

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
    await screen.findByText(ROUTE_DISABLED_TITLE);

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

  it("falls back to closed when the server reports no route entry at all", async () => {
    // An older backend without /chains, or a truncated response. The UI
    // must not treat silence as permission.
    getChains.mockResolvedValue({ ...fixtures.chainsFixture(), routes: [] });

    renderWithQueryClient(<BridgeCard />);
    await screen.findByText(ROUTE_DISABLED_TITLE);
    expect(screen.queryByLabelText(/Amount in GLC/i)).toBeNull();
    expect(getQuote).not.toHaveBeenCalled();
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

function openView(id: Route) {
  return {
    id,
    source_chain: routes[id].from.chain.id,
    destination_chain: routes[id].to.chain.id,
    enabled: true,
    disabled_reason: null,
    implemented: true,
  };
}

function closedView(id: Route) {
  return {
    ...openView(id),
    enabled: false,
    implemented: false,
    disabled_reason: "closed",
  };
}
