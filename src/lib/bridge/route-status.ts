import type { SettlementRoute } from "@/lib/api/schemas/common";
import { clampAtomicAtZero } from "@/lib/api/schemas/common";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type {
  BridgeStatusDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "@/lib/api/schemas/status";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";
import { directions } from "./direction";
import { GOLDCOIN_GLC, SOLANA_GLC } from "./chain-registry";
import {
  directionGateState,
  type DirectionGateState,
  type SolanaGovernedRoute,
} from "./direction-state";
import {
  robinhoodDestinationCapacity,
  robinhoodRouteGateState,
  robinhoodWindowRemaining,
  type RobinhoodRoute,
  type RobinhoodRouteGateState,
} from "./robinhood-route-state";
import { routeAvailability, type RouteAvailability } from "./route-availability";
import { executableRoutes } from "./route-families";

/**
 * Everything the status page states about ONE executable route, resolved
 * from the endpoint that actually owns each figure.
 *
 * # Why this is a table and not four hand-written cards
 *
 * The status page used to be modelled as a two-direction Solana bridge:
 * two blocks reading `GET /status` and `GET /reserve`, whose every field
 * is named `glc_to_sol_*` / `sol_to_glc_*` / `*_available_capacity`. Four
 * executable routes now settle onto THREE independent reserve pools, in
 * three different units, and two of them are bounded by a custody
 * contract's own rolling windows rather than by a Solana PDA. Written as
 * prose, the ways to answer a route with another route's number outnumber
 * the ways to answer it correctly.
 *
 * So every figure below is looked up through a TOTAL map keyed by the
 * route — one entry per route, no default branch, no fallback to a
 * neighbouring route's value. Adding a fifth route is a compile error
 * until someone states where its capacity and its window come from, which
 * is the property that makes "do not reuse one reserve value for multiple
 * routes" structural rather than a review note.
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
  /** The bridge fee that applies to this route, in bps. */
  readonly feeBps: number | null;
  /** The route's published minimum, when the backend publishes one for it. */
  readonly minimum: RouteFigure | null;
  /** The route's published per-transfer maximum, likewise. */
  readonly maximum: RouteFigure | null;
  /** Said only where the badge alone would leave a reader guessing. */
  readonly note?: string;
}

/** The inputs the four routes are resolved from. One endpoint per member. */
export interface RouteStatusInput {
  readonly chains: ChainsViewDto | undefined;
  readonly status: BridgeStatusDto | undefined;
  readonly reserve: ReserveAvailabilityDto | undefined;
  readonly robinhood: RobinhoodReserveDto | undefined;
  readonly limits: TransferLimitsDto | undefined;
}

/** The two routes whose figures `GET /status` and `GET /reserve` describe. */
const SOLANA_GOVERNED: Record<SolanaGovernedRoute, true> = {
  GlcToSol: true,
  SolToGlc: true,
};

function isSolanaGoverned(route: SettlementRoute): route is SolanaGovernedRoute {
  return route in SOLANA_GOVERNED;
}

function isRobinhoodRoute(route: SettlementRoute): route is RobinhoodRoute {
  return route === "GlcToRhn" || route === "RhnToGlc";
}

/**
 * The DESTINATION reserve's available capacity, per route.
 *
 * One entry per route and no default branch, because the mistake this
 * table exists to prevent is exactly a default branch: three independent
 * pools in two different units, where answering the wrong one is a
 * plausible-looking figure rather than a visible failure.
 *
 * - `GlcToSol` pays out of the SOLANA reserve, published by `GET /reserve`
 *   in the Token-2022 mint's 6-decimal units.
 * - `SolToGlc` and `RhnToGlc` both pay out of the GOLDCOIN reserve — the
 *   same physical pool, so the same figure, at Goldcoin's protocol-fixed 8
 *   decimals. That is a shared SOURCE, not a reused one: `Direction::
 *   destination_reserve()` names `GoldcoinReserve` for both.
 * - `GlcToRhn` pays out of the ROBINHOOD reserve, published by
 *   `GET /robinhood/reserve` in CANONICAL 8-decimal units (its ledger
 *   column is an `INTEGER` and cannot hold Robinhood's native 18).
 */
const CAPACITY: Record<SettlementRoute, (input: RouteStatusInput) => RouteFigure | null> =
  {
    GlcToSol: ({ reserve }) =>
      reserve
        ? {
            atomic: clampAtomicAtZero(reserve.solana_available_capacity),
            decimals: SOLANA_GLC.decimals,
            source: "GET /reserve · solana_available_capacity",
          }
        : null,
    SolToGlc: ({ reserve }) => goldcoinCapacity(reserve),
    RhnToGlc: ({ reserve }) => goldcoinCapacity(reserve),
    GlcToRhn: ({ robinhood, reserve }) => {
      const figure = robinhoodDestinationCapacity(
        "GlcToRhn",
        robinhood,
        goldcoinCapacity(reserve)?.atomic ?? null,
      );
      return figure
        ? {
            atomic: clampAtomicAtZero(figure.atomic),
            decimals: figure.decimals,
            source: "GET /robinhood/reserve · available_capacity_atomic",
          }
        : null;
    },
  };

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
 * The rolling 24-hour headroom that bounds this route, per route.
 *
 * The Solana pair is bounded by a Solana PDA and reported by `GET /status`
 * in MINT-atomic (6-decimal) units. The Robinhood pair is bounded by the
 * custody contract's own two buckets, reported in ROBINHOOD's native 18 —
 * outbound for the payout leg (`GlcToRhn`), inbound for the deposit leg
 * (`RhnToGlc`). Crossing either pair with the other's figure would state a
 * limit that neither chain enforces, which is precisely why the two
 * derivations live in separate modules and meet only here.
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
  RhnToGlc: ({ robinhood }) => robinhoodWindow("RhnToGlc", robinhood, "inbound_window"),
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
 * The per-transfer bounds `GET /limits` publishes, per route.
 *
 * `TransferLimits` carries the on-chain `BridgeConfig` values raw, and
 * those are the SOLANA program's — the on-chain checks compare them
 * against mint-atomic (6-decimal) amounts
 * (`limits.rs::enforce_transfer_amount`). They govern the two
 * Solana-governed routes and nothing else, which is the same rule the
 * bridge form already applies when it decides what MAX may be bounded by.
 *
 * So the Robinhood routes get `null` here rather than the Solana pair's
 * numbers. The backend publishes no per-route limits endpoint; that is a
 * genuine gap, and an empty row is the honest way to report it.
 */
const LIMITS: Record<
  SettlementRoute,
  (limits: TransferLimitsDto | undefined) => {
    minimum: RouteFigure | null;
    maximum: RouteFigure | null;
  }
> = {
  GlcToSol: solanaLimits,
  SolToGlc: solanaLimits,
  GlcToRhn: () => ({ minimum: null, maximum: null }),
  RhnToGlc: () => ({ minimum: null, maximum: null }),
};

function solanaLimits(limits: TransferLimitsDto | undefined) {
  if (!limits) return { minimum: null, maximum: null };
  return {
    minimum: {
      atomic: limits.min_transfer_amount,
      decimals: SOLANA_GLC.decimals,
      source: "GET /limits · min_transfer_amount",
    },
    maximum: {
      atomic: limits.per_transfer_limit,
      decimals: SOLANA_GLC.decimals,
      source: "GET /limits · per_transfer_limit",
    },
  };
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
  const { minimum, maximum } = LIMITS[route](input.limits);

  let kind = gate.kind;
  let note: string | undefined;

  if (kind === "available") {
    // A more specific, currently-known cause may still close this route.
    // It may never open one: `refine` returns `available` only when it has
    // nothing to add.
    if (isSolanaGoverned(route) && input.status) {
      kind = SOLANA_GATE_TO_KIND[directionGateState(input.status, route)];
    } else if (isRobinhoodRoute(route)) {
      const state = robinhoodRouteGateState(
        route,
        input.robinhood,
        capacity?.atomic ?? null,
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
    enabled: gate.view?.enabled ?? false,
    implemented: gate.view?.implemented ?? false,
    available: gate.view?.available,
    reason: gate.reason,
    capacity,
    window,
    feeBps: input.limits?.bridge_fee_bps ?? null,
    minimum,
    maximum,
    ...(note ? { note } : {}),
  };
}

/**
 * Every executable route this deployment has, each with its own figures.
 *
 * The list comes from `GET /chains`' `implemented` flag, so a route the
 * backend adds later appears with no frontend deploy. When `/chains` has
 * not answered there is no registry to read, and rather than showing
 * nothing at all this falls back to the routes this build has settlement
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
