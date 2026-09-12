import type { EligibilityRoute, RouteEligibility } from "@/lib/bridge/eligibility";
import { bridgeApi } from ".";

/**
 * The ONE call site for rolling-24h wallet eligibility.
 *
 * Every consumer — the form's live query, the fresh re-read immediately
 * before a wallet is invoked, the tests — goes through this function, so
 * callers name a route and two addresses and get back
 * {@link RouteEligibility} without learning which endpoint answered.
 *
 * # Why this is a thin pass-through
 *
 * It used to branch on the route itself. That put "which endpoint can
 * answer for this route" in front of the API boundary, where it was a
 * claim about the backend baked into the app — so a deployment that
 * served the route-agnostic endpoint could not be used without a
 * frontend change, and the claim could be loosened by editing a table
 * rather than by obtaining a verdict.
 *
 * It belongs behind the boundary instead: `HttpBridgeClient` speaks for
 * the real backend (per-route endpoint where one exists, an attempt at
 * `GET /eligibility` otherwise, `EligibilityEndpointUnpublishedError` on
 * a 404), and `MockBridgeClient` speaks for the fixtures.
 *
 * # Failure is a rejection, never a value
 *
 * This throws. It does not return a "could not check" verdict, because a
 * function that can return both an answer and a non-answer invites a
 * caller to forget which it got. The catch sites turn a rejection into
 * `answer: null`, and `routeEligibilityVerdict` turns that into a
 * refusal.
 */
export {
  EligibilityEndpointUnpublishedError,
  isEligibilityEndpointUnpublished,
} from "@/lib/bridge/eligibility";

/**
 * Asks this deployment for the verdict on one route and one pair of
 * wallets.
 *
 * `source` may be `null` — a caller racing a wallet disconnect, or a
 * route funded by a backend-issued deposit address, where no source
 * wallet exists in the browser at all. That is not smoothed over here:
 * the answer carries which sides were evaluated and which the backend
 * says apply, and `routeEligibilityVerdict` refuses anything short of a
 * clearance for every applicable side.
 */
export function fetchRouteEligibility(
  route: EligibilityRoute,
  source: string | null,
  destination: string,
  signal?: AbortSignal,
): Promise<RouteEligibility> {
  return bridgeApi.getRouteEligibility(route, source, destination, signal);
}
