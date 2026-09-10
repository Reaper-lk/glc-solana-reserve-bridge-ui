import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import { isSettlementRoute } from "@/lib/api/schemas/common";

/**
 * The system-wide availability sentence, derived from `GET /chains`.
 *
 * # Why the old sentence had to go
 *
 * The global strip used to read "The bridge is paused on both sides.",
 * derived from `goldcoin_paused && solana_paused` — two reserve pause
 * booleans on `GET /status`, in a bridge that now runs four executable
 * routes across three reserves. "Both sides" names a two-direction
 * topology that no longer exists, and the pause booleans it read cannot
 * see a Robinhood route at all: with `GlcToRhn` closed and both Solana
 * directions open, the old derivation said "Operational" and meant it.
 *
 * # Disabled is not the same as temporarily unavailable
 *
 * Both are "you cannot use this route right now", and for a while this
 * strip said so with one word. That was wrong in a way that matters to
 * whoever reads it:
 *
 * - `enabled: false` is a CONFIGURATION state. The route gate is shut —
 *   config file, `bridge_routes` row, adapter capability — and it stays
 *   shut until an operator changes something. `GlcToRhn` ships this way
 *   (`Route::default_enabled` is `false` for it), and calling that
 *   "temporarily unavailable" promises a self-healing that is not coming.
 * - `available: false` on an ENABLED route is a RUNTIME state: a pause,
 *   closed admission, the confirmed-liquidity gate, the mature-UTXO
 *   floor, or capacity. Nobody switched it off and nobody has to switch
 *   it back on — it reopens when its destination reserve does, which is
 *   exactly what "temporarily" means.
 *
 * The backend keeps them apart too, and even gives them different copy:
 * `route_availability` (service/src/api.rs) answers a disabled route with
 * `RouteGateError::UNAVAILABLE_MESSAGE` and a runtime-gated one with
 * `DIRECTION_UNAVAILABLE_MESSAGE`. This strip mirrors that distinction at
 * the aggregate level rather than flattening it.
 *
 * # What counts
 *
 * Only EXECUTABLE routes — `implemented: true`, and in this build's
 * settlement vocabulary. `SolToRhn`/`RhnToSol` have no settlement
 * machinery on either side, so counting them would make a warning
 * permanent and meaningless.
 *
 * A route is available only when the backend positively answered
 * `available: true`. An ABSENT `available` counts as unavailable, the
 * same fail-closed rule `isRouteEffectivelyAvailable` applies: an
 * unanswered question is not a yes. That case is bucketed with the
 * runtime ones rather than with the disabled ones, because `enabled` is
 * what distinguishes the two and such a route reports `enabled: true`.
 *
 * # Why no reason text
 *
 * The backend publishes a cause-agnostic reason per route, and there can
 * be several different ones at once. Concatenating them into a one-line
 * strip would either truncate them or state one route's reason as though
 * it were the bridge's. The strip links to /status, where every route's
 * own reason is rendered beside it, verbatim and untouched.
 */

/**
 * How the executable routes divide up. `available + disabled +
 * unavailable === total` always: every executable route lands in exactly
 * one bucket.
 */
export interface SystemRouteCounts {
  /** Executable routes `/chains` listed. */
  readonly total: number;
  /** `available: true`. */
  readonly available: number;
  /** `enabled: false` — switched off, and only an operator reopens it. */
  readonly disabled: number;
  /** Enabled, and not available right now. Reopens on its own. */
  readonly unavailable: number;
}

export type SystemRouteAvailability =
  /** `/chains` has not answered, or lists no executable route. No count is implied. */
  | { readonly kind: "unknown" }
  /** Every executable route is enabled and available. No warning is shown. */
  | ({ readonly kind: "all-available" } & SystemRouteCounts)
  /** Some are switched off; every enabled one is available. */
  | ({ readonly kind: "some-disabled" } & SystemRouteCounts)
  /** Every executable route is enabled; some are gated shut right now. */
  | ({ readonly kind: "some-unavailable" } & SystemRouteCounts)
  /** Both at once. */
  | ({ readonly kind: "some-disabled-and-unavailable" } & SystemRouteCounts)
  /** Nothing executable can be used, for either reason or both. */
  | ({ readonly kind: "none-available" } & SystemRouteCounts);

/**
 * Copy per state. Says nothing about WHY beyond the disabled/temporary
 * split, and never names a side, a direction or a network.
 *
 * The full-outage line deliberately does not pick between the two causes:
 * with nothing usable at all, which gate closed each individual route is
 * detail for /status, and "no transfer routes are currently available" is
 * the one fact that is true regardless.
 */
export const SYSTEM_ROUTE_MESSAGE = {
  none: "Bridge maintenance — no transfer routes are currently available.",
  disabled: "Some bridge routes are currently disabled.",
  unavailable: "Some bridge routes are temporarily unavailable.",
  mixed: "Some bridge routes are disabled or temporarily unavailable.",
  unknown: "Checking route availability…",
} as const;

/**
 * Executable routes only — `implemented: true`, and known to this build's
 * settlement vocabulary so that a route the backend adds ahead of the
 * frontend does not silently drag the whole strip into a warning before
 * anyone can describe it.
 */
function executableRouteViews(chains: ChainsViewDto): readonly RouteViewDto[] {
  return chains.routes.filter((view) => view.implemented && isSettlementRoute(view.id));
}

export function systemRouteAvailability(
  chains: ChainsViewDto | undefined,
): SystemRouteAvailability {
  if (!chains) return { kind: "unknown" };

  const views = executableRouteViews(chains);
  // A registry with no executable route at all is not a claim that the
  // bridge is up: there is nothing to be up. Reported as unknown rather
  // than as "0 of 0 available", which would read as an outage.
  if (views.length === 0) return { kind: "unknown" };

  let available = 0;
  let disabled = 0;
  let unavailable = 0;
  for (const view of views) {
    if (view.available === true) available += 1;
    // `enabled` is checked BEFORE the runtime bucket, and only for a route
    // that is not available: a switched-off route is a configuration fact
    // that outranks any runtime one, and it is the fact a reader needs to
    // know an operator has to act.
    else if (!view.enabled) disabled += 1;
    else unavailable += 1;
  }
  const counts: SystemRouteCounts = {
    total: views.length,
    available,
    disabled,
    unavailable,
  };

  if (available === 0) return { kind: "none-available", ...counts };
  if (available === counts.total) return { kind: "all-available", ...counts };
  if (disabled > 0 && unavailable > 0) {
    return { kind: "some-disabled-and-unavailable", ...counts };
  }
  if (disabled > 0) return { kind: "some-disabled", ...counts };
  return { kind: "some-unavailable", ...counts };
}

/**
 * The sentence to render, or `null` when every executable route is
 * available and there is nothing to warn about.
 *
 * The all-available case returns `null` rather than a cheerful string on
 * purpose: the caller renders its own "N of M routes available" line for
 * the healthy state, and this function's job is the warning.
 */
export function systemRouteMessage(state: SystemRouteAvailability): string | null {
  switch (state.kind) {
    case "none-available":
      return SYSTEM_ROUTE_MESSAGE.none;
    case "some-disabled":
      return SYSTEM_ROUTE_MESSAGE.disabled;
    case "some-unavailable":
      return SYSTEM_ROUTE_MESSAGE.unavailable;
    case "some-disabled-and-unavailable":
      return SYSTEM_ROUTE_MESSAGE.mixed;
    case "unknown":
      return SYSTEM_ROUTE_MESSAGE.unknown;
    case "all-available":
      return null;
  }
}
