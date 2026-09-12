import { describe, expect, it } from "vitest";
import {
  formatRetryAfter,
  formatRetryAt,
  isRouteEffectivelyAvailable,
  isRouteEnabled,
  isRouteOpen,
  robinhoodPredepositVerdict,
  routeAvailability,
  routeAvailabilitySummary,
  ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
} from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The contract-sourced pre-deposit AVAILABILITY gate, as pure functions.
 *
 * # The defect this exists to prevent
 *
 * `GET /chains`' `enabled` is the route gate's verdict over config,
 * `bridge_routes` and adapter capability. It reads NO reserve state. In
 * production it therefore stayed `true` while `GoldcoinReserve`'s
 * admission was closed, and every newly observed Robinhood deposit folded
 * into `ManualReview` as `admission_closed_at_fold` — users having made
 * irreversible on-chain deposits against a UI that had been told the
 * route was fine. Backend PR #76 split the answer into `enabled` and
 * `available`; these tests hold the frontend to reading the second one,
 * and to refusing when it has not been answered at all.
 *
 * Every case below is stated in terms of what reaches the custody
 * contract, because that is what cannot be undone.
 */

const CHAINS = () => fixtures.chainsFixture(() => new Date());

/** `/chains` with RhnToGlc switched on, and `available` set explicitly. */
function rhnChains(options: {
  enabled: boolean;
  available?: boolean | undefined;
  unavailableReason?: string | null;
}): ChainsViewDto {
  const base = CHAINS();
  return {
    ...base,
    routes: base.routes.map((route) =>
      route.id === "RhnToGlc"
        ? {
            ...route,
            enabled: options.enabled,
            disabled_reason: options.enabled ? null : "Route is switched off.",
            ...("available" in options ? { available: options.available } : {}),
            unavailable_reason: options.unavailableReason ?? null,
          }
        : route,
    ),
  };
}

/**
 * A `/chains` payload from a deployment predating `available` entirely:
 * `RhnToGlc` switched ON, and neither new field present anywhere. This is
 * the shape that used to be the ONLY answer available, and reading it as
 * a yes is precisely the defect.
 */
function preAvailabilityChains(): ChainsViewDto {
  const base = rhnChains({ enabled: true });
  return {
    ...base,
    routes: base.routes.map((route) => {
      const { available: _available, unavailable_reason: _reason, ...rest } = route;
      return rest;
    }),
  };
}

describe("routeViewSchema — the two availability fields", () => {
  it("parses a route that carries `available` and `unavailable_reason`", () => {
    const parsed = chainsViewSchema.parse(
      rhnChains({ enabled: true, available: false, unavailableReason: "Closed." }),
    );
    const view = parsed.routes.find((route) => route.id === "RhnToGlc")!;
    expect(view.available).toBe(false);
    expect(view.unavailable_reason).toBe("Closed.");
  });

  it("still parses a deployment that publishes neither field", () => {
    // Purely additive on the wire: an older backend must not fail Zod and
    // take the whole page down — it must simply read as "did not say".
    const parsed = chainsViewSchema.parse(preAvailabilityChains());
    const view = parsed.routes.find((route) => route.id === "RhnToGlc")!;
    expect(view.available).toBeUndefined();
  });
});

describe("routeAvailability — enabled and available are different questions", () => {
  it("reports `unavailable` for a route that is ENABLED and not available", () => {
    // The production state exactly: the route gate open, the destination
    // reserve refusing. Not `closed` — nobody switched anything off, and
    // nobody has to switch it back on.
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: "No capacity." }),
      "RhnToGlc",
    );
    expect(state.kind).toBe("unavailable");
    expect(state.kind === "unavailable" && state.reason).toBe("No capacity.");
  });

  it("renders the backend's `unavailable_reason` verbatim, never a local rewrite", () => {
    const reason = "Bridge capacity reached for this direction.";
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: reason }),
      "RhnToGlc",
    );
    expect(state.kind === "unavailable" && state.reason).toBe(reason);
  });

  it("falls back to neutral copy only when the backend published no sentence", () => {
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: null }),
      "RhnToGlc",
    );
    expect(state.kind === "unavailable" && state.reason).toBe(
      "This route is not available right now.",
    );
  });

  it("is `open` but NOT availability-known when the field is absent", () => {
    const state = routeAvailability(preAvailabilityChains(), "RhnToGlc");
    expect(state.kind).toBe("open");
    expect(state.kind === "open" && state.availabilityKnown).toBe(false);
  });

  it("is `open` and availability-known when the backend answered true", () => {
    const state = routeAvailability(
      rhnChains({ enabled: true, available: true }),
      "RhnToGlc",
    );
    expect(state.kind === "open" && state.availabilityKnown).toBe(true);
  });

  it("keeps `closed` ahead of `unavailable`: a disabled route is disabled", () => {
    const state = routeAvailability(
      rhnChains({ enabled: false, available: false }),
      "RhnToGlc",
    );
    expect(state.kind).toBe("closed");
  });
});

describe("the three availability predicates", () => {
  const enabledButUnavailable = rhnChains({ enabled: true, available: false });
  const unpublished = preAvailabilityChains();

  it("isRouteOpen: false once the backend says the route is not available", () => {
    expect(isRouteOpen(enabledButUnavailable, "RhnToGlc")).toBe(false);
    expect(isRouteOpen(rhnChains({ enabled: true, available: true }), "RhnToGlc")).toBe(
      true,
    );
  });

  it("isRouteEnabled: the DEPLOYMENT question, unmoved by a runtime gate", () => {
    // What decides whether an endpoint exists to poll, or a route deserves
    // a card on the status page. A reserve closing must not make a
    // deployed route look undeployed.
    expect(isRouteEnabled(enabledButUnavailable, "RhnToGlc")).toBe(true);
    expect(isRouteEnabled(rhnChains({ enabled: false }), "RhnToGlc")).toBe(false);
  });

  it("isRouteEffectivelyAvailable: only a positive `available: true` passes", () => {
    expect(
      isRouteEffectivelyAvailable(
        rhnChains({ enabled: true, available: true }),
        "RhnToGlc",
      ),
    ).toBe(true);
    expect(isRouteEffectivelyAvailable(enabledButUnavailable, "RhnToGlc")).toBe(false);
    // The case the whole split exists for: a backend that never answered.
    expect(isRouteEffectivelyAvailable(unpublished, "RhnToGlc")).toBe(false);
    // And an unreachable /chains.
    expect(isRouteEffectivelyAvailable(undefined, "RhnToGlc")).toBe(false);
  });
});

describe("routeAvailabilitySummary", () => {
  it("does not count a route the backend reports as unavailable", () => {
    const open = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
    expect(routeAvailabilitySummary(open)).toEqual({ open: 6, total: 6 });
    const gated = fixtures.chainsFixture(() => new Date(), {
      robinhoodOpen: true,
      robinhoodAvailable: false,
    });
    expect(routeAvailabilitySummary(gated)).toEqual({ open: 2, total: 6 });
  });
});

describe("robinhoodPredepositVerdict — availability, failing closed", () => {
  /**
   * The gate's remaining job after the rolling-24h windows moved to
   * `@/lib/bridge/eligibility` (which gates all six routes rather than
   * this one): is the ROUTE open, positively, per `/chains`.
   *
   * Splitting them is what makes each answerable in one place. What did
   * NOT change is the disposition: an unreadable `/chains` is a refusal,
   * because the deposit it stands in front of reaches the custody
   * contract with no backend preflight and cannot be given back.
   */
  const ALLOWED = {
    route: "RhnToGlc" as const,
    routeAvailable: true,
    unavailableReason: null,
  };

  it("allows a route /chains positively reported available", () => {
    expect(robinhoodPredepositVerdict(ALLOWED)).toEqual({ kind: "allowed" });
  });

  it("refuses a route that is not positively available", () => {
    expect(
      robinhoodPredepositVerdict({ ...ALLOWED, routeAvailable: false }),
    ).toMatchObject({ kind: "route-unavailable" });
  });

  it("uses the backend's own sentence when it published one", () => {
    const verdict = robinhoodPredepositVerdict({
      ...ALLOWED,
      routeAvailable: false,
      unavailableReason: "Transfers to Goldcoin are paused.",
    });
    expect(verdict).toEqual({
      kind: "route-unavailable",
      reason: "Transfers to Goldcoin are paused.",
    });
  });

  it("falls back to neutral copy when the backend published none", () => {
    // This UI never authors a second explanation of a backend decision,
    // so the fallback is deliberately cause-agnostic.
    expect(robinhoodPredepositVerdict({ ...ALLOWED, routeAvailable: false })).toEqual({
      kind: "route-unavailable",
      reason: ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
    });
  });

  it("applies the same rule to RhnToSol — both reach the contract directly", () => {
    expect(robinhoodPredepositVerdict({ ...ALLOWED, route: "RhnToSol" })).toEqual({
      kind: "allowed",
    });
    expect(
      robinhoodPredepositVerdict({
        ...ALLOWED,
        route: "RhnToSol",
        routeAvailable: false,
      }),
    ).toMatchObject({ kind: "route-unavailable" });
  });
});

describe("formatRetryAfter — the RELATIVE fallback spelling", () => {
  it("rounds UP, so the stated wait is never shorter than the real one", () => {
    expect(formatRetryAfter(30)).toBe("in under a minute");
    expect(formatRetryAfter(61)).toBe("in about 2 minutes");
    expect(formatRetryAfter(60)).toBe("in about 1 minute");
    expect(formatRetryAfter(3_601)).toBe("in about 2 hours");
    expect(formatRetryAfter(40_000)).toBe("in about 12 hours");
  });

  it("renders nothing for an absent or impossible figure", () => {
    expect(formatRetryAfter(null)).toBeNull();
    expect(formatRetryAfter(undefined)).toBeNull();
    expect(formatRetryAfter(-1)).toBeNull();
  });
});

describe("formatRetryAt — the ABSOLUTE preferred spelling", () => {
  const RETRY_AT = 1_787_000_000;

  it("renders the instant in the reader's own locale", () => {
    expect(formatRetryAt(RETRY_AT)).toBe(
      `after ${new Date(RETRY_AT * 1000).toLocaleString()}`,
    );
  });

  it("refuses an implausible timestamp rather than rendering the year 55000", () => {
    // The realistic way this field goes wrong is milliseconds where
    // seconds were meant: finite, positive, and absurd.
    expect(formatRetryAt(RETRY_AT * 1000)).toBeNull();
    expect(formatRetryAt(0)).toBeNull();
    expect(formatRetryAt(-1)).toBeNull();
    expect(formatRetryAt(Number.NaN)).toBeNull();
    expect(formatRetryAt(null)).toBeNull();
    expect(formatRetryAt(undefined)).toBeNull();
  });
});
