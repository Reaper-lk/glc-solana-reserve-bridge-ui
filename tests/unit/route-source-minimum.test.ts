import { describe, expect, it } from "vitest";
import { ROBINHOOD_DECIMALS, routeSourceMinimum } from "@/lib/bridge";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import * as fixtures from "@/lib/api/mock/fixtures";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";

/**
 * The source-side minimum, as the UI resolves it.
 *
 * # The rule this file pins
 *
 * ONE policy floor, identical on every route, published by the backend as
 * `GET /chains`' `min_transfer_atomic` and rendered without adjustment.
 * The bridge fee is deducted AFTER the backend checks it, so a minimum
 * transfer delivers less than the minimum — that is the policy working.
 *
 * # What it is guarding against
 *
 * Three successive versions of this number were wrong, each fix causing
 * the next bug: a chain's NET-side floor shown as an entry minimum ("Min
 * 99 GLC"); a fixed constant tuned to a fee that then changed; and a
 * fee-aware derivation that was arithmetically correct against a rule
 * that never was ("102.061856 GLC", and later "102.56410256 GLC" on the
 * Robinhood payout leg). The common thread is the UI computing a floor.
 * It no longer computes one, and these tests fail if it starts again.
 *
 * Nothing here writes the policy figure as a literal — every expectation
 * derives from the fixture, so a policy change reaches the screen with no
 * UI release.
 */

const OPEN = () =>
  chainsViewSchema.parse(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );

/** Canonical 8dp units for a whole number of GLC. */
function glc8(whole: bigint): string {
  return (whole * 10n ** BigInt(GOLDCOIN_DECIMALS)).toString();
}

/** 18dp Robinhood units for a whole number of GLC. */
function glc18(whole: bigint): string {
  return (whole * 10n ** BigInt(ROBINHOOD_DECIMALS)).toString();
}

/** Every route, as the (source, destination) chain pair it joins. */
const EVERY_ROUTE = [
  ["GlcToSol", "goldcoin", "solana"],
  ["SolToGlc", "solana", "goldcoin"],
  ["GlcToRhn", "goldcoin", "robinhood"],
  ["RhnToGlc", "robinhood", "goldcoin"],
  ["SolToRhn", "solana", "robinhood"],
  ["RhnToSol", "robinhood", "solana"],
] as const;

/** `routeSourceMinimum` for one named route, looked up by its pair. */
function minimumFor(
  chains: ChainsViewDto | undefined,
  route: (typeof EVERY_ROUTE)[number][0],
  decimals: number,
): string | undefined {
  const pair = EVERY_ROUTE.find(([id]) => id === route);
  if (!pair) throw new Error(`unknown route ${route}`);
  return routeSourceMinimum(chains, pair[1], pair[2], decimals);
}

describe("routeSourceMinimum — one rule, every route", () => {
  it("publishes the same floor for all six routes", () => {
    const chains = OPEN();
    for (const [route] of EVERY_ROUTE) {
      expect(minimumFor(chains, route, GOLDCOIN_DECIMALS)).toBe(
        fixtures.SOURCE_MINIMUM_ATOMIC,
      );
    }
  });

  it("is the backend's figure, not one derived from any chain limit", () => {
    // The Solana program's own floor and the Robinhood contract's are both
    // in the fixtures and are both DIFFERENT numbers. Neither may leak
    // into this answer.
    const chains = OPEN();
    const solanaFloor = fixtures.limitsFixture().min_transfer_amount;
    expect(minimumFor(chains, "GlcToSol", GOLDCOIN_DECIMALS)).not.toBe(solanaFloor);
    const robinhood = fixtures.robinhoodLimitsFixture(() => new Date(), { open: true });
    expect(minimumFor(chains, "GlcToRhn", GOLDCOIN_DECIMALS)).not.toBe(
      robinhood.outbound_min_atomic,
    );
  });

  /**
   * The regression that matters most. A fee-aware minimum would move when
   * the rate did; this one must not, because the fee is charged after the
   * check.
   */
  it("does not move with the bridge fee", () => {
    const chains = OPEN();
    const before = minimumFor(chains, "GlcToRhn", GOLDCOIN_DECIMALS);
    // The fixture prices the two Robinhood routes differently from the
    // Solana ones and from each other; the floor is the same on all of
    // them regardless.
    expect(fixtures.ROBINHOOD_FEE_BPS).not.toBe(fixtures.BRIDGE_FEE_BPS);
    for (const [route] of EVERY_ROUTE) {
      expect(minimumFor(chains, route, GOLDCOIN_DECIMALS)).toBe(before);
    }
  });
});

describe("routeSourceMinimum — units", () => {
  it("widens exactly to Robinhood's 18 decimals", () => {
    const chains = OPEN();
    const whole =
      BigInt(fixtures.SOURCE_MINIMUM_ATOMIC) / 10n ** BigInt(GOLDCOIN_DECIMALS);
    expect(minimumFor(chains, "RhnToGlc", ROBINHOOD_DECIMALS)).toBe(glc18(whole));
  });

  it("passes canonical through unchanged for a Goldcoin source", () => {
    const chains = OPEN();
    const whole =
      BigInt(fixtures.SOURCE_MINIMUM_ATOMIC) / 10n ** BigInt(GOLDCOIN_DECIMALS);
    expect(minimumFor(chains, "GlcToSol", GOLDCOIN_DECIMALS)).toBe(glc8(whole));
  });

  it("CEILS when narrowing, so a rounded floor is never below the backend's", () => {
    // A floor that is not representable at the source chain's coarser
    // precision must round UP. Rounding down would admit an amount the
    // backend refuses — the one direction a minimum may never move.
    const chains = OPEN();
    const withRemainder: ChainsViewDto = {
      ...chains,
      routes: chains.routes.map((r) =>
        r.id === "SolToGlc" ? { ...r, min_transfer_atomic: "10000000001" } : r,
      ),
    };
    // 6-decimal mint precision: 100.00000001 -> 100.000001, not 100.000000.
    expect(minimumFor(withRemainder, "SolToGlc", 6)).toBe("100000001");
  });
});

describe("routeSourceMinimum — unknown stays unknown", () => {
  it("is undefined while GET /chains is still in flight", () => {
    expect(minimumFor(undefined, "GlcToSol", GOLDCOIN_DECIMALS)).toBeUndefined();
  });

  it("is undefined for a route the response does not carry", () => {
    const chains = OPEN();
    const without: ChainsViewDto = {
      ...chains,
      routes: chains.routes.filter((r) => r.id !== "GlcToRhn"),
    };
    expect(minimumFor(without, "GlcToRhn", GOLDCOIN_DECIMALS)).toBeUndefined();
    // The other routes are unaffected.
    expect(minimumFor(without, "GlcToSol", GOLDCOIN_DECIMALS)).toBe(
      fixtures.SOURCE_MINIMUM_ATOMIC,
    );
  });

  it("is undefined for a pair no route joins", () => {
    expect(
      routeSourceMinimum(OPEN(), "solana", "solana", GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  /**
   * A backend predating the field omits it. That must read as "not
   * published" and leave the minimum absent — never as `0`, which would
   * claim the route has no floor. This is what lets the two repos deploy
   * in either order.
   */
  it("is undefined on a backend that does not publish the field", () => {
    const chains = OPEN();
    const older = chainsViewSchema.parse({
      ...chains,
      routes: chains.routes.map((r) => {
        const { min_transfer_atomic, ...rest } = r;
        void min_transfer_atomic;
        return rest;
      }),
    });
    for (const [route] of EVERY_ROUTE) {
      expect(minimumFor(older, route, GOLDCOIN_DECIMALS)).toBeUndefined();
    }
  });
});
