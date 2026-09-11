import type { SettlementRoute } from "@/lib/api/schemas/common";
import { clampAtomicAtZero } from "@/lib/api/schemas/common";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type {
  BridgeStatusDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "@/lib/api/schemas/status";
import type {
  RobinhoodLimitsDto,
  RobinhoodReserveDto,
} from "@/lib/api/schemas/robinhood";
import { isRobinhoodAvailable } from "@/lib/api/schemas/robinhood";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { ROBINHOOD_DECIMALS } from "./robinhood-amount";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";
import { directions } from "./direction";
import { GOLDCOIN_GLC, SOLANA_GLC } from "./chain-registry";
import {
  directionGateState,
  type DirectionGateState,
  type SolanaGovernedRoute,
} from "./direction-state";
import {
  robinhoodReserveCapacity,
  robinhoodRouteGateState,
  robinhoodWindowRemaining,
  type RobinhoodRoute,
  type RobinhoodRouteGateState,
} from "./robinhood-route-state";
import { robinhoodContractLeg } from "./robinhood-limits";
import { perTransferCeiling } from "./route-limits";
import { routeAvailability, type RouteAvailability } from "./route-availability";
import { executableRoutes } from "./route-families";

/**
 * Everything the status page states about ONE executable route, resolved
 * from the endpoint that actually owns each figure.
 *
 * # Why this is a table and not six hand-written cards
 *
 * The status page used to be modelled as a two-direction Solana bridge:
 * two blocks reading `GET /status` and `GET /reserve`, whose every field
 * is named `glc_to_sol_*` / `sol_to_glc_*` / `*_available_capacity`. Six
 * executable routes now settle onto THREE independent reserve pools, in
 * three different units, and four of them are bounded by a custody
 * contract's own rolling windows rather than by a Solana PDA. Written as
 * prose, the ways to answer a route with another route's number outnumber
 * the ways to answer it correctly.
 *
 * So every figure below is looked up through a TOTAL map keyed by the
 * route — one entry per route, no default branch, no fallback to a
 * neighbouring route's value. Adding a seventh route is a compile error
 * until someone states where its capacity and its window come from, which
 * is the property that makes "do not reuse one reserve value for multiple
 * routes" structural rather than a review note. It is also what surfaced
 * every figure the two cross routes needed when they were widened in:
 * nothing could be left to a default because there is no default.
 *
 * # Absent is never zero
 *
 * Every figure is nullable and `null` means the backend did not publish
 * it. On a page whose whole job is to say what the bridge can do right
 * now, "0 GLC of capacity" and "we do not publish that" are opposite
 * claims, and the second one is rendered as words.
 *
 * # Nothing here is derived from configuration
 *
 * Availability comes from `GET /chains` alone (see {@link routeGateFor}).
 * The other endpoints contribute figures and, at most, a more specific
 * CAUSE for a route the registry has already reported unavailable — they
 * can never promote a route to available.
 */

/** An exact atomic amount together with the decimals it is denominated in. */
export interface RouteFigure {
  readonly atomic: string;
  readonly decimals: number;
  /**
   * The API field this figure came from, verbatim. Carried so a reader —
   * and a test — can trace a number on screen to the response that
   * produced it, rather than inferring it from the label above it.
   */
  readonly source: string;
}

/**
 * One route's configured fee, as the backend publishes it for THAT route.
 *
 * `display` is the backend's own rendering and is shown verbatim. The
 * percentage is never re-derived from `bps` here: `GET /stats` formats it
 * with the same helper the operator tooling uses, so a rate that does not
 * divide evenly cannot read one way in this UI and another in the CLI.
 */
export interface RouteFee {
  readonly bps: number;
  /** e.g. `"3%"`. Rendered as given. */
  readonly display: string;
  /** The API field this came from, verbatim — same contract as {@link RouteFigure.source}. */
  readonly source: string;
}

/**
 * The badge state of one route.
 *
 * `available` is reachable ONLY when `GET /chains` positively answered
 * `available: true`. Everything else is a refusal or an admission of
 * ignorance, which is what keeps "enabled" from ever being rendered as
 * "available".
 */
export type RouteStatusKind =
  /** `/chains` says `available: true`, and no more specific cause contradicts it. */
  | "available"
  /** Switched on, and a runtime gate on the destination reserve is holding it shut. */
  | "unavailable"
  /** `enabled: false` — switched off in this deployment. */
  | "closed"
  /** `implemented: false` — no settlement machinery on either side. */
  | "unimplemented"
  /** The destination reserve or this leg's kill switch is paused. */
  | "paused"
  /** Destination reserve capacity is at or below zero. */
  | "insufficient-liquidity"
  /** This route's rolling 24-hour window has no headroom left. */
  | "quota-exhausted"
  /** Exhausted AND the operator pause has engaged behind it. */
  | "quota-paused"
  /** Open, but a figure it depends on could not be read. */
  | "degraded"
  /** `/chains` has not answered, or published no `available` at all. Fail closed. */
  | "unknown";

export interface ExecutableRouteStatus {
  readonly route: SettlementRoute;
  /** "GLC L1 → GLC on Robinhood". Never parsed. */
  readonly label: string;
  readonly kind: RouteStatusKind;
  /**
   * Whether `GET /chains` published a registry entry for this route at
   * all. `false` means the registry did not answer, and the three fields
   * below are this build's fail-closed defaults rather than the backend's
   * verdicts — a consumer must not render them as published facts.
   */
  readonly registered: boolean;
  /** `GET /chains`' `enabled` — the `RouteGate` verdict, reserve state excluded. */
  readonly enabled: boolean;
  /** `GET /chains`' `implemented`. */
  readonly implemented: boolean;
  /**
   * `GET /chains`' `available` (backend PR #76). `undefined` means the
   * field was absent, which is treated as unknown and never as a yes.
   */
  readonly available: boolean | undefined;
  /** `unavailable_reason`, or `disabled_reason` for a closed route. Backend copy, verbatim. */
  readonly reason: string | null;
  /** The destination reserve's available capacity, at that reserve's own decimals. */
  readonly capacity: RouteFigure | null;
  /** Headroom left in this route's rolling 24-hour window. */
  readonly window: RouteFigure | null;
  /**
   * The fee configured for THIS route, or `null` when the backend
   * publishes no per-route price for it. Never another route's rate.
   */
  readonly fee: RouteFee | null;
  /** The route's published minimum, when the backend publishes one for it. */
  readonly minimum: RouteFigure | null;
  /** The route's published per-transfer maximum, likewise. */
  readonly maximum: RouteFigure | null;
  /** Said only where the badge alone would leave a reader guessing. */
  readonly note?: string;
}

/** The inputs every route is resolved from. One endpoint per member. */
export interface RouteStatusInput {
  readonly chains: ChainsViewDto | undefined;
  readonly status: BridgeStatusDto | undefined;
  readonly reserve: ReserveAvailabilityDto | undefined;
  readonly robinhood: RobinhoodReserveDto | undefined;
  readonly limits: TransferLimitsDto | undefined;
  /** `GET /stats` — carried for `route_fees`, the per-route price table. */
  readonly stats: BridgeStatsDto | undefined;
  /**
   * `GET /robinhood/limits` — the custody contract's own per-transfer
   * ceilings, for the routes whose deposit it bounds.
   *
   * `undefined` on a deployment without the endpoint, or while the read
   * is in flight, which leaves those maxima absent rather than filled in
   * from the Solana program's figures.
   */
  readonly robinhoodLimits: RobinhoodLimitsDto | undefined;
}

/** The two routes whose figures `GET /status` and `GET /reserve` describe. */
const SOLANA_GOVERNED: Record<SolanaGovernedRoute, true> = {
  GlcToSol: true,
  SolToGlc: true,
};

function isSolanaGoverned(route: SettlementRoute): route is SolanaGovernedRoute {
  return route in SOLANA_GOVERNED;
}

/** Every route with the Robinhood custody contract on one side. */
function isRobinhoodRoute(route: SettlementRoute): route is RobinhoodRoute {
  return (
    route === "GlcToRhn" ||
    route === "RhnToGlc" ||
    route === "SolToRhn" ||
    route === "RhnToSol"
  );
}

/**
 * The DESTINATION reserve's available capacity, per route.
 *
 * One entry per route and no default branch, because the mistake this
 * table exists to prevent is exactly a default branch: three independent
 * pools in two different units, where answering the wrong one is a
 * plausible-looking figure rather than a visible failure.
 *
 * Grouped by the reserve `Direction::destination_reserve()` names:
 *
 * - SOLANA reserve — `GlcToSol` and `RhnToSol`. Published by `GET /reserve`
 *   in the Token-2022 mint's 6-decimal units.
 * - GOLDCOIN reserve — `SolToGlc` and `RhnToGlc`. Goldcoin's
 *   protocol-fixed 8 decimals.
 * - ROBINHOOD reserve — `GlcToRhn` and `SolToRhn`. Published by
 *   `GET /robinhood/reserve` in CANONICAL 8-decimal units (its ledger
 *   column is an `INTEGER` and cannot hold Robinhood's native 18).
 *
 * Two routes sharing a figure is a shared SOURCE, not a reused one: they
 * genuinely pay out of the same physical pool, so the same number is the
 * correct answer for both.
 */
const CAPACITY: Record<SettlementRoute, (input: RouteStatusInput) => RouteFigure | null> =
  {
    GlcToSol: ({ reserve }) => solanaCapacity(reserve),
    RhnToSol: ({ reserve }) => solanaCapacity(reserve),
    SolToGlc: ({ reserve }) => goldcoinCapacity(reserve),
    RhnToGlc: ({ reserve }) => goldcoinCapacity(reserve),
    GlcToRhn: ({ robinhood }) => robinhoodCapacity(robinhood),
    SolToRhn: ({ robinhood }) => robinhoodCapacity(robinhood),
  };

function solanaCapacity(reserve: ReserveAvailabilityDto | undefined): RouteFigure | null {
  return reserve
    ? {
        atomic: clampAtomicAtZero(reserve.solana_available_capacity),
        decimals: SOLANA_GLC.decimals,
        source: "GET /reserve · solana_available_capacity",
      }
    : null;
}

function goldcoinCapacity(
  reserve: ReserveAvailabilityDto | undefined,
): RouteFigure | null {
  return reserve
    ? {
        atomic: clampAtomicAtZero(reserve.goldcoin_available_capacity),
        decimals: GOLDCOIN_GLC.decimals,
        source: "GET /reserve · goldcoin_available_capacity",
      }
    : null;
}

/**
 * The Robinhood reserve's capacity, for the two routes that settle onto it.
 *
 * Clamped at zero like the other two: the backend can publish a negative
 * capacity when a protected minimum is breached, and "-40 GLC of capacity"
 * is not a fact a user can act on — "0" is, and the badge beside it already
 * says the route is capacity-constrained.
 */
function robinhoodCapacity(
  robinhood: RobinhoodReserveDto | undefined,
): RouteFigure | null {
  const figure = robinhoodReserveCapacity(robinhood);
  return figure
    ? {
        atomic: clampAtomicAtZero(figure.atomic),
        decimals: figure.decimals,
        source: "GET /robinhood/reserve · available_capacity_atomic",
      }
    : null;
}

/**
 * The rolling 24-hour headroom that bounds this route, per route.
 *
 * The two Solana-governed routes are bounded by a Solana PDA and reported
 * by `GET /status` in MINT-atomic (6-decimal) units — and by name, which is
 * why only those two can read it: `/status` publishes
 * `glc_to_sol_rolling_volume_remaining` and `sol_to_glc_…` and nothing for
 * any other route.
 *
 * The four Robinhood-legged routes are bounded by the custody contract's
 * own two buckets, reported in ROBINHOOD's native 18 — the outbound one for
 * a route paid out onto Robinhood (`GlcToRhn`, `SolToRhn`), the inbound one
 * for a route deposited on Robinhood (`RhnToGlc`, `RhnToSol`). Routes on
 * the same leg read the same figure because the contract holds one
 * accumulator per leg and charges every route on it against that one.
 *
 * Crossing the two families would state a limit that neither chain
 * enforces, which is precisely why the two derivations live in separate
 * modules and meet only here.
 */
const WINDOW: Record<SettlementRoute, (input: RouteStatusInput) => RouteFigure | null> = {
  GlcToSol: ({ status }) =>
    status
      ? {
          atomic: status.glc_to_sol_rolling_volume_remaining,
          decimals: SOLANA_GLC.decimals,
          source: "GET /status · glc_to_sol_rolling_volume_remaining",
        }
      : null,
  SolToGlc: ({ status }) =>
    status
      ? {
          atomic: status.sol_to_glc_rolling_volume_remaining,
          decimals: SOLANA_GLC.decimals,
          source: "GET /status · sol_to_glc_rolling_volume_remaining",
        }
      : null,
  GlcToRhn: ({ robinhood }) => robinhoodWindow("GlcToRhn", robinhood, "outbound_window"),
  SolToRhn: ({ robinhood }) => robinhoodWindow("SolToRhn", robinhood, "outbound_window"),
  RhnToGlc: ({ robinhood }) => robinhoodWindow("RhnToGlc", robinhood, "inbound_window"),
  RhnToSol: ({ robinhood }) => robinhoodWindow("RhnToSol", robinhood, "inbound_window"),
};

function robinhoodWindow(
  route: RobinhoodRoute,
  robinhood: RobinhoodReserveDto | undefined,
  field: "inbound_window" | "outbound_window",
): RouteFigure | null {
  const figure = robinhoodWindowRemaining(route, robinhood);
  return figure
    ? {
        atomic: figure.atomic,
        decimals: figure.decimals,
        source: `GET /robinhood/reserve · onchain.${field}.remaining_atomic`,
      }
    : null;
}

/**
 * The per-transfer bounds for one route.
 *
 * # The MAXIMUM is the ceiling the SOURCE chain enforces
 *
 * `TransferLimits` carries the on-chain `BridgeConfig` values raw, and
 * those are the SOLANA program's — the on-chain checks compare them against
 * mint-atomic (6-decimal) amounts (`limits.rs::enforce_transfer_amount`).
 * The Robinhood routes take theirs from the contract that actually reverts
 * above it, `GET /robinhood/limits`, and never from the Solana pair's
 * numbers.
 *
 * Which of the two applies to a given route is not decided here: it is
 * `perTransferCeiling` in `./route-limits`, the same table the bridge form
 * reads, so the ceiling this page PRINTS and the ceiling the form ENFORCES
 * cannot disagree. For the two cross routes, where both chains publish a
 * ceiling in different units, that table picks the source-side one and
 * documents why no combined figure is shown.
 *
 * # The MINIMUM is not from either
 *
 * It is the one published policy floor, identical on every route
 * (`GET /chains`' `min_transfer_atomic`). That is why the Solana routes
 * no longer report `min_transfer_amount` here: it is a NET-side on-chain
 * check, not the floor a user is held to, and printing it beside a
 * per-transfer maximum invited exactly the reading that produced "Min 99
 * GLC" in the bridge form.
 */
const LIMITS: Record<
  SettlementRoute,
  (input: RouteStatusInput) => {
    minimum: RouteFigure | null;
    maximum: RouteFigure | null;
  }
> = {
  GlcToSol: (input) => bounds("GlcToSol", input),
  SolToGlc: (input) => bounds("SolToGlc", input),
  GlcToRhn: (input) => bounds("GlcToRhn", input),
  RhnToGlc: (input) => bounds("RhnToGlc", input),
  SolToRhn: (input) => bounds("SolToRhn", input),
  RhnToSol: (input) => bounds("RhnToSol", input),
};

/**
 * One route's floor and ceiling, each from the endpoint that owns it.
 *
 * The ceiling is looked up through the shared pair→ceiling table rather
 * than restated per route, so the six entries above are six identical
 * lookups by design: there is no route-specific arithmetic left to get
 * wrong, and a seventh route is a compile error in that table instead of a
 * silently missing bound here.
 */
function bounds(
  route: SettlementRoute,
  input: RouteStatusInput,
): { minimum: RouteFigure | null; maximum: RouteFigure | null } {
  const descriptor = directions[route];
  const ceiling = perTransferCeiling(descriptor.from.chain.id, descriptor.to.chain.id);
  return {
    minimum: policyMinimum(input),
    maximum:
      ceiling === "solana-program"
        ? solanaMaximum(input.limits)
        : ceiling === "robinhood-contract"
          ? robinhoodMaximum(
              input,
              // The contract bounds LEGS: a route deposited on Robinhood is
              // capped by `inboundMax`, one paid out onto it by
              // `outboundMax`. Read off the same leg derivation the form
              // uses, never from the route name.
              robinhoodContractLeg(descriptor.from.chain.id, descriptor.to.chain.id) ===
                "deposit"
                ? "inbound_max_atomic"
                : "outbound_max_atomic",
            )
          : null,
  };
}

/**
 * The source-side floor every route publishes, in canonical 8dp.
 *
 * Read off whichever route entry `GET /chains` carries — they all hold
 * the same figure, and taking it from the route rather than hoisting it
 * keeps this honest if that ever stops being true.
 */
function policyMinimum(input: RouteStatusInput): RouteFigure | null {
  const raw = input.chains?.routes.find(
    (r) => r.min_transfer_atomic !== undefined,
  )?.min_transfer_atomic;
  if (raw === undefined) return null;
  return {
    atomic: raw,
    decimals: GOLDCOIN_DECIMALS,
    source: "GET /chains · min_transfer_atomic",
  };
}

function solanaMaximum(limits: TransferLimitsDto | undefined): RouteFigure | null {
  if (!limits) return null;
  return {
    atomic: limits.per_transfer_limit,
    decimals: SOLANA_GLC.decimals,
    source: "GET /limits · per_transfer_limit",
  };
}

/**
 * A Robinhood route's per-transfer ceiling, from the contract that
 * reverts anything above it. 18 decimals, reported in the contract's own
 * unit rather than narrowed — the card formats each figure with the
 * decimals it carries.
 */
function robinhoodMaximum(
  input: RouteStatusInput,
  field: "inbound_max_atomic" | "outbound_max_atomic",
): RouteFigure | null {
  const limits = input.robinhoodLimits;
  if (!limits || !isRobinhoodAvailable(limits.availability)) return null;
  const raw = limits[field];
  if (raw === null) return null;
  return {
    atomic: raw,
    decimals: ROBINHOOD_DECIMALS,
    source: `GET /robinhood/limits · ${field}`,
  };
}

/**
 * The fee that applies to ONE route, from the only field that states it
 * per route.
 *
 * # Why `/limits`' `bridge_fee_bps` is not consulted for five of the six
 *
 * `GET /limits` passes the SOLANA program's `BridgeConfig` through raw,
 * and the backend documents the fee beside those limits as `GlcToSol`'s
 * own: "it is not the rate any Robinhood route charges and must never be
 * displayed as one" (`TransferLimits::bridge_fee_bps`). `GET /stats`'
 * `bridge_fee_bps` carries the identical caveat and survives only for wire
 * compatibility. Every route is priced independently — the two cross
 * routes at their own rate again — so a single field cannot answer for all
 * of them, and showing `SolToRhn` the Solana rate is the display half of a
 * bug the backend already closed in its pricing path.
 *
 * `route_fees` is the table that does answer per route. When it is absent
 * — a deployment predating it — every route reports no published fee,
 * EXCEPT `GlcToSol`, which may fall back to `/limits` because that field
 * is documented as precisely its rate. That is a narrower claim, not a
 * borrowed one: no other route reads it.
 */
const FEE: Record<SettlementRoute, (input: RouteStatusInput) => RouteFee | null> = {
  GlcToSol: (input) => publishedFee(input, "GlcToSol") ?? glcToSolLegacyFee(input.limits),
  SolToGlc: (input) => publishedFee(input, "SolToGlc"),
  GlcToRhn: (input) => publishedFee(input, "GlcToRhn"),
  RhnToGlc: (input) => publishedFee(input, "RhnToGlc"),
  SolToRhn: (input) => publishedFee(input, "SolToRhn"),
  RhnToSol: (input) => publishedFee(input, "RhnToSol"),
};

function publishedFee(input: RouteStatusInput, route: SettlementRoute): RouteFee | null {
  const entry = input.stats?.route_fees?.find((fee) => fee.route === route);
  return entry
    ? {
        bps: entry.fee_bps,
        display: entry.fee_percent_display,
        source: `GET /stats · route_fees[${route}].fee_bps`,
      }
    : null;
}

/**
 * `GlcToSol`'s rate from `GET /limits`, for a backend with no `route_fees`.
 *
 * The display string is composed here rather than taken from the response
 * because this endpoint publishes none — which is itself a reason to
 * prefer `route_fees` wherever it exists.
 */
function glcToSolLegacyFee(limits: TransferLimitsDto | undefined): RouteFee | null {
  if (!limits) return null;
  return {
    bps: limits.bridge_fee_bps,
    display: formatBps(limits.bridge_fee_bps),
    source: "GET /limits · bridge_fee_bps",
  };
}

/** "300" -> "3%", "50" -> "0.5%". Integer arithmetic; never a float rate. */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${(bps / 100).toFixed(2)}%`;
}

/**
 * The badge a Solana-governed route's `GET /status` gate state maps to.
 * Only ever applied to a route `/chains` already reported available, and
 * only ever as a DOWNGRADE.
 */
const SOLANA_GATE_TO_KIND: Record<DirectionGateState, RouteStatusKind> = {
  active: "available",
  "operator-paused": "paused",
  "capacity-constrained": "insufficient-liquidity",
  "quota-exhausted": "quota-exhausted",
  "quota-paused": "quota-paused",
};

/** The same, for a Robinhood route's `GET /robinhood/reserve` gate state. */
const ROBINHOOD_GATE_TO_KIND: Record<RobinhoodRouteGateState, RouteStatusKind> = {
  active: "available",
  "operator-paused": "paused",
  "contract-paused": "paused",
  "capacity-constrained": "insufficient-liquidity",
  "quota-exhausted": "quota-exhausted",
  degraded: "degraded",
  unknown: "unknown",
};

/**
 * The extra sentence a route carries where the badge alone would leave a
 * reader guessing. Silent for the states the badge already says
 * everything about.
 */
const ROBINHOOD_NOTE: Partial<Record<RobinhoodRouteGateState, string>> = {
  "contract-paused":
    "Paused on the Robinhood custody contract itself, not by this bridge.",
  degraded:
    "The Robinhood custody contract or its indexer could not be read just now, so the figures below may be behind the chain.",
  unknown:
    "This deployment publishes no Robinhood reserve, so no capacity or 24-hour figure can be shown for this route.",
};

/** Said when `/chains` is reachable but published no `available` field at all. */
export const AVAILABILITY_NOT_PUBLISHED_NOTE =
  "This deployment does not publish effective route availability, so this route is reported as unknown rather than as open.";

/**
 * The route's state per `GET /chains` — the ONLY thing that can report a
 * route available.
 *
 * `enabled` is never enough on its own: it is the `RouteGate` verdict over
 * config, `bridge_routes` and adapter capability and it reads no reserve
 * state, which is exactly how `RhnToGlc` came to advertise itself while
 * the Goldcoin reserve's admission was closed. A route whose `available`
 * is absent is reported UNKNOWN here, not open.
 */
function routeGateFor(
  chains: ChainsViewDto | undefined,
  route: SettlementRoute,
): {
  kind: RouteStatusKind;
  reason: string | null;
  view: RouteViewDto | null;
  availability: RouteAvailability;
} {
  const availability = routeAvailability(chains, route);
  switch (availability.kind) {
    case "open":
      return availability.availabilityKnown
        ? { kind: "available", reason: null, view: availability.view, availability }
        : { kind: "unknown", reason: null, view: availability.view, availability };
    case "unavailable":
      return {
        kind: "unavailable",
        reason: availability.reason,
        view: availability.view,
        availability,
      };
    case "closed":
      return {
        kind: "closed",
        reason: availability.reason,
        view: availability.view,
        availability,
      };
    case "unimplemented":
      return {
        kind: "unimplemented",
        reason: availability.reason,
        view: availability.view,
        availability,
      };
    case "unknown":
      return { kind: "unknown", reason: null, view: null, availability };
  }
}

/**
 * The operator pause on the reserve that pays a Robinhood-legged route,
 * when that reserve is not the Robinhood one.
 *
 * Read off `directions[route].destinationReserve` rather than from a second
 * list of which route settles where — the descriptor already states it, and
 * `CAPACITY` above reads the same field's worth of truth for the figure
 * beside the badge.
 *
 * `null` for a route settling onto the Robinhood reserve (whose pause
 * `robinhoodRouteGateState` reads directly), and `null` when `/status` has
 * not answered — "not read" is not "not paused".
 */
function destinationReservePause(
  route: RobinhoodRoute,
  status: BridgeStatusDto | undefined,
): boolean | null {
  if (!status) return null;
  switch (directions[route].destinationReserve) {
    case "goldcoin":
      return status.goldcoin_paused;
    case "solana":
      return status.solana_paused;
    case "robinhood":
      return null;
  }
}

/**
 * One route's complete status row.
 *
 * The order of the two decisions matters and is deliberate. `/chains`
 * decides FIRST and can only ever refuse; the route-specific endpoints
 * decide second and can only ever refuse harder. Nothing in the second
 * step can turn a `false` or an absent `available` into a green badge —
 * which is what makes this safe to render beside a "start a transfer"
 * affordance gated on the same field.
 */
export function executableRouteStatus(
  route: SettlementRoute,
  input: RouteStatusInput,
): ExecutableRouteStatus {
  const gate = routeGateFor(input.chains, route);
  const capacity = CAPACITY[route](input);
  const window = WINDOW[route](input);
  const { minimum, maximum } = LIMITS[route](input);

  let kind = gate.kind;
  let note: string | undefined;

  if (kind === "available") {
    // A more specific, currently-known cause may still close this route.
    // It may never open one: each branch returns `available` only when it
    // has nothing to add.
    if (isSolanaGoverned(route) && input.status) {
      kind = SOLANA_GATE_TO_KIND[directionGateState(input.status, route)];
    } else if (isRobinhoodRoute(route)) {
      const state = robinhoodRouteGateState(
        route,
        input.robinhood,
        capacity?.atomic ?? null,
        // The DESTINATION reserve's operator pause, for the two legs that
        // settle off Robinhood. `reserve.paused` inside that function is
        // the Robinhood reserve's own pause and is the right answer for
        // the two payout legs; for `RhnToGlc` and `RhnToSol` the pool that
        // pays them is somebody else's, and a pause on it closes the route
        // just as hard. `null` for the payout legs rather than `false`:
        // there is no second reserve to report on, not a second reserve
        // reported as running.
        destinationReservePause(route, input.status),
      );
      kind = ROBINHOOD_GATE_TO_KIND[state];
      note = ROBINHOOD_NOTE[state];
    }
  } else if (
    kind === "unknown" &&
    gate.view !== null &&
    gate.view.enabled &&
    gate.view.available === undefined
  ) {
    note = AVAILABILITY_NOT_PUBLISHED_NOTE;
  }

  return {
    route,
    label: directions[route].label,
    kind,
    registered: gate.view !== null,
    enabled: gate.view?.enabled ?? false,
    implemented: gate.view?.implemented ?? false,
    available: gate.view?.available,
    reason: gate.reason,
    capacity,
    window,
    fee: FEE[route](input),
    minimum,
    maximum,
    ...(note ? { note } : {}),
  };
}

/**
 * Every executable route this deployment has, each with its own figures.
 *
 * The list comes from `GET /chains`' `implemented` flag, so a route the
 * backend adds later appears with no frontend deploy — and every route the
 * backend ships today is implemented, so the page carries all six. When
 * `/chains` has not answered there is no registry to read, and rather than
 * showing nothing at all this falls back to the routes this build has
 * descriptors for — every one of which then reports `unknown`, because
 * `routeAvailability` has nothing to say about them. That is a statement
 * about the ROUTES THIS BUILD CAN DESCRIBE, never a claim that any of them
 * is usable; the availability answer still comes from `/chains` alone.
 */
export function executableRouteStatuses(
  input: RouteStatusInput,
): readonly ExecutableRouteStatus[] {
  const routes = input.chains
    ? executableRoutes(input.chains)
    : (Object.keys(directions) as SettlementRoute[]);
  return routes.map((route) => executableRouteStatus(route, input));
}
