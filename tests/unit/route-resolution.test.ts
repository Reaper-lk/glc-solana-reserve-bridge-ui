import { describe, expect, it } from "vitest";
import {
  destinationsFor,
  isDefinedPair,
  resolveRoute,
  routeForPair,
  routesTouchingChain,
  sourceChainIds,
} from "@/lib/bridge/route-resolution";

/**
 * The single seam where a pair of networks becomes a backend route.
 *
 * This is the highest-stakes pure function in the redesigned UI: it turns
 * a presentation choice into a claim about which chain someone's money
 * comes out on. The tests below exist mainly to pin the NEGATIVE cases —
 * an unrecognised pair must never resolve to a route that happens to
 * exist, because that would pay a Robinhood-bound deposit out on Solana.
 */

describe("resolveRoute — the six defined pairs", () => {
  it.each([
    ["goldcoin", "solana", "GlcToSol"],
    ["solana", "goldcoin", "SolToGlc"],
    ["goldcoin", "robinhood", "GlcToRhn"],
    ["robinhood", "goldcoin", "RhnToGlc"],
    ["solana", "robinhood", "SolToRhn"],
    ["robinhood", "solana", "RhnToSol"],
  ])("%s -> %s resolves %s", (source, destination, expected) => {
    expect(resolveRoute(source, destination)).toEqual({ kind: "route", route: expected });
  });

  it("resolves the two cross routes like any other — resolution is not permission", () => {
    // Resolving a pair says nothing about whether it is open, and nothing
    // about whether this app can start it. Availability is `GET /chains`'
    // answer alone; startability is `route-execution`'s.
    expect(routeForPair("solana", "robinhood")).toBe("SolToRhn");
    expect(routeForPair("robinhood", "solana")).toBe("RhnToSol");
  });
});

describe("routesTouchingChain", () => {
  it("names every route with that network on either side", () => {
    // Four for Robinhood — the two Goldcoin-paired and the two cross
    // routes. Consumers scoped to one network read this instead of each
    // keeping their own list and each going stale on its own.
    // Table order: rows are walked source-first, so `GlcToRhn` (from
    // goldcoin) precedes `SolToRhn` (from solana), which precedes the two
    // sourced from Robinhood itself.
    expect([...routesTouchingChain("robinhood")]).toEqual([
      "GlcToRhn",
      "SolToRhn",
      "RhnToGlc",
      "RhnToSol",
    ]);
    expect([...routesTouchingChain("solana")]).toEqual([
      "GlcToSol",
      "SolToGlc",
      "SolToRhn",
      "RhnToSol",
    ]);

    expect([...routesTouchingChain("goldcoin")]).toEqual([
      "GlcToSol",
      "GlcToRhn",
      "SolToGlc",
      "RhnToGlc",
    ]);
  });

  it("covers both directions, never only the outbound half", () => {
    // The mistake this guards: filtering on `source === chainId`, which
    // would have reported two Robinhood routes instead of four and left the
    // integration strip speaking for half the integration.
    for (const chain of ["goldcoin", "solana", "robinhood"]) {
      expect(routesTouchingChain(chain)).toHaveLength(4);
    }
  });

  it("returns nothing for a network it has never heard of", () => {
    expect(routesTouchingChain("ethereum")).toEqual([]);
  });
});

describe("resolveRoute — failing closed", () => {
  it("refuses a same-network pair", () => {
    // This bridge moves GLC BETWEEN networks. Treating a self-pair as a
    // no-op would be a transfer that charges a fee for nothing.
    for (const chain of ["goldcoin", "solana", "robinhood"]) {
      expect(resolveRoute(chain, chain)).toEqual({ kind: "same-chain" });
    }
  });

  it("refuses a pair naming a network it has never heard of", () => {
    expect(resolveRoute("goldcoin", "ethereum")).toEqual({ kind: "undefined-pair" });
    expect(resolveRoute("ethereum", "goldcoin")).toEqual({ kind: "undefined-pair" });
    expect(resolveRoute("ethereum", "base")).toEqual({ kind: "undefined-pair" });
  });

  it("NEVER falls back to an existing route for an undefined pair", () => {
    // The single most dangerous possible behaviour in this module: a
    // default arm would route an unrecognised pair's deposit onto whatever
    // chain that route settles on.
    for (const pair of [
      ["ethereum", "solana"],
      ["goldcoin", ""],
      ["", "goldcoin"],
      ["GOLDCOIN", "solana"],
      ["goldcoin ", "solana"],
    ] as const) {
      expect(routeForPair(pair[0], pair[1])).toBeNull();
    }
  });

  it("is case- and whitespace-sensitive, matching the backend's own chain ids", () => {
    // The ids are wire identifiers, not display names. Accepting a
    // near-miss would mean guessing which network was meant.
    expect(routeForPair("Goldcoin", "Solana")).toBeNull();
    expect(routeForPair("goldcoin", " solana")).toBeNull();
  });
});

describe("isDefinedPair", () => {
  it("reports the reverse of every defined route as defined", () => {
    // What the direction switch is gated on: reversing must land on a pair
    // a route describes, though very often a closed one.
    expect(isDefinedPair("solana", "goldcoin")).toBe(true);
    expect(isDefinedPair("robinhood", "goldcoin")).toBe(true);
    expect(isDefinedPair("robinhood", "solana")).toBe(true);
  });

  it("is false for a same-network or unknown pair", () => {
    expect(isDefinedPair("solana", "solana")).toBe(false);
    expect(isDefinedPair("solana", "ethereum")).toBe(false);
  });
});

describe("destinationsFor", () => {
  it("lists every destination reachable from a source", () => {
    expect([...destinationsFor("goldcoin")].sort()).toEqual(["robinhood", "solana"]);
    expect([...destinationsFor("solana")].sort()).toEqual(["goldcoin", "robinhood"]);
    expect([...destinationsFor("robinhood")].sort()).toEqual(["goldcoin", "solana"]);
  });

  it("returns nothing for an unknown network rather than throwing", () => {
    expect(destinationsFor("ethereum")).toEqual([]);
  });
});

describe("sourceChainIds", () => {
  it("covers every network with an outbound route", () => {
    expect([...sourceChainIds()].sort()).toEqual(["goldcoin", "robinhood", "solana"]);
  });

  it("adding a network is a table entry, not a UI change", () => {
    // A guard on the shape of the design rather than its contents: every
    // source must be reachable as a destination from somewhere, or the
    // selector would offer a network no one can bridge to.
    for (const source of sourceChainIds()) {
      const reachable = sourceChainIds().some((other) =>
        destinationsFor(other).includes(source),
      );
      expect(reachable).toBe(true);
    }
  });
});
