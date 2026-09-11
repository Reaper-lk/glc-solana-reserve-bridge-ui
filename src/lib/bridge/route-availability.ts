import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";

/**
 * Route availability, read straight off `GET /chains`.
 *
 * Every function here is a lookup, never a derivation. The backend is the
 * single source of truth for whether a route is open, and re-deriving
 * that client-side — from env config, from a hardcoded list, from the
 * presence of a contract address — is precisely the drift this module
 * exists to prevent. If `/chains` has not loaded, the answer is
 * "unknown", never "probably fine".
 *
 * # Two backend fields, three predicates
 *
 * `enabled` is the `RouteGate` verdict (`service/src/routes.rs`) and
 * reads no reserve state. `available` (backend PR #76) is that AND every
 * runtime gate on the route's destination reserve. They answer different
 * questions and callers genuinely need both, so the lookup below reports
 * both and three predicates name which one a caller meant:
 *
 * - `isRouteEnabled` — is the route switched on in this deployment?
 * - `isRouteOpen` — is it usable, tolerating a backend too old to have
 *   published `available`?
 * - `isRouteEffectivelyAvailable` — did the backend positively say yes?
 *   The strict one, for anything standing in front of an irreversible
 *   deposit.
 *
 * Routes are looked up by the backend's own id STRING rather than by this
 * build's `Route` enum. A route the backend adds later is therefore
 * answerable here — as `unknown`, which fails closed — instead of being a
 * type error at the lookup. `Route` values are strings, so every existing
 * caller is unaffected.
 */

export type RouteAvailability =
  /**
   * `/chains` says this route is open: implemented, enabled, and not
   * refused by any runtime gate on its destination reserve.
   *
   * `availabilityKnown` records WHICH backend answered. `true` means this
   * deployment published `available: true` (backend PR #76) — a positive
   * statement that a transfer started now would be admitted. `false` means
   * the field was absent, so only the `enabled` half was ever answered and
   * the reserve half is unknown. Every caller that stands in front of an
   * IRREVERSIBLE deposit must require `true`; callers that merely label a
   * route may treat "open with unknown availability" as open, which is
   * what every pre-PR-#76 deployment has always meant by `enabled`.
   */
  | {
      readonly kind: "open";
      readonly view: RouteViewDto;
      readonly availabilityKnown: boolean;
    }
  /** Implemented but closed. `reason` is the backend's own copy. */
  | { readonly kind: "closed"; readonly reason: string; readonly view: RouteViewDto }
  /**
   * Implemented and ENABLED, and still refused right now:
   * `available: false`. A runtime gate on the route's destination reserve
   * — paused, admission closed, the confirmed-liquidity gate, the
   * mature-UTXO floor, capacity — is holding it shut. Distinct from
   * `closed` because no operator switched this route off and none has to
   * switch it back on; it reopens by itself when the reserve does.
   * `reason` is the backend's `unavailable_reason`, verbatim.
   */
  | { readonly kind: "unavailable"; readonly reason: string; readonly view: RouteViewDto }
  /**
   * Structurally non-executable in this build (`implemented: false`).
   * Distinct from `closed` because no operator action opens it: there is no
   * settlement machinery behind it at all.
   *
   * No route the backend ships today reports this — all six are
   * implemented. It is kept because `implemented` is a published field and
   * a deployment is entitled to report it `false`, and because the
   * alternative is reading that case as `closed`, which would tell an
   * operator to go looking for a switch that does not exist.
   */
  | {
      readonly kind: "unimplemented";
      readonly reason: string;
      readonly view: RouteViewDto;
    }
  /** `/chains` has not loaded, or does not list this route. Fail closed. */
  | { readonly kind: "unknown"; readonly reason: string; readonly view: null };

/**
 * Fallback copy for the `unknown` case only. Every other message shown to
 * a user comes from the backend's own `disabled_reason`, never from here
 * — a locally-authored "this route is closed" sentence would be a second
 * spelling of a backend decision, free to drift from it.
 */
const UNKNOWN_REASON = "Route availability is unavailable right now.";

/** Last-resort copy for a fallible field the backend left null. */
const NEUTRAL_REASON = "This route is not available right now.";

/** The backend's copy, or a neutral fallback if it sent none. */
function reasonOf(view: RouteViewDto): string {
  return view.disabled_reason ?? NEUTRAL_REASON;
}

export function routeAvailability(
  chains: ChainsViewDto | undefined,
  routeId: string,
): RouteAvailability {
  const view = chains?.routes.find((entry) => entry.id === routeId);
  if (!view) return { kind: "unknown", reason: UNKNOWN_REASON, view: null };
  if (!view.implemented) {
    return { kind: "unimplemented", reason: reasonOf(view), view };
  }
  if (!view.enabled) return { kind: "closed", reason: reasonOf(view), view };
  // `enabled` passed; the runtime gates on the destination reserve are a
  // SECOND question, and the backend answers it separately precisely
  // because the first one cannot. An explicit `false` closes the route
  // here even though an operator switched nothing off.
  if (view.available === false) {
    return {
      kind: "unavailable",
      reason: view.unavailable_reason ?? NEUTRAL_REASON,
      view,
    };
  }
  return { kind: "open", view, availabilityKnown: view.available === true };
}

/**
 * True only for a route `/chains` positively reports as open — including,
 * since backend PR #76, not being held shut by a runtime gate on its
 * destination reserve.
 *
 * This is the LABELLING predicate: it tolerates a deployment that never
 * published `available`, because that is what `enabled` alone has always
 * meant there. Anything standing in front of an irreversible deposit must
 * use `isRouteEffectivelyAvailable` instead, which does not.
 */
export function isRouteOpen(chains: ChainsViewDto | undefined, routeId: string): boolean {
  return routeAvailability(chains, routeId).kind === "open";
}

/**
 * Whether this route is SWITCHED ON in this deployment, ignoring the
 * runtime reserve gates entirely — `implemented && enabled`.
 *
 * The deployment-shaped question, and the only one some callers actually
 * have: whether a Robinhood endpoint exists to poll at all, whether a
 * route deserves a card on the status page. A route that is enabled but
 * momentarily gated shut still has all of those things, so answering
 * those questions with `isRouteOpen` would make a temporary reserve
 * condition look like a route that was never deployed.
 */
export function isRouteEnabled(
  chains: ChainsViewDto | undefined,
  routeId: string,
): boolean {
  const state = routeAvailability(chains, routeId);
  return state.kind === "open" || state.kind === "unavailable";
}

/**
 * The strict, fail-closed predicate: `/chains` positively answered
 * `available: true` for this route.
 *
 * The difference from `isRouteOpen` is the case where `available` was
 * never published — an older backend, or a `/chains` read that has not
 * landed. `isRouteOpen` calls that open; this calls it unknown, and
 * unknown is a refusal.
 *
 * Use this, and only this, to gate an action whose failure mode is a
 * user's funds already committed on-chain: `RhnToGlc`, whose deposit goes
 * straight to the custody contract with no backend preflight in front of
 * it. The backend re-checks everything at fold time and stays the
 * authority; what it cannot do is give the money back.
 */
export function isRouteEffectivelyAvailable(
  chains: ChainsViewDto | undefined,
  routeId: string,
): boolean {
  const state = routeAvailability(chains, routeId);
  return state.kind === "open" && state.availabilityKnown;
}

export interface RouteAvailabilitySummary {
  /** Routes `/chains` reports as both implemented and enabled. */
  readonly open: number;
  /** Every route `/chains` listed, open or not. */
  readonly total: number;
}

/**
 * How many of the backend's routes are open right now, for one-line copy
 * like "2 of 6 routes available".
 *
 * Counted from the response itself rather than from any UI-side list, so a
 * route the backend adds later is included with no frontend deploy — the
 * same property `routeAvailability` exists to preserve. `null` when
 * `/chains` has not loaded: a caller must say it does not know yet, never
 * report `0 of 0`.
 */
export function routeAvailabilitySummary(
  chains: ChainsViewDto | undefined,
): RouteAvailabilitySummary | null {
  if (!chains) return null;
  const open = chains.routes.filter(
    (view) => routeAvailability(chains, view.id).kind === "open",
  ).length;
  return { open, total: chains.routes.length };
}
