import {
  eligibilityEndpointFor,
  normalizeRecipientEligibility,
  type EligibilityRoute,
  type RouteEligibility,
} from "@/lib/bridge/eligibility";
import { bridgeApi } from ".";

/**
 * The ONE call site for rolling-24h wallet eligibility.
 *
 * Every consumer — the form's live query, the fresh re-read immediately
 * before a wallet is invoked, the tests — goes through this function, so
 * "which endpoint answers for this route" is decided in exactly one
 * place. Callers name a route and two addresses and get back
 * {@link RouteEligibility}; they never learn that two of the six routes
 * are served by differently-spelled per-route endpoints and four are not
 * served at all.
 *
 * # Failure is a rejection, never a value
 *
 * This throws. It does not return a "could not check" verdict, because a
 * function that can return both an answer and a non-answer invites a
 * caller to forget which it got. The catch sites turn a rejection into
 * `answer: null`, and `routeEligibilityVerdict` turns that into a
 * refusal.
 */

/**
 * Thrown for a route the backend publishes no eligibility endpoint for.
 *
 * A distinct type rather than a generic failure because the two mean
 * different things to an operator: a transport error is transient, and
 * this is a backend dependency that has not shipped. Both block
 * submission identically.
 */
export class EligibilityEndpointUnpublishedError extends Error {
  readonly route: EligibilityRoute;

  constructor(route: EligibilityRoute) {
    super(
      `the bridge API publishes no rolling-24h eligibility endpoint for ${route} yet`,
    );
    this.name = "EligibilityEndpointUnpublishedError";
    this.route = route;
  }
}

/**
 * Asks the authoritative endpoint for one route and one pair of wallets.
 *
 * `source` is required by this UI even though the backend's `?wallet=` is
 * optional: the policy gates BOTH sides, so an answer with the source leg
 * unevaluated is not one that can clear a transfer. Passing `null` is
 * still allowed — it produces exactly that unevaluated answer, which
 * `routeEligibilityVerdict` refuses — so a caller racing a wallet
 * disconnect gets a refusal rather than an exception.
 */
export async function fetchRouteEligibility(
  route: EligibilityRoute,
  source: string | null,
  destination: string,
  signal?: AbortSignal,
): Promise<RouteEligibility> {
  const endpoint = eligibilityEndpointFor(route);
  if (endpoint === null) throw new EligibilityEndpointUnpublishedError(route);

  // The backend's two endpoints take the DESTINATION as `?address=` and
  // the SOURCE wallet as `?wallet=`. The parameter names are the
  // backend's; the roles are this module's, and the mapping between them
  // lives here and nowhere else.
  switch (route) {
    case "SolToGlc": {
      const dto = await bridgeApi.getSolToGlcRecipientEligibility(
        destination,
        source,
        signal,
      );
      return normalizeRecipientEligibility(dto, route);
    }
    case "RhnToGlc": {
      const dto = await bridgeApi.getRhnToGlcRecipientEligibility(
        destination,
        source,
        signal,
      );
      return normalizeRecipientEligibility(dto, route);
    }
    default:
      // Unreachable: `eligibilityEndpointFor` returned non-null only for
      // the two cases above. A refusal rather than a cast, because the
      // alternative is asking a Goldcoin-payout endpoint about a route
      // that does not pay out on Goldcoin.
      throw new EligibilityEndpointUnpublishedError(route);
  }
}
