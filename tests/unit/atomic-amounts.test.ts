import { describe, expect, it } from "vitest";
import {
  atomicAmountSchema,
  clampAtomicAtZero,
  isNegativeAtomic,
  nonNegativeAtomicAmountSchema,
  toBigInt,
} from "@/lib/api/schemas/common";
import { bridgeStatsSchema } from "@/lib/api/schemas/stats";
import { reserveHistoryEntrySchema } from "@/lib/api/schemas/reserves";
import { transferViewSchema } from "@/lib/api/schemas/transfer";
import { quoteOutputSchema } from "@/lib/api/schemas/quote";
import {
  reserveAvailabilitySchema,
  bridgeStatusSchema,
  transferLimitsSchema,
} from "@/lib/api/schemas/status";
import { formatBaseUnits } from "@/lib/format/amount";

/**
 * The Reserves-page outage, as tests.
 *
 * Production `/stats` served `settled_volume_atomic: 9408405829927559`.
 * That is above `Number.MAX_SAFE_INTEGER`, so `JSON.parse` returned
 * `9408405829927560` and the page could not render. The backend now sends
 * these as decimal strings; these tests pin that the whole path — schema,
 * arithmetic, formatting — stays exact.
 */

const MAX_SAFE = "9007199254740991";
const JUST_PAST_SAFE = "9007199254740992";
/** The exact production value that broke the page. */
const PRODUCTION_SETTLED_VOLUME = "9408405829927559";
/** What JSON.parse turned it into. */
const CORRUPTED = 9_408_405_829_927_560;

describe("atomicAmountSchema", () => {
  it("accepts exact decimal strings at and beyond the JS-safe boundary", () => {
    for (const value of [
      "0",
      "1",
      MAX_SAFE,
      JUST_PAST_SAFE,
      PRODUCTION_SETTLED_VOLUME,
      "18446744073709551615", // u64::MAX
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    ]) {
      expect(atomicAmountSchema.parse(value)).toBe(value);
    }
  });

  it("preserves the production value exactly, digit for digit", () => {
    const parsed = atomicAmountSchema.parse(PRODUCTION_SETTLED_VOLUME);
    expect(parsed).toBe("9408405829927559");
    expect(toBigInt(parsed)).toBe(9408405829927559n);
    // The number the old wire format produced is a DIFFERENT value.
    expect(Number(parsed)).toBe(CORRUPTED);
    expect(BigInt(CORRUPTED)).not.toBe(toBigInt(parsed));
  });

  it("accepts negatives, and normalises -0 and leading zeros", () => {
    expect(atomicAmountSchema.parse("-1")).toBe("-1");
    expect(atomicAmountSchema.parse("-0")).toBe("0");
    expect(atomicAmountSchema.parse("007")).toBe("7");
    expect(atomicAmountSchema.parse("-007")).toBe("-7");
  });

  it("rejects anything that is not a decimal integer string", () => {
    for (const bad of ["", " 1", "1 ", "+1", "1.0", "1e3", "0x10", "abc", "1_000"]) {
      expect(atomicAmountSchema.safeParse(bad).success).toBe(false);
    }
  });

  describe("legacy numeric payloads, during rollout", () => {
    it("accepts a number that provably survived JSON.parse", () => {
      expect(atomicAmountSchema.parse(0)).toBe("0");
      expect(atomicAmountSchema.parse(500_000)).toBe("500000");
      expect(atomicAmountSchema.parse(Number(MAX_SAFE))).toBe(MAX_SAFE);
      expect(atomicAmountSchema.parse(-42)).toBe("-42");
    });

    it("REJECTS a number beyond the safe range rather than showing a wrong balance", () => {
      // This is the production payload as the old backend sent it. By the
      // time the schema sees it the digits are already gone; accepting it
      // would render a corrupted balance, silently.
      const result = atomicAmountSchema.safeParse(CORRUPTED);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("MAX_SAFE_INTEGER");
    });

    it("rejects a non-integer number", () => {
      expect(atomicAmountSchema.safeParse(1.5).success).toBe(false);
    });
  });

  it("nonNegativeAtomicAmountSchema refuses negatives", () => {
    expect(nonNegativeAtomicAmountSchema.parse("5")).toBe("5");
    expect(nonNegativeAtomicAmountSchema.safeParse("-5").success).toBe(false);
  });
});

describe("exact atomic helpers", () => {
  it("clamps at zero without leaving the exact domain", () => {
    expect(clampAtomicAtZero(PRODUCTION_SETTLED_VOLUME)).toBe(PRODUCTION_SETTLED_VOLUME);
    expect(clampAtomicAtZero("-1")).toBe("0");
    expect(clampAtomicAtZero("0")).toBe("0");
  });

  it("detects negatives, treating -0 as not negative", () => {
    expect(isNegativeAtomic("-1")).toBe(true);
    expect(isNegativeAtomic("0")).toBe(false);
    expect(isNegativeAtomic(PRODUCTION_SETTLED_VOLUME)).toBe(false);
  });

  it("compares beyond the safe range correctly, where numbers would not", () => {
    const a = "9007199254740993";
    const b = "9007199254740992";
    expect(toBigInt(a) > toBigInt(b)).toBe(true);
    // The same comparison as numbers is wrong — both collapse to the same
    // double, which is exactly why comparisons go through bigint.
    expect(Number(a) > Number(b)).toBe(false);
  });
});

describe("formatting stays exact and the displayed output is unchanged", () => {
  it("renders the production settled volume without precision loss", () => {
    // 8-decimal Goldcoin units.
    expect(formatBaseUnits(PRODUCTION_SETTLED_VOLUME, 8)).toBe("94,084,058.29927559");
    // The corrupted value would have rendered a different final digit —
    // this is what the user would have seen had the UI accepted it.
    expect(formatBaseUnits(String(CORRUPTED), 8)).toBe("94,084,058.2992756");
  });

  it("formats the boundary values and much larger future ones", () => {
    expect(formatBaseUnits(MAX_SAFE, 8)).toBe("90,071,992.54740991");
    expect(formatBaseUnits(JUST_PAST_SAFE, 8)).toBe("90,071,992.54740992");
    expect(formatBaseUnits("18446744073709551615", 8)).toBe("184,467,440,737.09551615");
  });
});

/**
 * The live-payload regression fixture: the exact `GET /stats` body the
 * backend serves, with the real production figure. If this parses and the
 * value survives, the Reserves page works.
 */
const PRODUCTION_STATS_PAYLOAD = {
  goldcoin_paused: false,
  solana_paused: false,
  glc_to_sol_available: true,
  sol_to_glc_available: true,
  glc_to_sol_quota_exhausted: false,
  sol_to_glc_quota_exhausted: false,
  glc_to_sol_rolling_volume_remaining: "17500000000",
  sol_to_glc_rolling_volume_remaining: "100000000000",
  bridge_fee_bps: 300,
  glc_to_sol: {
    total_requests: 41,
    in_progress_requests: 2,
    settled_requests: 36,
    manual_review_requests: 3,
  },
  sol_to_glc: {
    total_requests: 18,
    in_progress_requests: 1,
    settled_requests: 14,
    manual_review_requests: 3,
  },
  goldcoin_reserve: {
    paused: false,
    available_capacity: "425000000000000",
    settled_volume_atomic: "9408405829927559",
    accrued_fees_atomic: "290982654018",
  },
  solana_reserve: {
    paused: false,
    available_capacity: "-1",
    settled_volume_atomic: "1284902004551",
    accrued_fees_atomic: "39739237",
  },
  goldcoin_indexer_halted: false,
  goldcoin_indexer_seconds_since_tick: 4,
  solana_indexer_seconds_since_tick: 3,
  post_finality_reorg_events: 0,
  as_of: 1788600000,
} as const;

describe("the live /stats payload that broke the Reserves page", () => {
  it("parses, and the settled volume survives exactly", () => {
    const stats = bridgeStatsSchema.parse(
      JSON.parse(JSON.stringify(PRODUCTION_STATS_PAYLOAD)),
    );
    expect(stats.goldcoin_reserve.settled_volume_atomic).toBe("9408405829927559");
    expect(toBigInt(stats.goldcoin_reserve.settled_volume_atomic)).toBe(
      9408405829927559n,
    );
    // A negative capacity is a real diagnostic state and must survive too.
    expect(stats.solana_reserve.available_capacity).toBe("-1");
    expect(isNegativeAtomic(stats.solana_reserve.available_capacity)).toBe(true);
  });

  it("would have FAILED against the old numeric payload, which is the bug", () => {
    const legacy = {
      ...PRODUCTION_STATS_PAYLOAD,
      goldcoin_reserve: {
        ...PRODUCTION_STATS_PAYLOAD.goldcoin_reserve,
        // What JSON.parse yields from the old wire format.
        settled_volume_atomic: CORRUPTED,
      },
    };
    expect(bridgeStatsSchema.safeParse(legacy).success).toBe(false);
  });

  it("still parses an old backend's payload whenever every value is JS-safe", () => {
    const legacySafe = {
      ...PRODUCTION_STATS_PAYLOAD,
      glc_to_sol_rolling_volume_remaining: 17_500_000_000,
      sol_to_glc_rolling_volume_remaining: 100_000_000_000,
      goldcoin_reserve: {
        paused: false,
        available_capacity: 425_000_000_000_000,
        settled_volume_atomic: 1_284_902_004_551,
        accrued_fees_atomic: 290_982_654_018,
      },
      solana_reserve: {
        paused: false,
        available_capacity: -1,
        settled_volume_atomic: 1_284_902_004_551,
        accrued_fees_atomic: 39_739_237,
      },
    };
    const stats = bridgeStatsSchema.parse(legacySafe);
    expect(stats.goldcoin_reserve.available_capacity).toBe("425000000000000");
    expect(stats.solana_reserve.available_capacity).toBe("-1");
  });
});

describe("every endpoint carrying atomic amounts round-trips the production magnitude", () => {
  const BIG = "9408405829927559";

  it("/reserve", () => {
    const parsed = reserveAvailabilitySchema.parse({
      goldcoin_available_capacity: BIG,
      solana_available_capacity: `-${BIG}`,
    });
    expect(parsed.goldcoin_available_capacity).toBe(BIG);
    expect(parsed.solana_available_capacity).toBe(`-${BIG}`);
  });

  it("/status", () => {
    const parsed = bridgeStatusSchema.parse({
      goldcoin_paused: false,
      solana_paused: false,
      vault_address: "vault",
      next_solana_obligation_index: 7,
      glc_to_sol_available: true,
      sol_to_glc_available: true,
      glc_to_sol_quota_exhausted: false,
      sol_to_glc_quota_exhausted: false,
      glc_to_sol_rolling_volume_remaining: BIG,
      sol_to_glc_rolling_volume_remaining: "0",
    });
    expect(parsed.glc_to_sol_rolling_volume_remaining).toBe(BIG);
  });

  it("/limits", () => {
    const parsed = transferLimitsSchema.parse({
      min_transfer_amount: "99000000",
      per_transfer_limit: BIG,
      bridge_fee_bps: 300,
    });
    expect(parsed.per_transfer_limit).toBe(BIG);
  });

  it("/reserves/history, including a negative delta", () => {
    const parsed = reserveHistoryEntrySchema.parse({
      id: 1,
      direction: "GoldcoinReserve",
      detected_at: 1788600000,
      expected_atomic: BIG,
      observed_atomic: "9408405829927558",
      delta_atomic: "-1",
      classification: "under-observed",
      auto_paused: false,
    });
    expect(parsed.expected_atomic).toBe(BIG);
    expect(parsed.delta_atomic).toBe("-1");
    expect(toBigInt(parsed.observed_atomic) - toBigInt(parsed.expected_atomic)).toBe(-1n);
  });

  it("/transfers", () => {
    const parsed = transferViewSchema.parse({
      id: 1,
      direction: "GlcToSol",
      state: "Settled",
      gross_amount_atomic: BIG,
      fee_bps: 300,
      fee_amount_atomic: "282252174897826",
      net_amount_atomic: "9126153655029733",
      created_at: 1788600000,
      source_txid: null,
      source_confirmations: 6,
      required_source_confirmations: 6,
      destination_txid: null,
      failure_reason: null,
    });
    expect(parsed.gross_amount_atomic).toBe(BIG);
    // gross - fee == net, exactly.
    expect(
      toBigInt(parsed.gross_amount_atomic) - toBigInt(parsed.fee_amount_atomic),
    ).toBe(toBigInt(parsed.net_amount_atomic));
  });

  it("/quote", () => {
    const parsed = quoteOutputSchema.parse({
      direction: "GlcToSol",
      gross_amount: BIG,
      gross_display_amount: "94084058.29927559",
      fee_bps: 300,
      fee_amount: "282252174897826",
      fee_display_amount: "2822521.74897826",
      net_amount: "9126153655029733",
      net_display_amount: "91261536.55029733",
      source_decimals: 8,
      destination_decimals: 6,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Solana)",
    });
    expect(parsed.gross_amount).toBe(BIG);
    expect(formatBaseUnits(parsed.gross_amount, 8)).toBe("94,084,058.29927559");
  });
});
