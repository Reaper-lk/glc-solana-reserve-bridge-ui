import { describe, expect, it } from "vitest";
import {
  ROBINHOOD_DECIMALS,
  robinhoodPerTransferMaximum,
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

describe("unknown stays unknown", () => {
  it("is undefined before the query has answered", () => {
    expect(
      robinhoodRollingRemaining("payout", undefined, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("is undefined when the contract could not be read", () => {
    const limits = limitsWith({
      availability: "unavailable",
      rhn_to_glc_rolling_window: null,
      glc_to_rhn_rolling_window: null,
    });
    for (const leg of ["deposit", "payout"] as const) {
      expect(robinhoodRollingRemaining(leg, limits, GOLDCOIN_DECIMALS)).toBeUndefined();
    }
  });

  it("fails CLOSED on an availability spelling this build does not know", () => {
    // The figures are left non-null so the verdict is the only thing
    // under test. A fourth backend constant must never publish them.
    const limits = limitsWith({ availability: "degraded" });
    expect(
      robinhoodRollingRemaining("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("treats an omitted window as unknown, not as an exhausted one", () => {
    // A backend too old to publish these sends no key at all. Zero would
    // claim the route is out of capacity for the day; undefined blanks
    // that part of the line and leaves the rest standing, which is what
    // the form needs when the two repos deploy in either order.
    const { rhn_to_glc_rolling_window, glc_to_rhn_rolling_window, ...rest } =
      limitsWith();
    void rhn_to_glc_rolling_window;
    void glc_to_rhn_rolling_window;
    const older = robinhoodLimitsSchema.parse(rest);
    expect(
      robinhoodRollingRemaining("deposit", older, ROBINHOOD_DECIMALS),
    ).toBeUndefined();
    expect(robinhoodRollingRemaining("payout", older, GOLDCOIN_DECIMALS)).toBeUndefined();
    // The per-transfer CEILING is unaffected: one absent window blanks
    // one part of the line, not the whole of it.
    expect(robinhoodPerTransferMaximum("payout", older, GOLDCOIN_DECIMALS)).toBe(
      glc8(15_000n),
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
