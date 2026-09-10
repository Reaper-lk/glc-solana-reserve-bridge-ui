import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { routeAvailability } from "@/lib/bridge/route-availability";

/**
 * The network integration strip.
 *
 * # What changed, and why
 *
 * This used to be a pure constant announcing a FUTURE integration:
 * "COMING SOON — Robinhood Network Integration — GLC bridging with
 * Robinhood Chain launches next week." Every word of that is now stale.
 * The routes are implemented and shipped; the strip was still promising
 * them for "next week", which had already passed, and the badge said
 * "Coming soon" about machinery that exists.
 *
 * Deriving it from a constant was the right call while the thing being
 * announced did not exist — there was no live state it could read. That is
 * no longer true, and a hand-edited marketing line about a live route is
 * exactly the thing that goes stale silently. So the strip now reports
 * what `GET /chains` says about the two Robinhood routes, and nothing
 * else.
 *
 * # It still is not the operational strip
 *
 * `BridgeStatusBar` speaks for the bridge as a whole and sits above this.
 * This one is scoped to a single network's integration and says only
 * whether its routes can be used right now. It states no reason and makes
 * no promise about when a closed route opens: the backend publishes a
 * cause-agnostic sentence per route, and /status renders each one beside
 * the route it belongs to.
 *
 * Turning the strip off is a one-line edit to `enabled` below, and every
 * string it renders lives here rather than in the component.
 */

/** The two routes this strip reports on. */
const ROBINHOOD_ROUTES = ["GlcToRhn", "RhnToGlc"] as const;

/**
 * What the strip is reporting, derived from route availability.
 *
 * No `"coming-soon"` member: the routes are implemented, so nothing here
 * may describe them as unbuilt. `"unknown"` is the fail-closed state and
 * is never rendered as availability.
 */
export type NetworkAnnouncementStatus =
  /** Every route on this network is available right now. */
  | "available"
  /** At least one available, at least one not. */
  | "partial"
  /** None of this network's routes can be used right now. */
  | "unavailable"
  /** `/chains` has not answered. Says so; claims nothing. */
  | "unknown";

export interface NetworkAnnouncement {
  readonly enabled: boolean;
  readonly network: string;
  readonly title: string;
  /**
   * Namespaced, matching `THEME_STORAGE_KEY`: this origin also carries the
   * Solana wallet adapter's own storage keys, and a bare `dismissed` would be
   * a collision waiting to happen.
   */
  readonly storageKey: string;
}

export const NETWORK_ANNOUNCEMENT: NetworkAnnouncement = {
  enabled: true,
  network: "Robinhood Network",
  title: "Robinhood Network GLC bridge integration",
  storageKey: "glc-bridge-announcement-robinhood",
};

/**
 * The badge label per status, in one place so the component and its tests
 * agree — and so that adding a status cannot leave the component with a
 * label it has no case for.
 */
export const ANNOUNCEMENT_STATUS_LABEL: Record<NetworkAnnouncementStatus, string> = {
  available: "Available",
  partial: "Partially available",
  unavailable: "Unavailable",
  unknown: "Checking",
};

/**
 * The one line of copy per status.
 *
 * Deliberately neutral and free of launch language: no date, no "coming
 * soon", no "launches". It describes the integration as deployed and then
 * reports what the backend says about its routes, which is the only claim
 * this strip is entitled to make.
 */
export const ANNOUNCEMENT_STATUS_DESCRIPTION: Record<NetworkAnnouncementStatus, string> =
  {
    available:
      "GLC bridging to and from Robinhood Network is available in both directions right now.",
    partial: "Some Robinhood Network bridge routes are temporarily unavailable.",
    unavailable: "Robinhood Network bridge routes are not available right now.",
    unknown: "Checking Robinhood Network route availability…",
  };

/**
 * The strip's status, from `GET /chains` alone.
 *
 * A route counts as available only when the backend positively answered
 * `available: true` — the same fail-closed rule every other consumer of
 * this endpoint applies. `enabled` is not consulted: a route that is
 * switched on and held shut by its destination reserve is not one a user
 * can use, which is the only thing this strip reports.
 */
export function networkAnnouncementStatus(
  chains: ChainsViewDto | undefined,
): NetworkAnnouncementStatus {
  if (!chains) return "unknown";
  const available = ROBINHOOD_ROUTES.filter((route) => {
    const state = routeAvailability(chains, route);
    return state.kind === "open" && state.availabilityKnown;
  }).length;
  if (available === ROBINHOOD_ROUTES.length) return "available";
  if (available === 0) return "unavailable";
  return "partial";
}
