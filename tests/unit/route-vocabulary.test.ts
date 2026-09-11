import { describe, expect, it } from "vitest";
import {
  directionSchema,
  isSettlementRoute,
  routeSchema,
  settlementRouteSchema,
} from "@/lib/api/schemas/common";
import { transferViewSchema } from "@/lib/api/schemas/transfer";
import { explorerEventSchema } from "@/lib/api/schemas/explorer";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import { happyPathFor, routeDisplay } from "@/lib/bridge";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The route vocabulary, and the defect that made widening it necessary.
 *
 * Before this, the wire enum was exactly `GlcToSol | SolToGlc`. A single
 * `GlcToRhn` row anywhere in `GET /transfers` or `GET /explorer/events`
 * would have failed Zod and taken down the WHOLE page rather than one row
 * — so the UI would have broken the moment a Robinhood route was enabled
 * backend-side, with no frontend deploy involved.
 *
 * Parsing a route is now total over the backend's own enum. It remains
 * completely separate from whether a route may be used, which only
 * `GET /chains` answers.
 */

const ALL_ROUTES = [
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
  "SolToRhn",
  "RhnToSol",
] as const;

function transfer(direction: string) {
  return {
    id: 42,
    direction,
    state: "Settled",
    gross_amount_atomic: "100000000",
    fee_bps: 300,
    fee_amount_atomic: "3000000",
    net_amount_atomic: "97000000",
    created_at: 1_700_000_000,
    source_txid: null,
    source_confirmations: 0,
    required_source_confirmations: null,
    destination_txid: null,
    failure_reason: null,
    refund: null,
  };
}

describe("routeSchema", () => {
  it("accepts every route the backend can name", () => {
    for (const route of ALL_ROUTES) {
      expect(routeSchema.safeParse(route).success).toBe(true);
    }
  });

  it("still rejects a route outside that enum", () => {
    // Permissive over the backend's vocabulary, not permissive in general:
    // an unknown direction is a contract break worth surfacing.
    expect(routeSchema.safeParse("GlcToXyz").success).toBe(false);
    expect(routeSchema.safeParse("glctosol").success).toBe(false);
  });

  it("is the same vocabulary the response `direction` field uses", () => {
    expect(directionSchema.safeParse("RhnToGlc").success).toBe(true);
  });
});

describe("settlementRouteSchema", () => {
  it("covers every route the backend names", () => {
    // It used to cover four. `SolToRhn`/`RhnToSol` had no `Direction` value
    // backend-side, so excluding them at the type level stopped any code
    // path from handing either to an action. The backend has since shipped
    // settlement machinery for both, and a type that still excluded them
    // made this app describe a live route as an absent one.
    for (const route of ALL_ROUTES) {
      expect(settlementRouteSchema.safeParse(route).success).toBe(true);
      expect(isSettlementRoute(route)).toBe(true);
    }
  });

  it("is the wire vocabulary itself, not a second copy of it", () => {
    // Written as an alias rather than a second six-member enum: two enums
    // that have to stay identical are two places for them to stop being.
    expect([...settlementRouteSchema.options]).toEqual([...routeSchema.options]);
  });

  it("still narrows a route the backend has never named", () => {
    // The check is not vacuous just because it accepts all six today.
    // `/chains` route ids are open strings by design, so a seventh route
    // must narrow to nothing here rather than be guessed at.
    expect(isSettlementRoute("GlcToXyz")).toBe(false);
    expect(isSettlementRoute("")).toBe(false);
  });
});

describe("transferViewSchema", () => {
  it("parses a Robinhood transfer instead of failing the whole response", () => {
    // The defect this fixes: one such row used to reject the entire page.
    expect(transferViewSchema.safeParse(transfer("GlcToRhn")).success).toBe(true);
    expect(transferViewSchema.safeParse(transfer("RhnToGlc")).success).toBe(true);
  });

  it("still rejects a direction the backend could never send", () => {
    expect(transferViewSchema.safeParse(transfer("GlcToXyz")).success).toBe(false);
  });
});

describe("explorerEventSchema", () => {
  it("parses a Robinhood event", () => {
    expect(
      explorerEventSchema.safeParse({
        id: 1,
        request_id: 42,
        direction: "RhnToGlc",
        from_state: "AwaitingDeposit",
        to_state: "Settled",
        at: 1_700_000_000,
        reason: null,
      }).success,
    ).toBe(true);
  });
});

describe("routeDisplay", () => {
  it("names every route, including the two this app cannot start", () => {
    // A route this build cannot submit still has to be nameable — that is
    // what lets the UI say clearly that it cannot, instead of omitting it.
    for (const route of ALL_ROUTES) {
      const display = routeDisplay(route);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.from.chain.id).not.toBe(display.to.chain.id);
    }
  });

  it("gives the Robinhood token its real 18 decimals", () => {
    expect(routeDisplay("RhnToGlc").from.token.decimals).toBe(18);
    expect(routeDisplay("GlcToRhn").to.token.decimals).toBe(18);
  });
});

describe("happyPathFor", () => {
  it("includes a confirmation step only for Goldcoin-sourced routes", () => {
    // A Goldcoin deposit is confirmation-tracked block by block; a
    // contract-sourced one folds straight to SourceFinalized, which is why
    // `required_source_confirmations` is null for those.
    expect(happyPathFor("GlcToSol")).toContain("Confirming");
    expect(happyPathFor("GlcToRhn")).toContain("Confirming");
    expect(happyPathFor("SolToGlc")).not.toContain("Confirming");
    expect(happyPathFor("RhnToGlc")).not.toContain("Confirming");
    // Neither cross route touches Goldcoin at all, so neither has a
    // confirmation ramp — and neither needed a new branch to get that
    // right, because the rule is keyed on the source chain.
    expect(happyPathFor("SolToRhn")).not.toContain("Confirming");
    expect(happyPathFor("RhnToSol")).not.toContain("Confirming");
  });
});

describe("chainsViewSchema", () => {
  it("parses the registry the backend actually serves", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    expect(parsed.chains.map((chain) => chain.id)).toEqual([
      "goldcoin",
      "solana",
      "robinhood",
    ]);
    expect(parsed.routes).toHaveLength(6);
  });

  it("carries `implemented` separately from `enabled`", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    const byId = new Map(parsed.routes.map((route) => [route.id, route]));
    // Implemented but closed — the machinery exists, the route does not
    // open. Every route in this build is now in that state bar the two
    // that predate the registry, which is exactly why the two fields
    // cannot be collapsed into one: `implemented` says the code exists,
    // `enabled` says an operator switched it on, and neither implies the
    // other.
    for (const id of ["GlcToRhn", "RhnToGlc", "SolToRhn", "RhnToSol"] as const) {
      expect(byId.get(id)).toMatchObject({ implemented: true, enabled: false });
    }
    // And the pair that predates the registry is on by default.
    expect(byId.get("GlcToSol")).toMatchObject({ implemented: true, enabled: true });
  });

  it("reports every route as implemented, including the two cross routes", () => {
    // The fixture used to say `implemented: false` for `SolToRhn`/
    // `RhnToSol`, which made the app describe shipped machinery as absent
    // and gave them a "Not implemented" badge no operator could clear.
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    expect(parsed.routes.filter((route) => route.implemented)).toHaveLength(6);
  });

  it("publishes the same 100 GLC source minimum on all six routes", () => {
    const parsed = chainsViewSchema.parse(fixtures.chainsFixture(() => new Date()));
    for (const route of parsed.routes) {
      expect(route.min_transfer_atomic).toBe(fixtures.SOURCE_MINIMUM_ATOMIC);
    }
  });
});
