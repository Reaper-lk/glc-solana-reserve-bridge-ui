"use client";

import { Alert, ButtonLink } from "@/components/ui";
import {
  ELIGIBILITY_UNAVAILABLE_NEXT,
  ELIGIBILITY_UNAVAILABLE_TITLE,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
} from "@/lib/bridge";
import { routes } from "@/lib/config/links";

/**
 * Bridge-wide, backend-driven blockers.
 *
 * These get their own callout rather than disappearing into the submit
 * button's disabled-reason text: they are conditions the amount and
 * address fields cannot fix, so a reader should see them before filling
 * anything in, not discover them after clicking a dead-looking button.
 */
export type Blocker =
  | "unavailable"
  | "route-closed"
  | "route-unavailable"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  | "eligibility-blocked"
  | "eligibility-unavailable";

export function BlockerAlert({
  blocker,
  directionLabel,
  reason,
  detail,
  title,
}: {
  blocker: Blocker;
  directionLabel: string;
  /**
   * The backend's own sentence, used verbatim for `route-closed` and
   * `route-unavailable`. This UI never authors a second explanation of a
   * closed route and never infers which gate refused.
   */
  reason: string;
  /**
   * The blocker's own extra line, for the blockers that have one: the
   * backend's reopen time for a wallet inside its rolling window. Empty
   * or absent everywhere else — a window nobody published a time for is
   * never guessed at.
   */
  detail?: string;
  /**
   * The blocked title, for `eligibility-blocked` — which side is inside
   * its window is a fact about the verdict, not about this component, so
   * it is passed in rather than re-derived here.
   */
  title?: string;
}) {
  const copy: Record<Blocker, { title: string; funds: string }> = {
    "route-closed": {
      title: reason || `${directionLabel} is not available.`,
      funds:
        "Nothing you enter below will submit while this route is closed — no funds move.",
    },
    unavailable: {
      title: "We could not reach the bridge status service.",
      funds:
        "No funds have moved. This is a problem loading information, not a problem with a transfer.",
    },
    paused: {
      title: `${directionLabel} is currently paused.`,
      funds:
        "Nothing you enter below will submit while this route is paused — no funds move.",
    },
    "insufficient-liquidity": {
      title: "This route has no reserve capacity available right now.",
      funds:
        "Nothing you enter below will submit until capacity is available — no funds move.",
    },
    // The two quota states carry the approved copy verbatim. Neither may
    // promise a reset time or an automatic reopening: the backend's pause
    // after exhaustion clears only by manual operator action.
    "quota-exhausted": {
      title: QUOTA_EXHAUSTED_TITLE,
      funds: `${QUOTA_EXHAUSTED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    "quota-paused": {
      title: QUOTA_PAUSED_TITLE,
      funds: `${QUOTA_PAUSED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    "route-unavailable": {
      // The backend's `unavailable_reason`, verbatim.
      title: reason || `${directionLabel} is temporarily unavailable.`,
      funds:
        "Nothing you enter below will submit while this route is unavailable — no deposit is created and no funds move.",
    },
    /*
     * The two rolling-24h wallet states, which — unlike every blocker
     * above — are specific to the WALLETS in play rather than to the
     * bridge or the route.
     *
     * Both state plainly that nothing has been sent. On a contract-
     * sourced route that is the whole point: a deposit made while a
     * window is open is not refused, it is folded and held with the GLC
     * already committed, so "nothing has been sent" is the fact a user
     * needs and the one a bare rate-limit sentence leaves out.
     */
    "eligibility-blocked": {
      title: title || `${directionLabel} cannot accept this transfer right now.`,
      funds:
        "Nothing has been sent, and nothing you enter below will submit while this window is open — no funds move.",
    },
    "eligibility-unavailable": {
      title: ELIGIBILITY_UNAVAILABLE_TITLE,
      funds: "No funds have moved. Nothing has been sent.",
    },
  };

  // A wallet-scoped blocker gets no status-page link: the status page
  // would show a perfectly healthy bridge, which is not the answer to
  // "why can I not send".
  const isWalletScoped =
    blocker === "eligibility-blocked" || blocker === "eligibility-unavailable";
  const next =
    blocker === "quota-paused"
      ? QUOTA_PAUSED_NEXT
      : blocker === "quota-exhausted"
        ? "See the current status page for live capacity."
        : blocker === "eligibility-blocked"
          ? // The backend's own reopen time when it published one, and
            // nothing at all when it did not — never a guessed window.
            (detail ?? "")
          : blocker === "eligibility-unavailable"
            ? ELIGIBILITY_UNAVAILABLE_NEXT
            : blocker === "route-closed" || blocker === "route-unavailable"
              ? "You can still select another network pair."
              : "Check your connection and try again, or see the current status.";

  return (
    <Alert
      level="warn"
      title={copy[blocker].title}
      funds={copy[blocker].funds}
      next={next}
      actions={
        isWalletScoped ? undefined : (
          <ButtonLink href={routes.status} variant="secondary" size="sm">
            View status
          </ButtonLink>
        )
      }
    />
  );
}
