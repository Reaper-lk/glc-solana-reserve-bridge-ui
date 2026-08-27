/**
 * Copy and helpers for the SolToGlc per-recipient rate limit: a Goldcoin
 * destination address may receive at most one accepted bridge payout per
 * rolling 24-hour window (glc-solana-reserve-bridge docs/09-runbook.md).
 *
 * The verdict itself always comes from the backend
 * (`GET /recipients/sol-to-glc/eligibility`, `useSolToGlcRecipientEligibility`)
 * — nothing here re-implements the window; this module only renders what
 * the backend answered. The backend also remains the enforcing authority
 * at admission time, so this copy never claims to be the last line of
 * defense — it exists so the user is warned before their wallet is ever
 * opened for a deposit that would only be parked for manual review.
 */

export const RECIPIENT_RATE_LIMIT_TITLE =
  "This Goldcoin address has already received a bridge payout in the last 24 hours.";

export const RECIPIENT_RATE_LIMIT_FUNDS =
  "Nothing has been submitted and no funds have moved — the bridge accepts one payout per Goldcoin address per rolling 24-hour window.";

/**
 * "Try again after <time>…" — from the backend's absolute `retry_after`
 * unix timestamp, never a client-side re-derivation of the window. `null`
 * (a blocked verdict that somehow carried no timestamp) degrades to naming
 * the window rather than inventing a time.
 */
export function recipientRateLimitNext(retryAfterUnix: number | null): string {
  const when =
    retryAfterUnix === null
      ? "once the 24-hour window has passed"
      : `after ${new Date(retryAfterUnix * 1000).toLocaleString()}`;
  return `Try again ${when}, or use a different Goldcoin destination address.`;
}
