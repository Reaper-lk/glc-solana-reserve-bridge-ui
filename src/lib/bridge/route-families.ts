import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { isSettlementRoute, type SettlementRoute } from "@/lib/api/schemas/common";
import { directions, type DirectionDescriptor } from "./direction";

/**
 * Which route families this deployment can actually execute, read off
 * `GET /chains` rather than off any list in this build.
 *
 * # Why `implemented`, and not `enabled`
 *
 * These two questions are different and both matter:
 *
 * - `enabled` — "can a user start one right now". That is
 *   `./route-availability`'s job and it changes minute to minute.
 * - `implemented` — "does settlement machinery for this exist at all"
 *   (`Route::as_direction().is_some()` backend-side). That is what decides
 *   whether a route family is worth a row in an aggregate view, and it is
 *   stable.
 *
 * A settled-volume statistic is about money that has ALREADY moved, so it
 * belongs to the second question: a route that is temporarily closed still
 * has real history behind it, and hiding its figure the moment an operator
 * pauses it would silently rewrite the bridge's totals. `SolToRhn` and
 * `RhnToSol` are excluded by the same field, permanently and for the right
 * reason — the backend reports `implemented: false` because no `Direction`
 * value exists for either, so no settlement function can ever be called
 * with them and no volume can ever accrue.
 *
 * # Unknown is empty, never assumed
 *
 * With `/chains` not loaded this returns nothing. A caller renders a
 * loading state; it must not fall back to "the four routes we know about",
 * which would be exactly the hardcoded list this module exists to remove.
 */
export function executableRoutes(
  chains: ChainsViewDto | undefined,
): readonly SettlementRoute[] {
  if (!chains) return [];
  return (
    chains.routes
      .filter((route) => route.implemented)
      .map((route) => route.id)
      // A route the backend implements but this build has no descriptor for
      // is dropped rather than guessed at. It will appear in the Routes list
      // on /status by its backend id — which is a truthful "we know this
      // exists and cannot describe it" — but it gets no figure here, because
      // this build does not know which reserve pays it out or in what unit.
      .filter((id): id is SettlementRoute => isSettlementRoute(id))
  );
}

/** The reserve a route family draws its payout from. */
export type DestinationReserve = DirectionDescriptor["destinationReserve"];

/**
 * The executable route families that settle onto ONE reserve.
 *
 * Grouping is not a presentation choice here — it is what the backend's
 * data actually supports. `GET /stats` reports `settled_volume_atomic` per
 * RESERVE (`reserve_ledger.settled_liquidity_total`), never per route, so
 * once more than one executable route pays out of the same pool their
 * volumes are genuinely indistinguishable in the published figure. With
 * Robinhood live, `SolToGlc` and `RhnToGlc` both settle onto the Goldcoin
 * reserve and share one counter.
 *
 * Attributing that shared counter to either route family alone would
 * publish a number the bridge never claimed — and would silently double
 * the bridge's apparent Goldcoin-side volume if it were shown against
 * both. So the group is the unit, and every family feeding it is named on
 * it.
 */
export interface DestinationReserveGroup {
  readonly reserve: DestinationReserve;
  /** Every executable family settling onto this reserve, in registry order. */
  readonly routes: readonly DirectionDescriptor[];
}

/**
 * Groups routes by destination reserve, preserving the order the reserves
 * were first seen so the view does not reshuffle as routes open and close.
 */
export function destinationReserveGroups(
  routes: readonly SettlementRoute[],
): readonly DestinationReserveGroup[] {
  const groups = new Map<DestinationReserve, DirectionDescriptor[]>();
  for (const route of routes) {
    const descriptor = directions[route];
    const existing = groups.get(descriptor.destinationReserve);
    if (existing) existing.push(descriptor);
    else groups.set(descriptor.destinationReserve, [descriptor]);
  }
  return [...groups].map(([reserve, entries]) => ({ reserve, routes: entries }));
}
