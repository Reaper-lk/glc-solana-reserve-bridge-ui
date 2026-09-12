import type { Route } from "@/lib/api/schemas/common";
import type {
  RecipientEligibilityDto,
  RouteEligibilityDto,
  RouteEligibilitySideDto,
} from "@/lib/api/schemas/eligibility";
import { isUsableRetryTimestamp } from "./robinhood-predeposit";

/**
 * The rolling 24-hour WALLET ELIGIBILITY model, for all six routes, in
 * one place.
 *
 * # The policy
 *
 * For each route, the SOURCE wallet and the DESTINATION wallet may each be
 * used at most once within a rolling 24-hour window on that route. Two
 * independent windows, both enforced, and a transfer needs both sides
 * clear.
 *
 * # The backend owns the verdict; this module owns the shape
 *
 * Nothing here re-implements a window. There is no clock arithmetic that
 * decides eligibility, no cached "last used" value, and — deliberately —
 * no `localStorage`: a client-side record of what a wallet did is neither
 * authoritative nor tamper-proof, and treating one as enforcement would be
 * a second policy free to disagree with the real one. Every verdict below
 * is a normalisation of what the backend answered.
 *
 * What this module adds is a SINGLE normalised shape, so the form asks the
 * same question about every route and reads the same answer back. The
 * backend's own responses are per-route and asymmetric (see
 * `./eligibility-endpoints` below), and spreading that asymmetry across
 * the form is how a route quietly ends up ungated.
 *
 * # Fail closed, everywhere
 *
 * An answer that did not arrive, could not be read, was about different
 * inputs, or left one of the two sides unevaluated is NOT eligibility. All
 * of them resolve to {@link EligibilityVerdict} `unavailable`, which
 * disables submission. The cost of a wrong "no" is a retry; the cost of a
 * wrong "yes" on a contract-sourced route is a user's GLC parked in
 * `ManualReview` with the deposit already made.
 *
 * Specifically, `eligible` is never SYNTHESISED. There is no branch in
 * this file that produces an eligible verdict from anything other than a
 * backend response that said so about these exact inputs.
 */

/**
 * Raised when the deployment being talked to serves no eligibility
 * endpoint for a route.
 *
 * A distinct type rather than a generic failure because the two mean
 * different things to an operator: a transport error is transient, and
 * this is an endpoint that is not there. Both block submission
 * identically — this only selects which sentence is shown.
 *
 * Lives here, in the pure model, rather than beside the client that
 * raises it: `HttpBridgeClient` needs it, and importing it from the
 * request module (which imports the API barrel, which constructs the HTTP
 * client) would close a runtime import cycle.
 */
export class EligibilityEndpointUnpublishedError extends Error {
  readonly route: string;

  constructor(route: string) {
    super(`this deployment serves no rolling-24h eligibility endpoint for ${route}`);
    this.name = "EligibilityEndpointUnpublishedError";
    this.route = route;
  }
}

/** Whether a thrown value is that error, across module realms. */
export function isEligibilityEndpointUnpublished(error: unknown): boolean {
  return (
    error instanceof EligibilityEndpointUnpublishedError ||
    (error instanceof Error && error.name === "EligibilityEndpointUnpublishedError")
  );
}

/** Every route the bridge runs. All six are gated. */
export const ELIGIBILITY_ROUTES = [
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
  "SolToRhn",
  "RhnToSol",
] as const;

export type EligibilityRoute = (typeof ELIGIBILITY_ROUTES)[number];

export function isEligibilityRoute(route: Route | string): route is EligibilityRoute {
  return (ELIGIBILITY_ROUTES as readonly string[]).includes(route);
}

/**
 * Which side of a route a verdict is about.
 *
 * Named by ROLE rather than by chain, because the same chain is the source
 * on one route and the destination on another and the window is per route
 * per role.
 */
export type EligibilitySide = "source" | "destination";

/**
 * Where the authoritative answer for a route comes from.
 *
 * # What has landed, and what has not
 *
 * The backend (glc-solana-reserve-bridge, `service/src/api.rs`) publishes
 * exactly TWO eligibility endpoints today, both for routes whose payout
 * lands on Goldcoin:
 *
 * | route | endpoint | source param | destination param |
 * |---|---|---|---|
 * | `SolToGlc` | `GET /recipients/sol-to-glc/eligibility` | `?wallet=` (base58 Solana pubkey) | `?address=` (Goldcoin P2PKH) |
 * | `RhnToGlc` | `GET /recipients/rhn-to-glc/eligibility` | `?wallet=` (0x EVM address) | `?address=` (Goldcoin P2PKH) |
 *
 * Both return the one `RecipientEligibility` shape, built by the same
 * `RecipientEligibility::from_windows`, carrying BOTH sides at once: the
 * `source_wallet_*` fields are this module's source side and the
 * `recipient_*` fields are its destination side.
 *
 * The other four routes — `GlcToSol`, `GlcToRhn`, `SolToRhn`, `RhnToSol`
 * — have NO published endpoint. That is a backend dependency, tracked in
 * {@link ELIGIBILITY_BACKEND_DEPENDENCY}, and this module reports it as
 * `null` here rather than papering over it. A `null` endpoint is not
 * permission and not an absence of policy: it means no authoritative
 * answer can be obtained, which {@link routeEligibilityVerdict} resolves
 * to `unavailable` and the form treats as a refusal.
 *
 * # When the generic endpoint lands
 *
 * The expected replacement is one route-agnostic endpoint —
 * `GET /eligibility?route=<Route>&source=<address>&destination=<address>`
 * — carrying an overall verdict plus a per-side verdict with
 * `retry_at`/`remaining_seconds`/`reason`, and an `as_of`. When it ships,
 * this table gains six entries and {@link normalizeRouteEligibility}
 * gains one more input shape. Nothing else in the UI changes: the form,
 * the submit gate and the display all read {@link RouteEligibility}
 * already, which is the entire reason this indirection exists.
 */
export interface EligibilityEndpoint {
  readonly route: EligibilityRoute;
  /** Documentation value — the path the client actually calls. */
  readonly path: string;
  /** How the source wallet is spelled on the wire. */
  readonly sourceSpelling: "solana-base58" | "evm-hex" | "goldcoin-base58check";
  /** How the destination wallet is spelled on the wire. */
  readonly destinationSpelling: "solana-base58" | "evm-hex" | "goldcoin-base58check";
}

const ENDPOINTS: { readonly [K in EligibilityRoute]: EligibilityEndpoint | null } = {
  SolToGlc: {
    route: "SolToGlc",
    path: "/recipients/sol-to-glc/eligibility",
    sourceSpelling: "solana-base58",
    destinationSpelling: "goldcoin-base58check",
  },
  RhnToGlc: {
    route: "RhnToGlc",
    path: "/recipients/rhn-to-glc/eligibility",
    sourceSpelling: "evm-hex",
    destinationSpelling: "goldcoin-base58check",
  },
  // Awaiting the backend's route-agnostic endpoint. Never a fallback to
  // one of the two above: those answer about GOLDCOIN payout windows and
  // would be the wrong question on a route that pays out elsewhere.
  GlcToSol: null,
  GlcToRhn: null,
  SolToRhn: null,
  RhnToSol: null,
};

export function eligibilityEndpointFor(
  route: EligibilityRoute,
): EligibilityEndpoint | null {
  return ENDPOINTS[route];
}

/** Whether the backend publishes an authoritative answer for this route yet. */
export function hasAuthoritativeEligibility(route: EligibilityRoute): boolean {
  return ENDPOINTS[route] !== null;
}

/** The routes still waiting on the backend, for docs and diagnostics. */
export const ELIGIBILITY_BACKEND_DEPENDENCY = {
  /** Routes with a landed, authoritative endpoint. */
  covered: ELIGIBILITY_ROUTES.filter((route) => ENDPOINTS[route] !== null),
  /** Routes whose endpoint has not landed; submission is blocked on them. */
  pending: ELIGIBILITY_ROUTES.filter((route) => ENDPOINTS[route] === null),
  /** The shape this UI expects the route-agnostic endpoint to take. */
  expected:
    "GET /eligibility?route=<Route>&source=<address>&destination=<address> " +
    "-> { route, source, destination, eligible, as_of, window_seconds, " +
    "source: { eligible, retry_at, remaining_seconds, reason }, " +
    "destination: { eligible, retry_at, remaining_seconds, reason } }",
} as const;

/**
 * One wallet's side of a verdict.
 *
 * `evaluated` is separate from `eligible` on purpose. The backend's
 * `wallet` leg is optional — omit `?wallet=` and it is simply not checked
 * — and "not checked" must never read as "checked and clear". A side that
 * was not evaluated fails the whole verdict closed.
 */
export interface WalletEligibility {
  /** Whether the backend actually answered about this side. */
  readonly evaluated: boolean;
  /** Only meaningful when `evaluated`. */
  readonly eligible: boolean;
  /** Absolute unix second the window reopens; `null` when not blocked or not published. */
  readonly retryAt: number | null;
  /** The same wait in seconds; `null` when not blocked or not published. */
  readonly remainingSeconds: number | null;
  /** The backend's own machine-readable reason, verbatim; `null` when clear. */
  readonly reason: string | null;
  /**
   * Whether this side's window governs this route at all — **said by the
   * backend, never decided here.**
   *
   * `false` is not an exemption this UI grants itself. It is the backend
   * reporting that a side is outside the rule, which one route family
   * genuinely requires: `GlcToSol`/`GlcToRhn` are funded by sending GLC
   * to an address the backend issues, so no source wallet exists in the
   * browser and the source side can only be enforced at fold time. The
   * alternative would be a gate no answer could ever satisfy.
   *
   * Defaults to `true` everywhere it is not explicitly published, so a
   * backend that omits it gets the strict reading.
   */
  readonly applicable: boolean;
}

const NOT_EVALUATED: WalletEligibility = {
  evaluated: false,
  eligible: false,
  retryAt: null,
  remainingSeconds: null,
  reason: null,
  applicable: true,
};

const CLEAR: WalletEligibility = {
  evaluated: true,
  eligible: true,
  retryAt: null,
  remainingSeconds: null,
  reason: null,
  applicable: true,
};

/**
 * A side the backend reported as outside this route's rule.
 *
 * Distinct from {@link CLEAR}: that is "checked and fine", this is "not
 * this route's question". Both permit submission; only one of them is a
 * statement about a wallet.
 */
const NOT_APPLICABLE: WalletEligibility = {
  evaluated: true,
  eligible: true,
  retryAt: null,
  remainingSeconds: null,
  reason: null,
  applicable: false,
};

/**
 * A normalised, both-sides answer about ONE route and ONE pair of
 * addresses.
 *
 * The addresses are carried so a caller can prove the answer is about the
 * inputs it currently holds. That is not belt-and-braces: React Query
 * keys these values, but an in-flight response for a superseded address is
 * still a well-formed "eligible" that must not authorize a deposit whose
 * inputs it never saw.
 */
export interface RouteEligibility {
  readonly route: EligibilityRoute;
  /** The source wallet this answer is about; `null` when none was supplied. */
  readonly source: string | null;
  readonly destination: string;
  /** `true` only when BOTH sides were evaluated and both are clear. */
  readonly eligible: boolean;
  readonly sourceSide: WalletEligibility;
  readonly destinationSide: WalletEligibility;
  /** The rolling window itself, from the backend — never hardcoded here. */
  readonly windowSeconds: number;
  /** When the backend computed this, when it says; `null` when it does not. */
  readonly asOf: number | null;
}

/** The backend's `blocked_reason` spellings, as constants. */
export const REASON_SOURCE_WALLET_RATE_LIMITED = "source_wallet_rate_limited";
export const REASON_DESTINATION_RATE_LIMITED = "recipient_rate_limited";

/**
 * Maps a `RecipientEligibility` response onto {@link RouteEligibility}.
 *
 * The mapping is the whole point and it is deliberately literal:
 *
 * - source side ← `source_wallet_retry_after` / `source_wallet_rate_limited`
 * - destination side ← `recipient_retry_after` / `recipient_rate_limited`
 *
 * The backend's per-side `*_retry_after` fields are preferred over the
 * aggregate `retry_after` pair, which describes only whichever single
 * limit `blocked_reason` named. Where a per-side instant exists, the
 * remaining seconds are re-based against the aggregate pair the backend
 * computed at the same instant — so no clock on this machine ever enters
 * the arithmetic.
 *
 * `evaluated` for the source side is `wallet !== null`: the backend
 * echoes the wallet back precisely so a caller can tell "the wallet leg
 * was not evaluated" from "it was evaluated and found eligible". The
 * destination side is always evaluated — `?address=` is required.
 *
 * `eligible` is recomputed from the two sides rather than copied from the
 * response's own top-level `eligible`, and the two cannot disagree in a
 * way that lets something through: the response's flag is `AND`ed in, so
 * the result is the stricter of the two readings.
 */
export function normalizeRecipientEligibility(
  dto: RecipientEligibilityDto,
  route: EligibilityRoute,
): RouteEligibility {
  const blocking = new Set<string>([
    ...(dto.blocked_reasons ?? []),
    ...(dto.blocked_reason ? [dto.blocked_reason] : []),
  ]);

  const perSide = (
    side: EligibilitySide,
    reason: string,
    perSideRetryAt: number | null | undefined,
  ): WalletEligibility => {
    // `== null` rather than `=== null`: an absent field and an explicit
    // null both mean "the wallet leg was not evaluated", and a response
    // that omitted it must fail closed exactly as one that nulled it.
    if (side === "source" && dto.wallet == null) return NOT_EVALUATED;
    if (!blocking.has(reason)) return CLEAR;
    const aggregateIsThisSide = dto.blocked_reason === reason;
    const retryAt =
      (isUsableRetryTimestamp(perSideRetryAt) ? perSideRetryAt : null) ??
      (aggregateIsThisSide && isUsableRetryTimestamp(dto.retry_after)
        ? dto.retry_after
        : null);
    const remainingSeconds =
      isUsableRetryTimestamp(perSideRetryAt) &&
      isUsableRetryTimestamp(dto.retry_after) &&
      dto.retry_after_seconds !== null
        ? // Re-based against the backend's own pair, computed at one instant.
          Math.max(0, dto.retry_after_seconds + (perSideRetryAt - dto.retry_after))
        : aggregateIsThisSide
          ? (dto.retry_after_seconds ?? null)
          : null;
    return {
      evaluated: true,
      eligible: false,
      retryAt,
      remainingSeconds,
      reason,
      // The per-route endpoints govern both sides unconditionally; they
      // have no notion of a side being out of scope.
      applicable: true,
    };
  };

  const sourceSide = perSide(
    "source",
    REASON_SOURCE_WALLET_RATE_LIMITED,
    dto.source_wallet_retry_after,
  );
  const destinationSide = perSide(
    "destination",
    REASON_DESTINATION_RATE_LIMITED,
    dto.recipient_retry_after,
  );

  return {
    route,
    source: dto.wallet ?? null,
    destination: dto.address,
    // The stricter of "both sides clear" and the backend's own flag.
    eligible:
      dto.eligible &&
      sourceSide.evaluated &&
      sourceSide.eligible &&
      destinationSide.evaluated &&
      destinationSide.eligible,
    sourceSide,
    destinationSide,
    windowSeconds: dto.window_seconds,
    // `RecipientEligibility` publishes no `as_of`. Absent, never invented.
    asOf: null,
  };
}

/**
 * Maps a route-agnostic `RouteEligibility` response onto the same
 * {@link RouteEligibility} shape the per-route endpoints produce.
 *
 * Two normalisers, one output type — which is the whole reason the form
 * reads a normalised verdict rather than a response. A caller cannot tell
 * which endpoint answered, and nothing downstream branches on it.
 *
 * `applicable` defaults to `true` when the field is absent: an omitted
 * flag must never exempt a side. `evaluated` is `true` for any side the
 * response carried, because this endpoint takes both addresses and
 * answers about both — unlike the per-route pair, whose `?wallet=` is
 * optional and whose omission is the "not evaluated" case.
 */
export function normalizeRouteEligibility(
  dto: RouteEligibilityDto,
  route: EligibilityRoute,
): RouteEligibility {
  const side = (payload: RouteEligibilitySideDto): WalletEligibility => {
    const applicable = payload.applicable ?? true;
    if (!applicable) return NOT_APPLICABLE;
    if (payload.eligible) return CLEAR;
    return {
      evaluated: true,
      eligible: false,
      retryAt: isUsableRetryTimestamp(payload.retry_at) ? payload.retry_at : null,
      remainingSeconds:
        payload.remaining_seconds === null || payload.remaining_seconds === undefined
          ? null
          : payload.remaining_seconds,
      reason: payload.reason ?? null,
      applicable: true,
    };
  };

  const sourceSide = side(dto.source_eligibility);
  const destinationSide = side(dto.destination_eligibility);

  return {
    route,
    source: dto.source ?? null,
    destination: dto.destination,
    // The stricter of "every applicable side is clear" and the backend's
    // own flag, exactly as the per-route normaliser does it.
    eligible:
      dto.eligible &&
      (!sourceSide.applicable || (sourceSide.evaluated && sourceSide.eligible)) &&
      (!destinationSide.applicable ||
        (destinationSide.evaluated && destinationSide.eligible)),
    sourceSide,
    destinationSide,
    windowSeconds: dto.window_seconds,
    asOf: dto.as_of ?? null,
  };
}

/**
 * Whether a held answer is about the inputs being asked about right now.
 *
 * Wallet comparison is case-insensitive: the backend returns `0x`-prefixed
 * lowercase hex while a browser wallet reports the EIP-55 mixed-case
 * spelling of the same 20 bytes. Goldcoin and Solana addresses are
 * case-SENSITIVE (Base58Check and base58 both encode information in case),
 * so the destination is compared exactly.
 */
export function eligibilityMatchesInputs(
  answer: RouteEligibility,
  route: EligibilityRoute,
  source: string | null,
  destination: string,
): boolean {
  if (answer.route !== route) return false;
  if (answer.destination !== destination) return false;
  // `== null` throughout: a malformed answer with the field absent is
  // indistinguishable from one that nulled it, and both must fail closed
  // rather than throw on a property read.
  if (source === null) return answer.source == null;
  if (answer.source == null) return false;
  return answer.source.toLowerCase() === source.toLowerCase();
}

/** Why submission is not permitted, or that it is. */
export type EligibilityVerdict =
  /** Both sides positively cleared, for these exact inputs. */
  | { readonly kind: "eligible"; readonly answer: RouteEligibility }
  /** A request is in flight. Holds submission without claiming a limit. */
  | { readonly kind: "checking" }
  /** The backend says one or both sides are inside the rolling window. */
  | {
      readonly kind: "blocked";
      readonly answer: RouteEligibility;
      /** Source first when both are blocked, matching the backend's precedence. */
      readonly sides: readonly EligibilitySide[];
    }
  /**
   * No authoritative answer could be established: no endpoint published
   * for this route, a read that failed, a response about other inputs, or
   * a side the backend never evaluated.
   */
  | { readonly kind: "unavailable"; readonly detail: EligibilityUnavailableDetail };

export type EligibilityUnavailableDetail =
  /** The backend publishes no endpoint for this route yet. */
  | "endpoint-not-published"
  /** The request failed, or returned something unreadable. */
  | "request-failed"
  /** No source wallet is connected, so the source side cannot be asked about. */
  | "source-unknown"
  /** No destination address entered or it has not validated. */
  | "destination-unknown"
  /** The answer held is about a different route, address or wallet. */
  | "answer-stale"
  /** The backend answered but left one of the two sides unevaluated. */
  | "side-not-evaluated";

export interface RouteEligibilityInput {
  readonly route: EligibilityRoute;
  /** The connected source wallet, or `null` when there is none. */
  readonly source: string | null;
  /** The trimmed destination address, or `""` when not entered/valid. */
  readonly destination: string;
  /** A request is in flight and no usable answer is held yet. */
  readonly pending: boolean;
  /** The last answer received, or `null` for failed/absent. */
  readonly answer: RouteEligibility | null;
  /**
   * The request failed because the deployment serves no eligibility
   * endpoint for this route (`EligibilityEndpointUnpublishedError`).
   *
   * Purely a message selector: it chooses `endpoint-not-published` over
   * `request-failed`, and both are the same refusal. It is read from the
   * error the CLIENT raised rather than from any table here, because what
   * gates a transfer is whether an authoritative answer actually arrived
   * — never a compile-time claim about what the backend ought to serve.
   */
  readonly endpointUnpublished?: boolean;
}

/**
 * The whole gate as one pure function — used by the form to disable the
 * button AND by the submit path to refuse a click, so the two can never
 * disagree about what "eligible" means.
 *
 * # The only way through is a real answer
 *
 * There is deliberately no branch that consults {@link ENDPOINTS} to
 * decide whether a route MAY pass. That table records what the backend
 * publishes today and is worth keeping accurate, but a gate resting on it
 * would be trusting a compile-time claim: it would refuse a route the
 * backend has since started answering for, and — the direction that
 * matters — it could be loosened by editing a constant rather than by
 * obtaining a verdict. So the question this function asks is only ever
 * "did an authoritative answer arrive, about these exact inputs, clearing
 * every side the backend says applies". A deployment whose endpoint 404s
 * produces no answer and is refused; nothing else changes that.
 *
 * Order matters. Structural refusals come first — no inputs to ask about —
 * because they are facts about the question rather than answers to it, and
 * reporting them as "checking…" would promise a verdict that is not
 * coming.
 */
export function routeEligibilityVerdict(
  input: RouteEligibilityInput,
): EligibilityVerdict {
  if (input.destination.trim() === "") {
    return { kind: "unavailable", detail: "destination-unknown" };
  }
  if (input.answer === null) {
    // Pending is distinguished from failed only so the UI can say
    // "checking" rather than "unavailable". Both block submission.
    if (input.pending) return { kind: "checking" };
    return {
      kind: "unavailable",
      detail: input.endpointUnpublished ? "endpoint-not-published" : "request-failed",
    };
  }
  const answer = input.answer;
  if (!eligibilityMatchesInputs(answer, input.route, input.source, input.destination)) {
    return { kind: "unavailable", detail: "answer-stale" };
  }
  // A side the BACKEND reported as outside this route's rule needs no
  // verdict. A side it did not exempt needs one, and an unevaluated one
  // is not it — see `WalletEligibility.applicable`, and note that an
  // absent flag reads as applicable so a silence cannot exempt anything.
  if (
    (answer.sourceSide.applicable && !answer.sourceSide.evaluated) ||
    (answer.destinationSide.applicable && !answer.destinationSide.evaluated)
  ) {
    return { kind: "unavailable", detail: "side-not-evaluated" };
  }
  // A route whose source side IS in scope cannot be cleared without a
  // source wallet to ask about. Checked against the answer rather than
  // against the form alone, so "this route has no client-side source
  // wallet" stays the backend's statement and never this UI's assumption.
  if (answer.sourceSide.applicable && input.source === null) {
    return { kind: "unavailable", detail: "source-unknown" };
  }
  const sides: EligibilitySide[] = [];
  // Source first, matching the backend's own fold precedence.
  if (answer.sourceSide.applicable && !answer.sourceSide.eligible) sides.push("source");
  if (answer.destinationSide.applicable && !answer.destinationSide.eligible) {
    sides.push("destination");
  }
  if (sides.length > 0) return { kind: "blocked", answer, sides };
  if (!answer.eligible) {
    // Every applicable side read clear and the backend still refused.
    // Nothing here may invent the reason, and nothing here may let it
    // through.
    return { kind: "unavailable", detail: "request-failed" };
  }
  return { kind: "eligible", answer };
}

/** Whether a verdict permits submission. Exactly one kind does. */
export function eligibilityPermitsSubmission(verdict: EligibilityVerdict): boolean {
  return verdict.kind === "eligible";
}

/* ---------------------------------------------------------------------- *
 * Copy
 * ---------------------------------------------------------------------- */

/**
 * The blocked sentence, per side.
 *
 * One sentence, naming which wallet it is about. A user with a wallet
 * connected on one side and an address pasted on the other has to be able
 * to tell which of the two the bridge is refusing, and "this wallet" alone
 * does not say.
 */
export const ELIGIBILITY_BLOCKED_TITLE: { readonly [K in EligibilitySide]: string } = {
  source: "This wallet was already used on this route within the last 24 hours.",
  destination:
    "This destination wallet was already used on this route within the last 24 hours.",
};

/** Both sides inside their window at once. */
export const ELIGIBILITY_BLOCKED_BOTH_TITLE =
  "Both wallets were already used on this route within the last 24 hours.";

/**
 * Shown when no authoritative answer could be established — a failed
 * read, a route the backend does not publish yet, a stale answer.
 *
 * It says the CHECK did not complete, never that the user is rate
 * limited: asserting a limit the backend never asserted is its own wrong
 * answer, and the two have different remedies.
 */
export const ELIGIBILITY_UNAVAILABLE_TITLE =
  "Wallet eligibility check is temporarily unavailable.";

export const ELIGIBILITY_UNAVAILABLE_NEXT =
  "Submitting stays disabled until this check succeeds, because a transfer that the bridge would hold back cannot be reversed once it is sent. Try again in a moment.";

/** The compact row label while a request is in flight. */
export const ELIGIBILITY_CHECKING_LABEL = "Checking…";

/** The compact row labels for a settled verdict. */
export const ELIGIBILITY_ELIGIBLE_LABEL = "Eligible";
export const ELIGIBILITY_BLOCKED_LABEL = "Used in last 24h";
export const ELIGIBILITY_UNAVAILABLE_LABEL = "Unavailable";

/** The row labels for each side. */
export const ELIGIBILITY_SIDE_LABEL: { readonly [K in EligibilitySide]: string } = {
  source: "Source wallet",
  destination: "Destination wallet",
};

/**
 * "3h 12m" / "12m" / "under a minute" — the compact wait shown beside a
 * blocked row.
 *
 * Rounded UP to the next minute, so the stated wait is never shorter than
 * the real one and a user coming back at exactly that moment is not
 * refused again. `null` when the backend published no usable time, which
 * renders nothing: a window nobody published a reopen time for is not one
 * this UI may guess at.
 */
export function formatEligibilityCooldown(
  side: WalletEligibility,
  nowSeconds: number,
): string | null {
  const seconds = remainingSecondsFor(side, nowSeconds);
  if (seconds === null) return null;
  if (seconds < 60) return "under a minute";
  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * The remaining wait in seconds, preferring the absolute instant.
 *
 * `retryAt` is an instant and stays correct however long the page sits
 * open; `remainingSeconds` was measured against a backend clock that has
 * since moved on, and is the fallback for a response that carried only
 * that. `nowSeconds` is passed in rather than read here so the value is
 * one a caller can hold still across a render.
 */
export function remainingSecondsFor(
  side: WalletEligibility,
  nowSeconds: number,
): number | null {
  if (isUsableRetryTimestamp(side.retryAt)) {
    return Math.max(0, side.retryAt - nowSeconds);
  }
  if (side.remainingSeconds !== null && Number.isFinite(side.remainingSeconds)) {
    return Math.max(0, side.remainingSeconds);
  }
  return null;
}

/** The blocked title for a set of blocked sides. */
export function eligibilityBlockedTitle(sides: readonly EligibilitySide[]): string {
  if (sides.length >= 2) return ELIGIBILITY_BLOCKED_BOTH_TITLE;
  return ELIGIBILITY_BLOCKED_TITLE[sides[0] ?? "source"];
}

/**
 * The one extra sentence under a blocked callout: which side, and when it
 * reopens. Empty when the backend published no usable time.
 */
export function eligibilityBlockedDetail(
  verdict: Extract<EligibilityVerdict, { kind: "blocked" }>,
  nowSeconds: number,
): string {
  const parts: string[] = [];
  for (const side of verdict.sides) {
    const answerSide =
      side === "source" ? verdict.answer.sourceSide : verdict.answer.destinationSide;
    const wait = formatEligibilityCooldown(answerSide, nowSeconds);
    if (wait !== null) {
      parts.push(`${ELIGIBILITY_SIDE_LABEL[side]} is eligible again in ${wait}.`);
    }
  }
  return parts.join(" ");
}
