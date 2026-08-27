/**
 * Copy for the SolToGlc per-recipient rate limit: a Goldcoin destination
 * address may receive at most one accepted bridge payout per rolling
 * 24-hour window (glc-solana-reserve-bridge docs/09-runbook.md).
 *
 * The verdict itself always comes from the backend
 * (`GET /recipients/sol-to-glc/eligibility`, `useSolToGlcRecipientEligibility`)
 * — nothing here re-implements the window; this module only renders what
 * the backend answered. The backend also remains the enforcing authority
 * at admission time, so this copy never claims to be the last line of
 * defense — it exists so the user is warned before their wallet is ever
 * opened for a deposit that would only be parked for manual review.
 *
 * Deliberately ONE sentence and nothing else (product decision,
 * 2026-08-27): the blocked state shows exactly this line — no retry-after
 * time, no funds/next elaboration. The backend still returns
 * `retry_after`, and the pre-submit enforcement still uses the full
 * verdict; only the visible copy is reduced.
 */

export const RECIPIENT_RATE_LIMIT_TITLE =
  "This Goldcoin address has already received a bridge payout in the last 24 hours.";
