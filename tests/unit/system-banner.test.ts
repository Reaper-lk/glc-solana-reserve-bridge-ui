import { describe, expect, it } from "vitest";
import {
  systemRouteAvailability,
  systemRouteMessage,
  SYSTEM_ROUTE_MESSAGE,
} from "@/lib/bridge/system-banner";
import type { SystemRouteAvailability } from "@/lib/bridge/system-banner";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";

/**
 * The system-wide availability sentence.
 *
 * Two failures are pinned here, one historical and one that replaced it.
 *
 * The first: the strip said "The bridge is paused on both sides.",
 * derived from `goldcoin_paused && solana_paused`. The WORDING named a
 * two-direction topology that no longer exists, and the DERIVATION read
 * a pair of reserve pause booleans that cannot see a Robinhood route at
 * all — so with every Robinhood route shut and both Solana directions
 * open, the old strip said "Operational" and meant it.
 *
 * The second: the replacement called every unusable route "temporarily
 * unavailable". `GlcToRhn` ships `enabled: false` and stays that way
 * until an operator changes something, so "temporarily" promised a
 * self-healing that was never coming. `enabled` is what separates the
 * two, and every case below is about keeping them separate.
 */

const now = () => new Date();

/** One executable route's state, spelled the way `/chains` spells it. */
type RouteState = "available" | "disabled" | "unavailable";

/**
 * `/chains` with each executable route forced into one of the three
 * states, exactly as the backend's `route_availability` would report it
 * (service/src/api.rs): a disabled route carries the ROUTE-GATE copy, a
 * runtime-gated one carries the DIRECTION copy, and both report
 * `available: false`.
 */
function chainsWith(states: Partial<Record<string, RouteState>>): ChainsViewDto {
  const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route): RouteViewDto => {
      const state = states[route.id];
      if (state === undefined) return route;
      if (state === "available") {
        return {
          ...route,
          enabled: true,
          disabled_reason: null,
          available: true,
          unavailable_reason: null,
        };
      }
      if (state === "disabled") {
        return {
          ...route,
          enabled: false,
          disabled_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
          available: false,
          unavailable_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
        };
      }
      return {
        ...route,
        enabled: true,
        disabled_reason: null,
        available: false,
        unavailable_reason: fixtures.DIRECTION_UNAVAILABLE_MESSAGE,
      };
    }),
  };
}

/**
 * Every route the backend names, available. Six entries, because every one
 * of them is implemented and therefore counted — this used to be four, and
 * the two missing entries were the two the strip could not see.
 */
const ALL_AVAILABLE: Record<string, RouteState> = {
  GlcToSol: "available",
  SolToGlc: "available",
  GlcToRhn: "available",
  RhnToGlc: "available",
  SolToRhn: "available",
  RhnToSol: "available",
};

/** Every route in one state, for the outage cases. */
function allIn(state: RouteState): Record<string, RouteState> {
  return Object.fromEntries(Object.keys(ALL_AVAILABLE).map((id) => [id, state]));
}

describe("systemRouteAvailability — the five states", () => {
  it("every executable route enabled and available", () => {
    expect(systemRouteAvailability(chainsWith(ALL_AVAILABLE))).toEqual({
      kind: "all-available",
      total: 6,
      available: 6,
      disabled: 0,
      unavailable: 0,
    });
  });

  it("some switched off, every enabled one available", () => {
    expect(
      systemRouteAvailability(chainsWith({ ...ALL_AVAILABLE, GlcToRhn: "disabled" })),
    ).toEqual({
      kind: "some-disabled",
      total: 6,
      available: 5,
      disabled: 1,
      unavailable: 0,
    });
  });

  it("every executable route enabled, some gated shut right now", () => {
    expect(
      systemRouteAvailability(chainsWith({ ...ALL_AVAILABLE, RhnToGlc: "unavailable" })),
    ).toEqual({
      kind: "some-unavailable",
      total: 6,
      available: 5,
      disabled: 0,
      unavailable: 1,
    });
  });

  it("one of each — the state production is actually in", () => {
    // `GlcToRhn` ships disabled; `RhnToGlc` was the launch-blocker route,
    // enabled with the Goldcoin reserve's admission closed behind it.
    expect(
      systemRouteAvailability(
        chainsWith({
          ...ALL_AVAILABLE,
          GlcToRhn: "disabled",
          RhnToGlc: "unavailable",
        }),
      ),
    ).toEqual({
      kind: "some-disabled-and-unavailable",
      total: 6,
      available: 4,
      disabled: 1,
      unavailable: 1,
    });
  });

  it("nothing executable is usable, for either reason", () => {
    expect(
      systemRouteAvailability(
        chainsWith({
          GlcToSol: "unavailable",
          SolToGlc: "unavailable",
          SolToRhn: "unavailable",
          GlcToRhn: "disabled",
          RhnToGlc: "disabled",
          RhnToSol: "disabled",
        }),
      ),
    ).toEqual({
      kind: "none-available",
      total: 6,
      available: 0,
      disabled: 3,
      unavailable: 3,
    });
  });

  it("reports a maintenance pause as temporary, never as disabled", () => {
    // The production state: every Robinhood-legged route built and switched
    // ON, and every one reporting `available: false` while a reserve is held
    // shut. All four land in the `unavailable` bucket — nobody flipped a
    // switch, so the copy must not send anyone looking for one — and the
    // Solana pair, which is unaffected, keeps running.
    const maintenance = systemRouteAvailability(
      fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
    );
    expect(maintenance).toEqual({
      kind: "some-unavailable",
      total: 6,
      available: 2,
      disabled: 0,
      unavailable: 4,
    });
    expect(systemRouteMessage(maintenance)).toBe(SYSTEM_ROUTE_MESSAGE.unavailable);
  });

  it("reports a maintenance pause across ALL six as a full outage", () => {
    // The same cause reaching every route. The headline drops the
    // disabled/temporary split, because with nothing usable at all which
    // gate closed each route is detail for /status.
    const maintenance = systemRouteAvailability(chainsWith(allIn("unavailable")));
    expect(maintenance).toMatchObject({ kind: "none-available", total: 6, available: 0 });
    expect(systemRouteMessage(maintenance)).toBe(SYSTEM_ROUTE_MESSAGE.none);
  });

  it("full outage does not split by cause", () => {
    // Every route disabled and every route gated shut are different
    // situations, and with nothing usable at all neither is the headline.
    const allDisabled = systemRouteAvailability(chainsWith(allIn("disabled")));
    const allGated = systemRouteAvailability(chainsWith(allIn("unavailable")));
    expect(allDisabled.kind).toBe("none-available");
    expect(allGated.kind).toBe("none-available");
    expect(systemRouteMessage(allDisabled)).toBe(systemRouteMessage(allGated));
  });
});

describe("bucketing rules", () => {
  it("puts every executable route in exactly one bucket", () => {
    for (const states of [
      ALL_AVAILABLE,
      { ...ALL_AVAILABLE, GlcToRhn: "disabled" as const },
      {
        ...ALL_AVAILABLE,
        GlcToRhn: "disabled" as const,
        RhnToGlc: "unavailable" as const,
      },
      {
        ...allIn("disabled"),
        GlcToSol: "unavailable" as const,
        RhnToGlc: "unavailable" as const,
      },
    ]) {
      const state = systemRouteAvailability(chainsWith(states));
      if (state.kind === "unknown") throw new Error("expected a counted state");
      expect(state.available + state.disabled + state.unavailable).toBe(state.total);
    }
  });

  it("counts a switched-off route as disabled, never as temporary", () => {
    // The whole point of the split: `enabled: false` outranks any runtime
    // reading, because only an operator reopens it.
    const state = systemRouteAvailability(
      chainsWith({ ...ALL_AVAILABLE, GlcToRhn: "disabled" }),
    );
    expect(state).toMatchObject({ disabled: 1, unavailable: 0 });
    expect(systemRouteMessage(state)).not.toMatch(/temporarily/i);
  });

  it("counts an enabled-but-refused route as temporary, never as disabled", () => {
    const state = systemRouteAvailability(
      chainsWith({ ...ALL_AVAILABLE, RhnToGlc: "unavailable" }),
    );
    expect(state).toMatchObject({ disabled: 0, unavailable: 1 });
    expect(systemRouteMessage(state)).toMatch(/temporarily/i);
  });

  it("counts an enabled route with no published `available` as temporary", () => {
    // A deployment predating backend PR #76. `enabled: true` reads no
    // reserve state and is not an answer to "can this be used" — so the
    // route fails closed, and it belongs with the runtime bucket because
    // `enabled` is what would have moved it to the other one.
    const base = chainsWith(ALL_AVAILABLE);
    const legacy: ChainsViewDto = {
      ...base,
      routes: base.routes.map((route) => {
        if (route.id !== "RhnToGlc") return route;
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }),
    };
    expect(systemRouteAvailability(legacy)).toMatchObject({
      kind: "some-unavailable",
      available: 5,
      disabled: 0,
      unavailable: 1,
    });
  });

  it("counts every route the registry reports as implemented", () => {
    // All six, now that the backend implements all six. It used to be four,
    // and the two it left out were left out by reading `implemented` — not
    // by naming them — which is why this needed no new arm to follow the
    // backend.
    expect(fixtures.chainsFixture(now).routes).toHaveLength(6);
    expect(systemRouteAvailability(chainsWith(ALL_AVAILABLE))).toMatchObject({
      total: 6,
    });
  });

  it("counts only EXECUTABLE routes", () => {
    // A route a deployment reports `implemented: false` is structurally
    // inert there: counting it would make a warning permanent and
    // meaningless, because no operator action clears it.
    const base = chainsWith(ALL_AVAILABLE);
    const inert: ChainsViewDto = {
      ...base,
      routes: base.routes.map((route) =>
        route.id === "RhnToSol" ? { ...route, implemented: false } : route,
      ),
    };
    expect(systemRouteAvailability(inert)).toMatchObject({
      kind: "all-available",
      total: 5,
      available: 5,
    });
  });

  it("says it does not know until /chains answers", () => {
    expect(systemRouteAvailability(undefined)).toEqual({ kind: "unknown" });
  });

  it("says it does not know rather than reporting 0 of 0", () => {
    const empty: ChainsViewDto = { ...chainsWith(ALL_AVAILABLE), routes: [] };
    expect(systemRouteAvailability(empty)).toEqual({ kind: "unknown" });
  });

  it("does not read the Solana reserve pause booleans", () => {
    // The old derivation's blind spot, stated as a case: both Solana
    // directions open, both Robinhood routes shut. That is not
    // "operational", and no field on `GET /status` can say so.
    expect(
      systemRouteAvailability(
        chainsWith({ ...ALL_AVAILABLE, GlcToRhn: "disabled", RhnToGlc: "disabled" }),
      ).kind,
    ).toBe("some-disabled");
  });
});

describe("systemRouteMessage", () => {
  const cases: readonly [SystemRouteAvailability["kind"], string | null][] = [
    [
      "none-available",
      "Bridge maintenance — no transfer routes are currently available.",
    ],
    ["some-disabled", "Some bridge routes are currently disabled."],
    ["some-unavailable", "Some bridge routes are temporarily unavailable."],
    [
      "some-disabled-and-unavailable",
      "Some bridge routes are disabled or temporarily unavailable.",
    ],
    ["unknown", "Checking route availability…"],
    ["all-available", null],
  ];

  for (const [kind, expected] of cases) {
    it(`renders ${expected === null ? "no warning" : `"${expected}"`} for ${kind}`, () => {
      const state = (
        kind === "unknown"
          ? { kind }
          : { kind, total: 4, available: 2, disabled: 1, unavailable: 1 }
      ) as SystemRouteAvailability;
      expect(systemRouteMessage(state)).toBe(expected);
    });
  }

  it("shows no warning at all when everything is available", () => {
    expect(
      systemRouteMessage(systemRouteAvailability(chainsWith(ALL_AVAILABLE))),
    ).toBeNull();
  });

  it("never names a side, a direction, a network or a reason", () => {
    for (const message of Object.values(SYSTEM_ROUTE_MESSAGE)) {
      expect(message).not.toMatch(/both sides/i);
      expect(message).not.toMatch(/both directions/i);
      expect(message).not.toMatch(/\bsolana\b/i);
      expect(message).not.toMatch(/\brobinhood\b/i);
    }
  });

  it("keeps the disabled and temporary sentences distinguishable", () => {
    // Not merely different strings: the disabled one must not claim the
    // route heals itself, and the temporary one must not read as a
    // configuration change waiting on an operator.
    expect(SYSTEM_ROUTE_MESSAGE.disabled).not.toMatch(/temporar/i);
    expect(SYSTEM_ROUTE_MESSAGE.unavailable).not.toMatch(/disabled/i);
    expect(SYSTEM_ROUTE_MESSAGE.mixed).toMatch(/disabled/i);
    expect(SYSTEM_ROUTE_MESSAGE.mixed).toMatch(/temporarily/i);
    expect(new Set(Object.values(SYSTEM_ROUTE_MESSAGE)).size).toBe(
      Object.values(SYSTEM_ROUTE_MESSAGE).length,
    );
  });
});
