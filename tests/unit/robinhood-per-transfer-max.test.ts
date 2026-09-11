import { describe, expect, it } from "vitest";
import {
  CHAIN_DESCRIPTORS,
  robinhoodContractLeg,
  robinhoodPerTransferMaximum,
  routeForPair,
} from "@/lib/bridge";
import { robinhoodLimitsSchema } from "@/lib/api/schemas/robinhood";
import type { RobinhoodLimitsDto } from "@/lib/api/schemas/robinhood";
import * as fixtures from "@/lib/api/mock/fixtures";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge";

/**
 * The Robinhood per-transaction maximum, as the form resolves it.
 *
 * The bug this file exists to prevent is specific: the bridge form showed
 * "Min … · Max …" for the Solana pairs and NOTHING for a Robinhood route,
 * because `GET /limits` describes the Solana program and the form
 * (correctly) refused to relabel it. The fix reads the real ceiling from
 * `GET /robinhood/limits`. These tests pin that it comes from there, that
 * each route reads its OWN direction's field, and that an unread contract
 * still produces no number rather than an invented one.
 *
 * Nothing here hardcodes 20,000. Every expectation is derived from the
 * DTO handed in, which is how a limit change on chain reaches the screen
 * without a UI release.
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
 * Deliberately UNEQUAL inbound and outbound maxima.
 *
 * A real deployment must hold the same number in both — one configured
 * `per_transfer_limit`, checked against both fields by
 * `glc-admin robinhood-preflight`. Splitting them here is the only way to
 * prove each route reads its own field: with equal values, a helper that
 * always returned `inboundMax` would pass every assertion.
 */
function limitsWith(overrides: Partial<RobinhoodLimitsDto> = {}): RobinhoodLimitsDto {
  return robinhoodLimitsSchema.parse({
    availability: "available",
    inbound_min_atomic: glc18(100n),
    inbound_max_atomic: glc18(20_000n),
    inbound_rolling_limit_atomic: glc18(100_000n),
    outbound_min_atomic: glc18(100n),
    outbound_max_atomic: glc18(15_000n),
    outbound_rolling_limit_atomic: glc18(100_000n),
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
      limit_atomic: glc18(100_000n),
      used_atomic: glc18(31_000n),
      remaining_atomic: glc18(69_000n),
      resets_at: 1_700_043_200,
      is_current: true,
    },
    bridge_fee_bps: 300,
    glc_to_rhn_fee_bps: 250,
    rhn_to_glc_fee_bps: 300,
    as_of: 1_700_000_000,
    ...overrides,
  });
}

describe("robinhoodContractLeg — and its agreement with resolveRoute", () => {
  it("maps every pair with Robinhood as SOURCE to the deposit leg", () => {
    // Into the contract, bounded by `inboundMax` and charged against the
    // inbound window — whichever reserve eventually pays the route out.
    expect(robinhoodContractLeg("robinhood", "goldcoin")).toBe("deposit");
    expect(robinhoodContractLeg("robinhood", "solana")).toBe("deposit");
  });

  it("maps every pair with Robinhood as DESTINATION to the payout leg", () => {
    expect(robinhoodContractLeg("goldcoin", "robinhood")).toBe("payout");
    expect(robinhoodContractLeg("solana", "robinhood")).toBe("payout");
  });

  it("claims no leg for a pair that touches the contract on neither side", () => {
    expect(robinhoodContractLeg("goldcoin", "solana")).toBeNull();
    expect(robinhoodContractLeg("solana", "goldcoin")).toBeNull();
  });

  it("claims no leg for a same-network pair", () => {
    // There is no self-route to bound, and Robinhood on both sides must not
    // read as a deposit just because the source matches.
    expect(robinhoodContractLeg("robinhood", "robinhood")).toBeNull();
  });

  /**
   * The drift guard.
   *
   * `BridgeForm` derives the contract leg from the two chain ids rather
   * than from its resolved route — a React Compiler constraint, documented
   * where it happens. That makes this the SECOND statement in the codebase
   * of which pair is which, and this test is what stops the two from
   * disagreeing: for every pair the form can put in its selectors, a leg
   * exists exactly when `resolveRoute` answers with a Robinhood route, and
   * names the side that route touches.
   */
  it("agrees with resolveRoute on every pair the form can reach", () => {
    const ids = CHAIN_DESCRIPTORS.map((chain) => chain.id);
    expect(ids.length).toBeGreaterThan(2);
    /** The leg each route touches, stated independently of the function under test. */
    const LEG_BY_ROUTE: Record<string, "deposit" | "payout" | null> = {
      GlcToSol: null,
      SolToGlc: null,
      RhnToGlc: "deposit",
      RhnToSol: "deposit",
      GlcToRhn: "payout",
      SolToRhn: "payout",
    };
    for (const source of ids) {
      for (const destination of ids) {
        const route = routeForPair(source, destination);
        const expected = route === null ? null : LEG_BY_ROUTE[route];
        expect(robinhoodContractLeg(source, destination)).toBe(expected);
      }
    }
  });
});

describe("robinhoodPerTransferMaximum — which field bounds which leg", () => {
  it("the deposit leg (RhnToGlc) reads inboundMax", () => {
    // Source IS Robinhood, so 18dp in and 18dp out: no conversion.
    expect(robinhoodPerTransferMaximum("deposit", limitsWith(), ROBINHOOD_DECIMALS)).toBe(
      glc18(20_000n),
    );
  });

  it("the payout leg (GlcToRhn) reads outboundMax", () => {
    // Source is Goldcoin, so the 18dp figure narrows to canonical 8dp.
    expect(robinhoodPerTransferMaximum("payout", limitsWith(), GOLDCOIN_DECIMALS)).toBe(
      glc8(15_000n),
    );
  });

  it("never crosses the two legs over", () => {
    const limits = limitsWith();
    expect(robinhoodPerTransferMaximum("deposit", limits, ROBINHOOD_DECIMALS)).not.toBe(
      glc18(15_000n),
    );
    expect(robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS)).not.toBe(
      glc8(20_000n),
    );
  });

  it("publishes nothing for a pair with no Robinhood leg", () => {
    expect(
      robinhoodPerTransferMaximum(null, limitsWith(), GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });
});

describe("robinhoodPerTransferMaximum — units", () => {
  it("narrows 18dp to canonical 8dp by exactly the 10^10 factor", () => {
    const limits = limitsWith({ outbound_max_atomic: glc18(1n) });
    expect(robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS)).toBe(
      "100000000",
    );
  });

  it("FLOORS a sub-canonical remainder rather than rounding it up", () => {
    // 1 GLC plus one 18dp wei: not representable at 8dp. Rounding up
    // would publish a ceiling one canonical unit above the contract's.
    const limits = limitsWith({
      outbound_max_atomic: (10n ** 18n + 1n).toString(),
    });
    expect(robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS)).toBe(
      "100000000",
    );
  });
});

describe("robinhoodPerTransferMaximum — unknown stays unknown", () => {
  it("is undefined before the query has answered", () => {
    expect(
      robinhoodPerTransferMaximum("payout", undefined, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("is undefined when the contract could not be read", () => {
    // `availability: "unavailable"` — every figure null. Not zero.
    const limits = limitsWith({
      availability: "unavailable",
      inbound_max_atomic: null,
      outbound_max_atomic: null,
    });
    expect(
      robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
    expect(
      robinhoodPerTransferMaximum("deposit", limits, ROBINHOOD_DECIMALS),
    ).toBeUndefined();
  });

  it("is undefined on a deployment with no Robinhood contract at all", () => {
    const limits = robinhoodLimitsSchema.parse(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    expect(limits.availability).toBe("not_configured");
    expect(
      robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("fails CLOSED on an availability spelling this build does not know", () => {
    // A fourth backend constant must read as "not available", never as
    // "available" — the figures beside it would then be published as
    // real. The maxima are left non-null so the only thing under test is
    // the verdict.
    const limits = limitsWith({ availability: "degraded" });
    expect(
      robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
  });

  it("is undefined when the field alone is null under an available verdict", () => {
    const limits = limitsWith({ outbound_max_atomic: null });
    expect(
      robinhoodPerTransferMaximum("payout", limits, GOLDCOIN_DECIMALS),
    ).toBeUndefined();
    // The other direction is unaffected — one null does not blank both.
    expect(robinhoodPerTransferMaximum("deposit", limits, ROBINHOOD_DECIMALS)).toBe(
      glc18(20_000n),
    );
  });
});

describe("the mock backend's own limits fixture", () => {
  it("holds ONE per-transfer limit in both directions, as preflight requires", () => {
    const limits = robinhoodLimitsSchema.parse(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: true }),
    );
    expect(limits.inbound_max_atomic).toBe(limits.outbound_max_atomic);
  });

  it("reports the fee even with no contract to read", () => {
    const closed = robinhoodLimitsSchema.parse(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    expect(closed.bridge_fee_bps).toBe(fixtures.BRIDGE_FEE_BPS);
    expect(closed.inbound_max_atomic).toBeNull();
  });
});
