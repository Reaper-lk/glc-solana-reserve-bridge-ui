/**
 * The network announcement strip.
 *
 * A forward-looking product notice and nothing more. It is deliberately a
 * plain constant rather than a feature flag, a remote config or an API
 * response: this banner describes an integration that does not exist yet, so
 * there is no live state it could be derived from and nothing it could
 * legitimately ask the backend about.
 *
 * That separation is the whole point. The global trust strip above it
 * (`BridgeStatusBar`) reports the bridge as it is right now, from the status
 * endpoint; this reports a plan. Wiring the two together would let a future
 * marketing line be affected by — or worse, be mistaken for — the operational
 * state of real money movement.
 *
 * Turning it off is a one-line edit to `enabled` below, and every string it
 * renders lives here rather than in the component.
 *
 * The strip carries one line of copy and no call to action. It deliberately
 * has no `learnMoreHref`: this deployment serves no Robinhood page and no
 * external URL is configured for one, and a disabled control that explains it
 * cannot be used is still a dead control taking up the row. Nothing to open
 * is better said by showing nothing than by showing a button that refuses.
 *
 * # Announcing the launch
 *
 * The routes are OPEN when `GET /chains` says so, and only then — this
 * constant has no bearing on whether anyone can bridge, and flipping it
 * cannot open anything. It is the marketing line, and it is deliberately
 * kept where a person edits it rather than derived from live state, for
 * the reason above: an announcement that reacted to the status endpoint
 * would eventually be mistaken for it.
 *
 * When the backend actually opens `GlcToRhn`/`RhnToGlc`, the whole change
 * is TWO fields below — `status` to `"live"` and `description` to the
 * launched wording. Nothing in `NetworkAnnouncement.tsx` needs touching:
 * the badge's label, icon and styling are all resolved from `status`
 * there. Verify against `/chains` first; announcing a route the gate still
 * refuses is worse than announcing it a day late.
 */

/**
 * What the strip is announcing. `"live"` exists ahead of its use on
 * purpose — the flip must be an edit to a value, not a change to the
 * component that renders it.
 */
export type NetworkAnnouncementStatus = "coming-soon" | "live";

export interface NetworkAnnouncement {
  readonly enabled: boolean;
  readonly network: string;
  readonly status: NetworkAnnouncementStatus;
  readonly title: string;
  readonly description: string;
  /**
   * Namespaced, matching `THEME_STORAGE_KEY`: this origin also carries the
   * Solana wallet adapter's own storage keys, and a bare `dismissed` would be
   * a collision waiting to happen.
   */
  readonly storageKey: string;
}

export const NETWORK_ANNOUNCEMENT: NetworkAnnouncement = {
  enabled: true,
  // Still "coming-soon": both Robinhood routes ship disabled and the
  // backend gate has not opened them. See this module's doc for the flip.
  status: "coming-soon",
  network: "Robinhood",
  title: "Robinhood Network Integration",
  description: "GLC bridging with Robinhood Chain launches next week.",
  storageKey: "glc-bridge-announcement-robinhood",
};

/**
 * The badge label per status, in one place so the component and its tests
 * agree — and so that adding a status cannot leave the component with a
 * label it has no case for.
 */
export const ANNOUNCEMENT_STATUS_LABEL: Record<NetworkAnnouncementStatus, string> = {
  "coming-soon": "Coming soon",
  live: "Live",
};

/** The pre-launch label, kept as a named export for existing call sites. */
export const COMING_SOON_LABEL = ANNOUNCEMENT_STATUS_LABEL["coming-soon"];
