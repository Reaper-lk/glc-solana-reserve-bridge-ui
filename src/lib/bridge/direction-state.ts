import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
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
 * # Three outcomes, not two
 *
 * "The server closed this route", "the server sent something we could not
 * read", and "the server said nothing" are genuinely different, and
 * collapsing any pair of them causes a real failure:
 *
 * | `/chains` says | result |
 * |---|---|
 * | this route, `enabled: true` | **open** |
 * | this route, `enabled: false` | **closed** — explicit verdicts are always obeyed |
 * | this route, but unparseably (`unreadableRouteIds`) | **closed** — we could not read it, which is far closer to closed than to open |
 * | nothing about this route, or nothing at all (unreachable / errored) | **the route's structural default** |
 *
 * The structural default is `routes[route].direction !== null`: a route with
 * settlement machinery in this build defaults to open, one without defaults
 * to closed.
 *
 * This mirrors the backend's `Ledger::route_enabled(route_id,
 * default_enabled)` — absent table, absent row, or an explicit flag,
 * resolving to `Route::default_enabled()` when there is no explicit answer.
 * The two layers agree by construction rather than by coincidence.
 *
 * # Why "absent means closed" was wrong
 *
 * Treating a missing entry as closed made `GET /chains` a hard dependency of
 * the LIVE GLC↔SOL bridge: a 404 from a backend deployed after the UI, a
 * 5xx, a timeout, or a response carrying one unrecognised route would all
 * have disabled the working bridge — failing safe, but taking real,
 * functioning money paths down with it and blaming Robinhood in the copy.
 *
 * # Why "unreadable means default" was also wrong
 *
 * That was the residual gap in the first fix: dropping a malformed entry
 * made it indistinguishable from an absent one, so a garbled
 * `{"id":"GlcToSol","enabled":false}` would have fallen back to the live
 * route's default of open, silently reversing an operator's close.
 *
 * Takes the whole `ChainsViewDto` rather than a single view so a caller
 * cannot consult the route list while forgetting the unreadable list.
 */
export function routeAvailable(chains: ChainsViewDto | undefined, route: Route): boolean {
  if (!chains) return routes[route].direction !== null;
  const view = chains.routes.find((v) => v.id === route);
  if (view) return view.enabled === true;
  if (chains.unreadableRouteIds.includes(route)) return false;
  return routes[route].direction !== null;
}

export function directionGateState(
  status: BridgeStatusDto,
  route: Route,
  chains: ChainsViewDto | undefined,
): DirectionGateState {
  // The route gate outranks every reserve condition: a route that is not
  // available cannot be "quota exhausted" or "paused", because it has no
  // quota and no reserve.
  if (!routeAvailable(chains, route)) return "route-disabled";

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
 * Which settlement mechanism a route submits through.
 *
 * - `"backend-create"` — `POST /transfers`, which the backend can refuse.
 * - `"wallet-deposit"` — the user's Solana wallet signs `deposit_to_reserve`
 *   directly. **This leg never touches the HTTP API**, so no backend
 *   response can refuse a mis-dispatch to it.
 *
 * `null` means the route has no settlement machinery and must not be
 * submitted at all.
 *
 * # Why this is a function and not an inline branch
 *
 * The dispatch used to be `if (direction === "GlcToSol") … else …` written
 * inline in `BridgeCard.submit()`. When `direction` widened from two values
 * to four, every unbuilt route fell into the `else` — the wallet-deposit
 * leg. Because that leg has no server-side backstop, a fall-through would
 * have moved funds on a chain the user did not select.
 *
 * Pulling it out here makes the invariant unit-testable in isolation,
 * rather than only observable through a component whose incidental guards
 * (a pending quote, absent amount bounds) happen to stop the click today.
 * The `never` binding turns a future `Direction` variant into a compile
 * error here instead of a silent fall-through to Solana.
 */
export type SettlementLeg = "backend-create" | "wallet-deposit";

export function settlementLegFor(route: Route): SettlementLeg | null {
  const direction = routes[route].direction;
  if (direction === null) return null;
  if (direction === "GlcToSol") return "backend-create";
  if (direction === "SolToGlc") return "wallet-deposit";
  const unreachable: never = direction;
  return unreachable;
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
 * Copy for a route that is not available.
 *
 * Deliberately promises no date, no rollout window, and not that it will
 * ever open — the backend makes no such promise, and neither should the
 * screen.
 *
 * Derived from the route rather than hardcoded, because the same panel now
 * has to explain two genuinely different situations. A route with no
 * settlement machinery in this build is "coming soon"; a LIVE route that
 * the server has explicitly closed is not — telling a GLC↔SOL user about
 * Robinhood Network would be simply false.
 */
export const ROUTE_DISABLED_BADGE = "Coming soon";

/** Unbuilt-route copy. Kept exported: it is the badge's long form. */
export const ROUTE_COMING_SOON_TITLE = "Robinhood Network — coming soon";
export const ROUTE_COMING_SOON_BODY =
  "This route is not available for transfers yet. Goldcoin L1 ↔ Solana is unaffected and continues to operate normally.";

/** Copy for a route that EXISTS in this build but the server has closed. */
export const ROUTE_CLOSED_TITLE = "This route is currently unavailable.";
export const ROUTE_CLOSED_BODY =
  "New transfers on this route are not being accepted right now. Please check the official Telegram for updates.";

export function closedRouteTitle(route: Route): string {
  return routes[route].direction === null ? ROUTE_COMING_SOON_TITLE : ROUTE_CLOSED_TITLE;
}

export function closedRouteBody(route: Route): string {
  return routes[route].direction === null ? ROUTE_COMING_SOON_BODY : ROUTE_CLOSED_BODY;
}
