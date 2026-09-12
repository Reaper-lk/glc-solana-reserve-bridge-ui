import { describe, expect, it } from "vitest";
import {
  eligibilityBlockedDetail,
  eligibilityBlockedTitle,
  eligibilityEndpointFor,
  eligibilityMatchesInputs,
  eligibilityPermitsSubmission,
  formatEligibilityCooldown,
  hasAuthoritativeEligibility,
  isEligibilityRoute,
  normalizeRecipientEligibility,
  normalizeRouteWalletEligibility,
  remainingSecondsFor,
  routeEligibilityVerdict,
  ELIGIBILITY_BACKEND_DEPENDENCY,
  ELIGIBILITY_BLOCKED_BOTH_TITLE,
  ELIGIBILITY_BLOCKED_TITLE,
  ELIGIBILITY_ROUTES,
  sourceWalletKnownInBrowser,
  type EligibilityRoute,
  type RouteEligibility,
} from "@/lib/bridge/eligibility";
import {
  recipientEligibilitySchema,
  routeWalletEligibilitySchema,
} from "@/lib/api/schemas/eligibility";
import type {
  RecipientEligibilityDto,
  RouteWalletEligibilityDto,
} from "@/lib/api/schemas/eligibility";

/**
 * The rolling 24-hour wallet eligibility model, as pure functions.
 *
 * # What these tests are protecting
 *
 * One property, stated six ways: **nothing produces an eligible verdict
 * except a backend response that said so about these exact inputs.** Every
 * other outcome — no endpoint, a failed read, a stale answer, a side the
 * backend never evaluated, `eligible: false` with no reason — must disable
 * submission.
 *
 * That matters because the cost of the two errors is wildly asymmetric. A
 * wrong "no" costs a retry. A wrong "yes" on a contract-sourced route
 * costs a user their GLC: the custody contract accepts the deposit, the
 * bridge parks it in `ManualReview`, and there is no refusing it after the
 * fact.
 */

const GLC_ADDRESS = "GdKQNBb8CVhFxKC1kBi1AjgTQTgLPvVp7c";
const SOL_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_WALLET = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
const SOL_RECIPIENT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const NOW = 1_787_000_000;
const WINDOW = 86_400;

/** A backend response, validated by the real schema so the shape cannot drift. */
function dto(overrides: Partial<RecipientEligibilityDto> = {}): RecipientEligibilityDto {
  return recipientEligibilitySchema.parse({
    direction: "SolToGlc",
    address: GLC_ADDRESS,
    wallet: SOL_WALLET,
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    source_wallet_retry_after: null,
    recipient_retry_after: null,
    window_seconds: WINDOW,
    ...overrides,
  });
}

/** A leg of the route-generic answer, through the real schema. */
function leg(
  address: string,
  overrides: Partial<NonNullable<RouteWalletEligibilityDto["source"]>> = {},
) {
  return {
    address,
    eligible: true,
    reason: null,
    retry_after: null,
    retry_after_seconds: null,
    ...overrides,
  };
}

/**
 * A `GET /routes/{route}/eligibility` body, validated by the real schema
 * so a test cannot assert against a shape the backend does not serve.
 */
function routeDto(
  overrides: Partial<RouteWalletEligibilityDto> = {},
): RouteWalletEligibilityDto {
  return routeWalletEligibilitySchema.parse({
    route: "GlcToRhn",
    source: null,
    destination: leg(EVM_WALLET.toLowerCase()),
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: WINDOW,
    as_of: NOW,
    ...overrides,
  });
}

function verdictFor(
  answer: RouteEligibility | null,
  overrides: {
    route?: EligibilityRoute;
    source?: string | null;
    destination?: string;
    pending?: boolean;
    endpointUnpublished?: boolean;
  } = {},
) {
  return routeEligibilityVerdict({
    route: overrides.route ?? "SolToGlc",
    source: overrides.source === undefined ? SOL_WALLET : overrides.source,
    destination: overrides.destination ?? GLC_ADDRESS,
    pending: overrides.pending ?? false,
    answer,
    ...(overrides.endpointUnpublished === undefined
      ? {}
      : { endpointUnpublished: overrides.endpointUnpublished }),
  });
}

describe("the route table", () => {
  it("covers all six routes, and no others", () => {
    expect([...ELIGIBILITY_ROUTES].sort()).toEqual(
      ["GlcToRhn", "GlcToSol", "RhnToGlc", "RhnToSol", "SolToGlc", "SolToRhn"].sort(),
    );
    expect(ELIGIBILITY_ROUTES).toHaveLength(6);
  });

  it("recognises only real routes", () => {
    expect(isEligibilityRoute("SolToGlc")).toBe(true);
    expect(isEligibilityRoute("RhnToSol")).toBe(true);
    expect(isEligibilityRoute("NotARoute")).toBe(false);
  });

  it("has an endpoint for every one of the six routes", () => {
    expect([...ELIGIBILITY_BACKEND_DEPENDENCY.covered].sort()).toEqual(
      [...ELIGIBILITY_ROUTES].sort(),
    );
    expect(ELIGIBILITY_BACKEND_DEPENDENCY.pending).toEqual([]);
    for (const route of ELIGIBILITY_ROUTES) {
      expect(hasAuthoritativeEligibility(route)).toBe(true);
    }
  });

  it("maps the two per-route endpoints to the backend's real paths and spellings", () => {
    expect(eligibilityEndpointFor("SolToGlc")).toEqual({
      route: "SolToGlc",
      path: "/recipients/sol-to-glc/eligibility",
      sourceSpelling: "solana-base58",
      destinationSpelling: "goldcoin-base58check",
    });
    expect(eligibilityEndpointFor("RhnToGlc")).toEqual({
      route: "RhnToGlc",
      path: "/recipients/rhn-to-glc/eligibility",
      sourceSpelling: "evm-hex",
      destinationSpelling: "goldcoin-base58check",
    });
  });

  it("never falls back to a Goldcoin-payout endpoint for a route that pays out elsewhere", () => {
    // Asking `/recipients/sol-to-glc/eligibility` about `SolToRhn` would
    // be asking about a window that does not govern it. The four routes
    // that endpoint cannot answer for go to the route-generic path, in
    // the spelling the backend's own router matches on.
    for (const route of ["GlcToSol", "GlcToRhn", "SolToRhn", "RhnToSol"] as const) {
      expect(eligibilityEndpointFor(route).path).toBe(`/routes/${route}/eligibility`);
    }
  });

  it("names the Goldcoin-funded routes as the ones whose source the browser cannot know", () => {
    // Derived from the direction table's funding kind, not restated here
    // — a route whose funding changes must not end up exempt in one place
    // and gated in another.
    expect([...ELIGIBILITY_BACKEND_DEPENDENCY.sourceEnforcedAtAdmission].sort()).toEqual([
      "GlcToRhn",
      "GlcToSol",
    ]);
    expect(sourceWalletKnownInBrowser("GlcToSol")).toBe(false);
    expect(sourceWalletKnownInBrowser("GlcToRhn")).toBe(false);
    for (const route of ["SolToGlc", "RhnToGlc", "SolToRhn", "RhnToSol"] as const) {
      expect(sourceWalletKnownInBrowser(route)).toBe(true);
    }
  });
});

describe("normalizeRecipientEligibility — the backend's shape, mapped by SIDE", () => {
  it("maps source_wallet_* onto the source side and recipient_* onto the destination", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: NOW + 3_600,
        recipient_retry_after: NOW + 7_200,
      }),
      "SolToGlc",
    );
    expect(answer.sourceSide).toEqual({
      evaluated: true,
      eligible: false,
      retryAt: NOW + 3_600,
      remainingSeconds: 3_600,
      reason: "source_wallet_rate_limited",
      applicable: true,
    });
    expect(answer.destinationSide).toMatchObject({
      evaluated: true,
      eligible: false,
      retryAt: NOW + 7_200,
      reason: "recipient_rate_limited",
    });
    expect(answer.eligible).toBe(false);
  });

  it("re-bases a per-side wait against the backend's own pair, using no local clock", () => {
    // `recipient_retry_after` is an hour later than the aggregate the
    // seconds were measured against, so the destination's wait is the
    // aggregate plus that hour — never `Date.now()` arithmetic.
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: NOW + 3_600,
        recipient_retry_after: NOW + 7_200,
      }),
      "SolToGlc",
    );
    expect(answer.destinationSide.remainingSeconds).toBe(7_200);
  });

  it("reports the source side UNEVALUATED when no wallet was given", () => {
    // "Not checked" must never read as "checked and clear" — the whole
    // reason the backend echoes the wallet back.
    const answer = normalizeRecipientEligibility(dto({ wallet: null }), "SolToGlc");
    expect(answer.sourceSide.evaluated).toBe(false);
    expect(answer.sourceSide.eligible).toBe(false);
    expect(answer.destinationSide.evaluated).toBe(true);
    // And the aggregate cannot be eligible with a side unevaluated.
    expect(answer.eligible).toBe(false);
  });

  it("is eligible only when both sides were evaluated and both are clear", () => {
    const answer = normalizeRecipientEligibility(dto(), "SolToGlc");
    expect(answer.eligible).toBe(true);
    expect(answer.sourceSide).toMatchObject({ evaluated: true, eligible: true });
    expect(answer.destinationSide).toMatchObject({ evaluated: true, eligible: true });
  });

  it("takes the STRICTER of the two readings when the backend's own flag disagrees", () => {
    // A response claiming `eligible: true` while naming a blocking reason
    // is self-contradictory; the refusal wins.
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: true,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: ["recipient_rate_limited"],
        recipient_retry_after: NOW + 600,
      }),
      "SolToGlc",
    );
    expect(answer.destinationSide.eligible).toBe(false);
    expect(answer.eligible).toBe(false);
  });

  it("resolves a blocking side from blocked_reasons even on a backend that omits it", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: undefined,
        retry_after: NOW + 600,
        retry_after_seconds: 600,
      }),
      "SolToGlc",
    );
    expect(answer.destinationSide.eligible).toBe(false);
    expect(answer.destinationSide.retryAt).toBe(NOW + 600);
    expect(answer.sourceSide.eligible).toBe(true);
  });

  it("refuses an implausible timestamp rather than rendering the year 55000", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: ["recipient_rate_limited"],
        // Milliseconds where seconds were meant: finite, positive, absurd.
        recipient_retry_after: (NOW + 600) * 1000,
        retry_after: null,
        retry_after_seconds: null,
      }),
      "SolToGlc",
    );
    expect(answer.destinationSide.retryAt).toBeNull();
  });

  it("carries the backend's own window rather than a hardcoded 24 hours", () => {
    expect(
      normalizeRecipientEligibility(dto({ window_seconds: 43_200 }), "SolToGlc")
        .windowSeconds,
    ).toBe(43_200);
  });

  it("reports as_of as absent, because RecipientEligibility publishes none", () => {
    // Absent, never invented — a timestamp this UI made up would be
    // indistinguishable from one the backend stood behind.
    expect(normalizeRecipientEligibility(dto(), "SolToGlc").asOf).toBeNull();
  });
});

describe("eligibilityMatchesInputs — an answer to a superseded question is not a yes", () => {
  const answer = normalizeRecipientEligibility(dto(), "SolToGlc");

  it("accepts the exact inputs it is about", () => {
    expect(eligibilityMatchesInputs(answer, "SolToGlc", SOL_WALLET, GLC_ADDRESS)).toBe(
      true,
    );
  });

  it("rejects a different route, destination or wallet", () => {
    expect(eligibilityMatchesInputs(answer, "RhnToGlc", SOL_WALLET, GLC_ADDRESS)).toBe(
      false,
    );
    expect(eligibilityMatchesInputs(answer, "SolToGlc", SOL_WALLET, "GOther")).toBe(
      false,
    );
    expect(eligibilityMatchesInputs(answer, "SolToGlc", "OtherWallet", GLC_ADDRESS)).toBe(
      false,
    );
  });

  it("compares an EVM wallet case-insensitively but a base58 address exactly", () => {
    // A wallet reports EIP-55 mixed case for the same 20 bytes the
    // backend lowercases. Base58Check and base58 both encode information
    // in case and must match exactly.
    const evm = normalizeRecipientEligibility(
      dto({
        direction: "RhnToGlc",
        wallet: EVM_WALLET.toLowerCase(),
      }),
      "RhnToGlc",
    );
    expect(eligibilityMatchesInputs(evm, "RhnToGlc", EVM_WALLET, GLC_ADDRESS)).toBe(true);
    expect(
      eligibilityMatchesInputs(evm, "RhnToGlc", EVM_WALLET, GLC_ADDRESS.toLowerCase()),
    ).toBe(false);
  });

  it("does not throw on a malformed answer with the wallet field absent", () => {
    const malformed = { ...answer, source: undefined } as unknown as RouteEligibility;
    expect(eligibilityMatchesInputs(malformed, "SolToGlc", SOL_WALLET, GLC_ADDRESS)).toBe(
      false,
    );
  });
});

describe("routeEligibilityVerdict — every branch fails closed", () => {
  it("permits submission ONLY for a positively eligible answer", () => {
    const verdict = verdictFor(normalizeRecipientEligibility(dto(), "SolToGlc"));
    expect(verdict.kind).toBe("eligible");
    expect(eligibilityPermitsSubmission(verdict)).toBe(true);
  });

  it("refuses a route this deployment serves no endpoint for", () => {
    // The CLIENT reports that, by rejecting with
    // `EligibilityEndpointUnpublishedError`; the flag only picks which
    // sentence is shown. Against today's backend that is all four of
    // GlcToSol, GlcToRhn, SolToRhn and RhnToSol.
    for (const route of ["GlcToSol", "GlcToRhn", "SolToRhn", "RhnToSol"] as const) {
      const verdict = verdictFor(null, { route, endpointUnpublished: true });
      expect(verdict).toEqual({ kind: "unavailable", detail: "endpoint-not-published" });
      expect(eligibilityPermitsSubmission(verdict)).toBe(false);
    }
  });

  it("refuses an unanswered route whatever the reason for the silence", () => {
    // The flag is cosmetic. With it absent the refusal is identical in
    // effect — which is the property that matters: no answer, no
    // submission.
    for (const route of ["GlcToSol", "GlcToRhn", "SolToRhn", "RhnToSol"] as const) {
      const verdict = verdictFor(null, { route });
      expect(verdict).toEqual({ kind: "unavailable", detail: "request-failed" });
      expect(eligibilityPermitsSubmission(verdict)).toBe(false);
    }
  });

  it("refuses an answer that is about a DIFFERENT route than the one asked about", () => {
    // The gate rests on an answer matching these exact inputs, so a
    // verdict earned on one route cannot be replayed onto another.
    const answer = normalizeRecipientEligibility(dto(), "SolToGlc");
    expect(verdictFor(answer, { route: "RhnToSol" })).toEqual({
      kind: "unavailable",
      detail: "answer-stale",
    });
  });

  it("refuses before an answer arrives, as `checking`", () => {
    const verdict = verdictFor(null, { pending: true });
    expect(verdict.kind).toBe("checking");
    expect(eligibilityPermitsSubmission(verdict)).toBe(false);
  });

  it("refuses a read that FAILED — unreadable eligibility is unknown eligibility", () => {
    expect(verdictFor(null, { pending: false })).toEqual({
      kind: "unavailable",
      detail: "request-failed",
    });
  });

  it("refuses when the source side APPLIES and no source wallet is connected", () => {
    // The per-route endpoints govern both sides unconditionally, so a
    // SolToGlc answer always reports the source side as applicable —
    // and with no wallet to ask about, there is nothing that could clear
    // it.
    const answer = normalizeRecipientEligibility(dto({ wallet: null }), "SolToGlc");
    expect(answer.sourceSide.applicable).toBe(true);
    expect(verdictFor(answer, { source: null })).toEqual({
      kind: "unavailable",
      detail: "side-not-evaluated",
    });
  });

  it("clears a Goldcoin-funded route the backend evaluated no source leg for", () => {
    // The one case a Goldcoin-sourced route requires. The user sends to
    // an address the backend issues, so no source wallet exists in the
    // browser, the client sends no `?source=`, and the backend answers
    // `source: null`. That is not a clearance for the source window — it
    // is the absence of a wallet to ask about, and the backend enforces
    // that window at admission against the wallet the deposit really
    // came from.
    const answer = normalizeRouteWalletEligibility(
      routeDto({ route: "GlcToSol", source: null, destination: leg(SOL_RECIPIENT) }),
      "GlcToSol",
    );
    expect(answer.sourceSide.applicable).toBe(false);
    expect(answer.source).toBeNull();
    expect(answer.destinationSide).toMatchObject({ evaluated: true, eligible: true });
    expect(
      routeEligibilityVerdict({
        route: "GlcToSol",
        source: null,
        destination: SOL_RECIPIENT,
        pending: false,
        answer,
      }).kind,
    ).toBe("eligible");
  });

  it("clears GlcToRhn the same way, on a destination-only check", () => {
    // The production symptom this whole path exists to fix: route
    // Available, both wallet rows "Unavailable", and the submit button
    // held by a check that never had a question to ask.
    const answer = normalizeRouteWalletEligibility(
      routeDto({ route: "GlcToRhn", source: null, destination: leg(EVM_WALLET) }),
      "GlcToRhn",
    );
    expect(answer.sourceSide.applicable).toBe(false);
    expect(
      routeEligibilityVerdict({
        route: "GlcToRhn",
        source: null,
        destination: EVM_WALLET,
        pending: false,
        answer,
      }).kind,
    ).toBe("eligible");
  });

  it("REFUSES a null source leg on a route whose source wallet the browser does know", () => {
    // The exemption is narrow on purpose: it is about a wallet that
    // cannot exist, never about one the check simply failed to ask about.
    // `SolToRhn` has a connected Solana wallet, so an unevaluated source
    // is half an answer to a two-sided policy.
    const answer = normalizeRouteWalletEligibility(
      routeDto({ route: "SolToRhn", source: null, destination: leg(EVM_WALLET) }),
      "SolToRhn",
    );
    expect(answer.sourceSide).toMatchObject({ evaluated: false, applicable: true });
    expect(answer.eligible).toBe(false);
    expect(
      routeEligibilityVerdict({
        route: "SolToRhn",
        source: SOL_WALLET,
        destination: EVM_WALLET,
        pending: false,
        answer,
      }),
    ).toEqual({ kind: "unavailable", detail: "answer-stale" });
  });

  it("REFUSES a null DESTINATION leg on every route, Goldcoin-funded included", () => {
    // The destination window is the one this check exists to establish.
    // No exemption reaches it.
    for (const route of ["GlcToSol", "GlcToRhn"] as const) {
      const answer = normalizeRouteWalletEligibility(
        routeDto({ route, source: null, destination: null }),
        route,
      );
      expect(answer.destinationSide).toMatchObject({
        evaluated: false,
        applicable: true,
      });
      expect(answer.eligible).toBe(false);
      expect(
        routeEligibilityVerdict({
          route,
          source: null,
          destination: SOL_RECIPIENT,
          pending: false,
          answer,
        }).kind,
      ).toBe("unavailable");
    }
  });

  it("never clears a side the backend reported as blocked, whatever `eligible` says", () => {
    // `eligible` is ANDed, never copied: the stricter of the top-level
    // flag and the legs wins.
    const answer = normalizeRouteWalletEligibility(
      routeDto({
        route: "GlcToRhn",
        source: null,
        destination: leg(EVM_WALLET, {
          eligible: false,
          reason: "wallet_destination_24h_limit",
          retry_after: NOW + 3_600,
          retry_after_seconds: 3_600,
        }),
        eligible: true,
      }),
      "GlcToRhn",
    );
    expect(answer.eligible).toBe(false);
    const verdict = routeEligibilityVerdict({
      route: "GlcToRhn",
      source: null,
      destination: EVM_WALLET,
      pending: false,
      answer,
    });
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind === "blocked") expect(verdict.sides).toEqual(["destination"]);
    expect(answer.destinationSide).toMatchObject({
      reason: "wallet_destination_24h_limit",
      retryAt: NOW + 3_600,
      remainingSeconds: 3_600,
    });
  });

  it("still refuses a BLOCKED source side on a route that has one", () => {
    const answer = normalizeRouteWalletEligibility(
      routeDto({
        route: "SolToRhn",
        source: leg(SOL_WALLET, {
          eligible: false,
          reason: "wallet_source_24h_limit",
          retry_after: NOW + 3_600,
          retry_after_seconds: 3_600,
        }),
        destination: leg(EVM_WALLET),
        eligible: false,
      }),
      "SolToRhn",
    );
    const verdict = routeEligibilityVerdict({
      route: "SolToRhn",
      source: SOL_WALLET,
      destination: EVM_WALLET,
      pending: false,
      answer,
    });
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind === "blocked") expect(verdict.sides).toEqual(["source"]);
  });

  it("accepts the backend's canonicalized echo of an EVM address it was sent mixed-case", () => {
    // The backend lowercases an EVM address before keying its window, so
    // its echo never matches the EIP-55 spelling a wallet reports as raw
    // text. Comparing them as text rejected the backend's answer to the
    // question the form had just asked.
    const answer = normalizeRouteWalletEligibility(
      routeDto({
        route: "RhnToSol",
        source: leg(EVM_WALLET.toLowerCase()),
        destination: leg(SOL_RECIPIENT),
      }),
      "RhnToSol",
    );
    expect(eligibilityMatchesInputs(answer, "RhnToSol", EVM_WALLET, SOL_RECIPIENT)).toBe(
      true,
    );
    expect(
      routeEligibilityVerdict({
        route: "RhnToSol",
        source: EVM_WALLET,
        destination: SOL_RECIPIENT,
        pending: false,
        answer,
      }).kind,
    ).toBe("eligible");
  });

  it("still compares a base58 address by case, where case IS the identity", () => {
    // Two base58 strings differing only in case are two different
    // pubkeys, not two spellings of one.
    const answer = normalizeRouteWalletEligibility(
      routeDto({
        route: "SolToRhn",
        source: leg(SOL_WALLET),
        destination: leg(EVM_WALLET.toLowerCase()),
      }),
      "SolToRhn",
    );
    expect(
      eligibilityMatchesInputs(answer, "SolToRhn", SOL_WALLET.toLowerCase(), EVM_WALLET),
    ).toBe(false);
  });

  it("refuses when no destination has been entered", () => {
    expect(verdictFor(null, { destination: "   " })).toEqual({
      kind: "unavailable",
      detail: "destination-unknown",
    });
  });

  it("refuses an answer about different inputs than the form now holds", () => {
    const answer = normalizeRecipientEligibility(dto(), "SolToGlc");
    expect(verdictFor(answer, { destination: "GdifferentAddress" })).toEqual({
      kind: "unavailable",
      detail: "answer-stale",
    });
    expect(verdictFor(answer, { source: "DifferentWallet11111111111111111111" })).toEqual(
      { kind: "unavailable", detail: "answer-stale" },
    );
  });

  it("refuses an answer that left the source side unevaluated", () => {
    // The backend was asked without `?wallet=`. Half an answer is not an
    // answer to a two-sided policy.
    const answer: RouteEligibility = {
      ...normalizeRecipientEligibility(dto({ wallet: null }), "SolToGlc"),
      source: SOL_WALLET,
    };
    expect(verdictFor(answer)).toEqual({
      kind: "unavailable",
      detail: "side-not-evaluated",
    });
  });

  it("blocks on the SOURCE side, and says so", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: NOW + 3_600,
      }),
      "SolToGlc",
    );
    const verdict = verdictFor(answer);
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind === "blocked") expect(verdict.sides).toEqual(["source"]);
    expect(eligibilityPermitsSubmission(verdict)).toBe(false);
  });

  it("blocks on the DESTINATION side, and says so", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: ["recipient_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        recipient_retry_after: NOW + 3_600,
      }),
      "SolToGlc",
    );
    const verdict = verdictFor(answer);
    if (verdict.kind === "blocked") expect(verdict.sides).toEqual(["destination"]);
    else expect.unreachable("expected a blocked verdict");
  });

  it("reports BOTH sides when both are inside their window, source first", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: NOW + 3_600,
        recipient_retry_after: NOW + 7_200,
      }),
      "SolToGlc",
    );
    const verdict = verdictFor(answer);
    if (verdict.kind === "blocked") {
      // Source first, matching the backend's own fold precedence.
      expect(verdict.sides).toEqual(["source", "destination"]);
      expect(eligibilityBlockedTitle(verdict.sides)).toBe(ELIGIBILITY_BLOCKED_BOTH_TITLE);
    } else expect.unreachable("expected a blocked verdict");
  });

  it("refuses `eligible: false` with no reason the backend named", () => {
    // Nothing here may invent a reason, and nothing here may let it
    // through.
    const answer: RouteEligibility = {
      ...normalizeRecipientEligibility(dto(), "SolToGlc"),
      eligible: false,
    };
    expect(verdictFor(answer)).toEqual({
      kind: "unavailable",
      detail: "request-failed",
    });
  });

  it("re-enables submission as soon as the backend says the window expired", () => {
    // The re-enable is the BACKEND's answer changing, not a local timer
    // reaching zero. Same inputs, later poll, eligible again.
    const blocked = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited"],
        retry_after: NOW + 60,
        retry_after_seconds: 60,
        source_wallet_retry_after: NOW + 60,
      }),
      "SolToGlc",
    );
    expect(verdictFor(blocked).kind).toBe("blocked");
    const cleared = normalizeRecipientEligibility(dto(), "SolToGlc");
    expect(verdictFor(cleared).kind).toBe("eligible");
  });
});

describe("the copy and the compact cooldown", () => {
  it("names which side a one-sided refusal is about", () => {
    expect(eligibilityBlockedTitle(["source"])).toBe(ELIGIBILITY_BLOCKED_TITLE.source);
    expect(eligibilityBlockedTitle(["destination"])).toBe(
      ELIGIBILITY_BLOCKED_TITLE.destination,
    );
    expect(ELIGIBILITY_BLOCKED_TITLE.source).toMatch(
      /already used on this route within the last 24 hours/,
    );
  });

  it("formats a wait as h/m, rounded UP", () => {
    const side = (remainingSeconds: number) => ({
      evaluated: true,
      eligible: false,
      retryAt: null,
      remainingSeconds,
      reason: "source_wallet_rate_limited",
      applicable: true,
    });
    expect(formatEligibilityCooldown(side(11_520), NOW)).toBe("3h 12m");
    expect(formatEligibilityCooldown(side(720), NOW)).toBe("12m");
    expect(formatEligibilityCooldown(side(3_600), NOW)).toBe("1h");
    expect(formatEligibilityCooldown(side(30), NOW)).toBe("under a minute");
    // Rounded up, so a user returning at the stated moment is not refused
    // again.
    expect(formatEligibilityCooldown(side(61), NOW)).toBe("2m");
  });

  it("prefers the absolute instant, which does not decay while the page sits open", () => {
    const side = {
      evaluated: true,
      eligible: false,
      retryAt: NOW + 7_200,
      // Deliberately disagreeing: measured against a backend clock that
      // has since moved on.
      remainingSeconds: 60,
      reason: "recipient_rate_limited",
      applicable: true,
    };
    expect(remainingSecondsFor(side, NOW)).toBe(7_200);
    expect(formatEligibilityCooldown(side, NOW)).toBe("2h");
  });

  it("renders nothing when the backend published no usable time", () => {
    // A window nobody published a reopen time for is not one this UI may
    // guess at.
    const side = {
      evaluated: true,
      eligible: false,
      retryAt: null,
      remainingSeconds: null,
      reason: "recipient_rate_limited",
      applicable: true,
    };
    expect(remainingSecondsFor(side, NOW)).toBeNull();
    expect(formatEligibilityCooldown(side, NOW)).toBeNull();
  });

  it("clamps a window that has already passed to zero rather than going negative", () => {
    const side = {
      evaluated: true,
      eligible: false,
      retryAt: NOW - 600,
      remainingSeconds: null,
      reason: "recipient_rate_limited",
      applicable: true,
    };
    expect(remainingSecondsFor(side, NOW)).toBe(0);
  });

  it("details every blocked side that has a published time, and only those", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "source_wallet_rate_limited",
        blocked_reasons: ["source_wallet_rate_limited", "recipient_rate_limited"],
        retry_after: NOW + 3_600,
        retry_after_seconds: 3_600,
        source_wallet_retry_after: NOW + 3_600,
        recipient_retry_after: NOW + 7_200,
      }),
      "SolToGlc",
    );
    const verdict = verdictFor(answer);
    if (verdict.kind !== "blocked") return expect.unreachable("expected blocked");
    const detail = eligibilityBlockedDetail(verdict, NOW);
    expect(detail).toContain("Source wallet is eligible again in 1h");
    expect(detail).toContain("Destination wallet is eligible again in 2h");
  });

  it("produces an empty detail when no side published a time", () => {
    const answer = normalizeRecipientEligibility(
      dto({
        eligible: false,
        blocked_reason: "recipient_rate_limited",
        blocked_reasons: ["recipient_rate_limited"],
        retry_after: null,
        retry_after_seconds: null,
        recipient_retry_after: null,
      }),
      "SolToGlc",
    );
    const verdict = verdictFor(answer);
    if (verdict.kind !== "blocked") return expect.unreachable("expected blocked");
    expect(eligibilityBlockedDetail(verdict, NOW)).toBe("");
  });
});
