import { describe, expect, it } from "vitest";
import {
  formatRetryAfter,
  formatRetryAt,
  isRouteEffectivelyAvailable,
  isRouteEnabled,
  isRouteOpen,
  retryAfterSentence,
  retryTimeFor,
  robinhoodPredepositVerdict,
  routeAvailability,
  routeAvailabilitySummary,
  verdictMatchesInputs,
  ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
} from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import { chainsViewSchema } from "@/lib/api/schemas/chains";
import { recipientEligibilitySchema } from "@/lib/api/schemas/eligibility";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The `RhnToGlc` pre-deposit gate, as pure functions.
 *
 * # The defect this exists to prevent
 *
 * `GET /chains`' `enabled` is the route gate's verdict over config,
 * `bridge_routes` and adapter capability. It reads NO reserve state. In
 * production it therefore stayed `true` while `GoldcoinReserve`'s
 * admission was closed, and every newly observed Robinhood deposit folded
 * into `ManualReview` as `admission_closed_at_fold` — users having made
 * irreversible on-chain deposits against a UI that had been told the
 * route was fine. Backend PR #76 split the answer into `enabled` and
 * `available`; these tests hold the frontend to reading the second one,
 * and to refusing when it has not been answered at all.
 *
 * Every case below is stated in terms of what reaches the custody
 * contract, because that is what cannot be undone.
 */

const CHAINS = () => fixtures.chainsFixture(() => new Date());

/** `/chains` with RhnToGlc switched on, and `available` set explicitly. */
function rhnChains(options: {
  enabled: boolean;
  available?: boolean | undefined;
  unavailableReason?: string | null;
}): ChainsViewDto {
  const base = CHAINS();
  return {
    ...base,
    routes: base.routes.map((route) =>
      route.id === "RhnToGlc"
        ? {
            ...route,
            enabled: options.enabled,
            disabled_reason: options.enabled ? null : "Route is switched off.",
            ...("available" in options ? { available: options.available } : {}),
            unavailable_reason: options.unavailableReason ?? null,
          }
        : route,
    ),
  };
}

/**
 * A `/chains` payload from a deployment predating `available` entirely:
 * `RhnToGlc` switched ON, and neither new field present anywhere. This is
 * the shape that used to be the ONLY answer available, and reading it as
 * a yes is precisely the defect.
 */
function preAvailabilityChains(): ChainsViewDto {
  const base = rhnChains({ enabled: true });
  return {
    ...base,
    routes: base.routes.map((route) => {
      const { available: _available, unavailable_reason: _reason, ...rest } = route;
      return rest;
    }),
  };
}

/** A plausible unix SECOND, comfortably inside the renderable range. */
const RETRY_AT = 1_800_000_000;

function verdict(overrides: Partial<RecipientEligibilityDto> = {}) {
  return recipientEligibilitySchema.parse({
    direction: "RhnToGlc",
    address: "GADDRESS",
    wallet: "0xdd870fa1b7c4700f2bd7f44238821c26f7392148",
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    source_wallet_retry_after: null,
    recipient_retry_after: null,
    window_seconds: 86_400,
    ...overrides,
  });
}

describe("routeViewSchema — the two availability fields", () => {
  it("parses a route that carries `available` and `unavailable_reason`", () => {
    const parsed = chainsViewSchema.parse(
      rhnChains({ enabled: true, available: false, unavailableReason: "Closed." }),
    );
    const view = parsed.routes.find((route) => route.id === "RhnToGlc")!;
    expect(view.available).toBe(false);
    expect(view.unavailable_reason).toBe("Closed.");
  });

  it("still parses a deployment that publishes neither field", () => {
    // Purely additive on the wire: an older backend must not fail Zod and
    // take the whole page down — it must simply read as "did not say".
    const parsed = chainsViewSchema.parse(preAvailabilityChains());
    const view = parsed.routes.find((route) => route.id === "RhnToGlc")!;
    expect(view.available).toBeUndefined();
  });
});

describe("routeAvailability — enabled and available are different questions", () => {
  it("reports `unavailable` for a route that is ENABLED and not available", () => {
    // The production state exactly: the route gate open, the destination
    // reserve refusing. Not `closed` — nobody switched anything off, and
    // nobody has to switch it back on.
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: "No capacity." }),
      "RhnToGlc",
    );
    expect(state.kind).toBe("unavailable");
    expect(state.kind === "unavailable" && state.reason).toBe("No capacity.");
  });

  it("renders the backend's `unavailable_reason` verbatim, never a local rewrite", () => {
    const reason = "Bridge capacity reached for this direction.";
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: reason }),
      "RhnToGlc",
    );
    expect(state.kind === "unavailable" && state.reason).toBe(reason);
  });

  it("falls back to neutral copy only when the backend published no sentence", () => {
    const state = routeAvailability(
      rhnChains({ enabled: true, available: false, unavailableReason: null }),
      "RhnToGlc",
    );
    expect(state.kind === "unavailable" && state.reason).toBe(
      "This route is not available right now.",
    );
  });

  it("is `open` but NOT availability-known when the field is absent", () => {
    const state = routeAvailability(preAvailabilityChains(), "RhnToGlc");
    expect(state.kind).toBe("open");
    expect(state.kind === "open" && state.availabilityKnown).toBe(false);
  });

  it("is `open` and availability-known when the backend answered true", () => {
    const state = routeAvailability(
      rhnChains({ enabled: true, available: true }),
      "RhnToGlc",
    );
    expect(state.kind === "open" && state.availabilityKnown).toBe(true);
  });

  it("keeps `closed` ahead of `unavailable`: a disabled route is disabled", () => {
    const state = routeAvailability(
      rhnChains({ enabled: false, available: false }),
      "RhnToGlc",
    );
    expect(state.kind).toBe("closed");
  });
});

describe("the three availability predicates", () => {
  const enabledButUnavailable = rhnChains({ enabled: true, available: false });
  const unpublished = preAvailabilityChains();

  it("isRouteOpen: false once the backend says the route is not available", () => {
    expect(isRouteOpen(enabledButUnavailable, "RhnToGlc")).toBe(false);
    expect(isRouteOpen(rhnChains({ enabled: true, available: true }), "RhnToGlc")).toBe(
      true,
    );
  });

  it("isRouteEnabled: the DEPLOYMENT question, unmoved by a runtime gate", () => {
    // What decides whether an endpoint exists to poll, or a route deserves
    // a card on the status page. A reserve closing must not make a
    // deployed route look undeployed.
    expect(isRouteEnabled(enabledButUnavailable, "RhnToGlc")).toBe(true);
    expect(isRouteEnabled(rhnChains({ enabled: false }), "RhnToGlc")).toBe(false);
  });

  it("isRouteEffectivelyAvailable: only a positive `available: true` passes", () => {
    expect(
      isRouteEffectivelyAvailable(
        rhnChains({ enabled: true, available: true }),
        "RhnToGlc",
      ),
    ).toBe(true);
    expect(isRouteEffectivelyAvailable(enabledButUnavailable, "RhnToGlc")).toBe(false);
    // The case the whole split exists for: a backend that never answered.
    expect(isRouteEffectivelyAvailable(unpublished, "RhnToGlc")).toBe(false);
    // And an unreachable /chains.
    expect(isRouteEffectivelyAvailable(undefined, "RhnToGlc")).toBe(false);
  });
});

describe("routeAvailabilitySummary", () => {
  it("does not count a route the backend reports as unavailable", () => {
    const open = fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });
    expect(routeAvailabilitySummary(open)).toEqual({ open: 6, total: 6 });
    const gated = fixtures.chainsFixture(() => new Date(), {
      robinhoodOpen: true,
      robinhoodAvailable: false,
    });
    expect(routeAvailabilitySummary(gated)).toEqual({ open: 2, total: 6 });
  });
});

describe("verdictMatchesInputs", () => {
  it("rejects an answer about a different destination", () => {
    expect(
      verdictMatchesInputs(
        verdict(),
        "OTHER",
        "0xDD870fa1B7C4700F2BD7f44238821c26f7392148",
      ),
    ).toBe(false);
  });

  it("rejects an answer about a different wallet", () => {
    expect(
      verdictMatchesInputs(
        verdict(),
        "GADDRESS",
        "0x0000000000000000000000000000000000000001",
      ),
    ).toBe(false);
  });

  it("accepts the EIP-55 spelling of the same 20 bytes", () => {
    // The backend answers in lowercase hex; a browser wallet reports the
    // checksummed mixed case. Same address, and a case-sensitive compare
    // would refuse every real deposit.
    expect(
      verdictMatchesInputs(
        verdict(),
        "GADDRESS",
        "0xdD870fA1b7C4700F2BD7f44238821C26f7392148",
      ),
    ).toBe(true);
  });

  it("rejects a wallet-less answer once a wallet is connected", () => {
    // The source-wallet leg was never evaluated, so this verdict cannot
    // clear a wallet — it is silent about it, which is not the same thing.
    expect(verdictMatchesInputs(verdict({ wallet: null }), "GADDRESS", "0xabc")).toBe(
      false,
    );
  });
});

describe("formatRetryAfter — the RELATIVE fallback spelling", () => {
  it("rounds UP, so the wait it states is never shorter than the real one", () => {
    expect(formatRetryAfter(30)).toBe("in under a minute");
    expect(formatRetryAfter(61)).toBe("in about 2 minutes");
    expect(formatRetryAfter(60)).toBe("in about 1 minute");
    expect(formatRetryAfter(3_601)).toBe("in about 2 hours");
    expect(formatRetryAfter(40_000)).toBe("in about 12 hours");
  });

  it("says nothing at all when the backend published no time", () => {
    expect(formatRetryAfter(null)).toBeNull();
    expect(formatRetryAfter(undefined)).toBeNull();
    expect(formatRetryAfter(-1)).toBeNull();
  });
});

describe("formatRetryAt — the ABSOLUTE preferred spelling", () => {
  it("renders a unix-seconds instant as the reader's own local date and time", () => {
    // Same treatment every other backend instant in this app gets
    // (TransferRow, EventRow, ReservesView), so the expectation is
    // computed the same way rather than pinned to one machine's locale.
    expect(formatRetryAt(RETRY_AT)).toBe(
      `after ${new Date(RETRY_AT * 1000).toLocaleString()}`,
    );
  });

  it("refuses a value that is not plausibly a unix SECOND", () => {
    // The realistic failure is a unit mistake: milliseconds where seconds
    // were meant is finite and positive and would render a date in the
    // year 55000. Refusing it lets the relative fallback answer instead.
    expect(formatRetryAt(RETRY_AT * 1000)).toBeNull();
    expect(formatRetryAt(0)).toBeNull();
    expect(formatRetryAt(-1)).toBeNull();
    expect(formatRetryAt(Number.NaN)).toBeNull();
    expect(formatRetryAt(null)).toBeNull();
    expect(formatRetryAt(undefined)).toBeNull();
  });
});

describe("retryTimeFor", () => {
  it("prefers the PER-LIMIT instant, and re-bases its seconds off the backend's own pair", () => {
    // Both limits block with different windows; neither may be quoted for
    // the other. The seconds are derived from the aggregate pair the
    // backend computed at one instant, so no clock on this machine enters
    // the arithmetic.
    const both = verdict({
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
      blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
      retry_after: RETRY_AT,
      retry_after_seconds: 3_600,
      source_wallet_retry_after: RETRY_AT,
      recipient_retry_after: RETRY_AT + 3_600,
    });
    expect(retryTimeFor(both, "source_wallet_rate_limited")).toEqual({
      at: RETRY_AT,
      seconds: 3_600,
    });
    expect(retryTimeFor(both, "recipient_rate_limited")).toEqual({
      at: RETRY_AT + 3_600,
      seconds: 7_200,
    });
  });

  it("falls back to the aggregate pair only for the limit `blocked_reason` names", () => {
    const older = verdict({
      eligible: false,
      blocked_reason: "recipient_rate_limited",
      blocked_reasons: undefined,
      retry_after: RETRY_AT,
      retry_after_seconds: 7_200,
      source_wallet_retry_after: undefined,
      recipient_retry_after: undefined,
    });
    expect(retryTimeFor(older, "recipient_rate_limited")).toEqual({
      at: RETRY_AT,
      seconds: 7_200,
    });
    // The aggregate describes the recipient limit, so it says nothing
    // about the wallet one — and must not be borrowed for it.
    expect(retryTimeFor(older, "source_wallet_rate_limited")).toEqual({
      at: null,
      seconds: null,
    });
  });
});

describe("retryAfterSentence", () => {
  it("prefers the absolute instant over the relative wait", () => {
    // An instant stays correct however long the page sits open; a
    // seconds-from-now figure was measured against a clock that has since
    // moved on.
    const blocked = verdict({
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
      blocked_reasons: ["source_wallet_rate_limited"],
      retry_after: RETRY_AT,
      retry_after_seconds: 3_600,
      source_wallet_retry_after: RETRY_AT,
    });
    expect(retryAfterSentence(blocked, "source_wallet_rate_limited")).toBe(
      `This Robinhood Network wallet can bridge again after ${new Date(
        RETRY_AT * 1000,
      ).toLocaleString()}.`,
    );
  });

  it("falls back to the relative wait when only `retry_after_seconds` came back", () => {
    const secondsOnly = verdict({
      eligible: false,
      blocked_reason: "recipient_rate_limited",
      blocked_reasons: ["recipient_rate_limited"],
      retry_after: null,
      retry_after_seconds: 7_200,
    });
    expect(retryAfterSentence(secondsOnly, "recipient_rate_limited")).toBe(
      "This Goldcoin address can receive again in about 2 hours.",
    );
  });

  it("falls back to the relative wait when the timestamp is implausible", () => {
    const millisecondsByMistake = verdict({
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
      blocked_reasons: ["source_wallet_rate_limited"],
      retry_after: RETRY_AT * 1000,
      retry_after_seconds: 3_600,
    });
    expect(retryAfterSentence(millisecondsByMistake, "source_wallet_rate_limited")).toBe(
      "This Robinhood Network wallet can bridge again in about 1 hour.",
    );
  });

  it("names WHICH limit it is timing, so the two stay distinguishable", () => {
    // The two windows are independent and reopen at different times. A
    // retry line read on its own must still say which one it belongs to.
    const both = verdict({
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
      blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
      retry_after: RETRY_AT,
      retry_after_seconds: 3_600,
      source_wallet_retry_after: RETRY_AT,
      recipient_retry_after: RETRY_AT + 7_200,
    });
    const wallet = retryAfterSentence(both, "source_wallet_rate_limited");
    const recipient = retryAfterSentence(both, "recipient_rate_limited");
    expect(wallet).toContain("This Robinhood Network wallet");
    expect(recipient).toContain("This Goldcoin address");
    expect(wallet).not.toBe(recipient);
  });

  it("is empty rather than guessed when the backend published no time at all", () => {
    // "Try again in 24 hours" would be a number the backend never said.
    const noTime = verdict({
      eligible: false,
      blocked_reason: "recipient_rate_limited",
      retry_after: null,
      retry_after_seconds: null,
    });
    expect(retryAfterSentence(noTime, "recipient_rate_limited")).toBe("");
  });
});

describe("robinhoodPredepositVerdict — every branch fails closed", () => {
  const ALLOWED = {
    routeAvailable: true,
    unavailableReason: null,
    eligibility: verdict(),
    address: "GADDRESS",
    wallet: "0xdd870fa1b7c4700f2bd7f44238821c26f7392148",
  } as const;

  it("allows only when availability AND eligibility both answered yes", () => {
    expect(robinhoodPredepositVerdict(ALLOWED)).toEqual({ kind: "allowed" });
  });

  it("refuses on availability BEFORE looking at any rate limit", () => {
    // A closed route is not a fact about this user's wallet, and telling
    // them to wait out a window they are not in is the wrong remedy.
    const state = robinhoodPredepositVerdict({
      ...ALLOWED,
      routeAvailable: false,
      unavailableReason: "Bridge capacity reached for this direction.",
      eligibility: verdict({ eligible: false, blocked_reason: "recipient_rate_limited" }),
    });
    expect(state).toEqual({
      kind: "route-unavailable",
      reason: "Bridge capacity reached for this direction.",
    });
  });

  it("refuses with local fallback copy when availability is simply unknown", () => {
    expect(
      robinhoodPredepositVerdict({
        ...ALLOWED,
        routeAvailable: false,
        unavailableReason: null,
      }),
    ).toEqual({
      kind: "route-unavailable",
      reason: ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
    });
  });

  it("refuses when the eligibility endpoint gave no answer at all", () => {
    expect(robinhoodPredepositVerdict({ ...ALLOWED, eligibility: null })).toEqual({
      kind: "eligibility-unknown",
    });
  });

  it("refuses an answer about a superseded destination or wallet", () => {
    // The exact stale-authorization case: a verdict that said `eligible`
    // about inputs the form no longer holds is not a weaker yes, it is an
    // answer to a different question.
    expect(robinhoodPredepositVerdict({ ...ALLOWED, address: "EDITED" }).kind).toBe(
      "eligibility-unknown",
    );
    expect(
      robinhoodPredepositVerdict({
        ...ALLOWED,
        wallet: "0x0000000000000000000000000000000000000009",
      }).kind,
    ).toBe("eligibility-unknown");
  });

  it("names the SOURCE WALLET limit, with its own reopen time", () => {
    const state = robinhoodPredepositVerdict({
      ...ALLOWED,
      eligibility: verdict({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited"],
        retry_after: 1_800_000_000,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: 1_800_000_000,
      }),
    });
    expect(state).toEqual({
      kind: "source-wallet-rate-limited",
      retryAfter: `This Robinhood Network wallet can bridge again after ${new Date(
        1_800_000_000 * 1000,
      ).toLocaleString()}.`,
    });
  });

  it("names the DESTINATION limit, with its own reopen time", () => {
    const state = robinhoodPredepositVerdict({
      ...ALLOWED,
      eligibility: verdict({
        eligible: false,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: ["recipient_rate_limited"],
        retry_after: 1_800_000_000,
        retry_after_seconds: 7_200,
        recipient_retry_after: 1_800_000_000,
      }),
    });
    expect(state).toEqual({
      kind: "recipient-rate-limited",
      retryAfter: `This Goldcoin address can receive again after ${new Date(
        1_800_000_000 * 1000,
      ).toLocaleString()}.`,
    });
  });

  it("prefers the wallet limit when both block, matching the fold's precedence", () => {
    const state = robinhoodPredepositVerdict({
      ...ALLOWED,
      eligibility: verdict({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        retry_after: 1_800_000_000,
        retry_after_seconds: 60,
      }),
    });
    expect(state.kind).toBe("source-wallet-rate-limited");
  });

  it("refuses an `eligible: false` the backend gave no reason for", () => {
    // Nothing here may invent a limit, and nothing here may let it
    // through because it could not name one.
    const state = robinhoodPredepositVerdict({
      ...ALLOWED,
      eligibility: verdict({
        eligible: false,
        blocked_reason: null,
        blocked_reasons: [],
      }),
    });
    expect(state.kind).toBe("eligibility-unknown");
  });
});
