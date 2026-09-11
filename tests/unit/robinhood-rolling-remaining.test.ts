import { describe, expect, it } from "vitest";
import {
  ROBINHOOD_DECIMALS,
  robinhoodPerTransferMinimum,
  robinhoodRollingRemaining,
} from "@/lib/bridge";
import { robinhoodLimitsSchema } from "@/lib/api/schemas/robinhood";
import type { RobinhoodLimitsDto } from "@/lib/api/schemas/robinhood";
import * as fixtures from "@/lib/api/mock/fixtures";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";

/**
 * The two halves of "Min X GLC · Max Y GLC · Z GLC remaining today" that
 * the per-transfer maximum did not already cover: the FLOOR and the
 * rolling REMAINDER, on both Robinhood routes.
 *
 * # What each is, and why they are not symmetric
 *
 * `GlcRobinhoodBridge` keeps one accumulator per direction and charges it
 * the amount IT sees. On `RhnToGlc` that is the deposit — exactly what the
 * user types, because the bridge fee is taken later on the Goldcoin side.
 * On `GlcToRhn` it is the NET payout, after this route's fee. So the
 * deposit leg's figures apply as-is and the payout leg's floor has to be
 * grossed up, or the form would invite an amount the contract reverts with
 * `AmountBelowMinimum`.
 *
 * # Nothing here is hardcoded
 *
 * No 100, no 20,000, no 5,000,000. Every expectation is derived from the
 * DTO handed in — by independent bigint arithmetic, not by calling the
 * function under test twice — so a limit or fee change on chain reaches the
 * screen without a UI release, and a regression in the derivation shows up
 * as a failure rather than as two wrong numbers agreeing.
 */

/** 18dp Robinhood units for a whole number of GLC. */
function glc18(whole: bigint): string {
  return (whole * 10n ** BigInt(ROBINHOOD_DECIMALS)).toString();
}

/** 8dp canonical units for a whole number of GLC. */
function glc8(whole: bigint): string {
  return (whole * 10n ** BigInt(GOLDCOIN_DECIMALS)).toString();
}

/**
 * The smallest canonical GROSS whose net clears `minNetCanonical`, worked
 * out by brute search rather than by algebra.
 *
 * This is the independent oracle for the payout leg. The production helper
 * binary-searches the same predicate; a search here would share its bug, so
 * this walks upward from the continuous-algebra answer minus a margin and
 * takes the first gross that qualifies.
 */
function smallestGrossClearing(minNetCanonical: bigint, feeBps: bigint): bigint {
  const net = (gross: bigint) => gross - (gross * feeBps) / 10_000n;
  let candidate = (minNetCanonical * 10_000n) / (10_000n - feeBps) - 10n;
  if (candidate < 0n) candidate = 0n;
  for (let i = 0n; i < 1_000n; i += 1n) {
    if (net(candidate + i) >= minNetCanonical) return candidate + i;
  }
  throw new Error("no gross clears the floor within the search window");
}

/**
 * Every figure deliberately DIFFERENT between the two directions.
 *
 * A real deployment holds one `per_transfer_limit` in both, and the same
 * rolling limit in both — but a fixture that agreed would let a crossed
 * inbound/outbound mapping pass every assertion below. The divergence is
 * the only thing that can catch it.
 */
function limitsWith(overrides: Partial<RobinhoodLimitsDto> = {}): RobinhoodLimitsDto {
  return robinhoodLimitsSchema.parse({
    availability: "available",
    inbound_min_atomic: glc18(100n),
    inbound_max_atomic: glc18(20_000n),
    inbound_rolling_limit_atomic: glc18(100_000n),
    outbound_min_atomic: glc18(250n),
    outbound_max_atomic: glc18(15_000n),
    outbound_rolling_limit_atomic: glc18(70_000n),
    protected_min_reserve_atomic: glc18(50_000n),
    rolling_window_seconds: 86_400,
    rhn_to_glc_rolling_window: {
      limit_atomic: glc18(100_000n),
      used_atomic: glc18(12_000n),
      remaining_atomic: glc18(88_000n),
      resets_at: 1_700_043_200,
      is_current: true,
    },
    glc_to_rhn_rolling_window: {
      limit_atomic: glc18(70_000n),
      used_atomic: glc18(31_000n),
      remaining_atomic: glc18(39_000n),
      resets_at: 1_700_043_200,
      is_current: true,
    },
    bridge_fee_bps: 300,
    // The two routes are priced separately backend-side, so they are
    // priced differently here: a minimum computed with the wrong route's
    // fee must be visibly wrong, not coincidentally right.
    glc_to_rhn_fee_bps: 250,
    rhn_to_glc_fee_bps: 300,
    as_of: 1_700_000_000,
    ...overrides,
  });
}

describe("robinhoodPerTransferMinimum — RhnToGlc (the deposit leg)", () => {
  it("is inboundMin as-is, because the deposit is what the user types", () => {
    // `deposit()` checks `amount < inboundMin` against the tokens
    // transferred in. Source IS Robinhood, so 18dp in, 18dp out, and the
    // fee — charged later at fold time — does not enter.
    expect(robinhoodPerTransferMinimum("deposit", limitsWith(), ROBINHOOD_DECIMALS)).toBe(
      glc18(100n),
    );
  });

  it("does not read the payout leg's floor", () => {
    expect(
      robinhoodPerTransferMinimum("deposit", limitsWith(), ROBINHOOD_DECIMALS),
    ).not.toBe(glc18(250n));
  });

  it("is not adjusted by this route's fee", () => {
    // The guard against "grossed up both legs for symmetry". Charging a
    // fee this leg does not charge would publish a floor above the
    // contract's, refusing amounts it would have accepted.
    const raw = limitsWith();
    const unadjusted = robinhoodPerTransferMinimum("deposit", raw, ROBINHOOD_DECIMALS);
    const doubledFee = limitsWith({ rhn_to_glc_fee_bps: 2_500 });
    expect(robinhoodPerTransferMinimum("deposit", doubledFee, ROBINHOOD_DECIMALS)).toBe(
      unadjusted,
    );
  });
});

describe("robinhoodPerTransferMinimum — GlcToRhn (the payout leg)", () => {
  it("is the smallest GROSS whose net clears outboundMin", () => {
    // `executePayout` checks `req.amount < outboundMin` against the NET.
    // Publishing outboundMin raw is the "Min 99 GLC" bug: a user enters
    // it, this service prices it, and the chain reverts the payout.
    const limits = limitsWith();
    const expected = smallestGrossClearing(BigInt(glc8(250n)), 250n);
    expect(robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS)).toBe(
      expected.toString(),
    );
    // And it really is ABOVE the raw floor — otherwise the assertion
    // above would pass on a helper that did nothing.
    expect(expected).toBeGreaterThan(BigInt(glc8(250n)));
  });

  it("prices the gross-up with GlcToRhn's own fee, not the other route's", () => {
    const limits = limitsWith();
    const wrongFee = smallestGrossClearing(BigInt(glc8(250n)), 300n);
    expect(robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS)).not.toBe(
      wrongFee.toString(),
    );
  });

  it("moves with the fee, so a rate change needs no UI release", () => {
    const cheaper = limitsWith({ glc_to_rhn_fee_bps: 100 });
    const dearer = limitsWith({ glc_to_rhn_fee_bps: 900 });
    const cheap = robinhoodPerTransferMinimum("payout", cheaper, GOLDCOIN_DECIMALS)!;
    const dear = robinhoodPerTransferMinimum("payout", dearer, GOLDCOIN_DECIMALS)!;
    expect(BigInt(dear)).toBeGreaterThan(BigInt(cheap));
  });

  it("clears the floor when run back through the fee", () => {
    // The property that matters, stated directly: whatever the helper
    // returns must actually survive `compute_fee` on the backend.
    for (const feeBps of [0, 1, 100, 250, 300, 600, 900, 4_999]) {
      const limits = limitsWith({ glc_to_rhn_fee_bps: feeBps });
      const gross = BigInt(
        robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS)!,
      );
      const net = gross - (gross * BigInt(feeBps)) / 10_000n;
      expect(net).toBeGreaterThanOrEqual(BigInt(glc8(250n)));
      // And it is the SMALLEST such gross — one unit less must fail.
      const under = gross - 1n;
      expect(under - (under * BigInt(feeBps)) / 10_000n).toBeLessThan(BigInt(glc8(250n)));
    }
  });

  it("does not read the deposit leg's floor", () => {
    const limits = limitsWith();
    expect(robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS)).not.toBe(
      glc8(100n),
    );
  });

  it("reports unknown rather than throwing on a fee at or above 100%", () => {
    // No gross clears any floor at a 100% rate, and the search refuses
    // the input. A misconfigured backend must blank the figure, not throw
    // inside a render and take the whole form down.
    for (const feeBps of [10_000, 12_000]) {
      const limits = limitsWith({ glc_to_rhn_fee_bps: feeBps });
      expect(() =>
        robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS),
      ).not.toThrow();
      expect(
        robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS),
      ).toBeUndefined();
    }
    // The deposit leg is unaffected: it never consults a fee.
    const limits = limitsWith({ glc_to_rhn_fee_bps: 10_000 });
    expect(robinhoodPerTransferMinimum("deposit", limits, ROBINHOOD_DECIMALS)).toBe(
      glc18(100n),
    );
  });
});

describe("robinhoodRollingRemaining — which window bounds which route", () => {
  it("RhnToGlc reads the inbound accumulator the backend names for it", () => {
    // Source IS Robinhood: 18dp in, 18dp out.
    expect(robinhoodRollingRemaining("deposit", limitsWith(), ROBINHOOD_DECIMALS)).toBe(
      glc18(88_000n),
    );
  });

  it("GlcToRhn reads the outbound accumulator, narrowed to canonical 8dp", () => {
    expect(robinhoodRollingRemaining("payout", limitsWith(), GOLDCOIN_DECIMALS)).toBe(
      glc8(39_000n),
    );
  });

  it("never crosses the two windows over", () => {
    const limits = limitsWith();
    expect(robinhoodRollingRemaining("deposit", limits, ROBINHOOD_DECIMALS)).not.toBe(
      glc18(39_000n),
    );
    expect(robinhoodRollingRemaining("payout", limits, GOLDCOIN_DECIMALS)).not.toBe(
      glc8(88_000n),
    );
  });

  it("reports what the backend computed, never limit minus used re-derived here", () => {
    // A backend that saturated, rolled a bucket over, or applied any rule
    // this UI does not know about must win. Given a window whose
    // `remaining_atomic` deliberately disagrees with `limit - used`, the
    // published remainder is what shows.
    const limits = limitsWith({
      glc_to_rhn_rolling_window: {
        limit_atomic: glc18(70_000n),
        used_atomic: glc18(31_000n),
        // An expired bucket: the backend reports the WHOLE limit, because
        // `_consumeWindow` resets it on its next write.
        remaining_atomic: glc18(70_000n),
        resets_at: 1_700_043_200,
        is_current: false,
      },
    });
    expect(robinhoodRollingRemaining("payout", limits, GOLDCOIN_DECIMALS)).toBe(
      glc8(70_000n),
    );
  });

  it("FLOORS a sub-canonical remainder rather than rounding it up", () => {
    const limits = limitsWith({
      glc_to_rhn_rolling_window: {
        limit_atomic: glc18(70_000n),
        used_atomic: "0",
        remaining_atomic: (10n ** 18n + 1n).toString(),
        resets_at: 1_700_043_200,
        is_current: true,
      },
    });
    expect(robinhoodRollingRemaining("payout", limits, GOLDCOIN_DECIMALS)).toBe(
      "100000000",
    );
  });

  it("publishes nothing for a pair with no Robinhood leg", () => {
    expect(
      robinhoodRollingRemaining(null, limitsWith(), GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });
});

describe("unknown stays unknown, on both new figures", () => {
  it("is undefined before the query has answered", () => {
    expect(
      robinhoodPerTransferMinimum("payout", undefined, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
    expect(
      robinhoodRollingRemaining("payout", undefined, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("is undefined when the contract could not be read", () => {
    const limits = limitsWith({
      availability: "unavailable",
      inbound_min_atomic: null,
      outbound_min_atomic: null,
      rhn_to_glc_rolling_window: null,
      glc_to_rhn_rolling_window: null,
    });
    for (const leg of ["deposit", "payout"] as const) {
      expect(robinhoodPerTransferMinimum(leg, limits, GOLDCOIN_DECIMALS)).toBeUndefined();
      expect(robinhoodRollingRemaining(leg, limits, GOLDCOIN_DECIMALS)).toBeUndefined();
    }
  });

  it("fails CLOSED on an availability spelling this build does not know", () => {
    // The figures are left non-null so the verdict is the only thing
    // under test. A fourth backend constant must never publish them.
    const limits = limitsWith({ availability: "degraded" });
    expect(
      robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
    expect(
      robinhoodRollingRemaining("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("treats an omitted window as unknown, not as an exhausted one", () => {
    // A backend too old to publish these sends no key at all. Zero would
    // claim the route is out of capacity for the day; undefined blanks
    // the figure and leaves Min/Max alone, which is what the form needs
    // when the two repos deploy in either order.
    const { rhn_to_glc_rolling_window, glc_to_rhn_rolling_window, ...rest } =
      limitsWith();
    void rhn_to_glc_rolling_window;
    void glc_to_rhn_rolling_window;
    const older = robinhoodLimitsSchema.parse(rest);
    expect(
      robinhoodRollingRemaining("deposit", older, ROBINHOOD_DECIMALS),
    ).toBeUndefined();
    expect(robinhoodRollingRemaining("payout", older, GOLDCOIN_DECIMALS)).toBeUndefined();
    // The bounds are unaffected: an absent window blanks one part of the
    // line, not the whole of it.
    expect(robinhoodPerTransferMinimum("deposit", older, ROBINHOOD_DECIMALS)).toBe(
      glc18(100n),
    );
  });

  it("is undefined when one field alone is null under an available verdict", () => {
    const limits = limitsWith({ outbound_min_atomic: null });
    expect(
      robinhoodPerTransferMinimum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
    // One null does not blank the other direction.
    expect(robinhoodPerTransferMinimum("deposit", limits, ROBINHOOD_DECIMALS)).toBe(
      glc18(100n),
    );
  });
});

describe("the mock backend's own limits fixture", () => {
  it("publishes a window for each route when the contract is readable", () => {
    const limits = robinhoodLimitsSchema.parse(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
    );
    expect(limits.rhn_to_glc_rolling_window).not.toBeNull();
    expect(limits.glc_to_rhn_rolling_window).not.toBeNull();
    // Unequal, so a crossed mapping cannot look right in mock mode.
    expect(limits.rhn_to_glc_rolling_window?.remaining_atomic).not.toBe(
      limits.glc_to_rhn_rolling_window?.remaining_atomic,
    );
  });

  it("publishes no window on a deployment with no Robinhood contract", () => {
    const closed = robinhoodLimitsSchema.parse(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    expect(closed.availability).toBe("not_configured");
    expect(closed.rhn_to_glc_rolling_window).toBeNull();
    expect(closed.glc_to_rhn_rolling_window).toBeNull();
  });
});
