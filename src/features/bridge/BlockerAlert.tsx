"use client";

import { Alert, ButtonLink } from "@/components/ui";
import {
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  ROBINHOOD_ELIGIBILITY_UNKNOWN_NEXT,
  ROBINHOOD_ELIGIBILITY_UNKNOWN_TITLE,
  ROBINHOOD_RECIPIENT_RATE_LIMIT_TITLE,
  ROBINHOOD_SOURCE_WALLET_RATE_LIMIT_TITLE,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
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
  | "route-not-executable-here"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  | "recipient-rate-limited"
  | "source-wallet-rate-limited"
  | "robinhood-recipient-rate-limited"
  | "robinhood-source-wallet-rate-limited"
  | "robinhood-eligibility-unknown";

export function BlockerAlert({
  blocker,
  directionLabel,
  reason,
  detail,
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
   * The "you can try again in about N hours" line, for the blockers that
   * have one. Empty or absent for every blocker whose approved copy is a
   * single sentence — including the two SolToGlc rate limits, whose
   * product decision is that no retry time is shown at all.
   */
  detail?: string;
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
    // Unlike every blocker above, these two are specific to the ADDRESS
    // typed or the WALLET connected, not to the bridge or the route. Each
    // shows exactly one sentence: empty `funds`/`next` render nothing, and
    // the status-page link (which would show a perfectly healthy bridge)
    // is omitted. The retry-after time the backend returns is deliberately
    // not displayed.
    "recipient-rate-limited": { title: RECIPIENT_RATE_LIMIT_TITLE, funds: "" },
    "source-wallet-rate-limited": { title: SOURCE_WALLET_RATE_LIMIT_TITLE, funds: "" },
    /*
     * The RhnToGlc pre-deposit gate. Three blockers of its own rather
     * than a reuse of the four above, because what is at stake differs:
     * a Robinhood deposit is irreversible and unrefused — the contract
     * takes the GLC and the bridge parks the obligation — so each of
     * these states what has NOT happened yet, which the one-sentence
     * SolToGlc copy deliberately omits.
     */
    "route-unavailable": {
      // The backend's `unavailable_reason`, verbatim.
      title: reason || `${directionLabel} is temporarily unavailable.`,
      funds:
        "Nothing you enter below will submit while this route is unavailable — no deposit is created and no funds move.",
    },
    /*
     * The one blocker whose cause is THIS APP rather than the bridge.
     *
     * Worded so it cannot be read as the route being closed or broken: the
     * route is live, and a reader who goes to /status will see it reported
     * available, so copy blaming the bridge would contradict the page this
     * callout links to. `route-execution` authors the sentence — it is the
     * module that knows which piece is missing — and it is rendered
     * verbatim, the same contract the two backend-reason blockers follow.
     */
    "route-not-executable-here": {
      title: reason || `${directionLabel} cannot be started from this app yet.`,
      funds:
        "Nothing you enter below will submit — no deposit is created, nothing is sent, and no funds move.",
    },
    "robinhood-recipient-rate-limited": {
      title: ROBINHOOD_RECIPIENT_RATE_LIMIT_TITLE,
      funds:
        "A deposit sent now would not be refused — it would be held for manual review with your GLC already in the bridge contract. Nothing has been sent.",
    },
    "robinhood-source-wallet-rate-limited": {
      title: ROBINHOOD_SOURCE_WALLET_RATE_LIMIT_TITLE,
      funds:
        "A deposit sent now would not be refused — it would be held for manual review with your GLC already in the bridge contract. Nothing has been sent.",
    },
    "robinhood-eligibility-unknown": {
      title: ROBINHOOD_ELIGIBILITY_UNKNOWN_TITLE,
      funds: "No funds have moved. Nothing has been sent.",
    },
  };

  const isRateLimited =
    blocker === "recipient-rate-limited" || blocker === "source-wallet-rate-limited";
  const isRobinhoodRateLimited =
    blocker === "robinhood-recipient-rate-limited" ||
    blocker === "robinhood-source-wallet-rate-limited";
  const next =
    blocker === "quota-paused"
      ? QUOTA_PAUSED_NEXT
      : blocker === "quota-exhausted"
        ? "See the current status page for live capacity."
        : isRateLimited
          ? ""
          : isRobinhoodRateLimited
            ? // The backend's own reopen time when it published one, and
              // nothing at all when it did not — never a guessed window.
              (detail ?? "")
            : blocker === "robinhood-eligibility-unknown"
              ? ROBINHOOD_ELIGIBILITY_UNKNOWN_NEXT
              : blocker === "route-not-executable-here"
                ? // No "try again": waiting changes nothing here. The one
                  // useful next step is a pair this app can actually start.
                  "Select another network pair to bridge GLC now."
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
        isRateLimited || isRobinhoodRateLimited ? undefined : (
          <ButtonLink href={routes.status} variant="secondary" size="sm">
            View status
          </ButtonLink>
        )
      }
    />
  );
}
