import { describe, expect, it } from "vitest";
import {
  executableRouteStatus,
  executableRouteStatuses,
  AVAILABILITY_NOT_PUBLISHED_NOTE,
} from "@/lib/bridge/route-status";
import type { RouteStatusInput } from "@/lib/bridge/route-status";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";
import type { SettlementRoute } from "@/lib/api/schemas/common";

/**
 * Where each route's numbers come from.
 *
 * This is the file that guards the defect the status page actually had:
 * four executable routes settling onto three independent reserve pools, in
 * three different units, described by code shaped around two directions.
 * A wrong answer here is not a crash or a blank — it is a confident,
 * plausible figure attributed to the wrong route, which is the one failure
 * mode a status page cannot afford.
 *
 * So every case below pins a route to the API FIELD its figure came from,
 * not merely to a rendered number: two routes legitimately share the
 * Goldcoin reserve, and a test that only compared displayed values could
 * not tell that sharing apart from an accidental fallback.
 */

const now = () => new Date();

/**
 * Deliberately distinct values in every slot, none of them equal to any
 * other and none of them equal to a fixture default. A figure that leaked
 * from one route to another therefore shows up as the wrong NUMBER, not
 * just as the wrong provenance string.
 */
const GOLDCOIN_CAPACITY = "111100000000"; // 8dp -> 1,111.00
const SOLANA_CAPACITY = "222200000"; // 6dp -> 222.20
const ROBINHOOD_CAPACITY = "333300000000"; // 8dp -> 3,333.00
const GLC_TO_SOL_WINDOW = "444400000"; // 6dp -> 444.40
const SOL_TO_GLC_WINDOW = "555500000"; // 6dp -> 555.50
const OUTBOUND_WINDOW = "666600000000000000000"; // 18dp -> 666.60
const INBOUND_WINDOW = "777700000000000000000"; // 18dp -> 777.70

function robinhoodReserve(): RobinhoodReserveDto {
  const base = fixtures.robinhoodReserveFixture(now, { open: true });
  const outbound = base.onchain.outbound_window!;
  const inbound = base.onchain.inbound_window!;
  return {
    ...base,
    available_capacity_atomic: ROBINHOOD_CAPACITY,
    onchain: {
      ...base.onchain,
      outbound_window: { ...outbound, remaining_atomic: OUTBOUND_WINDOW },
      inbound_window: { ...inbound, remaining_atomic: INBOUND_WINDOW },
    },
  };
}

function input(overrides: Partial<RouteStatusInput> = {}): RouteStatusInput {
  return {
    chains: fixtures.chainsFixture(now, { robinhoodOpen: true }),
    status: {
      ...fixtures.statusFixture(now),
      glc_to_sol_rolling_volume_remaining: GLC_TO_SOL_WINDOW,
      sol_to_glc_rolling_volume_remaining: SOL_TO_GLC_WINDOW,
    },
    reserve: {
      goldcoin_available_capacity: GOLDCOIN_CAPACITY,
      solana_available_capacity: SOLANA_CAPACITY,
    },
    robinhood: robinhoodReserve(),
    limits: fixtures.limitsFixture(),
    ...overrides,
  };
}

function statusOf(route: SettlementRoute, overrides: Partial<RouteStatusInput> = {}) {
  return executableRouteStatus(route, input(overrides));
}

describe("each route reads its capacity from its own destination reserve", () => {
  it("pays GlcToSol out of the Solana reserve, at the mint's 6 decimals", () => {
    const card = statusOf("GlcToSol");
    expect(card.capacity).toEqual({
      atomic: SOLANA_CAPACITY,
      decimals: 6,
      source: "GET /reserve · solana_available_capacity",
    });
  });

  it("pays SolToGlc out of the Goldcoin reserve, at Goldcoin's 8", () => {
    const card = statusOf("SolToGlc");
    expect(card.capacity).toEqual({
      atomic: GOLDCOIN_CAPACITY,
      decimals: 8,
      source: "GET /reserve · goldcoin_available_capacity",
    });
  });

  it("pays GlcToRhn out of the Robinhood ledger, at CANONICAL 8 decimals", () => {
    // Not Robinhood's native 18: the ledger column is an INTEGER and the
    // backend keeps this reserve's books in canonical units. Reading it at
    // 18 would understate the reserve by ten orders of magnitude.
    const card = statusOf("GlcToRhn");
    expect(card.capacity).toEqual({
      atomic: ROBINHOOD_CAPACITY,
      decimals: 8,
      source: "GET /robinhood/reserve · available_capacity_atomic",
    });
  });

  it("pays RhnToGlc out of the GOLDCOIN reserve, not the Robinhood one", () => {
    // `Direction::destination_reserve()` names `GoldcoinReserve` for this
    // route: the deposit lands on Robinhood, the payout comes out of
    // Goldcoin. Answering it with the Robinhood ledger's capacity would be
    // the wrong pool entirely.
    const card = statusOf("RhnToGlc");
    expect(card.capacity).toEqual({
      atomic: GOLDCOIN_CAPACITY,
      decimals: 8,
      source: "GET /reserve · goldcoin_available_capacity",
    });
  });
});

describe("no route is answered with another route's figures", () => {
  it("keeps GlcToSol and SolToGlc on different reserves", () => {
    const glcToSol = statusOf("GlcToSol");
    const solToGlc = statusOf("SolToGlc");

    expect(glcToSol.capacity?.atomic).not.toBe(solToGlc.capacity?.atomic);
    expect(glcToSol.capacity?.source).not.toBe(solToGlc.capacity?.source);
    // And in different units — 6 for the Solana mint, 8 for Goldcoin.
    expect(glcToSol.capacity?.decimals).toBe(6);
    expect(solToGlc.capacity?.decimals).toBe(8);
  });

  it("keeps GlcToRhn and RhnToGlc on different reserves", () => {
    const glcToRhn = statusOf("GlcToRhn");
    const rhnToGlc = statusOf("RhnToGlc");

    expect(glcToRhn.capacity?.atomic).toBe(ROBINHOOD_CAPACITY);
    expect(rhnToGlc.capacity?.atomic).toBe(GOLDCOIN_CAPACITY);
    expect(glcToRhn.capacity?.source).not.toBe(rhnToGlc.capacity?.source);
  });

  it("charges each Robinhood route against its own contract window", () => {
    // `GlcToRhn` PAYS OUT onto Robinhood and is charged against the
    // outbound bucket; `RhnToGlc` takes a DEPOSIT and is charged against
    // the inbound one. Crossing them reports a limit the contract does not
    // apply to that route.
    expect(statusOf("GlcToRhn").window).toEqual({
      atomic: OUTBOUND_WINDOW,
      decimals: 18,
      source: "GET /robinhood/reserve · onchain.outbound_window.remaining_atomic",
    });
    expect(statusOf("RhnToGlc").window).toEqual({
      atomic: INBOUND_WINDOW,
      decimals: 18,
      source: "GET /robinhood/reserve · onchain.inbound_window.remaining_atomic",
    });
  });

  it("never gives a Robinhood route the Solana rolling window", () => {
    for (const route of ["GlcToRhn", "RhnToGlc"] as const) {
      const card = statusOf(route);
      expect(card.window?.atomic).not.toBe(GLC_TO_SOL_WINDOW);
      expect(card.window?.atomic).not.toBe(SOL_TO_GLC_WINDOW);
      expect(card.window?.source).toContain("robinhood");
    }
  });

  it("never gives a Solana route a Robinhood contract window", () => {
    expect(statusOf("GlcToSol").window).toEqual({
      atomic: GLC_TO_SOL_WINDOW,
      decimals: 6,
      source: "GET /status · glc_to_sol_rolling_volume_remaining",
    });
    expect(statusOf("SolToGlc").window).toEqual({
      atomic: SOL_TO_GLC_WINDOW,
      decimals: 6,
      source: "GET /status · sol_to_glc_rolling_volume_remaining",
    });
  });

  it("gives all four routes a window figure that is theirs alone", () => {
    const windows = executableRouteStatuses(input()).map((card) => card.window?.atomic);
    expect(windows).toHaveLength(4);
    expect(new Set(windows).size).toBe(4);
  });

  it("uses exactly three distinct capacity sources across the four routes", () => {
    // Three reserve pools, four routes: `SolToGlc` and `RhnToGlc` settle
    // onto the SAME Goldcoin pool, so they share one figure by design.
    // That is a shared source, not a reused one — and the count is what
    // tells the two apart.
    const sources = executableRouteStatuses(input()).map((card) => card.capacity?.source);
    expect(new Set(sources).size).toBe(3);
  });
});

describe("units are never crossed between networks", () => {
  it("reads the Robinhood ledger at 8 and its contract windows at 18, on one route", () => {
    const card = statusOf("GlcToRhn");
    expect(card.capacity?.decimals).toBe(8);
    expect(card.window?.decimals).toBe(18);
  });

  it("clamps a negative capacity for display without inventing a figure", () => {
    // A capacity below zero is a real diagnostic state the backend reports
    // rather than hides, but "-2 GLC of headroom" is not a sentence a user
    // can act on: it means none.
    const card = statusOf("SolToGlc", {
      reserve: {
        goldcoin_available_capacity: "-500",
        solana_available_capacity: SOLANA_CAPACITY,
      },
    });
    expect(card.capacity?.atomic).toBe("0");
  });
});

describe("availability comes from GET /chains and nothing else", () => {
  it("reports available only when the backend answered available: true", () => {
    for (const route of ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const) {
      const card = statusOf(route);
      expect(card.available).toBe(true);
      expect(card.kind).toBe("available");
    }
  });

  it("closes a route the backend reports available: false", () => {
    const card = statusOf("RhnToGlc", {
      chains: fixtures.chainsFixture(now, {
        robinhoodOpen: true,
        robinhoodAvailable: false,
      }),
    });
    expect(card.enabled).toBe(true);
    expect(card.available).toBe(false);
    expect(card.kind).toBe("unavailable");
    expect(card.reason).toBe(fixtures.DIRECTION_UNAVAILABLE_MESSAGE);
  });

  it("never reports an enabled-but-unanswered route as available", () => {
    // A deployment predating backend PR #76 publishes no `available` at
    // all. `enabled: true` is the route gate's verdict over config and
    // adapter capability and reads NO reserve state — treating it as
    // permission is exactly how `RhnToGlc` deposits reached a Goldcoin
    // reserve whose admission was closed.
    const open = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const legacy: ChainsViewDto = {
      ...open,
      routes: open.routes.map((route) => {
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }),
    };
    const card = statusOf("RhnToGlc", { chains: legacy });

    expect(card.enabled).toBe(true);
    expect(card.available).toBeUndefined();
    expect(card.kind).toBe("unknown");
    expect(card.note).toBe(AVAILABILITY_NOT_PUBLISHED_NOTE);
  });

  it("fails closed when /chains has not answered at all", () => {
    const card = statusOf("GlcToSol", { chains: undefined });
    expect(card.kind).toBe("unknown");
    expect(card.enabled).toBe(false);
    expect(card.available).toBeUndefined();
  });

  it("reports a switched-off route as closed, with the backend's own copy", () => {
    const card = statusOf("GlcToRhn", { chains: fixtures.chainsFixture(now) });
    expect(card.enabled).toBe(false);
    expect(card.kind).toBe("closed");
    expect(card.reason).toBe(fixtures.ROUTE_UNAVAILABLE_MESSAGE);
  });

  it("still refuses when /status contradicts an available route", () => {
    // The two endpoints can disagree for a moment. `/chains` is the
    // authority on whether a transfer may start; `/status` may only make
    // the refusal MORE specific, never turn one into a yes.
    const card = statusOf("GlcToSol", {
      chains: fixtures.chainsFixture(now, { robinhoodOpen: true }),
      status: fixtures.pausedStatusFixture(),
    });
    expect(card.available).toBe(true);
    expect(card.kind).toBe("paused");
  });

  it("downgrades an available Robinhood route whose reserve is paused", () => {
    const reserve = fixtures.robinhoodReserveFixture(now, { open: true, paused: true });
    const card = statusOf("GlcToRhn", { robinhood: reserve });
    expect(card.available).toBe(true);
    expect(card.kind).toBe("paused");
  });

  it("cannot promote a route the registry refused, whatever the reserve says", () => {
    // A healthy, funded, unpaused Robinhood reserve beside a `/chains` that
    // says no. The reserve is not a second opinion.
    const card = statusOf("GlcToRhn", {
      chains: fixtures.chainsFixture(now, {
        robinhoodOpen: true,
        robinhoodAvailable: false,
      }),
      robinhood: robinhoodReserve(),
    });
    expect(card.kind).toBe("unavailable");
  });
});

describe("the route list itself", () => {
  it("covers exactly the four executable routes", () => {
    const routes = executableRouteStatuses(input()).map((card) => card.route);
    expect(routes).toEqual(["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"]);
  });

  it("never includes a route with no settlement machinery", () => {
    // `SolToRhn`/`RhnToSol` are `implemented: false`: no `Direction` value
    // exists for either, so no reserve pays them and no window bounds them.
    // They belong in the Routes list, which states availability and stops.
    const routes = executableRouteStatuses(input()).map((card) => card.route);
    expect(routes).not.toContain("SolToRhn");
    expect(routes).not.toContain("RhnToSol");
  });

  it("still lists this build's settlement routes when /chains is unreachable", () => {
    // Rendering nothing would be worse than rendering four rows that all
    // say "unknown" — and every one of them does say exactly that.
    const cards = executableRouteStatuses(input({ chains: undefined }));
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.kind).toBe("unknown");
  });
});

describe("published limits and fees", () => {
  it("gives the Solana-governed pair the limits GET /limits actually describes", () => {
    for (const route of ["GlcToSol", "SolToGlc"] as const) {
      const card = statusOf(route);
      expect(card.minimum?.source).toBe("GET /limits · min_transfer_amount");
      expect(card.maximum?.source).toBe("GET /limits · per_transfer_limit");
      // Mint-atomic, the unit the on-chain checks compare against.
      expect(card.minimum?.decimals).toBe(6);
    }
  });

  it("gives a Robinhood route no per-transfer limits rather than Solana's", () => {
    // `GET /limits` passes the SOLANA program's `BridgeConfig` through raw.
    // Applying it to a Robinhood-legged route would state a ceiling that
    // neither chain enforces — the same rule the bridge form's MAX applies.
    for (const route of ["GlcToRhn", "RhnToGlc"] as const) {
      const card = statusOf(route);
      expect(card.minimum).toBeNull();
      expect(card.maximum).toBeNull();
    }
  });

  it("reports the published bridge fee on every route", () => {
    for (const card of executableRouteStatuses(input())) {
      expect(card.feeBps).toBe(fixtures.BRIDGE_FEE_BPS);
    }
  });

  it("says the fee is not published rather than assuming one", () => {
    for (const card of executableRouteStatuses(input({ limits: undefined }))) {
      expect(card.feeBps).toBeNull();
    }
  });
});

describe("absent is never zero", () => {
  it("publishes no Robinhood figure on a deployment with no Robinhood reserve", () => {
    const card = statusOf("GlcToRhn", {
      robinhood: fixtures.robinhoodReserveFixture(now, { open: false }),
    });
    expect(card.capacity).toBeNull();
    expect(card.window).toBeNull();
    expect(card.kind).toBe("unknown");
  });

  it("publishes no figure at all when /reserve has not answered", () => {
    const cards = executableRouteStatuses(input({ reserve: undefined }));
    const solToGlc = cards.find((card) => card.route === "SolToGlc");
    expect(solToGlc?.capacity).toBeNull();
  });
});
