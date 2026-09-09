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
  it("returns exactly the four families the backend implements", () => {
    expect([...executableRoutes(chains())]).toEqual([
      "GlcToSol",
      "SolToGlc",
      "GlcToRhn",
      "RhnToGlc",
    ]);
  });

  it("never reports SolToRhn or RhnToSol as executable", () => {
    // These two have no `Direction` value on either side, so no settlement
    // function can ever be called with them and no volume can accrue. The
    // backend says so with `implemented: false`; nothing here may soften
    // that into "closed for now".
    const routes = executableRoutes(chains());
    expect(routes).not.toContain("SolToRhn");
    expect(routes).not.toContain("RhnToSol");
  });

  it("is the whole route vocabulary minus the two non-executable spellings", () => {
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
  it("groups the four families onto the three reserves that pay them", () => {
    const groups = destinationReserveGroups(executableRoutes(chains()));
    expect(groups.map((group) => [group.reserve, group.routes.map((r) => r.id)])).toEqual(
      [
        ["solana", ["GlcToSol"]],
        ["goldcoin", ["SolToGlc", "RhnToGlc"]],
        ["robinhood", ["GlcToRhn"]],
      ],
    );
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

  it("is stable in order, so a card does not move when a route closes", () => {
    const groups = destinationReserveGroups(["GlcToRhn", "GlcToSol", "SolToGlc"]);
    expect(groups.map((group) => group.reserve)).toEqual([
      "robinhood",
      "solana",
      "goldcoin",
    ]);
  });
});
