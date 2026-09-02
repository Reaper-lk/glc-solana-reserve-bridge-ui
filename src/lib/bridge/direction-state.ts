import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import type { RouteViewDto } from "@/lib/api/schemas/chains";
import type { Direction, Route } from "@/lib/api/schemas/common";
import { routes } from "./direction";

/**
 * Per-route operational state.
 *
 * Two independent questions, deliberately kept apart:
 *
 * 1. **Does this route exist and is it open?** Answered by `GET /chains`
 *    (`RouteViewDto`), which is the backend's own `RouteGate` verdict. A
 *    route the server says is closed is closed, full stop — the UI never
 *    second-guesses it and never derives it from local configuration.
 *
 * 2. **If it is open, can it currently accept a transfer?** Answered by
 *    `GET /status`, derived exactly the way the backend composes it
 *    (`service/src/api.rs`): available iff the DESTINATION reserve is
 *    unpaused AND the rolling-24h-volume quota has headroom AND reserve
 *    capacity is above zero.
 *
 * Conflating the two would tell a user "check back later" about a route
 * that does not exist in this build, and "temporarily paused" about
 * machinery that was never written.
 *
 * The quota workflow never auto-unpauses (backend docs/09-runbook.md,
 * 2026-08-22): once the operator pause engages after exhaustion, reopening
 * is a manual operator action after reserves are replenished. Copy in this
 * module therefore never promises a reset time, a midnight rollover, or an
 * automatic reopening.
 */
export type DirectionGateState =
  | "active"
  | "quota-exhausted"
  | "quota-paused"
  | "operator-paused"
  | "capacity-constrained"
  /** The server reports this route closed. Not a reserve condition. */
  | "route-disabled";

/**
 * Per-route accessors into `GET /status`.
 *
 * These were ternaries on `direction === "GlcToSol"`. With four routes a
 * ternary silently treats every non-`GlcToSol` route as `SolToGlc`, so a
 * Robinhood route would have read Goldcoin's pause flag and Goldcoin's
 * quota headroom and rendered them as its own — fabricated status for a
 * chain the backend knows nothing about. Table lookups return `null` for a
 * route with no reserve instead, and callers must handle that.
 */
const DESTINATION_PAUSED: Record<Route, (s: BridgeStatusDto) => boolean | null> = {
  GlcToSol: (s) => s.solana_paused,
  SolToGlc: (s) => s.goldcoin_paused,
  GlcToRhn: () => null,
  RhnToGlc: () => null,
};

const QUOTA_EXHAUSTED: Record<Route, (s: BridgeStatusDto) => boolean | null> = {
  GlcToSol: (s) => s.glc_to_sol_quota_exhausted,
  SolToGlc: (s) => s.sol_to_glc_quota_exhausted,
  GlcToRhn: () => null,
  RhnToGlc: () => null,
};

const ROLLING_VOLUME_REMAINING: Record<Route, (s: BridgeStatusDto) => number | null> = {
  GlcToSol: (s) => s.glc_to_sol_rolling_volume_remaining,
  SolToGlc: (s) => s.sol_to_glc_rolling_volume_remaining,
  GlcToRhn: () => null,
  RhnToGlc: () => null,
};

const AVAILABLE: Record<Route, (s: BridgeStatusDto) => boolean | null> = {
  GlcToSol: (s) => s.glc_to_sol_available,
  SolToGlc: (s) => s.sol_to_glc_available,
  GlcToRhn: () => null,
  RhnToGlc: () => null,
};

/**
 * The destination reserve's operator-pause flag for a route, or `null` when
 * the route has no reserve. `null` means "there is nothing to report",
 * never "not paused".
 */
export function destinationPaused(status: BridgeStatusDto, route: Route) {
  return DESTINATION_PAUSED[route](status);
}

export function quotaExhausted(status: BridgeStatusDto, route: Route) {
  return QUOTA_EXHAUSTED[route](status);
}

/** Mint-atomic headroom left in this route's 24h window, or `null`. */
export function rollingVolumeRemaining(status: BridgeStatusDto, route: Route) {
  return ROLLING_VOLUME_REMAINING[route](status);
}

export function directionAvailable(status: BridgeStatusDto, route: Route) {
  return AVAILABLE[route](status);
}

/**
 * Whether this route can be selected and submitted at all.
 *
 * `routeView` is the server's entry for this route from `GET /chains`. A
 * MISSING entry is treated as disabled, matching the backend's own
 * fail-closed posture: if the server did not affirmatively say a route is
 * open, it is not open.
 */
export function routeEnabled(routeView: RouteViewDto | undefined): boolean {
  return routeView?.enabled === true;
}

export function directionGateState(
  status: BridgeStatusDto,
  route: Route,
  routeView: RouteViewDto | undefined,
): DirectionGateState {
  // The route gate outranks every reserve condition: a route the server
  // will not accept cannot be "quota exhausted" or "paused", because it has
  // no quota and no reserve.
  if (!routeEnabled(routeView)) return "route-disabled";

  const paused = destinationPaused(status, route);
  const quota = quotaExhausted(status, route);
  if (paused === null || quota === null) return "route-disabled";
  if (quota && paused) return "quota-paused";
  if (quota) return "quota-exhausted";
  if (paused) return "operator-paused";
  if (directionAvailable(status, route) === true) return "active";
  // Unpaused with quota headroom, yet not available: the remaining cause in
  // the backend's derivation is zero reserve capacity (protected-minimum
  // constrained).
  return "capacity-constrained";
}

/** Looks up one route's server entry from a `GET /chains` response. */
export function findRouteView(
  views: readonly RouteViewDto[] | undefined,
  route: Route,
): RouteViewDto | undefined {
  return views?.find((v) => v.id === route);
}

/**
 * The settled `Direction` a route produces, or `null`. Callers that need a
 * `Direction` (quotes, transfer creation, history lookups) must use this
 * and handle `null` — mirroring the backend, where a route without a
 * direction cannot reach any settlement function at all.
 */
export function routeDirection(route: Route): Direction | null {
  return routes[route].direction;
}

/**
 * Approved end-user copy. The second message matches the backend's
 * `DIRECTION_UNAVAILABLE_MESSAGE` (api.rs) line for line. Neither message
 * may claim an automatic reset or reopening — there is none.
 */
export const QUOTA_EXHAUSTED_TITLE =
  "24-hour bridge capacity reached for this direction.";
export const QUOTA_EXHAUSTED_BODY = "New transfers are temporarily unavailable.";

export const QUOTA_PAUSED_TITLE = "Bridge capacity reached for this direction.";
export const QUOTA_PAUSED_BODY =
  "Transfers are temporarily paused while reserves are replenished.";
export const QUOTA_PAUSED_NEXT =
  "Please check the official Telegram for reopening updates.";

/**
 * Copy for a route the server reports closed.
 *
 * Deliberately promises no date, no rollout window, and not that it will
 * ever open — the backend makes no such promise, and neither should the
 * screen. The badge is short enough for the selector; the title and body
 * are used in the panel that replaces the form.
 */
export const ROUTE_DISABLED_BADGE = "Coming soon";
export const ROUTE_DISABLED_TITLE = "Robinhood Network — coming soon";
export const ROUTE_DISABLED_BODY =
  "This route is not available for transfers yet. Goldcoin L1 ↔ Solana is unaffected and continues to operate normally.";
