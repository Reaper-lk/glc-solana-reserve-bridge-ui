import type { Route } from "@/lib/api/schemas/common";
import type {
  RecipientEligibilityDto,
  RouteWalletEligibilityDto,
  WalletLegDto,
} from "@/lib/api/schemas/eligibility";
import { directions } from "./direction";
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
 * # What the backend actually serves
 *
 * Three endpoints, all landed (glc-solana-reserve-bridge,
 * `service/src/api.rs`):
 *
 * | route | endpoint | source param | destination param |
 * |---|---|---|---|
 * | `SolToGlc` | `GET /recipients/sol-to-glc/eligibility` | `?wallet=` (base58 Solana pubkey) | `?address=` (Goldcoin P2PKH) |
 * | `RhnToGlc` | `GET /recipients/rhn-to-glc/eligibility` | `?wallet=` (0x EVM address) | `?address=` (Goldcoin P2PKH) |
 * | all six | `GET /routes/{route}/eligibility` | `?source=` (the route's source chain) | `?destination=` (the route's destination chain) |
 *
 * The two `/recipients/*` endpoints return `RecipientEligibility`, built
 * by `RecipientEligibility::from_windows`, carrying both sides at once:
 * the `source_wallet_*` fields are this module's source side and the
 * `recipient_*` fields are its destination side.
 *
 * The route-generic endpoint returns `RouteWalletEligibilityView`: one
 * NULLABLE leg object per side, where a `null` leg means that side was
 * not asked about and therefore not evaluated.
 *
 * # Why the two per-route endpoints are still used where they exist
 *
 * The route-generic endpoint covers all six and could replace them. It is
 * not used for `SolToGlc`/`RhnToGlc` because those two paths are the ones
 * in production service today, verified against the live deployment;
 * moving them is a change with no defect behind it. The four routes that
 * had no working path are the ones this table now points at
 * `/routes/{route}/eligibility`.
 *
 * # What this table is NOT
 *
 * It is documentation and diagnostics. {@link routeEligibilityVerdict}
 * deliberately never consults it: what gates a transfer is whether an
 * authoritative answer actually ARRIVED, never a compile-time claim about
 * what the backend ought to serve. A wrong entry here makes a doc wrong;
 * it cannot make a refusal into a clearance.
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

const ENDPOINTS: { readonly [K in EligibilityRoute]: EligibilityEndpoint } = {
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
  // The route-generic endpoint, for the four routes no `/recipients/*`
  // path answers about. Never a fallback to one of the two above: those
  // answer about GOLDCOIN payout windows and would be the wrong question
  // on a route that pays out elsewhere.
  GlcToSol: {
    route: "GlcToSol",
    path: "/routes/GlcToSol/eligibility",
    sourceSpelling: "goldcoin-base58check",
    destinationSpelling: "solana-base58",
  },
  GlcToRhn: {
    route: "GlcToRhn",
    path: "/routes/GlcToRhn/eligibility",
    sourceSpelling: "goldcoin-base58check",
    destinationSpelling: "evm-hex",
  },
  SolToRhn: {
    route: "SolToRhn",
    path: "/routes/SolToRhn/eligibility",
    sourceSpelling: "solana-base58",
    destinationSpelling: "evm-hex",
  },
  RhnToSol: {
    route: "RhnToSol",
    path: "/routes/RhnToSol/eligibility",
    sourceSpelling: "evm-hex",
    destinationSpelling: "solana-base58",
  },
};

export function eligibilityEndpointFor(route: EligibilityRoute): EligibilityEndpoint {
  return ENDPOINTS[route];
}

/**
 * Whether an endpoint EXISTS for this route in the backend's API.
 *
 * Total over `EligibilityRoute` since the route-generic endpoint landed,
 * which is why this reads from the type rather than probing the table:
 * the compiler, not a runtime lookup, is what guarantees a seventh route
 * cannot be added without an entry.
 *
 * This is a statement about the API, NOT about a deployment. An older
 * deployment can still 404 the path, which is a runtime fact discovered
 * by asking — `EligibilityEndpointUnpublishedError` — and it refuses.
 * Nothing gates on this function; see {@link routeEligibilityVerdict}.
 */
export function hasAuthoritativeEligibility(route: EligibilityRoute): boolean {
  return isEligibilityRoute(route);
}

/**
 * Whether this route's SOURCE wallet can be known in the browser before
 * the transfer exists — the one structural fact that decides whether an
 * unevaluated source leg is a refusal or a non-question.
 *
 * # Why this is a route TOPOLOGY fact and not a permission
 *
 * `GlcToSol` and `GlcToRhn` are funded by sending GLC to a per-request
 * address the backend issues (`funding: "goldcoin-deposit-address"`).
 * There is no connected Goldcoin wallet, no signature, and no way for the
 * page to learn which address the user will send from until the deposit
 * is observed on-chain. Asking the backend about a source wallet on those
 * routes is not a question that has an answer, and FABRICATING one to
 * make the gate satisfiable would be strictly worse than not asking: it
 * would produce an authoritative-looking clearance about an address no
 * deposit will ever come from.
 *
 * So the pre-submit check asks about the destination only, and the source
 * side is not a gate this UI can hold. The rule itself is untouched: the
 * backend enforces the real Goldcoin source window at admission, against
 * the wallets the deposit was REALLY funded from, and parks a violation
 * in `ManualReview`. Nothing here can weaken that, and nothing here
 * pretends to be it.
 *
 * # Read from the direction table, not restated
 *
 * The funding kind lives in `./direction` and is the same value the form
 * uses to decide whether a source wallet exists to connect at all. Deriving
 * it keeps one source of truth: a route whose funding changes cannot end
 * up exempt here and gated there.
 */
export function sourceWalletKnownInBrowser(route: EligibilityRoute): boolean {
  return directions[route].funding !== "goldcoin-deposit-address";
}

/** The endpoint coverage, for docs and diagnostics. */
export const ELIGIBILITY_BACKEND_DEPENDENCY = {
  /** Routes with a landed, authoritative endpoint — all six. */
  covered: ELIGIBILITY_ROUTES.filter(hasAuthoritativeEligibility),
  /**
   * Routes whose endpoint has not landed. Empty: `ENDPOINTS` is total
   * over the six. Kept so the shape of this record does not change if the
   * bridge ever adds a route ahead of its endpoint.
   */
  pending: ELIGIBILITY_ROUTES.filter((route) => !hasAuthoritativeEligibility(route)),
  /**
   * Routes whose source wallet the browser cannot know pre-submit, so the
   * pre-submit check sends `?destination=` only and the source window is
   * enforced backend-side at admission.
   */
  sourceEnforcedAtAdmission: ELIGIBILITY_ROUTES.filter(
    (route) => !sourceWalletKnownInBrowser(route),
  ),
  /** The route-generic shape, as served. */
  generic:
    "GET /routes/{route}/eligibility?source=<address>&destination=<address> " +
    "-> { route, source: leg|null, destination: leg|null, eligible, " +
    "blocked_reason, blocked_reasons, retry_after, retry_after_seconds, " +
    "window_seconds, as_of }, leg = { address, eligible, reason, " +
    "retry_after, retry_after_seconds }",
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
   * Whether this side's window is a gate the BROWSER can hold before the
   * transfer is submitted.
   *
   * `false` is not an exemption from the rule and not a permission this
   * UI grants a wallet. It marks the one case where there is no wallet to
   * ask about: `GlcToSol`/`GlcToRhn` are funded by sending GLC to an
   * address the backend issues, so no source wallet exists in the browser
   * and none can be learned until the deposit is observed on-chain. The
   * backend still enforces that window at admission, against the wallet
   * the deposit was really funded from. See
   * {@link sourceWalletKnownInBrowser}, which is the only thing that
   * produces a `false` here, and only for the source side.
   *
   * `true` everywhere else, including every side either normaliser is
   * unsure about — an unevaluated side is `applicable` and therefore
   * fails the verdict closed.
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
 * Maps a `RouteWalletEligibilityView` response — the route-generic
 * `GET /routes/{route}/eligibility` — onto the same
 * {@link RouteEligibility} shape the per-route endpoints produce.
 *
 * Two normalisers, one output type — which is the whole reason the form
 * reads a normalised verdict rather than a response. A caller cannot tell
 * which endpoint answered, and nothing downstream branches on it.
 *
 * # A `null` leg, and the single exception
 *
 * The backend returns a leg object per side it evaluated and `null` for a
 * side it was not asked about. `null` is NOT a clearance, so it maps to
 * {@link NOT_EVALUATED}, which fails the whole verdict closed.
 *
 * The one exception is the source leg of a route whose source wallet
 * cannot exist in the browser — see {@link sourceWalletKnownInBrowser}
 * for why that is a structural fact about how the route is funded rather
 * than an exemption granted here, and why the rule is still enforced,
 * backend-side, against the wallet the deposit really came from. On those
 * routes a `null` source is {@link NOT_APPLICABLE}: not a question this
 * check can ask, and so not a gate it can hold.
 *
 * That exception is deliberately narrow. It applies only to the SOURCE
 * side, only on routes the direction table marks
 * `goldcoin-deposit-address`, and only when the backend confirms it
 * evaluated nothing there. A `null` DESTINATION leg, or a `null` source
 * on any other route, is still a refusal.
 */
export function normalizeRouteWalletEligibility(
  dto: RouteWalletEligibilityDto,
  route: EligibilityRoute,
): RouteEligibility {
  const leg = (
    payload: WalletLegDto | null,
    side: EligibilitySide,
  ): WalletEligibility => {
    if (payload === null) {
      if (side === "source" && !sourceWalletKnownInBrowser(route)) {
        return NOT_APPLICABLE;
      }
      return NOT_EVALUATED;
    }
    if (payload.eligible) return CLEAR;
    return {
      evaluated: true,
      eligible: false,
      retryAt: isUsableRetryTimestamp(payload.retry_after) ? payload.retry_after : null,
      remainingSeconds: payload.retry_after_seconds ?? null,
      reason: payload.reason ?? null,
      applicable: true,
    };
  };

  const sourceSide = leg(dto.source, "source");
  const destinationSide = leg(dto.destination, "destination");

  return {
    route,
    // The address the backend CANONICALIZED and echoed, not the one that
    // was sent — `eligibilityMatchesInputs` compares the two by address
    // form, so an EVM address that comes back lowercased still matches
    // the checksummed spelling the form holds.
    source: dto.source?.address ?? null,
    // `""` when the backend evaluated no destination leg. That can never
    // match the non-empty destination the form holds, so it resolves to
    // `answer-stale` — a refusal, which is the right outcome for an
    // answer that skipped the one side this check exists to establish.
    destination: dto.destination?.address ?? "",
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
 * Whether two spellings name the same wallet.
 *
 * # Case matters on two of the three chains, and not on the third
 *
 * A `0x` prefix means an EVM address and nothing else: `0` is not in the
 * base58 alphabet, so no Solana pubkey and no Goldcoin Base58Check
 * address can begin with it (the backend dispatches on exactly this
 * property, `parse_transfer_address_filter` in service/src/api.rs). EVM
 * hex carries identity in its 20 bytes and only a checksum in its case,
 * and the backend canonicalizes to lowercase while a browser wallet
 * reports the EIP-55 mixed-case spelling of the same bytes — so those are
 * compared case-INSENSITIVELY or a matching pair reads as a mismatch.
 *
 * Base58 and Base58Check encode information IN the case: two strings
 * differing only in case are two different pubkeys, not two spellings of
 * one. Those are compared exactly. Comparing them loosely would let an
 * answer about one wallet be accepted as an answer about another.
 */
function sameWallet(a: string, b: string): boolean {
  if (a.startsWith("0x") && b.startsWith("0x")) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/**
 * Whether a held answer is about the inputs being asked about right now.
 *
 * Both sides are compared through {@link sameWallet}, which is case
 * sensitivity decided by ADDRESS FORM rather than by side. The destination
 * used to be compared as raw text on the grounds that it was always a
 * Goldcoin address; the route-generic endpoint answers about EVM and
 * Solana destinations too, and canonicalizes an EVM one to lowercase, so
 * a raw comparison rejected the backend's own echo of the address the
 * user had just typed.
 */
export function eligibilityMatchesInputs(
  answer: RouteEligibility,
  route: EligibilityRoute,
  source: string | null,
  destination: string,
): boolean {
  if (answer.route !== route) return false;
  if (!sameWallet(answer.destination, destination)) return false;
  // `== null` throughout: a malformed answer with the field absent is
  // indistinguishable from one that nulled it, and both must fail closed
  // rather than throw on a property read.
  if (source === null) return answer.source == null;
  if (answer.source == null) return false;
  return sameWallet(answer.source, source);
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

/**
 * The row label for a side with no wallet the browser can ask about —
 * the source of a Goldcoin-funded route.
 *
 * It names WHEN the check happens, not that it was waived. The 24-hour
 * rule still governs that side; it is checked against the wallet the
 * deposit actually arrives from, which is the first moment that wallet
 * exists. Saying "Eligible" would claim a verdict nobody has given.
 */
export const ELIGIBILITY_NOT_APPLICABLE_LABEL = "Checked when your deposit arrives";

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
