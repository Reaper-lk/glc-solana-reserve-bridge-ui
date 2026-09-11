import { describe, expect, it } from "vitest";
import { destinationReserveGroups, executableRoutes } from "@/lib/bridge";
import { routeSchema, settlementRouteSchema } from "@/lib/api/schemas/common";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";

/**
 * Which route families an aggregate view may present, and how their
 * settled volume may be attributed.
 *
 * The defect this guards is the one the explorer summary actually had: it
 * named `GlcToSol`/`SolToGlc` in the markup and read `solana_reserve` and
 * `goldcoin_reserve` straight off `GET /stats`. That is correct only while
 * those two are the only routes with settlement machinery. `RhnToGlc`
 * settles onto the SAME Goldcoin reserve as `SolToGlc`, and
 * `settled_volume_atomic` is a per-reserve counter — so the card labelled
 * "Solana → Goldcoin settled" would silently start including Robinhood
 * volume the day that route opened.
 *
 * With all six routes implemented every reserve is now shared by exactly
 * two of them, which is what the grouping cases below pin.
 */

const chains = () => fixtures.chainsFixture(() => new Date());

/** `/chains` with an executable route this build has no descriptor for. */
function chainsWithUnknownExecutableRoute(): ChainsViewDto {
  const base = chains();
  return {
    ...base,
    routes: [
      ...base.routes,
      {
        id: "GlcToXyz",
        source_chain: "goldcoin",
        destination_chain: "xyz",
        enabled: true,
        disabled_reason: null,
        implemented: true,
      },
    ],
  };
}

describe("executableRoutes", () => {
  it("returns every family the backend implements — all six", () => {
    expect([...executableRoutes(chains())]).toEqual([
      "GlcToSol",
      "SolToGlc",
      "GlcToRhn",
      "RhnToGlc",
      "SolToRhn",
      "RhnToSol",
    ]);
  });

  it("includes the cross routes because the registry says they are implemented", () => {
    // They used to be excluded here, correctly: the backend reported
    // `implemented: false` because neither had a `Direction` value. Both
    // now do. Nothing in the module changed to follow that — it reads the
    // flag instead of keeping a list, which is the property being pinned.
    const routes = executableRoutes(chains());
    expect(routes).toContain("SolToRhn");
    expect(routes).toContain("RhnToSol");
  });

  it("still drops a route the backend reports as NOT implemented", () => {
    // The flag is read, not assumed. A deployment reporting a route inert
    // gets no family here, however many routes this build can describe.
    const base = chains();
    const inert = {
      ...base,
      routes: base.routes.map((route) =>
        route.id === "SolToRhn" ? { ...route, implemented: false } : route,
      ),
    };
    expect(executableRoutes(inert)).not.toContain("SolToRhn");
    expect(executableRoutes(inert)).toContain("RhnToSol");
  });

  it("is the whole route vocabulary, pinned against the schemas", () => {
    // Pinned against the schemas rather than a second literal list, so a
    // route added to the wire enum cannot be silently omitted here.
    const executable = new Set(executableRoutes(chains()));
    for (const route of routeSchema.options) {
      expect(executable.has(route as never)).toBe(
        settlementRouteSchema.safeParse(route).success,
      );
    }
  });

  it("includes a family whose route is currently CLOSED", () => {
    // Both Robinhood routes ship disabled, and their settled volume is
    // still real history. Availability decides whether a transfer can be
    // started; it does not decide whether past volume existed.
    const closed = chains();
    expect(closed.routes.find((r) => r.id === "GlcToRhn")?.enabled).toBe(false);
    expect(executableRoutes(closed)).toContain("GlcToRhn");
  });

  it("returns nothing before /chains has answered, rather than assuming", () => {
    // Fail closed. The alternative — falling back to "the routes we know
    // about" — is the hardcoded list this module exists to remove.
    expect(executableRoutes(undefined)).toEqual([]);
  });

  it("drops an executable route this build has no descriptor for", () => {
    // A backend that adds a fifth executable route ships it to an
    // unchanged frontend. This build does not know which reserve pays it
    // out or in what unit, so it gets no figure — not a guessed one.
    expect(executableRoutes(chainsWithUnknownExecutableRoute())).not.toContain(
      "GlcToXyz" as never,
    );
  });
});

describe("destinationReserveGroups", () => {
  it("groups all six families onto the three reserves that pay them", () => {
    const groups = destinationReserveGroups(executableRoutes(chains()));
    expect(groups.map((group) => [group.reserve, group.routes.map((r) => r.id)])).toEqual(
      [
        ["solana", ["GlcToSol", "RhnToSol"]],
        ["goldcoin", ["SolToGlc", "RhnToGlc"]],
        ["robinhood", ["GlcToRhn", "SolToRhn"]],
      ],
    );
  });

  it("gives every reserve exactly one group, whatever feeds it", () => {
    // `/stats` publishes one `settled_volume_atomic` per RESERVE. Two
    // groups for one reserve would show the same figure twice and double
    // that side's apparent volume — which is now a live risk on all three
    // pools, not just Goldcoin, because each has two routes settling onto
    // it.
    const groups = destinationReserveGroups(executableRoutes(chains()));
    const reserves = groups.map((group) => group.reserve);
    expect(new Set(reserves).size).toBe(reserves.length);
    expect(groups.flatMap((group) => group.routes)).toHaveLength(6);
  });

  it("keeps SolToGlc and RhnToGlc in ONE group, never two", () => {
    // Both settle onto the Goldcoin reserve, and `/stats` publishes one
    // counter for that reserve. Two groups would show the same figure
    // twice and double the bridge's apparent Goldcoin-side volume.
    const groups = destinationReserveGroups(executableRoutes(chains()));
    const goldcoin = groups.filter((group) => group.reserve === "goldcoin");
    expect(goldcoin).toHaveLength(1);
    expect(goldcoin[0]!.routes.map((r) => r.id)).toEqual(["SolToGlc", "RhnToGlc"]);
  });

  it("puts each cross route with the pool that actually pays it", () => {
    // `SolToRhn` settles onto the ROBINHOOD reserve and `RhnToSol` onto the
    // SOLANA one, which is the opposite of where their names' first half
    // points. Grouping either by its source would attribute its volume to a
    // pool that never paid it.
    const groups = destinationReserveGroups(["SolToRhn", "RhnToSol"]);
    expect(groups.map((group) => [group.reserve, group.routes.map((r) => r.id)])).toEqual(
      [
        ["robinhood", ["SolToRhn"]],
        ["solana", ["RhnToSol"]],
      ],
    );
  });

  it("is stable in order, so a card does not move when a route closes", () => {
    const groups = destinationReserveGroups(["GlcToRhn", "GlcToSol", "SolToGlc"]);
    expect(groups.map((group) => group.reserve)).toEqual([
      "robinhood",
      "solana",
      "goldcoin",
    ]);
  });
});
